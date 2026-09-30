// ============================================================
//  사진에서 얼굴 찾기
//  · tracking.js(BSD)를 저장소에 함께 넣어 두었습니다 — 인터넷 없이도 동작합니다.
//  · 사진을 0° · 90° · 270° 로 돌려 가며 찾기 때문에,
//    옆으로 누운 사진도 «어느 쪽이 위인지» 함께 알려 줍니다.
//  · 얼굴을 못 찾으면 null 을 돌려줍니다 (그럴 땐 사람이 직접 맞추면 됩니다).
// ============================================================
import { loadScript, drawScaled, PHOTO_MAX, PHOTO_MIN, PHOTO_Q, FRAME, ORIG_MAX } from "./ui.js";

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
export async function findFace(source, { width, height, pick = "largest", degs = [0, 90, 270], near = null } = {}) {
  const tr = await loadFaceFinder();
  const iw = width ?? source.width ?? source.naturalWidth;
  const ih = height ?? source.height ?? source.naturalHeight;
  if (!iw || !ih) return null;

  let best = null;
  // 180°(뒤집힌 얼굴)는 실제로 거의 없는데 헛짚기 쉬워서 보지 않습니다
  for (const deg of degs) {
    const { cv, sc, w, h } = rotatedCanvas(source, iw, ih, deg, WORK_PX);
    const px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    let found = [];
    try {
      found = tr.ViolaJones.detect(px.data, cv.width, cv.height,
        1, 1.25, 1.7, 0.2, tr.ViolaJones.classifiers.face) || [];
    } catch { found = []; }
    if (found.length) {
      //  «largest» — 가장 큰 얼굴 / «center» — 가운데에 가장 가깝고 큰 얼굴
      //  (단체사진에서 한 사람 쪽으로 잘라 둔 사진은, 그 사람이 가운데 크게 있고 옆 사람은 가장자리에 걸칩니다)
      //  near = [가로 비율, 세로 비율] — 이 점에 가까운 얼굴을 고릅니다 (없으면 한가운데)
      const cx = cv.width * (near ? near[0] : 0.5), cy = cv.height * (near ? near[1] : 0.5);
      const diag = Math.hypot(cv.width, cv.height);
      const score = (f) => Math.hypot(f.x + f.width / 2 - cx, f.y + f.height / 2 - cy) / diag - 0.6 * (f.width / cv.width);
      const b = pick === "center"
        ? [...found].sort((x, y) => score(x) - score(y))[0]
        : [...found].sort((x, y) => y.width - x.width)[0];
      const cand = {
        deg, count: found.length, width: w, height: h,
        box: { x: b.x / sc, y: b.y / sc, w: b.width / sc, h: b.height / sc },
        all: found.map((f) => ({ x: f.x / sc, y: f.y / sc, w: f.width / sc, h: f.height / sc })),
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

/** 머리(정수리~턱) 한가운데 (cx, cy) 와 머리 높이 headH 로 «4:5 틀» 자리를 잡습니다 (사진 밖으로 나가지 않게) */
function frameAround(cx, cy, headH, width, height) {
  let w = headH / (2 * FRAME.head.ry);
  let h = w * FRAME.ratio;
  const k = Math.min(1, width / w, height / h);   // 사진보다 크면 사진 안으로 줄입니다
  w *= k; h *= k;
  return {
    w, h,
    x: Math.min(Math.max(0, cx - w * FRAME.head.cx), width - w),
    y: Math.min(Math.max(0, cy - w * FRAME.head.cy), height - h),
  };
}

/** 찾은 얼굴을 «4:5 틀» 의 점선 타원(정수리~턱)에 맞추는 자리 (돌린 뒤 그림 기준).
 *  얼굴 찾기가 잡는 네모는 «눈썹 위 ~ 턱» 쯤이라, 정수리까지 위로 넉넉히 늘려 잡습니다.
 *  (실제 사진 70장으로 재 보니 머리 높이 ≈ 네모 높이 × 1.44, 머리 한가운데 ≈ 네모 위에서 30%) */
export function faceFrameRect(hit) {
  const { box, width, height } = hit;
  return frameAround(box.x + box.w / 2, box.y + box.h * 0.30, box.h * 1.44, width, height);
}

/**
 * 사진 한 장을 «얼굴에 맞춰» 4:5 틀로 잘라 줍니다 (엑셀로 한꺼번에 올릴 때).
 * · 얼굴이 하나만 또렷하게 잡힐 때만 잘라 주고, 못 찾거나 여러 명이면 null 을 돌려줍니다.
 *   (단체사진에서 누구 얼굴인지는 앱이 알 수 없으니 사람이 정하는 게 맞습니다)
 */
export async function autoFaceCrop(blob, { size = PHOTO_MAX, quality = PHOTO_Q, maxFaces = 1 } = {}) {
  let bitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch { try { bitmap = await createImageBitmap(blob); } catch { return null; } }
  try {
    const hit = await findFace(bitmap);
    if (!hit || hit.count > maxFaces) return null;
    const { cv } = rotatedCanvas(bitmap, bitmap.width, bitmap.height, hit.deg, 0);
    const r = faceFrameRect(hit);
    // 원본에서 실제로 쓰는 픽셀만큼 저장합니다 (있는 화질을 버리지도, 억지로 늘리지도 않게)
    const pw = Math.round(Math.min(size, Math.max(PHOTO_MIN, r.w)));
    const out = document.createElement("canvas");
    out.width = pw; out.height = Math.round(pw * FRAME.ratio);
    const c = out.getContext("2d");
    drawScaled(c, cv, r.x, r.y, r.w, r.h, out.width, out.height);
    const blob = await new Promise((res) => out.toBlob((b) => res(b || null), "image/jpeg", quality));
    if (!blob) return null;
    //  «다시 자르기» 할 수 있도록 세운 원본도 같이 붙여 둡니다
    const k = Math.min(1, ORIG_MAX / Math.max(cv.width, cv.height));
    const oc = document.createElement("canvas");
    oc.width = Math.max(1, Math.round(cv.width * k)); oc.height = Math.max(1, Math.round(cv.height * k));
    drawScaled(oc.getContext("2d"), cv, 0, 0, cv.width, cv.height, oc.width, oc.height);
    const orig = await new Promise((res) => oc.toBlob((b) => res(b || null), "image/jpeg", 0.9));
    if (orig) { blob.original = orig; blob.crop = { x: r.x / cv.width, y: r.y / cv.height, w: r.w / cv.width }; }
    return blob;
  } finally { bitmap.close?.(); }
}

/**
 * 엑셀 사진 대장에서 꺼낸 사진을 «4:5 틀» 로 만듭니다.
 *   full : 돌리고 세운 원본(단체사진 전체) 캔버스
 *   vis  : 엑셀에서 보이던 부분 [x, y, w, h]
 * · useFace 면 «보이던 부분» 안에서 가운데 얼굴을 찾아, 원본 전체에서 머리·목·어깨까지 넉넉히 잡습니다.
 *   (엑셀에서 딱 얼굴만 잘라 뒀어도 원본에는 여백이 있으니까요)
 * · 얼굴을 못 찾으면 선생님이 엑셀에서 잘라 둔 부분을 그대로 가운데에 둡니다.
 * · 원본(긴 쪽 ORIG_MAX)도 함께 붙여서, 나중에 «다시 자르기» 로 단체사진 전체에서 다시 고를 수 있습니다.
 * 반환: { blob, faced }
 */
export async function framePhoto(full, vis, { useFace = true, size = PHOTO_MAX, quality = PHOTO_Q } = {}) {
  const FW = full.width, FH = full.height;
  const [vx, vy, vw, vh] = vis;
  //  기본값: 선생님이 엑셀에서 잘라 둔 부분 = «머리 + 조금» 이라고 보고 머리 자리를 어림합니다
  //  (70장을 재 보니 머리 높이 ≈ 자른 높이 × 0.78, 머리 한가운데 ≈ 위에서 47%)
  let head = { cx: vx + vw / 2, cy: vy + vh * 0.47, h: vh * 0.78 };
  let faced = false;
  if (useFace) {
    try {
      //  얼굴이 사진을 꽉 채우면 얼굴 찾기가 오히려 못 찾아서, 둘레를 넉넉히 넣고 찾습니다
      const pad = 0.6 * Math.max(vw, vh);
      const rx = Math.max(0, vx - pad), ry = Math.max(0, vy - pad);
      const rw = Math.min(FW, vx + vw + pad) - rx, rh = Math.min(FH, vy + vh + pad) - ry;
      const s = Math.min(1, 900 / Math.max(rw, rh));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(rw * s)); c.height = Math.max(1, Math.round(rh * s));
      c.getContext("2d").drawImage(full, rx, ry, rw, rh, 0, 0, c.width, c.height);
      const near = [(vx + vw / 2 - rx) / rw, (vy + vh / 2 - ry) / rh];
      const hit = await findFace(c, { width: c.width, height: c.height, pick: "center", degs: [0], near });
      if (hit) {
        const b = { x: rx + hit.box.x / s, y: ry + hit.box.y / s, w: hit.box.w / s, h: hit.box.h / s };
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        //  엉뚱한 사람을 잡지 않도록: 찾은 얼굴이 «잘라 둔 부분 안» 에 있고 크기도 그럴듯할 때만 씁니다
        const inside = bcx > vx && bcx < vx + vw && bcy > vy && bcy < vy + vh;
        const sized = b.w > vw * 0.25 && b.w < vw * 1.1;
        if (inside && sized) { head = { cx: bcx, cy: b.y + b.h * 0.30, h: b.h * 1.44 }; faced = true; }
      }
    } catch (e) { console.warn("얼굴 찾기 실패 — 잘라 둔 대로 씁니다", e); }
  }
  const r = frameAround(head.cx, head.cy, head.h, FW, FH);
  const pw = Math.round(Math.min(size, Math.max(PHOTO_MIN, r.w)));
  const out = document.createElement("canvas");
  out.width = pw; out.height = Math.round(pw * FRAME.ratio);
  drawScaled(out.getContext("2d"), full, r.x, r.y, r.w, r.h, out.width, out.height);
  const blob = await new Promise((res) => out.toBlob((b) => res(b), "image/jpeg", quality));
  if (!blob) return { blob: null, faced };
  const ko = Math.min(1, ORIG_MAX / Math.max(FW, FH));
  const oc = document.createElement("canvas");
  oc.width = Math.max(1, Math.round(FW * ko)); oc.height = Math.max(1, Math.round(FH * ko));
  drawScaled(oc.getContext("2d"), full, 0, 0, FW, FH, oc.width, oc.height);
  const orig = await new Promise((res) => oc.toBlob((b) => res(b), "image/jpeg", 0.9));
  if (orig) { blob.original = orig; blob.crop = { x: r.x / FW, y: r.y / FH, w: r.w / FW }; }
  return { blob, faced };
}
