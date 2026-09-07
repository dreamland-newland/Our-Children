// ============================================================
//  사진에서 얼굴 찾기
//  · tracking.js(BSD)를 저장소에 함께 넣어 두었습니다 — 인터넷 없이도 동작합니다.
//  · 사진을 0° · 90° · 270° 로 돌려 가며 찾기 때문에,
//    옆으로 누운 사진도 «어느 쪽이 위인지» 함께 알려 줍니다.
//  · 얼굴을 못 찾으면 null 을 돌려줍니다 (그럴 땐 사람이 직접 맞추면 됩니다).
// ============================================================
import { loadScript } from "./ui.js";

/** 찾을 때 쓰는 그림 크기 — 크면 잘 찾지만 느립니다 */
const WORK_PX = 640;
/** 얼굴 둘레를 얼마나 넉넉히 담을지 (2.05면 얼굴 너비의 2.05배가 사진 한 변 — 머리 위 여백과 어깨가 함께 들어옵니다) */
export const FACE_TIGHTNESS = 2.05;

let loading = null;
export function loadFaceFinder() {
  if (window.tracking?.ViolaJones?.classifiers?.face) return Promise.resolve(window.tracking);
  loading ||= (async () => {
    await loadScript("./assets/vendor/tracking-min.js");
    await loadScript("./assets/vendor/tracking-face-min.js");
    return window.tracking;
  })();
  return loading;
}

/** 사진을 deg 만큼 돌려서 그린 캔버스 (긴 쪽이 max 픽셀) */
function rotatedCanvas(source, iw, ih, deg, max) {
  const swap = deg % 180 !== 0;
  const sw = swap ? ih : iw, sh = swap ? iw : ih;
  const sc = max ? Math.min(1, max / Math.max(sw, sh)) : 1;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(sw * sc));
  cv.height = Math.max(1, Math.round(sh * sc));
  const c = cv.getContext("2d", { willReadFrequently: true });
  c.imageSmoothingQuality = "high";
  c.translate(cv.width / 2, cv.height / 2);
  c.rotate((deg * Math.PI) / 180);
  c.drawImage(source, (-iw * sc) / 2, (-ih * sc) / 2, iw * sc, ih * sc);
  return { cv, sc, w: sw, h: sh };
}

/**
 * 얼굴 찾기.
 * @returns null | {
 *   deg,        // 이 각도로 돌려야 얼굴이 똑바로 섭니다 (0·90·180·270)
 *   count,      // 그 각도에서 찾은 얼굴 수 (여럿이면 단체사진일 수 있습니다)
 *   box,        // 돌린 뒤 그림 기준 얼굴 자리 {x, y, w, h}
 *   width, height,  // 돌린 뒤 그림 크기
 * }
 */
export async function findFace(source, { width, height } = {}) {
  const tr = await loadFaceFinder();
  const iw = width ?? source.width ?? source.naturalWidth;
  const ih = height ?? source.height ?? source.naturalHeight;
  if (!iw || !ih) return null;

  let best = null;
  // 180°(뒤집힌 얼굴)는 실제로 거의 없는데 헛짚기 쉬워서 보지 않습니다
  for (const deg of [0, 90, 270]) {
    const { cv, sc, w, h } = rotatedCanvas(source, iw, ih, deg, WORK_PX);
    const px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    let found = [];
    try {
      found = tr.ViolaJones.detect(px.data, cv.width, cv.height,
        1, 1.25, 1.7, 0.2, tr.ViolaJones.classifiers.face) || [];
    } catch { found = []; }
    if (found.length) {
      const b = [...found].sort((x, y) => y.width - x.width)[0];
      const cand = {
        deg, count: found.length, width: w, height: h,
        box: { x: b.x / sc, y: b.y / sc, w: b.width / sc, h: b.height / sc },
      };
      // 얼굴이 «많이» 잡힌 쪽이 진짜 방향입니다. 같으면 더 큰 얼굴 쪽.
      if (!best || cand.count > best.count ||
          (cand.count === best.count && cand.box.w > best.box.w)) best = cand;
      // 똑바로 선 사진에서 이미 찾았으면 더 돌려볼 필요가 없습니다
      if (deg === 0) break;
    }
  }
  return best;
}

/** 찾은 얼굴을 가운데 담는 «자를 네모» (돌린 뒤 그림 기준) */
export function faceCropRect(hit, tight = FACE_TIGHTNESS) {
  const { box, width, height } = hit;
  const size = Math.min(Math.max(box.w, box.h) * tight, width, height);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h * 0.50;          // 머리 위 여백과 어깨가 고르게 들어오도록
  return {
    size,
    x: Math.min(Math.max(0, cx - size / 2), width - size),
    y: Math.min(Math.max(0, cy - size / 2), height - size),
  };
}

/**
 * 사진 한 장을 «얼굴에 맞춰» 정사각형으로 잘라 줍니다 (엑셀로 한꺼번에 올릴 때).
 * · 얼굴이 하나만 또렷하게 잡힐 때만 잘라 주고, 못 찾거나 여러 명이면 null 을 돌려줍니다.
 *   (단체사진에서 누구 얼굴인지는 앱이 알 수 없으니 사람이 정하는 게 맞습니다)
 */
export async function autoFaceCrop(blob, { size = 400, quality = 0.85, maxFaces = 1 } = {}) {
  let bitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch { try { bitmap = await createImageBitmap(blob); } catch { return null; } }
  try {
    const hit = await findFace(bitmap);
    if (!hit || hit.count > maxFaces) return null;
    const { cv } = rotatedCanvas(bitmap, bitmap.width, bitmap.height, hit.deg, 0);
    const r = faceCropRect(hit);
    const out = document.createElement("canvas");
    out.width = out.height = size;
    const c = out.getContext("2d");
    c.imageSmoothingQuality = "high";
    c.drawImage(cv, r.x, r.y, r.size, r.size, 0, 0, size, size);
    return await new Promise((res) => out.toBlob((b) => res(b || null), "image/jpeg", quality));
  } finally { bitmap.close?.(); }
}
