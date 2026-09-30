// ============================================================
//  엑셀(.xlsx) 안에 박힌 사진 꺼내기
//  · SheetJS(xlsx.full.min.js)는 그림은 읽지 못해서, 이 파일은 xlsx를
//    zip 그대로 열어(JSZip) 그림이 «어느 칸 위에 있는지» 를 직접 봅니다.
//  · 우리 교회에서 쓰는 «사진 대장» 형식(사진 줄 바로 아래 같은 열에 이름 줄)을
//    기준으로 삼습니다 — 반별 사진 파일(꿈새 교적부 사진_중1.xlsx 같은 것)이 이 모양입니다.
// ============================================================
import { loadScript } from "./ui.js";

export async function loadJSZip() {
  if (!window.JSZip) await loadScript("./assets/vendor/jszip.min.js");
  return window.JSZip;
}

/** 1 → A, 27 → AA (1-based) */
function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseXML(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function parseRels(xml) {
  const map = {};
  if (!xml) return map;
  const doc = parseXML(xml);
  for (const r of doc.getElementsByTagName("Relationship"))
    map[r.getAttribute("Id")] = r.getAttribute("Target");
  return map;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = parseXML(xml);
  return [...doc.getElementsByTagName("si")].map((si) =>
    [...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
}

/** 시트의 칸 주소("A1") → 값. 이름이 들어있을 만한 칸(문자/공유문자열)만 읽습니다. */
function parseSheetCells(xml, sst) {
  const doc = parseXML(xml);
  const cells = new Map();
  for (const c of doc.getElementsByTagName("c")) {
    const ref = c.getAttribute("r");
    if (!ref) continue;
    const t = c.getAttribute("t");
    let val = null;
    if (t === "s") {
      const idx = Number(c.getElementsByTagName("v")[0]?.textContent);
      val = Number.isFinite(idx) ? (sst[idx] ?? "") : "";
    } else if (t === "inlineStr") {
      val = c.getElementsByTagName("t")[0]?.textContent ?? "";
    } else {
      const v = c.getElementsByTagName("v")[0];
      if (v) val = v.textContent;
    }
    if (val !== null) cells.set(ref, val);
  }
  return cells;
}

/** «xl» 기준 상대경로(«../media/image1.jpg» 등)를 zip 안 전체경로로 바꿉니다 */
function resolvePath(baseDir, target) {
  const parts = `${baseDir}/${target}`.split("/");
  const out = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop(); else out.push(p);
  }
  return out.join("/");
}

const EXT_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
                   gif: "image/gif", bmp: "image/bmp", webp: "image/webp" };
const mimeOf = (path) => EXT_MIME[(path.split(".").pop() || "").toLowerCase()] || "image/jpeg";

// ── 칸 크기 (엑셀 단위 → EMU) ─────────────────────────────
//  그림이 «실제로 어디에 얼마나 크게» 놓였는지 알려면 열 너비·행 높이가 필요합니다.
const EMU_PX = 9525, EMU_PT = 12700;
function sheetGeometry(doc) {
  const fmt = doc.getElementsByTagName("sheetFormatPr")[0];
  const defW = Number(fmt?.getAttribute("defaultColWidth")) || 8.43;
  const defH = Number(fmt?.getAttribute("defaultRowHeight")) || 15;
  const colW = new Map(), rowH = new Map();
  for (const c of doc.getElementsByTagName("col")) {
    const a = Number(c.getAttribute("min")), b = Number(c.getAttribute("max")), w = Number(c.getAttribute("width"));
    if (a && b && w) for (let i = a; i <= Math.min(b, a + 400); i++) colW.set(i - 1, w);
  }
  for (const r of doc.getElementsByTagName("row")) {
    const i = Number(r.getAttribute("r")), h = Number(r.getAttribute("ht"));
    if (i && h) rowH.set(i - 1, h);
  }
  const cw = (c) => ((colW.get(c) ?? defW) * 7 + 5) * EMU_PX;   // 글자 폭 7px 기준 (엑셀 기본)
  const rh = (r) => (rowH.get(r) ?? defH) * EMU_PT;
  const xs = [0], ys = [0];
  const colX = (c) => { while (xs.length <= c) xs.push(xs[xs.length - 1] + cw(xs.length - 1)); return xs[c]; };
  const rowY = (r) => { while (ys.length <= r) ys.push(ys[ys.length - 1] + rh(ys.length - 1)); return ys[r]; };
  return { colX, rowY, cell: (r, c) => [colX(c), rowY(r), colX(c + 1), rowY(r + 1)] };
}

const num = (el, tag) => Number(el?.getElementsByTagName(tag)[0]?.textContent);
const overlap = (a, b) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
/** "A1" → [행, 열] (0부터) */
function refRC(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || "");
  if (!m) return null;
  let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, c - 1];
}
const LABEL_WORDS = new Set(["사진", "이름", "성명", "번호", "학년", "반"]);

/**
 * 파일 하나에서 «(사진, 그 사진의 이름)» 목록을 뽑아냅니다.
 *  · 엑셀에서 «자르기» 한 그림은 원본 단체사진이 통째로 들어 있고, 어디를 잘랐는지만 적혀 있습니다.
 *    예전에는 이걸 몰라서 단체사진 전체를 가져왔고, 그래서 얼굴 찾기가 엉뚱한 사람을 잡았습니다.
 *    이제는 엑셀 화면에 보이는 그대로(자르기 · 돌리기 · 뒤집기까지) 잘라 옵니다.
 *  · 이름은 «그림이 실제로 가장 많이 덮고 있는 사진 칸» 바로 아래 칸에서 찾습니다.
 *    그림이 옆 칸으로 삐져나가 있어도 제자리를 찾고, 한 이름에 두 장이 붙지 않게 합니다.
 * 반환: [{ sheet, name, blob(미리보기용 작은 사진), make() }]
 *   make() → 올릴 때 한 장씩 부르면 { full(세운 원본 캔버스), vis(보이던 부분 [x,y,w,h]), release() }
 */
export async function extractPhotosFromWorkbook(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const readText = async (path) => { const f = zip.file(path); return f ? f.async("string") : null; };
  const readBlob = async (path) => { const f = zip.file(path); return f ? f.async("blob") : null; };

  const workbookXml = await readText("xl/workbook.xml");
  if (!workbookXml) throw new Error("엑셀 파일(.xlsx)이 아닌 것 같습니다.");
  const wbDoc = parseXML(workbookXml);
  const sheetEls = [...wbDoc.getElementsByTagName("sheet")];
  const wbRels = parseRels(await readText("xl/_rels/workbook.xml.rels"));
  const sst = parseSharedStrings(await readText("xl/sharedStrings.xml"));
  const out = [];

  for (const sheetEl of sheetEls) {
    const sheetName = sheetEl.getAttribute("name") || "";
    const rId = sheetEl.getAttribute("r:id");
    const target = rId && wbRels[rId];
    if (!target) continue;
    const sheetPath = resolvePath("xl", target);
    const sheetXml = await readText(sheetPath);
    if (!sheetXml) continue;
    const cells = parseSheetCells(sheetXml, sst);
    const sheetDoc = parseXML(sheetXml);
    const geo = sheetGeometry(sheetDoc);

    const sheetDir = sheetPath.split("/").slice(0, -1).join("/");
    const sheetBase = sheetPath.split("/").pop();
    const sheetRels = parseRels(await readText(`${sheetDir}/_rels/${sheetBase}.rels`));
    const drawingRId = sheetDoc.getElementsByTagName("drawing")[0]?.getAttribute("r:id");
    const drawingTarget = drawingRId && sheetRels[drawingRId];
    if (!drawingTarget) continue;
    const drawingPath = resolvePath(sheetDir, drawingTarget);
    const drawingXml = await readText(drawingPath);
    if (!drawingXml) continue;
    const drawingDir = drawingPath.split("/").slice(0, -1).join("/");
    const drawingBase = drawingPath.split("/").pop();
    const drawingRels = parseRels(await readText(`${drawingDir}/_rels/${drawingBase}.rels`));
    const drawDoc = parseXML(drawingXml);

    // ── 이름 자리: 글자가 있고, 바로 위 칸(=사진 칸)이 비어 있는 칸 ──
    const text = new Map();                       // "행,열" → 글자
    for (const [ref, v] of cells) {
      const rc = refRC(ref); const t = String(v ?? "").trim();
      if (rc && t) text.set(`${rc[0]},${rc[1]}`, t);
    }
    const slots = [];
    for (const [k, t] of text) {
      const [r, c] = k.split(",").map(Number);
      if (r > 0 && !LABEL_WORDS.has(t.replace(/\s/g, "")) && !text.has(`${r - 1},${c}`))
        slots.push({ r, c, name: t, box: geo.cell(r - 1, c) });
    }

    // ── 그림마다: 실제 자리 · 원본 · 자른 부분 · 돌림/뒤집기 ──
    const pics = [];
    const anchors = [
      ...drawDoc.getElementsByTagName("xdr:twoCellAnchor"),
      ...drawDoc.getElementsByTagName("xdr:oneCellAnchor"),
    ];
    for (const anchor of anchors) {
      const fromEl = anchor.getElementsByTagName("xdr:from")[0];
      if (!fromEl) continue;
      const col0 = num(fromEl, "xdr:col"), row0 = num(fromEl, "xdr:row");
      if (!Number.isFinite(row0) || !Number.isFinite(col0)) continue;
      const x0 = geo.colX(col0) + (num(fromEl, "xdr:colOff") || 0);
      const y0 = geo.rowY(row0) + (num(fromEl, "xdr:rowOff") || 0);
      let x1, y1;
      const toEl = anchor.getElementsByTagName("xdr:to")[0];
      const extEl = anchor.getElementsByTagName("xdr:ext")[0] || anchor.getElementsByTagName("a:ext")[0];
      if (toEl) {
        x1 = geo.colX(num(toEl, "xdr:col")) + (num(toEl, "xdr:colOff") || 0);
        y1 = geo.rowY(num(toEl, "xdr:row")) + (num(toEl, "xdr:rowOff") || 0);
      } else {
        x1 = x0 + (Number(extEl?.getAttribute("cx")) || 0);
        y1 = y0 + (Number(extEl?.getAttribute("cy")) || 0);
      }
      const embedId = anchor.getElementsByTagName("a:blip")[0]?.getAttribute("r:embed");
      const mediaTarget = embedId && drawingRels[embedId];
      if (!mediaTarget) continue;
      const mediaPath = resolvePath(drawingDir, mediaTarget);
      const sr = anchor.getElementsByTagName("a:srcRect")[0];
      const pct = (k) => (Number(sr?.getAttribute(k)) || 0) / 100000;
      const xf = anchor.getElementsByTagName("a:xfrm")[0];
      pics.push({
        rect: [x0, y0, Math.max(x1, x0 + 1), Math.max(y1, y0 + 1)], row0, col0, mediaPath,
        crop: { l: pct("l"), t: pct("t"), r: pct("r"), b: pct("b") },
        rot: (Number(xf?.getAttribute("rot")) || 0) / 60000,
        flipH: xf?.getAttribute("flipH") === "1", flipV: xf?.getAttribute("flipV") === "1",
      });
    }

    // ── 짝짓기: 가장 많이 겹치는 사진 칸부터, 이름 하나에 사진 한 장 ──
    const cand = [];
    pics.forEach((p, i) => {
      const area = (p.rect[2] - p.rect[0]) * (p.rect[3] - p.rect[1]);
      slots.forEach((s, j) => { const o = overlap(p.rect, s.box); if (o > 0) cand.push([o / area, i, j]); });
    });
    cand.sort((a, b) => b[0] - a[0]);
    const picSlot = new Map(), usedSlot = new Set();
    for (const [, i, j] of cand) {
      if (picSlot.has(i) || usedSlot.has(j)) continue;
      picSlot.set(i, j); usedSlot.add(j);
    }

    for (const [i, p] of pics.entries()) {
      // 겹치는 사진 칸이 없으면 예전 규칙(그림 왼쪽 위 칸 바로 아래)으로 찾아봅니다
      const name = picSlot.has(i) ? slots[picSlot.get(i)].name
        : String(cells.get(colLetter(p.col0 + 1) + (p.row0 + 2)) ?? "").trim();
      const media = await readBlob(p.mediaPath);
      if (!media) continue;
      const src = new Blob([media], { type: mimeOf(p.mediaPath) });
      const make = () => renderPicture(src, p);
      let blob;
      try { blob = await thumbOf(make); } catch { blob = src; }
      out.push({ sheet: sheetName, name, blob, make });
    }
  }
  return out;
}

/** 엑셀 화면에 보이던 그대로 만들기 — 원본을 돌리고/뒤집은 «세운 원본» 과, 그 안에서 보이던 부분 */
async function renderPicture(src, p) {
  let bmp;
  //  엑셀은 사진 속 회전 정보(EXIF)를 쓰지 않고 자기 «돌리기» 값만 씁니다 — 똑같이 맞춥니다
  try { bmp = await createImageBitmap(src, { imageOrientation: "none" }); }
  catch { bmp = await createImageBitmap(src); }
  const W = bmp.width, H = bmp.height;
  const quarter = Math.round((((p.rot % 360) + 360) % 360) / 90) % 4;   // 90° 단위만 (엑셀 사진 대장은 늘 이렇습니다)
  const swap = quarter % 2 === 1;
  const full = document.createElement("canvas");
  full.width = swap ? H : W; full.height = swap ? W : H;
  const m = new DOMMatrix()
    .translate(full.width / 2, full.height / 2)
    .rotate(quarter * 90)
    .scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1)
    .translate(-W / 2, -H / 2);
  const ctx = full.getContext("2d");
  ctx.setTransform(m);
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  // 보이던 부분 = 원본에서 자른 네모를 같은 식으로 옮긴 자리
  const c = p.crop;
  const pts = [[W * c.l, H * c.t], [W * (1 - c.r), H * c.t], [W * c.l, H * (1 - c.b)], [W * (1 - c.r), H * (1 - c.b)]]
    .map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const vx = Math.max(0, Math.min(...xs)), vy = Math.max(0, Math.min(...ys));
  const vis = [vx, vy, Math.max(1, Math.min(full.width, Math.max(...xs)) - vx), Math.max(1, Math.min(full.height, Math.max(...ys)) - vy)];
  return { full, vis, release() { full.width = full.height = 0; } };
}

/** 미리보기용 작은 사진 (보이던 부분만) */
async function thumbOf(make) {
  const { full, vis, release } = await make();
  const k = Math.min(1, 240 / Math.max(vis[2], vis[3]));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(vis[2] * k)); cv.height = Math.max(1, Math.round(vis[3] * k));
  cv.getContext("2d").drawImage(full, vis[0], vis[1], vis[2], vis[3], 0, 0, cv.width, cv.height);
  release();
  return new Promise((res) => cv.toBlob((b) => res(b), "image/jpeg", 0.88));
}
