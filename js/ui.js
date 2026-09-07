// ============================================================
//  UI 헬퍼
// ============================================================

// «하늘아이» 배지 온/오프 (올해중1 화면에서 켜고 끄면 주소록·셀편성에도 같이 적용됩니다)
const SKY_KEY = "kkumttang.promoted.showSky";
export function showSkyBadge() {
  try { return localStorage.getItem(SKY_KEY) !== "off"; } catch { return true; }
}
export function setShowSkyBadge(v) {
  try { localStorage.setItem(SKY_KEY, v ? "on" : "off"); } catch {}
}

/** HTML 이스케이프 */
export function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** 값이 없으면 흐린 대시 */
export function dash(v) {
  return v ? esc(v) : '<span style="color:var(--text-muted)">—</span>';
}

/** 태그 만들기 */
export function h(tag, attrs = {}, html = "") {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  if (html) el.innerHTML = html;
  return el;
}

/** 전화번호 정규화 / 표기 */
export const digits = (p) => String(p || "").replace(/\D/g, "");
export function fmtPhone(p) {
  const d = digits(p);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return p || "";
}
export function telLink(p) {
  if (!p) return dash(p);
  return `<a class="tel" href="tel:${esc(digits(p))}" data-num="${esc(fmtPhone(p))}"
    >${esc(fmtPhone(p))}</a>`;
}

/** 마우스로 쓰는 기기인가 (전화 앱이 없을 가능성이 큼) */
export const isDesktop = () =>
  window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true;

/** PC에서 전화번호를 누르면 전화 앱 대신 복사해 줍니다. */
export function installTelCopy() {
  document.addEventListener("click", async (e) => {
    const a = e.target.closest?.("a.tel");
    if (!a || !isDesktop()) return;          // 휴대폰에서는 그대로 전화 앱으로
    e.preventDefault();
    const num = a.dataset.num || a.textContent.trim();
    try {
      await navigator.clipboard.writeText(num);
      toast(`${num} 복사했습니다.`);
    } catch {
      const t = document.createElement("textarea");
      t.value = num; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); toast(`${num} 복사했습니다.`); }
      catch { toast("복사하지 못했습니다. 번호를 직접 선택해 주세요.", "err"); }
      t.remove();
    }
  });
}

/** 생년월일 → "2011. 11. 26. (14세)" */
export function fmtBirth(b, withAge = true) {
  if (!b) return "";
  const [y, m, d] = String(b).split("-").map(Number);
  if (!y || !m || !d) return String(b);
  let s = `${y}. ${m}. ${d}.`;
  if (withAge) {
    const t = new Date();
    let age = t.getFullYear() - y;
    if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) age--;
    s += ` (만 ${age}세)`;
  }
  return s;
}
export function birthMD(row) {
  if (row.birth) {
    const [, m, d] = String(row.birth).split("-").map(Number);
    return { m, d };
  }
  if (row.birth_md) {
    const [m, d] = String(row.birth_md).split("-").map(Number);
    return { m, d };
  }
  return null;
}

/** 토스트 */
export function toast(msg, kind = "") {
  const root = document.getElementById("toastRoot");
  const t = h("div", { class: "toast " + kind }, esc(msg));
  root.appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .25s"; t.style.opacity = "0"; }, 2400);
  setTimeout(() => t.remove(), 2750);
}

/** 모달 열기. body 는 HTML 문자열 또는 Element. 반환: close() */
export function modal({ title, body, footer, narrow = false, wide = false, onMount }) {
  const root = document.getElementById("modalRoot");
  const overlay = h("div", { class: "overlay" });
  const box = h("div", { class: "modal" + (narrow ? " narrow" : "") + (wide ? " wide" : "") });
  box.innerHTML = `
    <div class="modal-head">
      <h3>${esc(title)}</h3>
      <button class="icon-btn" data-close aria-label="닫기">✕</button>
    </div>
    <div class="modal-body"></div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ""}`;
  const bodyEl = box.querySelector(".modal-body");
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  overlay.appendChild(box);
  root.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  onMount?.(box, close);
  return close;
}

/** 확인 대화상자 */
export function confirmDialog(message, { danger = true, okText = "삭제" } = {}) {
  return new Promise((resolve) => {
    const close = modal({
      title: "확인",
      narrow: true,
      body: `<p style="margin:0;font-size:14px;line-height:1.6">${esc(message)}</p>`,
      footer: `<button class="btn" data-no>취소</button>
               <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(okText)}</button>`,
      onMount(box, cl) {
        box.querySelector("[data-no]").onclick = () => { cl(); resolve(false); };
        box.querySelector("[data-yes]").onclick = () => { cl(); resolve(true); };
      },
    });
    void close;
  });
}

/** 가로 막대 차트 (단일 계열) */
export function barChart(rows, { alt = false } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows.map((r) => `
    <div class="bar-row">
      <span class="bar-label">${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-fill${alt ? " alt" : ""}" style="width:${(r.value / max) * 100}%"></span></span>
      <span class="bar-value">${r.value}</span>
    </div>`).join("");
}

/** CSV 내려받기 (엑셀에서 바로 열리도록 BOM 포함) */
export function downloadCSV(filename, headers, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** 로컬 스크립트 한 번만 불러오기 (CDN 의존 없음) */
const _loaded = new Map();
export function loadScript(src) {
  if (_loaded.has(src)) return _loaded.get(src);
  const pr = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`스크립트를 불러오지 못했습니다: ${src}`));
    document.head.appendChild(el);
  });
  _loaded.set(src, pr);
  return pr;
}

/** 업로드 전에 사진을 정사각형으로 잘라 400px 로 줄입니다 (용량·속도) */
export function resizeImage(file, size = 400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error("이미지 파일만 올릴 수 있습니다."));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      cv.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지를 처리하지 못했습니다.")),
                "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 열지 못했습니다.")); };
    img.src = url;
  });
}
// ── 사진 크기 기준 ──────────────────────────────────────────
//   저장하는 사진은 «화면에 보이는 크기» 보다 넉넉해야 합니다.
//   그래야 나중에 다시 자르거나 크게 당겨도 흐려지지 않습니다.
export const PHOTO_MAX = 800;      // 잘라서 저장하는 프로필 사진의 한 변 (최대)
export const PHOTO_MIN = 240;      // 이보다 작게는 만들지 않습니다
export const PHOTO_SOFT = 400;     // 원본 픽셀이 이보다 적으면 «흐려집니다» 라고 알려 줍니다
export const PHOTO_Q = 0.92;       // JPEG 품질 (0.85 → 0.92 로 올렸습니다)
//   ※ 원본에 있는 픽셀보다 «크게» 만들어 봐야 선명해지지 않고 용량만 커집니다.
//      그래서 잘라낸 부분의 실제 픽셀 수를 그대로 쓰되, 위 범위 안으로만 둡니다.

/** 큰 사진을 한 번에 확 줄이면 거칠어져서, 절반씩 여러 번 줄입니다.
 *  (원본 3000px → 800px 처럼 많이 줄일 때 눈에 띄게 깨끗해집니다) */
export function drawScaled(ctx, source, sx, sy, sw, sh, dw, dh) {
  let cur = source, cx = sx, cy = sy, cw = sw, ch = sh;
  // 절반보다 더 줄여야 하면, 절반씩 미리 줄여 둡니다
  while (cw > dw * 2 && ch > dh * 2) {
    const half = document.createElement("canvas");
    half.width = Math.max(1, Math.round(cw / 2));
    half.height = Math.max(1, Math.round(ch / 2));
    const hc = half.getContext("2d");
    hc.imageSmoothingEnabled = true;
    hc.imageSmoothingQuality = "high";
    hc.drawImage(cur, cx, cy, cw, ch, 0, 0, half.width, half.height);
    cur = half; cx = 0; cy = 0; cw = half.width; ch = half.height;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, dw, dh);
}

/** 사진을 «자르지 않고» 크기만 줄입니다 (긴 쪽이 max 픽셀).
 *  엑셀로 한꺼번에 올릴 때 씁니다 — 원본이 통째로 남아 있어야
 *  나중에 «사진 다시 자르기» 로 원하는 부분을 다시 고를 수 있습니다. */
export function fitImage(file, max = 1400, quality = PHOTO_Q) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error("이미지 파일만 올릴 수 있습니다."));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * scale));
      cv.height = Math.max(1, Math.round(img.height * scale));
      drawScaled(cv.getContext("2d"), img, 0, 0, img.width, img.height, cv.width, cv.height);
      cv.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지를 처리하지 못했습니다.")),
                "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 열지 못했습니다.")); };
    img.src = url;
  });
}

/** 이미 올려 둔 사진을 다시 열어 «자르기» 창을 띄웁니다.
 *  · src 는 사진 주소(문자열)나 아직 저장 전인 사진(Blob) 둘 다 됩니다.
 *  · 새로 파일을 고르지 않고도 위치·크기만 다시 맞출 수 있습니다.
 *  · 취소하면 null 을 돌려줍니다. */
export async function recropStoredPhoto(src) {
  if (!src) throw new Error("아직 사진이 없습니다.");
  let blob = src;
  if (typeof src === "string") {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      blob = await res.blob();
    } catch {
      throw new Error("올려 둔 사진을 불러오지 못했습니다. 잠시 뒤 다시 해보시거나 사진을 새로 올려 주세요.");
    }
  }
  if (!/^image\//.test(blob.type)) blob = new Blob([blob], { type: "image/jpeg" });
  return cropImage(blob);
}

/** 사진에서 쓸 부분을 고르는 창 (프로필 사진 만들기).
 *  · 가운데 «동그라미» 안이 그대로 프로필 사진이 됩니다.
 *  · 사진을 끌어 옮기고, ＋ − 또는 퍼센트로 크기를 키웁니다
 *    (얼굴이 작게 찍힌 사진도 크게 당겨서 쓸 수 있습니다).
 *  · 컴퓨터는 Ctrl(⌘)+휠, 휴대폰은 두 손가락으로도 확대·축소됩니다.
 *  · 옆으로 누운 사진은 «↺ ↻» 로 돌려 세웁니다.
 *  · «적용» 을 누르면 그 부분만 잘린 JPEG 한 장이 나옵니다. 취소하면 null.
 */
export async function cropImage(file, { size = PHOTO_MAX, quality = PHOTO_Q } = {}) {
  if (!/^image\//.test(file.type)) throw new Error("이미지 파일만 올릴 수 있습니다.");
  let src = await loadUpright(file);             // 휴대폰 사진 회전 먼저 반영
  const releaseOriginal = src.release;           // 창을 닫을 때 원본 비트맵을 놓아 줍니다

  return new Promise((resolve) => {
    // 자를 네모(=보이는 창)의 크기. PC 는 넉넉하게, 휴대폰은 화면 폭에 꽉 차게.
    const wide = window.innerWidth >= 720;
    const V = wide ? 420
      : Math.round(Math.max(240, Math.min(window.innerWidth - 40, window.innerHeight * 0.9 - 320, 460)));
    const MAXZ = 12;                    // 최대 12배까지 당길 수 있습니다
    let fitZ = 1;                       // 사진이 네모를 꼭 채우는 배율 (= 100%)
    let z = 1, tx = 0, ty = 0;          // 지금 배율과 사진의 위치
    let done = false;

    const wrap = document.createElement("div");
    wrap.className = "crop-wrap";
    wrap.innerHTML = `
      <div class="crop-stage">
        <div class="crop-view" id="cropView" style="width:${V}px;height:${V}px">
          <img id="cropImg" alt="" draggable="false">
          <div class="crop-guide"></div>
        </div>
      </div>
      <div class="crop-panel">
        <button type="button" class="btn btn-primary btn-block crop-face" id="findFace">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
               stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8"/>
            <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"/>
            <circle cx="12" cy="10.4" r="2.5"/>
            <path d="M7.6 17.2a4.9 4.9 0 0 1 8.8 0"/>
          </svg><span>얼굴 맞추기</span></button>

        <div class="seg seg-2 crop-rot" role="group" aria-label="돌리기">
          <button type="button" class="seg-btn" id="rotL" aria-label="왼쪽으로 돌리기">↺<span class="rot-t"> 왼쪽</span></button>
          <button type="button" class="seg-btn" id="rotR" aria-label="오른쪽으로 돌리기">↻<span class="rot-t"> 오른쪽</span></button>
        </div>

        <div class="crop-zoom">
          <div class="cz-head">
            <span>크기</span>
            <button type="button" class="zpct" id="zPct" title="눌러서 직접 적기">100%</button>
          </div>
          <div class="cz-row">
            <button type="button" class="cz-step" id="zOut" aria-label="줄이기">−</button>
            <input type="range" class="cz-slider" id="zRange" min="100" max="${MAXZ * 100}" value="100" step="1"
                   aria-label="사진 크기">
            <button type="button" class="cz-step" id="zIn" aria-label="키우기">＋</button>
          </div>
          <button type="button" class="btn btn-ghost btn-sm btn-block" id="zFit">처음 크기로</button>
        </div>

        <div class="crop-hint">
          <b>동그라미 안</b>이 프로필 사진이 됩니다. 사진을 <b>끌어서</b> 옮기고,
          슬라이더로 키우거나 줄이세요.
          <div class="dim">퍼센트를 누르면 직접 적을 수 있습니다 ·
            컴퓨터 <b>Ctrl(⌘)+휠</b> · 휴대폰 <b>두 손가락</b></div>
        </div>
      </div>`;

    const view = wrap.querySelector("#cropView");
    const imgEl = wrap.querySelector("#cropImg");
    const rangeEl = wrap.querySelector("#zRange");
    let pctEl = wrap.querySelector("#zPct");

    /** 사진이 네모를 늘 덮도록 위치를 붙잡아 둡니다 (빈 곳이 생기지 않게) */
    const clamp = () => {
      const w = src.width * z, h = src.height * z;
      tx = w <= V ? (V - w) / 2 : Math.min(0, Math.max(V - w, tx));
      ty = h <= V ? (V - h) / 2 : Math.min(0, Math.max(V - h, ty));
    };
    /** 지금 네모 안에 들어오는 «원본 픽셀» 수 (한 변) — 이게 곧 사진의 선명함입니다 */
    const srcPixels = () => V / z;
    const apply = () => {
      clamp();
      imgEl.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
      const pct = Math.round((z / fitZ) * 100);
      pctEl.textContent = `${pct}%`;
      if (rangeEl && document.activeElement !== rangeEl) rangeEl.value = String(Math.min(MAXZ * 100, pct));
      // 원본 픽셀이 모자라기 시작하면 («더 키우면 흐려집니다») 퍼센트를 주황으로
      const soft = srcPixels() < PHOTO_SOFT;
      pctEl.classList.toggle("soft", soft);
      pctEl.title = soft
        ? "더 키우면 사진이 흐려집니다 (원본 픽셀이 모자랍니다)"
        : "눌러서 직접 적기";
    };
    /** ax, ay (네모 안 좌표) 를 붙잡은 채 배율만 바꿉니다 */
    const setZoom = (nz, ax = V / 2, ay = V / 2) => {
      nz = Math.min(fitZ * MAXZ, Math.max(fitZ, nz));
      const ix = (ax - tx) / z, iy = (ay - ty) / z;
      z = nz;
      tx = ax - ix * z; ty = ay - iy * z;
      apply();
    };
    /** 사진 전체가 네모를 꼭 채우는 «처음 크기» 로 */
    const fitAll = () => {
      fitZ = Math.max(V / src.width, V / src.height);
      z = fitZ;
      tx = (V - src.width * z) / 2;
      ty = (V - src.height * z) / 2;
      apply();
    };
    const showSrc = () => {
      imgEl.src = src.url;
      imgEl.style.width = `${src.width}px`;
      imgEl.style.height = `${src.height}px`;
      fitAll();
    };
    showSrc();

    /** 90° 돌리기 — dir 이 -1이면 왼쪽, +1이면 오른쪽 */
    const rotate = (dir) => {
      const cv = document.createElement("canvas");
      cv.width = src.height;
      cv.height = src.width;
      const c = cv.getContext("2d");
      c.imageSmoothingQuality = "high";
      c.translate(cv.width / 2, cv.height / 2);
      c.rotate((dir * Math.PI) / 2);
      c.drawImage(src.bitmap, -src.width / 2, -src.height / 2, src.width, src.height);
      src = { width: cv.width, height: cv.height, bitmap: cv, url: cv.toDataURL("image/jpeg", 0.92) };
      showSrc();
    };

    // ── 끌어서 옮기기 · 두 손가락으로 확대 ──
    const pts = new Map();
    let pinch = null;
    view.addEventListener("pointerdown", (e) => {
      view.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z };
      }
      e.preventDefault();
    });
    view.addEventListener("pointermove", (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      const r = view.getBoundingClientRect();
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        setZoom(pinch.z * (d / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      } else {
        tx += cur.x - prev.x; ty += cur.y - prev.y; apply();
      }
    });
    const lift = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    view.addEventListener("pointerup", lift);
    view.addEventListener("pointercancel", lift);

    // ── Ctrl(⌘) + 휠 로 확대·축소 (그냥 휠은 화면 스크롤 그대로) ──
    view.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = view.getBoundingClientRect();
      setZoom(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // ── 버튼들 ──
    // ── 얼굴 찾아 자동으로 맞추기 ──
    //    누워 있는 사진이면 방향까지 함께 바로잡아 줍니다.
    wrap.querySelector("#findFace").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "찾는 중…";
      try {
        const { findFace, faceCropRect } = await import("./face.js");
        const hit = await findFace(src.bitmap, { width: src.width, height: src.height });
        if (!hit) {
          toast("얼굴을 자동으로 찾지 못했습니다. 직접 맞춰 주세요.", "err");
          return;
        }
        if (hit.deg) {                       // 누워 있으면 먼저 세웁니다
          const turns = hit.deg === 270 ? [-1] : hit.deg === 180 ? [1, 1] : [1];
          for (const d of turns) rotate(d);
        }
        const r = faceCropRect(hit);
        z = V / r.size;
        tx = -r.x * z; ty = -r.y * z;
        apply();
        toast(hit.count > 1 ? `얼굴 ${hit.count}명 중 가장 큰 얼굴에 맞췄습니다.` : "얼굴에 맞췄습니다.");
      } catch (err) {
        console.error(err);
        toast("얼굴 찾기를 준비하지 못했습니다.", "err");
      } finally { btn.disabled = false; btn.textContent = label; }
    });

    rangeEl.addEventListener("input", () => setZoom(fitZ * (Number(rangeEl.value) / 100)));
    wrap.querySelector("#zIn").addEventListener("click", () => setZoom(z * 1.2));
    wrap.querySelector("#zOut").addEventListener("click", () => setZoom(z / 1.2));
    wrap.querySelector("#zFit").addEventListener("click", fitAll);
    wrap.querySelector("#rotL").addEventListener("click", () => rotate(-1));
    wrap.querySelector("#rotR").addEventListener("click", () => rotate(1));

    // ── 퍼센트를 눌러 직접 적기 ──
    const editPct = () => {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.className = "zpct-input";
      inp.value = String(Math.round((z / fitZ) * 100));
      inp.min = "100"; inp.max = String(MAXZ * 100); inp.step = "10";
      // Enter 로 확정하면 곧바로 blur 도 일어나므로, 한 번만 되돌리도록 잠급니다
      let closed = false;
      const back = () => {
        if (closed) return;
        closed = true;
        inp.replaceWith(pctEl);
        apply();
      };
      const commit = () => {
        if (closed) return;
        const v = Number(inp.value);
        if (Number.isFinite(v) && v > 0) setZoom(fitZ * (v / 100));
        back();
      };
      inp.addEventListener("blur", commit);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); back(); }
      });
      pctEl.replaceWith(inp);
      inp.focus(); inp.select();
    };
    pctEl.addEventListener("click", editPct);

    const close = modal({
      title: "사진 자르기", wide: true, body: wrap,
      footer: `<button class="btn" data-close>취소</button>
               <button class="btn btn-primary" id="cropOk">적용</button>`,
      onMount(box) {
        box.querySelector("#cropOk").addEventListener("click", () => {
          // 원본에서 실제로 쓰는 픽셀만큼 저장합니다.
          //  · 넉넉하면 그대로(최대 size) — 있는 화질을 버리지 않습니다
          //  · 많이 당겨서 픽셀이 모자라면 억지로 늘리지 않고 그 크기로 (최소 PHOTO_MIN)
          const region = srcPixels();
          const out = Math.round(Math.max(PHOTO_MIN, Math.min(size, region)));
          const cv = document.createElement("canvas");
          cv.width = cv.height = out;
          const ctx = cv.getContext("2d");
          // 지금 네모 안에 보이는 부분이 그대로 사진이 됩니다
          drawScaled(ctx, src.bitmap, -tx / z, -ty / z, region, region, out, out);
          cv.toBlob((blob) => {
            done = true; releaseOriginal?.(); close(); resolve(blob || null);
          }, "image/jpeg", quality);
        });
      },
    });

    const watch = setInterval(() => {          // 취소로 닫혔을 때
      if (document.body.contains(wrap)) return;
      clearInterval(watch);
      if (!done) { releaseOriginal?.(); resolve(null); }
    }, 200);
  });
}

/** 회전 정보(EXIF)를 반영해 똑바로 세운 이미지 */
async function loadUpright(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bitmap = await createImageBitmap(file); }
  const cv = document.createElement("canvas");
  cv.width = bitmap.width; cv.height = bitmap.height;
  cv.getContext("2d").drawImage(bitmap, 0, 0);
  const url = cv.toDataURL("image/jpeg", 0.92);
  return {
    width: bitmap.width, height: bitmap.height, bitmap, url,
    release() { bitmap.close?.(); },
  };
}

export const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error("이미지를 읽지 못했습니다."));
  r.readAsDataURL(blob);
});

/** 이름 첫 글자 동그라미 — 사진이 없거나 볼 수 없을 때 */
export function avatar(name, url, size = 30) {
  const initials = esc(String(name || "?").slice(-2));
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  return url
    ? `<span class="ava" style="${st}"><img src="${esc(url)}" alt="${initials}" loading="lazy"></span>`
    : `<span class="ava ava-txt" style="${st}" data-n="${initials}">${initials}</span>`;
}

/** 한글 정렬 */
export const byName = (a, b) => String(a).localeCompare(String(b), "ko");
