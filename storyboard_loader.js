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
      color: "#aaa",
      fontSize: "11px",
      fontWeight: "bold",
      textTransform: "uppercase",
      letterSpacing: "1px",
      marginBottom: "4px",
      marginTop: "8px",
    }
  }, [text]);
}

function inputBox(placeholder, defaultVal, onBlur) {
  const input = el("input", {
    type: "text",
    placeholder,
    style: {
      width: "100%",
      background: "#1a1a1a",
      border: "1px solid #444",
      borderRadius: "4px",
      color: "#eee",
      padding: "4px 8px",
      fontSize: "12px",
      boxSizing: "border-box",
      marginBottom: "6px",
    }
  });
  input.value = defaultVal || "";
  input.addEventListener("blur", () => onBlur(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") onBlur(input.value); });
  return input;
}

function paginationBar(page, totalPages, onPage) {
  const bar = el("div", { style: { display: "flex", alignItems: "center", gap: "6px", margin: "4px 0", justifyContent: "center" } });
  const prevBtn = el("button", {
    style: { background: "#333", border: "1px solid #555", color: "#eee", borderRadius: "3px", padding: "2px 10px", cursor: "pointer" }
  }, ["◀"]);
  const pageInfo = el("span", { style: { color: "#aaa", fontSize: "11px" } }, [`${page} / ${totalPages}`]);
  const nextBtn = el("button", {
    style: { background: "#333", border: "1px solid #555", color: "#eee", borderRadius: "3px", padding: "2px 10px", cursor: "pointer" }
  }, ["▶"]);

  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;
  prevBtn.style.opacity = page <= 1 ? "0.4" : "1";
  nextBtn.style.opacity = page >= totalPages ? "0.4" : "1";

  prevBtn.addEventListener("click", () => { if (page > 1) onPage(page - 1); });
  nextBtn.addEventListener("click", () => { if (page < totalPages) onPage(page + 1); });

  bar.appendChild(prevBtn);
  bar.appendChild(pageInfo);
  bar.appendChild(nextBtn);
  return bar;
}

// ─────────────────────────────────────────────
// Gallery section builder
// ─────────────────────────────────────────────

function buildImageGallery(container, folder, endpoint, page, onPageChange) {
  container.innerHTML = "";
  if (!folder) {
    container.appendChild(el("div", { style: { color: "#666", fontSize: "11px", padding: "4px" } }, ["경로를 입력하세요"]));
    return;
  }

  const loading = el("div", { style: { color: "#888", fontSize: "11px", padding: "4px" } }, ["불러오는 중..."]);
  container.appendChild(loading);

  fetch(`/storyboard/${endpoint}?folder=${encodeURIComponent(folder)}&page=${page}&page_size=${PAGE_SIZE_IMG}`)
    .then(r => r.json())
    .then(data => {
      container.innerHTML = "";
      if (!data.items || data.items.length === 0) {
        container.appendChild(el("div", { style: { color: "#666", fontSize: "11px", padding: "4px" } }, ["이미지 없음"]));
        return;
      }

      const grid = el("div", {
        style: {
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
          gap: "4px",
          marginBottom: "4px",
        }
      });

      for (const item of data.items) {
        const stem = item.filename.replace(/\.[^.]+$/, "");
        const cell = el("div", {
          style: {
            background: "#1a1a1a",
            borderRadius: "4px",
            overflow: "hidden",
            border: "1px solid #333",
            cursor: "default",
          }
        });
        if (item.thumb) {
          const img = el("img", {
            src: item.thumb,
            style: { width: "100%", display: "block", aspectRatio: "1", objectFit: "cover" }
          });
          cell.appendChild(img);
        }
        const label = el("div", {
          style: { color: "#888", fontSize: "9px", textAlign: "center", padding: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
        }, [stem]);
        cell.appendChild(label);
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
    .catch(() => {
      container.innerHTML = "";
      container.appendChild(el("div", { style: { color: "#f66", fontSize: "11px" } }, ["폴더 로드 실패"]));
    });
}

function buildSceneList(container, folder, page, onPageChange) {
  container.innerHTML = "";
  if (!folder) {
    container.appendChild(el("div", { style: { color: "#666", fontSize: "11px", padding: "4px" } }, ["경로를 입력하세요"]));
    return;
  }

  const loading = el("div", { style: { color: "#888", fontSize: "11px", padding: "4px" } }, ["불러오는 중..."]);
  container.appendChild(loading);

  fetch(`/storyboard/scenes?folder=${encodeURIComponent(folder)}&page=${page}&page_size=${PAGE_SIZE_SCENE}`)
    .then(r => r.json())
    .then(data => {
      container.innerHTML = "";
      if (!data.items || data.items.length === 0) {
        container.appendChild(el("div", { style: { color: "#666", fontSize: "11px", padding: "4px" } }, ["장면 파일 없음"]));
        return;
      }

      for (const item of data.items) {
        const card = el("div", {
          style: {
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: "4px",
            padding: "6px 8px",
            marginBottom: "4px",
          }
        });

        const title = el("div", {
          style: { color: "#ccc", fontSize: "11px", fontWeight: "bold", marginBottom: "3px" }
        }, [item.filename]);

        const meta = el("div", {
          style: { color: "#888", fontSize: "10px", marginBottom: "3px" }
        }, [`배경: ${item.background ?? "-"}  |  캐릭터: ${(item.characters || []).join(", ") || "-"}`]);

        const prompt = el("div", {
          style: { color: "#aaa", fontSize: "10px", whiteSpace: "pre-wrap", wordBreak: "break-word" }
        }, [item.prompt || ""]);

        card.appendChild(title);
        card.appendChild(meta);
        card.appendChild(prompt);
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
    .catch(() => {
      container.innerHTML = "";
      container.appendChild(el("div", { style: { color: "#f66", fontSize: "11px" } }, ["폴더 로드 실패"]));
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
      self.serialize_widgets = true;

      // state
      const state = {
        bgFolder: "",
        charFolder: "",
        sceneFolder: "",
        bgPage: 1,
        charPage: 1,
        scenePage: 1,
      };

      // ── outer wrapper ──
      const wrapper = el("div", {
        style: {
          padding: "8px",
          background: "#222",
          borderRadius: "6px",
          minWidth: "340px",
          fontFamily: "sans-serif",
        }
      });

      // ── Background section ──
      wrapper.appendChild(sectionLabel("🖼 배경 폴더"));
      const bgInput = inputBox("배경 폴더 경로", state.bgFolder, (v) => {
        state.bgFolder = v;
        // sync to widget
        const w = self.widgets?.find(w => w.name === "background_folder");
        if (w) w.value = v;
        state.bgPage = 1;
        buildImageGallery(bgGallery, v, "backgrounds", state.bgPage, (p) => { state.bgPage = p; });
      });
      const bgGallery = el("div", { style: { minHeight: "40px" } });
      wrapper.appendChild(bgInput);
      wrapper.appendChild(bgGallery);

      // ── Character section ──
      wrapper.appendChild(sectionLabel("🧍 캐릭터 폴더"));
      const charInput = inputBox("캐릭터 폴더 경로", state.charFolder, (v) => {
        state.charFolder = v;
        const w = self.widgets?.find(w => w.name === "character_folder");
        if (w) w.value = v;
        state.charPage = 1;
        buildImageGallery(charGallery, v, "characters", state.charPage, (p) => { state.charPage = p; });
      });
      const charGallery = el("div", { style: { minHeight: "40px" } });
      wrapper.appendChild(charInput);
      wrapper.appendChild(charGallery);

      // ── Scene section ──
      wrapper.appendChild(sectionLabel("📄 장면 폴더"));
      const sceneInput = inputBox("장면 폴더 경로", state.sceneFolder, (v) => {
        state.sceneFolder = v;
        const w = self.widgets?.find(w => w.name === "scene_folder");
        if (w) w.value = v;
        state.scenePage = 1;
        buildSceneList(sceneList, v, state.scenePage, (p) => { state.scenePage = p; });
      });
      const sceneList = el("div", { style: { minHeight: "40px" } });
      wrapper.appendChild(sceneInput);
      wrapper.appendChild(sceneList);

      // ── Add DOM widget ──
      const domWidget = self.addDOMWidget("storyboard_ui", "div", wrapper, {
        getValue() { return ""; },
        setValue() {},
        serialize: false,
      });

      // sync existing widget values → input boxes
      setTimeout(() => {
        const bgW = self.widgets?.find(w => w.name === "background_folder");
        const charW = self.widgets?.find(w => w.name === "character_folder");
        const sceneW = self.widgets?.find(w => w.name === "scene_folder");

        if (bgW?.value) { bgInput.value = bgW.value; state.bgFolder = bgW.value; buildImageGallery(bgGallery, bgW.value, "backgrounds", 1, (p) => { state.bgPage = p; }); }
        if (charW?.value) { charInput.value = charW.value; state.charFolder = charW.value; buildImageGallery(charGallery, charW.value, "characters", 1, (p) => { state.charPage = p; }); }
        if (sceneW?.value) { sceneInput.value = sceneW.value; state.sceneFolder = sceneW.value; buildSceneList(sceneList, sceneW.value, 1, (p) => { state.scenePage = p; }); }
      }, 300);
    };
  }
});
