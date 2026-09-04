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

/**
 * 파일 하나에서 «(사진, 그 아래 칸 이름)» 목록을 뽑아냅니다.
 * 반환: [{ sheet, name, blob }]  — name이 빈 값이면 이름 칸을 못 찾은 사진입니다.
 */
export async function extractPhotosFromWorkbook(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);

  const readText = async (path) => {
    const f = zip.file(path);
    return f ? f.async("string") : null;
  };
  const readBuf = async (path) => {
    const f = zip.file(path);
    return f ? f.async("arraybuffer") : null;
  };

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

    const sheetDir = sheetPath.split("/").slice(0, -1).join("/");
    const sheetBase = sheetPath.split("/").pop();
    const sheetRels = parseRels(await readText(`${sheetDir}/_rels/${sheetBase}.rels`));

    const sheetDoc = parseXML(sheetXml);
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
    const anchors = [
      ...drawDoc.getElementsByTagName("xdr:twoCellAnchor"),
      ...drawDoc.getElementsByTagName("xdr:oneCellAnchor"),
    ];

    for (const anchor of anchors) {
      const fromEl = anchor.getElementsByTagName("xdr:from")[0];
      if (!fromEl) continue;
      const row0 = Number(fromEl.getElementsByTagName("xdr:row")[0]?.textContent);
      const col0 = Number(fromEl.getElementsByTagName("xdr:col")[0]?.textContent);
      if (!Number.isFinite(row0) || !Number.isFinite(col0)) continue;

      const embedId = anchor.getElementsByTagName("a:blip")[0]?.getAttribute("r:embed");
      const mediaTarget = embedId && drawingRels[embedId];
      if (!mediaTarget) continue;
      const mediaPath = resolvePath(drawingDir, mediaTarget);
      const buf = await readBuf(mediaPath);
      if (!buf) continue;

      // 검증된 규칙: 사진이 앉은 칸 «바로 아래, 같은 열» 에 이름이 있습니다
      // («사진» 줄 다음 줄이 «이름» 줄인 교회 사진 대장 양식)
      const ref = colLetter(col0 + 1) + (row0 + 2);
      const name = String(cells.get(ref) ?? "").trim();
      const blob = new Blob([buf], { type: mimeOf(mediaPath) });
      out.push({ sheet: sheetName, name, blob });
    }
  }
  return out;
}
