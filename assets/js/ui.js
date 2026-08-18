// ============================================================
//  UI 헬퍼
// ============================================================

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
export function modal({ title, body, footer, narrow = false, onMount }) {
  const root = document.getElementById("modalRoot");
  const overlay = h("div", { class: "overlay" });
  const box = h("div", { class: "modal" + (narrow ? " narrow" : "") });
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
/** 사진에서 쓸 부분을 네모로 잘라내는 창.
 *  · 사진 전체가 보이고, 그 위에 «자를 네모» 가 얹힙니다.
 *  · 네모 안을 끌면 위치가, 네 귀퉁이를 끌면 크기가 바뀝니다 (정사각형 유지).
 *  · «적용» 을 누르면 그 부분만 잘린 JPEG 한 장이 나옵니다. 취소하면 null.
 */
export async function cropImage(file, { size = 400, quality = 0.85 } = {}) {
  if (!/^image\//.test(file.type)) throw new Error("이미지 파일만 올릴 수 있습니다.");
  const src = await loadUpright(file);          // 휴대폰 사진 회전 먼저 반영

  return new Promise((resolve) => {
    // 사진 전체가 들어가도록 축소해서 보여 줍니다
    const MAX = Math.min(320, Math.max(240, Math.round(window.innerWidth * 0.72)));
    const scale = Math.min(MAX / src.width, MAX / src.height, 1);
    const dw = Math.round(src.width * scale), dh = Math.round(src.height * scale);
    const MIN = 44;                              // 자를 네모의 최소 크기
    let fs = Math.round(Math.min(dw, dh) * 0.85);   // frame size
    let fx = Math.round((dw - fs) / 2), fy = Math.round((dh - fs) / 2);
    let done = false;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="crop-stage">
        <div class="crop-area" id="cropArea" style="width:${dw}px;height:${dh}px">
          <img id="cropImg" alt="" draggable="false" style="width:${dw}px;height:${dh}px">
          <div class="crop-dim" id="cropDim"></div>
          <div class="crop-frame" id="cropFrame">
            <i class="hd nw" data-h="nw"></i><i class="hd ne" data-h="ne"></i>
            <i class="hd sw" data-h="sw"></i><i class="hd se" data-h="se"></i>
          </div>
        </div>
      </div>
      <div class="form-note" style="margin-top:12px">
        네모 <b>안쪽을 끌면</b> 위치가, <b>귀퉁이를 끌면</b> 크기가 바뀝니다.
        네모 안이 프로필 사진이 됩니다.
      </div>
      <div class="crop-tools">
        <button type="button" class="btn btn-sm" id="cropAll">전체</button>
        <button type="button" class="btn btn-sm" id="cropSquare">가운데 정사각형</button>
      </div>`;

    const imgEl = wrap.querySelector("#cropImg");
    const frame = wrap.querySelector("#cropFrame");
    const dim = wrap.querySelector("#cropDim");
    const area = wrap.querySelector("#cropArea");
    imgEl.src = src.url;

    const draw = () => {
      fs = Math.max(MIN, Math.min(fs, dw, dh));
      fx = Math.max(0, Math.min(dw - fs, fx));
      fy = Math.max(0, Math.min(dh - fs, fy));
      frame.style.cssText = `left:${fx}px;top:${fy}px;width:${fs}px;height:${fs}px`;
      // 바깥을 어둡게 (네모만 뚫린 마스크)
      dim.style.clipPath =
        `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,` +
        ` ${fx}px ${fy}px, ${fx}px ${fy + fs}px,` +
        ` ${fx + fs}px ${fy + fs}px, ${fx + fs}px ${fy}px, ${fx}px ${fy}px)`;
    };
    draw();

    // ── 끌기 (안쪽=이동, 귀퉁이=크기) ──
    let mode = null, st = null;
    const start = (e) => {
      const h = e.target.dataset?.h;
      mode = h || "move";
      st = { x: e.clientX, y: e.clientY, fx, fy, fs };
      area.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    frame.addEventListener("pointerdown", start);
    area.addEventListener("pointermove", (e) => {
      if (!mode) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (mode === "move") { fx = st.fx + dx; fy = st.fy + dy; }
      else {
        // 반대쪽 귀퉁이를 고정한 채 정사각형으로 늘리고 줄입니다
        const right = st.fx + st.fs, bottom = st.fy + st.fs;
        let n = st.fs;
        if (mode === "se") n = st.fs + Math.max(dx, dy);
        if (mode === "nw") n = st.fs - Math.min(dx, dy);
        if (mode === "ne") n = st.fs + Math.max(dx, -dy);
        if (mode === "sw") n = st.fs + Math.max(-dx, dy);
        n = Math.max(MIN, n);
        if (mode === "se") n = Math.min(n, dw - st.fx, dh - st.fy);
        if (mode === "nw") { n = Math.min(n, right, bottom); fx = right - n; fy = bottom - n; }
        if (mode === "ne") { n = Math.min(n, dw - st.fx, bottom); fy = bottom - n; }
        if (mode === "sw") { n = Math.min(n, right, dh - st.fy); fx = right - n; }
        fs = n;
      }
      draw();
    });
    const end = () => { mode = null; };
    area.addEventListener("pointerup", end);
    area.addEventListener("pointercancel", end);

    wrap.querySelector("#cropAll").addEventListener("click", () => {
      fs = Math.min(dw, dh); fx = (dw - fs) / 2; fy = (dh - fs) / 2; draw();
    });
    wrap.querySelector("#cropSquare").addEventListener("click", () => {
      fs = Math.round(Math.min(dw, dh) * 0.7); fx = (dw - fs) / 2; fy = (dh - fs) / 2; draw();
    });

    const close = modal({
      title: "사진 자르기", narrow: true, body: wrap,
      footer: `<button class="btn" data-close>취소</button>
               <button class="btn btn-primary" id="cropOk">적용</button>`,
      onMount(box) {
        box.querySelector("#cropOk").addEventListener("click", () => {
          const cv = document.createElement("canvas");
          cv.width = cv.height = size;
          const ctx = cv.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(src.bitmap, fx / scale, fy / scale, fs / scale, fs / scale, 0, 0, size, size);
          cv.toBlob((blob) => {
            done = true; src.release(); close(); resolve(blob || null);
          }, "image/jpeg", quality);
        });
      },
    });

    const watch = setInterval(() => {          // 취소로 닫혔을 때
      if (document.body.contains(wrap)) return;
      clearInterval(watch);
      if (!done) { src.release(); resolve(null); }
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
