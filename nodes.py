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

def _find_image_by_number(folder: str, number: int) -> str:
    """숫자 파일명으로 이미지 찾기 (확장자 무관)"""
    folder_path = Path(folder.strip())
    for ext in ALLOWED_EXTENSIONS:
        candidate = folder_path / f"{number}{ext}"
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError(
        f"이미지를 찾을 수 없습니다: {folder_path / str(number)}"
        f" (시도한 확장자: {', '.join(ALLOWED_EXTENSIONS)})"
    )


def _load_images_from_folder(folder: str) -> List[Dict[str, Any]]:
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
    import torch
    img = Image.open(path).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _merge_character_images(paths: List[str]) -> Image.Image:
    """캐릭터 이미지들을 가로로 합쳐서 PIL Image 반환"""
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
    return merged


def _combine_images(bg: Image.Image, char: Image.Image, mode: str) -> Image.Image:
    """배경 + 캐릭터 합성"""

    if mode == "side_by_side":
        # 가로로 이어붙이기
        max_h = max(bg.height, char.height)
        bg_r = bg.resize((int(bg.width * max_h / bg.height), max_h), Image.LANCZOS)
        char_r = char.resize((int(char.width * max_h / char.height), max_h), Image.LANCZOS)
        combined = Image.new("RGB", (bg_r.width + char_r.width, max_h))
        combined.paste(bg_r, (0, 0))
        combined.paste(char_r, (bg_r.width, 0))
        return combined

    elif mode == "character_bottom":
        # 배경 아래에 캐릭터 배치 (세로로 붙이기)
        max_w = max(bg.width, char.width)
        bg_r = bg.resize((max_w, int(bg.height * max_w / bg.width)), Image.LANCZOS)
        char_r = char.resize((max_w, int(char.height * max_w / char.width)), Image.LANCZOS)
        combined = Image.new("RGB", (max_w, bg_r.height + char_r.height))
        combined.paste(bg_r, (0, 0))
        combined.paste(char_r, (0, bg_r.height))
        return combined

    else:  # overlay - 캐릭터를 배경 위에 오버레이 (배경 크기 기준, 캐릭터를 하단 중앙에 배치)
        combined = bg.copy()
        # 캐릭터를 배경 높이의 80% 크기로 리사이즈
        char_h = int(bg.height * 0.8)
        char_ratio = char.width / char.height
        char_w = int(char_h * char_ratio)
        # 배경보다 넓으면 폭 기준으로 리사이즈
        if char_w > bg.width:
            char_w = int(bg.width * 0.9)
            char_h = int(char_w / char_ratio)
        char_r = char.resize((char_w, char_h), Image.LANCZOS)
        # 하단 중앙 배치
        x = (bg.width - char_w) // 2
        y = bg.height - char_h
        combined.paste(char_r, (x, y))
        return combined


def _pil_to_tensor(img: Image.Image):
    import torch
    arr = np.array(img.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


# ─────────────────────────────────────────────
# Node
# ─────────────────────────────────────────────

class StoryboardLoader:
    CATEGORY = "storyboard"
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("combined_image", "background_image", "character_image", "prompt_text")
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
                "combine_mode":      (["overlay", "character_bottom", "side_by_side"], {"default": "overlay"}),
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
        combine_mode: str = "overlay",
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
        bg_path = _find_image_by_number(background_folder, bg_num)
        bg_pil = Image.open(bg_path).convert("RGB")
        bg_tensor = _pil_to_tensor(bg_pil)

        # 캐릭터 이미지 로드 및 합성
        char_nums = scene.get("characters", [])
        if not char_nums:
            raise ValueError("Scene 파일에 CHARACTERS 번호가 없습니다.")
        char_paths = [_find_image_by_number(character_folder, n) for n in char_nums]
        char_pil = _merge_character_images(char_paths)
        char_tensor = _pil_to_tensor(char_pil)

        # 배경 + 캐릭터 합성
        combined_pil = _combine_images(bg_pil, char_pil, combine_mode)
        combined_tensor = _pil_to_tensor(combined_pil)

        # 프롬프트
        prompt = scene.get("prompt", "")

        with STATE_LOCK:
            STORYBOARD_STATE[node_id] = {
                "background_folder": background_folder,
                "character_folder": character_folder,
                "scene_folder": scene_folder,
                "scene_index": scene_index,
            }

        _send_state_update(node_id, background_folder, character_folder, scene_folder, scene_index)

        return (combined_tensor, bg_tensor, char_tensor, prompt)


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
    page_items = items[start:start + page_size]
    result = [{"filename": i["filename"], "thumb": _image_to_base64(i["path"])} for i in page_items]
    return web.json_response({"items": result, "total": total, "page": page, "page_size": page_size})


@routes.get("/storyboard/characters")
async def get_characters(request):
    folder = request.query.get("folder", "")
    page = int(request.query.get("page", 1))
    page_size = int(request.query.get("page_size", 25))
    items = _load_images_from_folder(folder)
    total = len(items)
    start = (page - 1) * page_size
    page_items = items[start:start + page_size]
    result = [{"filename": i["filename"], "thumb": _image_to_base64(i["path"])} for i in page_items]
    return web.json_response({"items": result, "total": total, "page": page, "page_size": page_size})


@routes.get("/storyboard/scenes")
async def get_scenes(request):
    folder = request.query.get("folder", "")
    page = int(request.query.get("page", 1))
    page_size = int(request.query.get("page_size", 20))
    items = _load_scenes_from_folder(folder)
    total = len(items)
    start = (page - 1) * page_size
    page_items = items[start:start + page_size]
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
