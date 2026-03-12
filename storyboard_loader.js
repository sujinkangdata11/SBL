import { app } from "../../scripts/app.js";

const GRID_COLS = 5;
const PAGE_SIZE_IMG = 25;
const PAGE_SIZE_SCENE = 20;

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

function sectionLabel(text) {
  return el("div", {
    style: {
      color: "#aaa", fontSize: "11px", fontWeight: "bold",
      textTransform: "uppercase", letterSpacing: "1px",
      marginBottom: "4px", marginTop: "10px",
    }
  }, [text]);
}

function styledInput(placeholder, defaultVal, onBlur) {
  const input = el("input", {
    type: "text", placeholder,
    style: {
      width: "100%", background: "#1a1a1a", border: "1px solid #444",
      borderRadius: "4px", color: "#eee", padding: "5px 8px",
      fontSize: "12px", boxSizing: "border-box", marginBottom: "6px",
    }
  });
  input.value = defaultVal || "";
  input.addEventListener("blur", () => onBlur(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") onBlur(input.value); });
  return input;
}

function paginationBar(page, totalPages, onPage) {
  const bar = el("div", { style: { display: "flex", alignItems: "center", gap: "6px", margin: "6px 0", justifyContent: "center" } });
  const btn = (label, disabled, onClick) => {
    const b = el("button", {
      style: {
        background: "#333", border: "1px solid #555", color: "#eee",
        borderRadius: "3px", padding: "2px 10px", cursor: disabled ? "default" : "pointer",
        opacity: disabled ? "0.4" : "1",
      }
    }, [label]);
    if (!disabled) b.addEventListener("click", onClick);
    return b;
  };
  bar.appendChild(btn("◀", page <= 1, () => onPage(page - 1)));
  bar.appendChild(el("span", { style: { color: "#aaa", fontSize: "11px" } }, [`${page} / ${totalPages}`]));
  bar.appendChild(btn("▶", page >= totalPages, () => onPage(page + 1)));
  return bar;
}

// ─────────────────────────────────────────────
// Gallery builders
// ─────────────────────────────────────────────

function buildImageGallery(container, folder, endpoint, page, onPageChange) {
  container.innerHTML = "";
  if (!folder || !folder.trim()) {
    container.appendChild(el("div", { style: { color: "#555", fontSize: "11px", padding: "6px 0" } }, ["경로를 입력하세요"]));
    return;
  }

  container.appendChild(el("div", { style: { color: "#888", fontSize: "11px", padding: "4px 0" } }, ["불러오는 중..."]));

  fetch(`/storyboard/${endpoint}?folder=${encodeURIComponent(folder)}&page=${page}&page_size=${PAGE_SIZE_IMG}`)
    .then(r => r.json())
    .then(data => {
      container.innerHTML = "";
      if (!data.items || data.items.length === 0) {
        container.appendChild(el("div", { style: { color: "#666", fontSize: "11px", padding: "4px 0" } }, ["이미지 없음"]));
        return;
      }

      const grid = el("div", {
        style: {
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
          gap: "4px", marginBottom: "4px",
        }
      });

      for (const item of data.items) {
        const stem = item.filename.replace(/\.[^.]+$/, "");
        const cell = el("div", {
          style: {
            background: "#1a1a1a", borderRadius: "4px", overflow: "hidden",
            border: "1px solid #333",
          }
        });
        if (item.thumb) {
          cell.appendChild(el("img", {
            src: item.thumb,
            style: { width: "100%", display: "block", aspectRatio: "1", objectFit: "cover" }
          }));
        }
        cell.appendChild(el("div", {
          style: { color: "#777", fontSize: "9px", textAlign: "center", padding: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
        }, [stem]));
        grid.appendChild(cell);
      }
      container.appendChild(grid);

      const totalPages = Math.ceil(data.total / PAGE_SIZE_IMG);
      if (totalPages > 1) {
        container.appendChild(paginationBar(page, totalPages, (p) => {
          onPageChange(p);
          buildImageGallery(container, folder, endpoint, p, onPageChange);
        }));
      }
    })
    .catch(err => {
      container.innerHTML = "";
      container.appendChild(el("div", { style: { color: "#f66", fontSize: "11px" } }, [`폴더 로드 실패: ${err.message}`]));
    });
}

function buildSceneList(container, folder, page, onPageChange) {
  container.innerHTML = "";
  if (!folder || !folder.trim()) {
    container.appendChild(el("div", { style: { color: "#555", fontSize: "11px", padding: "6px 0" } }, ["경로를 입력하세요"]));
    return;
  }

  container.appendChild(el("div", { style: { color: "#888", fontSize: "11px", padding: "4px 0" } }, ["불러오는 중..."]));

  fetch(`/storyboard/scenes?folder=${encodeURIComponent(folder)}&page=${page}&page_size=${PAGE_SIZE_SCENE}`)
    .then(r => r.json())
    .then(data => {
      container.innerHTML = "";
      if (!data.items || data.items.length === 0) {
        container.appendChild(el("div", { style: { color: "#666", fontSize: "11px" } }, ["장면 파일 없음"]));
        return;
      }

      for (const item of data.items) {
        const card = el("div", {
          style: {
            background: "#1a1a1a", border: "1px solid #333",
            borderRadius: "4px", padding: "6px 8px", marginBottom: "4px",
          }
        });
        card.appendChild(el("div", { style: { color: "#ccc", fontSize: "11px", fontWeight: "bold", marginBottom: "2px" } }, [item.filename]));
        card.appendChild(el("div", { style: { color: "#777", fontSize: "10px", marginBottom: "2px" } },
          [`배경: ${item.background ?? "-"}  |  캐릭터: ${(item.characters || []).join(", ") || "-"}`]));
        card.appendChild(el("div", { style: { color: "#aaa", fontSize: "10px", whiteSpace: "pre-wrap", wordBreak: "break-word" } }, [item.prompt || ""]));
        container.appendChild(card);
      }

      const totalPages = Math.ceil(data.total / PAGE_SIZE_SCENE);
      if (totalPages > 1) {
        container.appendChild(paginationBar(page, totalPages, (p) => {
          onPageChange(p);
          buildSceneList(container, folder, p, onPageChange);
        }));
      }
    })
    .catch(err => {
      container.innerHTML = "";
      container.appendChild(el("div", { style: { color: "#f66", fontSize: "11px" } }, [`폴더 로드 실패: ${err.message}`]));
    });
}

// ─────────────────────────────────────────────
// Node registration
// ─────────────────────────────────────────────

app.registerExtension({
  name: "StoryboardLoader",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "StoryboardLoader") return;

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;

    nodeType.prototype.onNodeCreated = function () {
      if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

      const self = this;

      const state = { bgFolder: "", charFolder: "", sceneFolder: "", bgPage: 1, charPage: 1, scenePage: 1 };

      // ── wrapper ──
      const wrapper = el("div", {
        style: { padding: "8px", background: "#1e1e1e", borderRadius: "6px", minWidth: "360px", fontFamily: "sans-serif" }
      });

      // ── Background ──
      wrapper.appendChild(sectionLabel("🖼 배경 폴더"));
      const bgInput = styledInput("배경 폴더 경로", "", (v) => {
        state.bgFolder = v;
        syncWidget("background_folder", v);
        state.bgPage = 1;
        buildImageGallery(bgGallery, v, "backgrounds", 1, (p) => { state.bgPage = p; });
      });
      const bgGallery = el("div", { style: { minHeight: "30px" } });
      wrapper.appendChild(bgInput);
      wrapper.appendChild(bgGallery);

      // ── Character ──
      wrapper.appendChild(sectionLabel("🧍 캐릭터 폴더"));
      const charInput = styledInput("캐릭터 폴더 경로", "", (v) => {
        state.charFolder = v;
        syncWidget("character_folder", v);
        state.charPage = 1;
        buildImageGallery(charGallery, v, "characters", 1, (p) => { state.charPage = p; });
      });
      const charGallery = el("div", { style: { minHeight: "30px" } });
      wrapper.appendChild(charInput);
      wrapper.appendChild(charGallery);

      // ── Scene ──
      wrapper.appendChild(sectionLabel("📄 장면 폴더"));
      const sceneInput = styledInput("장면 폴더 경로", "", (v) => {
        state.sceneFolder = v;
        syncWidget("scene_folder", v);
        state.scenePage = 1;
        buildSceneList(sceneList, v, 1, (p) => { state.scenePage = p; });
      });
      const sceneList = el("div", { style: { minHeight: "30px" } });
      wrapper.appendChild(sceneInput);
      wrapper.appendChild(sceneList);

      // ── sync helper ──
      const syncWidget = (name, value) => {
        const w = self.widgets?.find(w => w.name === name);
        if (w) { w.value = value; self.setDirtyCanvas(true); }
      };

      // ── DOM widget ──
      self.addDOMWidget("storyboard_ui", "div", wrapper, {
        getValue() { return ""; },
        setValue() {},
        serialize: false,
      });

      // ── sync saved values → input boxes on load ──
      setTimeout(() => {
        const bgW    = self.widgets?.find(w => w.name === "background_folder");
        const charW  = self.widgets?.find(w => w.name === "character_folder");
        const sceneW = self.widgets?.find(w => w.name === "scene_folder");

        if (bgW?.value)    { bgInput.value    = bgW.value;    state.bgFolder    = bgW.value;    buildImageGallery(bgGallery,    bgW.value,    "backgrounds", 1, (p) => { state.bgPage    = p; }); }
        if (charW?.value)  { charInput.value  = charW.value;  state.charFolder  = charW.value;  buildImageGallery(charGallery,  charW.value,  "characters",  1, (p) => { state.charPage  = p; }); }
        if (sceneW?.value) { sceneInput.value = sceneW.value; state.sceneFolder = sceneW.value; buildSceneList(sceneList, sceneW.value, 1, (p) => { state.scenePage = p; }); }
      }, 500);
    };
  }
});
