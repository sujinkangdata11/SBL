import io
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from PIL import Image
from aiohttp import web
from server import PromptServer


STATE_LOCK = threading.Lock()
STORYBOARD_STATE: Dict[str, Dict[str, Any]] = {}

PACKAGE_DIR = Path(__file__).resolve().parent
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _load_images_from_folder(folder: str) -> List[Dict[str, Any]]:
    """폴더에서 이미지 파일 목록 반환 (숫자 파일명 정렬)"""
    folder_path = Path(folder.strip())
    if not folder_path.exists():
        return []

    items = []
    for f in folder_path.iterdir():
        if f.suffix.lower() in ALLOWED_EXTENSIONS:
            items.append({"filename": f.name, "path": str(f)})

    def sort_key(item):
        stem = Path(item["filename"]).stem
        try:
            return (0, int(stem))
        except ValueError:
            return (1, stem)

    items.sort(key=sort_key)
    return items


def _load_scenes_from_folder(folder: str) -> List[Dict[str, Any]]:
    """장면 폴더에서 Scene*.txt 파일 목록 반환"""
    folder_path = Path(folder.strip())
    if not folder_path.exists():
        return []

    items = []
    for f in folder_path.iterdir():
        if f.suffix.lower() == ".txt":
            try:
                content = f.read_text(encoding="utf-8")
                items.append({"filename": f.name, "path": str(f), "content": content})
            except Exception:
                pass

    def sort_key(item):
        match = re.search(r"(\d+)", item["filename"])
        return int(match.group(1)) if match else 999999

    items.sort(key=sort_key)
    return items


def _image_to_base64(path: str, max_size: int = 200) -> str:
    """이미지를 base64 썸네일로 변환"""
    import base64
    try:
        img = Image.open(path).convert("RGB")
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=80)
        return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


def _parse_scene(content: str) -> Dict[str, Any]:
    """Scene.txt 파싱"""
    result = {"background": None, "characters": [], "prompt": ""}
    for line in content.splitlines():
        line = line.strip()
        if line.upper().startswith("BACKGROUND:"):
            val = line.split(":", 1)[1].strip()
            try:
                result["background"] = int(val)
            except ValueError:
                pass
        elif line.upper().startswith("CHARACTERS:"):
            val = line.split(":", 1)[1].strip()
            result["characters"] = [int(x.strip()) for x in val.split(",") if x.strip().isdigit()]
        elif line.upper().startswith("PROMPT:"):
            result["prompt"] = line.split(":", 1)[1].strip()
    return result


def _load_image_tensor(path: str):
    """이미지 파일 → ComfyUI IMAGE tensor"""
    import torch
    img = Image.open(path).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _merge_character_images(paths: List[str]):
    """캐릭터 이미지들을 가로로 합쳐서 1장으로"""
    import torch
    images = [Image.open(p).convert("RGB") for p in paths]
    max_h = max(img.height for img in images)
    resized = []
    for img in images:
        ratio = max_h / img.height
        new_w = int(img.width * ratio)
        resized.append(img.resize((new_w, max_h), Image.LANCZOS))

    total_w = sum(img.width for img in resized)
    merged = Image.new("RGB", (total_w, max_h))
    x = 0
    for img in resized:
        merged.paste(img, (x, 0))
        x += img.width

    arr = np.array(merged).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


# ─────────────────────────────────────────────
# Node
# ─────────────────────────────────────────────

class StoryboardLoader:
    CATEGORY = "storyboard"
    RETURN_TYPES = ("IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("background_image", "character_image", "prompt_text")
    FUNCTION = "load"
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "background_folder": ("STRING", {"default": "C:/storyboard/backgrounds", "multiline": False}),
                "character_folder":  ("STRING", {"default": "C:/storyboard/characters",  "multiline": False}),
                "scene_folder":      ("STRING", {"default": "C:/storyboard/scenes",       "multiline": False}),
                "scene_index":       ("INT",    {"default": 1, "min": 1, "max": 9999, "step": 1}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def load(
        self,
        background_folder: str,
        character_folder: str,
        scene_folder: str,
        scene_index: int,
        unique_id: str = "unknown",
    ):
        node_id = str(unique_id)

        # 장면 파일 로드
        scenes = _load_scenes_from_folder(scene_folder)
        if not scenes:
            raise FileNotFoundError(f"장면 폴더에 txt 파일이 없습니다: {scene_folder}")

        idx = min(scene_index - 1, len(scenes) - 1)
        scene = _parse_scene(scenes[idx]["content"])

        # 배경 이미지 로드
        bg_num = scene.get("background")
        if bg_num is None:
            raise ValueError("Scene 파일에 BACKGROUND 번호가 없습니다.")
        bg_path = Path(background_folder.strip()) / f"{bg_num}.png"
        if not bg_path.exists():
            raise FileNotFoundError(f"배경 이미지를 찾을 수 없습니다: {bg_path}")
        bg_tensor = _load_image_tensor(str(bg_path))

        # 캐릭터 이미지 로드 및 합성
        char_nums = scene.get("characters", [])
        if not char_nums:
            raise ValueError("Scene 파일에 CHARACTERS 번호가 없습니다.")
        char_paths = [str(Path(character_folder.strip()) / f"{n}.png") for n in char_nums]
        for p in char_paths:
            if not Path(p).exists():
                raise FileNotFoundError(f"캐릭터 이미지를 찾을 수 없습니다: {p}")
        char_tensor = _merge_character_images(char_paths)

        # 프롬프트
        prompt = scene.get("prompt", "")

        # 프론트엔드용 상태 저장
        with STATE_LOCK:
            STORYBOARD_STATE[node_id] = {
                "background_folder": background_folder,
                "character_folder": character_folder,
                "scene_folder": scene_folder,
                "scene_index": scene_index,
            }

        _send_state_update(node_id, background_folder, character_folder, scene_folder, scene_index)

        return (bg_tensor, char_tensor, prompt)


# ─────────────────────────────────────────────
# State & WebSocket
# ─────────────────────────────────────────────

def _send_state_update(node_id, bg_folder, char_folder, scene_folder, scene_index):
    PromptServer.instance.send_sync("storyboard_update", {
        "node_id": node_id,
        "background_folder": bg_folder,
        "character_folder": char_folder,
        "scene_folder": scene_folder,
        "scene_index": scene_index,
    })


# ─────────────────────────────────────────────
# REST API routes
# ─────────────────────────────────────────────

routes = PromptServer.instance.routes


@routes.get("/storyboard/backgrounds")
async def get_backgrounds(request):
    folder = request.query.get("folder", "")
    page = int(request.query.get("page", 1))
    page_size = int(request.query.get("page_size", 25))

    items = _load_images_from_folder(folder)
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end]

    result = []
    for item in page_items:
        result.append({
            "filename": item["filename"],
            "thumb": _image_to_base64(item["path"]),
        })

    return web.json_response({"items": result, "total": total, "page": page, "page_size": page_size})


@routes.get("/storyboard/characters")
async def get_characters(request):
    folder = request.query.get("folder", "")
    page = int(request.query.get("page", 1))
    page_size = int(request.query.get("page_size", 25))

    items = _load_images_from_folder(folder)
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end]

    result = []
    for item in page_items:
        result.append({
            "filename": item["filename"],
            "thumb": _image_to_base64(item["path"]),
        })

    return web.json_response({"items": result, "total": total, "page": page, "page_size": page_size})


@routes.get("/storyboard/scenes")
async def get_scenes(request):
    folder = request.query.get("folder", "")
    page = int(request.query.get("page", 1))
    page_size = int(request.query.get("page_size", 20))

    items = _load_scenes_from_folder(folder)
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end]

    result = []
    for item in page_items:
        parsed = _parse_scene(item["content"])
        result.append({
            "filename": item["filename"],
            "content": item["content"],
            "background": parsed["background"],
            "characters": parsed["characters"],
            "prompt": parsed["prompt"],
        })

    return web.json_response({"items": result, "total": total, "page": page, "page_size": page_size})


# ─────────────────────────────────────────────
# Registration
# ─────────────────────────────────────────────

NODE_CLASS_MAPPINGS = {
    "StoryboardLoader": StoryboardLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StoryboardLoader": "Storyboard Loader",
}
