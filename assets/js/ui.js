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
/** 생년월일 → 만 나이 (모르면 null) */
export function ageOf(b) {
  if (!b) return null;
  const [y, m, d] = String(b).split("-").map(Number);
  if (!y || !m || !d) return null;
  const t = new Date();
  let age = t.getFullYear() - y;
  if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

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
  liftToast();
  const t = h("div", { class: "toast " + kind }, esc(msg));
  root.appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .25s"; t.style.opacity = "0"; }, 2400);
  setTimeout(() => t.remove(), 2750);
}

/** 알림쪽지가 «저장·취소» 단추를 가리지 않도록 그만큼 위로 띄웁니다.
 *  (휴대폰에서 창이 아래에서 올라오면 단추도 화면 맨 아래에 붙습니다) */
export function liftToast() {
  const root = document.getElementById("toastRoot");
  if (!root) return;
  const near = (el) => {
    if (!el || !el.offsetHeight) return 0;
    const r = el.getBoundingClientRect();
    // 화면 맨 아래에 붙어 있을 때만 피해 줍니다 (컴퓨터에서 가운데 뜬 창은 그대로)
    return window.innerHeight - r.bottom < 24 ? Math.round(r.height + 10) : 0;
  };
  const lift = near(document.querySelector(".overlay .modal-foot"))
            || near(document.querySelector(".install-bar"));
  root.style.setProperty("--toast-lift", `${lift}px`);
}

/* ── 창이 떠 있는 동안 뒤쪽 화면 잠그기 ──────────────────────
   창을 열면 뒤 페이지는 어차피 못 쓰는데 스크롤 막대만 남아 거슬립니다.
   잠그는 동안 막대가 사라지면서 화면이 옆으로 튀지 않도록, 막대 두께만큼
   오른쪽 여백을 대신 넣어 둡니다. 창을 여러 개 겹쳐 열어도 세어서 되돌립니다. */
let pageLocks = 0;
function lockPage() {
  if (pageLocks++ > 0) return;
  const bar = window.innerWidth - document.documentElement.clientWidth;
  if (bar > 0) document.body.style.paddingRight = `${bar}px`;
  document.body.style.overflow = "hidden";
}
function unlockPage() {
  if (--pageLocks > 0) return;
  pageLocks = 0;
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
}

/**
 * 얇게 떠올랐다 사라지는 스크롤 막대 (맥 트랙패드 느낌).
 *   · 진짜 스크롤 막대는 숨깁니다 — 자리를 차지하지 않아 사진이 가장자리까지 꽉 찹니다
 *   · 굴리는 동안만 보이고, 멈추면 스르륵 사라집니다
 *   · 보여 주기만 하는 표시라 끌어당기지는 않습니다 (스크롤 자체는 그대로 동작)
 */
function slimScroll(box) {
  const el = box.querySelector(".modal-body");
  if (!el) return () => {};
  el.classList.add("slimscroll");

  const rail = h("div", { class: "ss-rail" });
  const thumb = h("div", { class: "ss-thumb" });
  rail.appendChild(thumb);
  box.appendChild(rail);

  let timer = null;
  const draw = () => {
    const view = el.clientHeight;
    const total = el.scrollHeight;
    if (total <= view + 1) { rail.style.display = "none"; return; }   // 넘칠 게 없으면 아예 숨김
    rail.style.display = "";
    rail.style.top = `${el.offsetTop}px`;
    rail.style.height = `${view}px`;
    const size = Math.max(28, Math.round((view * view) / total));
    const room = view - size;
    const pos = Math.round((el.scrollTop / (total - view)) * room);
    thumb.style.height = `${size}px`;
    thumb.style.transform = `translateY(${Math.min(room, Math.max(0, pos))}px)`;
  };
  const flash = () => {
    draw();
    rail.classList.add("on");
    clearTimeout(timer);
    timer = setTimeout(() => rail.classList.remove("on"), 800);
  };

  el.addEventListener("scroll", flash, { passive: true });
  let ro = null;
  if (window.ResizeObserver) {                      // 사진이 늦게 떠서 길이가 바뀌어도 따라갑니다
    ro = new ResizeObserver(draw);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
  }
  requestAnimationFrame(draw);

  return () => { clearTimeout(timer); ro?.disconnect(); };
}

/** 모달 열기. body 는 HTML 문자열 또는 Element. 반환: close() */
export function modal({ title, body, footer, narrow = false, slim = false, wide = false, bare = false, onMount }) {
  const root = document.getElementById("modalRoot");
  const overlay = h("div", { class: "overlay" });
  const box = h("div", { class: "modal" + (narrow ? " narrow" : "") + (slim ? " slim" : "")
    + (wide ? " wide" : "") + (bare ? " bare" : "") });
  box.innerHTML = `
    ${bare ? "" : `<div class="modal-head">
      <h3>${esc(title)}</h3>
      <button class="icon-btn" data-close aria-label="닫기">✕</button>
    </div>`}
    <div class="modal-body"></div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ""}`;
  const bodyEl = box.querySelector(".modal-body");
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  overlay.appendChild(box);
  requestAnimationFrame(liftToast);
  root.appendChild(overlay);
  lockPage();
  const stopScroll = slimScroll(box);

  let closed = false;
  const close = () => {
    if (closed) return;                        // 두 번 닫아도 잠금이 어긋나지 않게
    closed = true;
    stopScroll(); unlockPage();
    overlay.remove(); document.removeEventListener("keydown", onKey);
    requestAnimationFrame(liftToast);          // 창이 닫히면 알림쪽지를 제자리로
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  onMount?.(box, close);
  return close;
}

/** 글자를 클립보드에 넣습니다 (안 되면 옛 방식으로 한 번 더) */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = document.createElement("textarea");
    t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* 실패해도 아래에서 알려 줍니다 */ }
    t.remove();
    return ok;
  }
}

/** 사진을 화면 가득 크게 보기 (아무 데나 누르면 닫힙니다) */
export function photoViewer(url, name = "", sub = "") {
  if (!url) return;
  const el = document.createElement("div");
  el.className = "photo-view";
  el.innerHTML = `
    <button class="pv-x" aria-label="닫기">✕</button>
    <img src="${esc(url)}" alt="${esc(name)}">
    <div class="pv-cap"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  let gone = false;
  const off = () => {
    if (gone) return;
    gone = true;
    el.remove(); unlockPage();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); off(); } };
  el.addEventListener("click", off);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(el);
  lockPage();
}

/** 번호 하나를 눌렀을 때 뜨는 작은 차림표 — 전화 · 문자 · 복사 */
export function contactMenu({ label, name, phone }) {
  const num = fmtPhone(phone);
  const raw = digits(phone);
  if (!raw) return;
  const touch = !isDesktop();
  const body = `
    <div class="cm-head">
      <div class="cm-who">${esc(label)}${name ? ` · ${esc(name)}` : ""}</div>
      <div class="cm-num">${esc(num)}</div>
    </div>
    <div class="cm-acts">
      ${touch ? `<a class="cm-b pri" href="tel:${esc(raw)}" data-close>📞 전화하기</a>
                 <a class="cm-b" href="sms:${esc(raw)}" data-close>💬 문자 보내기</a>` : ""}
      <button type="button" class="cm-b" data-copy>⧉ 번호 복사</button>
    </div>`;
  modal({
    title: "연락하기", narrow: true, bare: true, body,
    footer: `<button class="btn btn-block" data-close>닫기</button>`,
    onMount(box, close) {
      box.querySelector("[data-copy]")?.addEventListener("click", async () => {
        close();
        toast(await copyText(num) ? `${num} 복사했습니다.` : "복사하지 못했습니다.", "");
      });
    },
  });
}

/**
 * 신상 창 — 사진이 위를 꽉 채우고, 흰 그라데이션 위에 이름이 얹힙니다.
 *   name/sub/badges : 맨 위에 크게 보여 줄 것
 *   photo           : 사진 주소 (없으면 이름 첫 글자를 크게)
 *   contacts        : [{label, name, phone}] — 번호가 없어도 회색으로 자리를 지킵니다
 *   sections        : [{label, rows:[{k, v, chev, act}], note}]  (v 는 HTML 그대로)
 */
export function detailModal({ name, sub = "", badges = [], photo = null,
                              contacts = [], sections = [], footer = "", onMount }) {
  const ini = esc(String(name || "?").slice(0, 1));
  const wrap = document.createElement("div");
  wrap.className = "dtl";
  wrap.innerHTML = `
    <div class="dtl-stick">
      ${avatar(name, photo, 26)}
      <b>${esc(name)}</b>${sub ? `<span>${esc(sub.split(" · ")[0])}</span>` : ""}
      <button class="dtl-x2" data-close aria-label="닫기">✕</button>
    </div>

    <div class="dtl-hero${photo ? " tap" : ""}"${photo ? ' role="button" tabindex="0" title="눌러서 크게 보기"' : ""}>
      ${photo ? `<img src="${esc(photo)}" alt="${esc(name)}">` : `<span class="dtl-ini">${ini}</span>`}
      <span class="dtl-grip"></span>
      <button class="dtl-x" data-close aria-label="닫기">✕</button>
      ${photo ? `<span class="dtl-zoom" aria-hidden="true">⤢</span>` : ""}
      <div class="dtl-fade">
        <div class="dtl-name">${esc(name)}</div>
        ${sub ? `<div class="dtl-sub">${esc(sub)}</div>` : ""}
        ${badges.length ? `<div class="dtl-badges">${badges.map((b) =>
          `<span class="badge${b.kind ? " " + b.kind : ""}">${esc(b.text)}</span>`).join("")}</div>` : ""}
      </div>
    </div>

    <div class="dtl-body">
      ${contacts.length ? `<div class="dtl-quick">${contacts.map((c, i) => `
        <button type="button" class="cq${c.phone ? "" : " off"}" ${c.phone ? `data-c="${i}"` : "disabled"}>
          <span class="cq-i">${c.phone ? "📞" : "—"}</span>
          <span class="cq-t">${esc(c.label)}${c.phone ? "" : '<small>번호 없음</small>'}</span>
        </button>`).join("")}</div>` : ""}

      ${sections.map((sec) => `
        ${sec.label ? `<div class="sec">${esc(sec.label)}</div>` : ""}
        ${sec.note !== undefined
          ? `<div class="dtl-note">${sec.note || '<span class="dim">적어 둔 내용이 없습니다.</span>'}</div>`
          : `<div class="dtl-list">${(sec.rows || []).map((r) => `
              <div class="dtl-row${r.act ? " tap" : ""}"${r.act ? ` data-act="${esc(r.act)}"` : ""}>
                <span class="k">${esc(r.k)}</span>
                <span class="v">${r.v || '<span class="dim">—</span>'}</span>
                ${r.chev ? '<span class="chev">›</span>' : ""}
              </div>`).join("")}</div>`}`).join("")}
    </div>`;

  return modal({
    title: name, bare: true, slim: true, body: wrap, footer,
    onMount(box, close) {
      // 내리면 위에 이름이 작게 붙습니다
      const scroller = box.querySelector(".modal-body");
      const hero = box.querySelector(".dtl-hero");
      const stick = box.querySelector(".dtl-stick");
      const sync = () => stick.classList.toggle("on", scroller.scrollTop > hero.offsetHeight - 76);
      scroller.addEventListener("scroll", sync, { passive: true });
      sync();

      if (photo) {
        const open = () => photoViewer(photo, name, sub);
        hero.addEventListener("click", (e) => { if (!e.target.closest("[data-close]")) open(); });
        hero.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      }
      box.querySelectorAll("[data-c]").forEach((b) =>
        b.addEventListener("click", () => contactMenu(contacts[Number(b.dataset.c)])));

      onMount?.(box, close);
    },
  });
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

// ════════════════════════════════════════════════════════════
//  그래프 — 색은 «파스텔로 칠하고 글자는 먹으로» 가 원칙입니다.
//  연한 색만으로는 눈이 구분하기 어려워서, 숫자를 늘 함께 적습니다.
// ════════════════════════════════════════════════════════════

/** 도넛 — 전체 중 얼마씩인가. rows: {label, value, color}
 *  조각 사이에는 바탕색 틈을 2px 남겨 서로 붙어 보이지 않게 합니다. */
export function donutChart(rows, { size = 176, thickness = 24, mid = "", midSub = "" } = {}) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const GAP = rows.length > 1 ? 1.1 : 0;          // 둘레를 100 으로 본 틈
  const r = size / 2 - thickness / 2 - 1;
  let acc = 0;
  const segs = rows.map((row, i) => {
    const pct = (row.value / total) * 100;
    const len = Math.max(0.4, pct - GAP);
    const off = -acc; acc += pct;
    return `<circle class="dn-seg" cx="${size / 2}" cy="${size / 2}" r="${r}" pathLength="100"
      fill="none" stroke="${row.color}" stroke-width="${thickness}"
      stroke-dasharray="${len.toFixed(2)} ${(100 - len).toFixed(2)}"
      stroke-dashoffset="${off.toFixed(2)}" style="--d:${i * 70}ms"
      ><title>${esc(row.label)} ${row.value}명 · ${Math.round(pct)}%</title></circle>`;
  }).join("");
  return `
  <div class="donut" style="--dn:${size}px">
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(rows.map((x) => `${x.label} ${x.value}명`).join(", "))}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
              stroke="var(--grid)" stroke-width="${thickness}" opacity=".5"></circle>
      ${segs}
    </svg>
    <div class="dn-mid"><b>${esc(String(mid))}</b><span>${esc(midSub)}</span></div>
  </div>`;
}

/** 도넛 옆에 붙는 이름표 — 색만으로 구분하지 않도록 숫자를 꼭 같이 적습니다 */
export function donutLegend(rows, total = rows.reduce((a, x) => a + x.value, 0)) {
  total = total || 1;
  if (!rows.length) return "";
  return `<div class="dn-keys">${rows.map((r) => `
    <div class="dn-key">
      <i style="background:${r.color}"></i>
      <span class="k">${esc(r.label)}</span>
      <b>${r.value}</b>
      <small>${Math.round((r.value / total) * 100)}%</small>
    </div>`).join("")}</div>`;
}

/** 점 게이지 — «일곱 중 다섯» 을 눈으로 세게 합니다.
 *  사람이 너무 많으면 점 대신 띠로 바꿉니다(점이 스무 개면 세지지 못하니까요). */
export function dotGauge(on, total, { max = 14 } = {}) {
  if (total > max) {
    const pc = total ? (on / total) * 100 : 0;
    return `<span class="dg dg-bar"><i style="width:${pc.toFixed(1)}%"></i></span>`;
  }
  return `<span class="dg">${Array.from({ length: total }, (_, i) =>
    `<i class="${i < on ? "on" : ""}"></i>`).join("")}</span>`;
}

/** 열두 달처럼 «쭉 이어지는» 값 — 부드러운 면 그래프.
 *  선과 면만 SVG 로 그리고, 점·숫자·달 이름은 HTML 로 얹습니다.
 *  (SVG 안에 글씨를 넣으면 화면 너비에 따라 글씨까지 같이 커져 버립니다) */
export function areaChart(rows, { hi = -1 } = {}) {
  const n = rows.length;
  if (!n) return "";
  const max = Math.max(1, ...rows.map((r) => r.value));
  const PADX = 3.6, TOP = 12;
  const X = (i) => (n === 1 ? 50 : PADX + (i * (100 - 2 * PADX)) / (n - 1));
  const Y = (v) => TOP + (1 - v / max) * (100 - TOP);
  const pts = rows.map((r, i) => [X(i), Y(r.value)]);

  //  점 사이를 부드럽게 잇습니다 (Catmull–Rom 을 베지에로)
  let line = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    line += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)}`
          + ` ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)}`
          + ` ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  const id = "ac" + Math.random().toString(36).slice(2, 8);
  const peak = rows.reduce((b, r, i) => (r.value > rows[b].value ? i : b), 0);
  const tag = (i, cls) => `<b class="ac-tag ${cls}" style="left:${X(i).toFixed(2)}%;top:${Y(rows[i].value).toFixed(2)}%"
      >${rows[i].value}</b>`;

  return `
  <div class="ac">
    <div class="ac-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="var(--series-1)" stop-opacity=".32"></stop>
            <stop offset="100%" stop-color="var(--series-1)" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <path d="${line} L${pts[n - 1][0].toFixed(2)},100 L${pts[0][0].toFixed(2)},100 Z" fill="url(#${id})"></path>
        <path class="ac-line" d="${line}" fill="none" vector-effect="non-scaling-stroke"></path>
      </svg>
      <span class="ac-base"></span>
      ${rows.map((r, i) => `<i class="ac-pt${i === hi ? " on" : ""}"
          style="left:${X(i).toFixed(2)}%;top:${Y(r.value).toFixed(2)}%"
          title="${esc(r.label)} ${r.value}명"></i>`).join("")}
      ${peak !== hi ? tag(peak, "peak") : ""}
      ${hi >= 0 ? tag(hi, "now") : ""}
    </div>
    <div class="ac-xs" aria-hidden="true">
      ${rows.map((r, i) => `<span class="${i === hi ? "on" : ""}">${esc(r.label)}</span>`).join("")}
    </div>
    <span class="sr-only">${esc(rows.map((r) => `${r.label} ${r.value}명`).join(", "))}</span>
  </div>`;
}

// ── 검색칸의 ✕ (적은 것을 한 번에 지우기) ──────────────────
//  화면마다 따로 달지 않고, 새로 생기는 검색칸을 지켜보다가 저절로 붙입니다.
//  (창·팝업 안에서 새로 그려지는 검색칸까지 빠짐없이 챙기려고요)
function wireOneSearch(inp) {
  if (inp.dataset.xw) return;
  const host = inp.parentElement;
  if (!host) return;
  inp.dataset.xw = "1";
  host.classList.add("has-x");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "s-x"; btn.tabIndex = -1;
  btn.setAttribute("aria-label", "적은 내용 지우기");
  btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>`;
  //  단추를 누를 때 글상자에서 초점이 빠지면 키보드가 내려가 버립니다
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    inp.value = "";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("search", { bubbles: true }));
    inp.focus();
  });
  host.appendChild(btn);
  const sync = () => host.classList.toggle("x-on", !!inp.value);
  inp.addEventListener("input", sync);
  sync();
}

export function wireSearchClear(root = document) {
  root.querySelectorAll?.('input[type="search"]').forEach(wireOneSearch);
}

export function startSearchClear() {
  wireSearchClear(document);
  new MutationObserver((list) => {
    for (const m of list) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('input[type="search"]')) wireOneSearch(node);
        else wireSearchClear(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
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
export const ORIG_MAX = 1600;      // 다시 자르기용으로 함께 올리는 «원본» 의 긴 쪽 (최대)

/** 프로필 사진 한 장의 «틀» — 세로 4:5.
 *  · 네모 전체는 신상 창 맨 위에 그대로 쓰입니다 (머리 위 조금 + 목 · 어깨까지).
 *  · 동그라미(목록·사진첩)는 그 안에서 «얼굴 부분만» 크게 당겨 씁니다.
 *  숫자는 모두 «사진 너비(W)» 를 1 로 본 값이고, style.css 의 .ava img.pt 와 짝입니다.
 *  (여기를 바꾸면 style.css 도 같이 바꿔야 동그라미가 얼굴에 맞습니다) */
export const FRAME = {
  ratio: 1.25,                                        // 높이 = 너비 × 1.25
  head:   { cx: 0.5, cy: 0.45, rx: 0.225, ry: 0.30 }, // 정수리~턱 타원 (눈은 한가운데)
  //  동그라미로 쓰는 부분 — 얼굴이 정가운데가 아니라 조금 위, 아래로 목까지 나오게.
  //  (머리 꼭대기가 동그라미 위 7% 쯤, 턱이 70% 쯤, 그 아래로 목 · 어깨 조금)
  circle: { cx: 0.5, cy: 0.555, d: 0.94 },
};
/** 이 사진이 «4:5 틀» 로 자른 사진인가 (예전에 정사각형으로 자른 사진과 구별) */
export const isFramed = (w, h) => w > 0 && h > 0 && Math.abs(w / h - 1 / FRAME.ratio) < 0.006;

/** 화면에 뜬 사진마다 «4:5 틀인지» 표시를 달아 둡니다 — 동그라미가 얼굴만 크게 당기도록.
 *  사진이 다 불러와진 뒤에야 크기를 알 수 있어서, 불러오기가 끝날 때마다 살핍니다. */
function tagFrame(img) {
  if (img.naturalWidth) img.classList.toggle("pt", isFramed(img.naturalWidth, img.naturalHeight));
}
export function startPhotoFrames() {
  document.addEventListener("load", (e) => {
    const t = e.target;
    if (t?.tagName === "IMG" && t.closest?.(".ava, .dtl-hero, .photo-view")) tagFrame(t);
  }, true);
  document.querySelectorAll(".ava img, .dtl-hero img").forEach((i) => i.complete && tagFrame(i));
}
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
export async function recropStoredPhoto(src, { original } = {}) {
  if (!src) throw new Error("아직 사진이 없습니다.");
  //  ① 방금 자른(아직 저장 전) 사진 — 원본이 붙어 있습니다
  if (src instanceof Blob && src.original instanceof Blob)
    return cropImage(src.original, { initial: src.crop });
  //  ② 저장해 둔 사진 — 원본을 따로 불러옵니다 (지난번 자른 자리에서 열립니다)
  if (original) {
    const o = await original();
    if (o?.blob) return cropImage(o.blob, { initial: o.crop });
  }
  //  ③ 원본이 없는 예전 사진 — 잘린 사진을 그대로 엽니다
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
export async function cropImage(file, { size = PHOTO_MAX, quality = PHOTO_Q, initial = null } = {}) {
  if (!/^image\//.test(file.type)) throw new Error("이미지 파일만 올릴 수 있습니다.");
  let src = await loadUpright(file);             // 휴대폰 사진 회전 먼저 반영
  const releaseOriginal = src.release;           // 창을 닫을 때 원본 비트맵을 놓아 줍니다

  return new Promise((resolve) => {
    // 자를 틀(=보이는 창)의 크기 — 세로 4:5. PC 는 넉넉하게, 휴대폰은 화면 폭에 맞춰.
    const wide = window.innerWidth >= 720;
    const V = wide ? 372
      : Math.round(Math.max(220, Math.min(window.innerWidth - 40,
                                          (window.innerHeight * 0.9 - 250) / FRAME.ratio, 420)));
    const VH = Math.round(V * FRAME.ratio);
    const MAXZ = 12;                    // 최대 12배까지 당길 수 있습니다
    let fitZ = 1;                       // 사진이 네모를 꼭 채우는 배율 (= 100%)
    let z = 1, tx = 0, ty = 0;          // 지금 배율과 사진의 위치
    let done = false;

    const wrap = document.createElement("div");
    wrap.className = "crop-wrap";
    wrap.innerHTML = `
      <div class="crop-stage">
        <div class="crop-view" id="cropView" style="width:${V}px;height:${VH}px">
          <img id="cropImg" alt="" draggable="false">
          ${frameGuideSvg()}
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
          <b>머리를 점선 사람 모양에 맞춰</b> 주세요.
          <div class="crop-legend">
            <span><i class="lg-h"></i>점선 타원 — <b>정수리부터 턱까지</b>, 눈은 양옆 눈금 높이</span>
            <span><i class="lg-c"></i>동그라미 — 목록·사진첩 (얼굴만 크게)</span>
            <span><i class="lg-r"></i>네모 전체 — 신상 창 맨 위 (목·어깨까지)</span>
          </div>
          사진을 <b>끌어서</b> 옮기고, 슬라이더로 키우거나 줄이세요.
          <div class="dim">퍼센트를 누르면 직접 적을 수 있습니다 ·
            컴퓨터 <b>Ctrl(⌘)+휠</b> · 휴대폰 <b>두 손가락</b></div>
        </div>
      </div>`;

    const view = wrap.querySelector("#cropView");
    const imgEl = wrap.querySelector("#cropImg");
    const rangeEl = wrap.querySelector("#zRange");
    let pctEl = wrap.querySelector("#zPct");

    /** 사진이 틀을 늘 덮도록 위치를 붙잡아 둡니다 (빈 곳이 생기지 않게) */
    const clamp = () => {
      const w = src.width * z, h = src.height * z;
      tx = w <= V ? (V - w) / 2 : Math.min(0, Math.max(V - w, tx));
      ty = h <= VH ? (VH - h) / 2 : Math.min(0, Math.max(VH - h, ty));
    };
    /** 지금 틀 안에 들어오는 «원본 픽셀» 수 (가로) — 이게 곧 사진의 선명함입니다 */
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
    const setZoom = (nz, ax = V / 2, ay = VH / 2) => {
      nz = Math.min(fitZ * MAXZ, Math.max(fitZ, nz));
      const ix = (ax - tx) / z, iy = (ay - ty) / z;
      z = nz;
      tx = ax - ix * z; ty = ay - iy * z;
      apply();
    };
    /** 사진 전체가 네모를 꼭 채우는 «처음 크기» 로 */
    const fitAll = () => {
      fitZ = Math.max(V / src.width, VH / src.height);
      z = fitZ;
      tx = (V - src.width * z) / 2;
      ty = (VH - src.height * z) / 2;
      apply();
    };
    const showSrc = () => {
      imgEl.src = src.url;
      imgEl.style.width = `${src.width}px`;
      imgEl.style.height = `${src.height}px`;
      fitAll();
    };
    showSrc();
    //  다시 자르기 — 지난번에 자른 자리에서 시작합니다
    if (initial && initial.w > 0) {
      z = Math.min(fitZ * MAXZ, Math.max(fitZ, V / (initial.w * src.width)));
      tx = -initial.x * src.width * z;
      ty = -initial.y * src.height * z;
      apply();
    }

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
        const { findFace, faceFrameRect } = await import("./face.js");
        const hit = await findFace(src.bitmap, { width: src.width, height: src.height });
        if (!hit) {
          toast("얼굴을 자동으로 찾지 못했습니다. 직접 맞춰 주세요.", "err");
          return;
        }
        if (hit.deg) {                       // 누워 있으면 먼저 세웁니다
          const turns = hit.deg === 270 ? [-1] : hit.deg === 180 ? [1, 1] : [1];
          for (const d of turns) rotate(d);
        }
        //  찾은 얼굴을 점선 타원에 맞춥니다 (정수리~턱이 타원 안에)
        const r = faceFrameRect(hit);
        z = Math.max(fitZ, V / r.w);
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
          const outW = Math.round(Math.max(PHOTO_MIN, Math.min(size, region)));
          const outH = Math.round(outW * FRAME.ratio);
          const cv = document.createElement("canvas");
          cv.width = outW; cv.height = outH;
          const ctx = cv.getContext("2d");
          // 지금 틀 안에 보이는 부분이 그대로 사진이 됩니다 (세로 4:5)
          drawScaled(ctx, src.bitmap, -tx / z, -ty / z, V / z, VH / z, outW, outH);
          //  «원본» 도 한 장 같이 챙깁니다 (돌린 방향 그대로, 긴 쪽 ORIG_MAX 까지).
          //  나중에 «다시 자르기» 를 누르면 이 원본에서, 지금 자른 자리 그대로 열립니다.
          const crop = { x: (-tx / z) / src.width, y: (-ty / z) / src.height, w: (V / z) / src.width };
          const k = Math.min(1, ORIG_MAX / Math.max(src.width, src.height));
          const oc = document.createElement("canvas");
          oc.width = Math.max(1, Math.round(src.width * k));
          oc.height = Math.max(1, Math.round(src.height * k));
          drawScaled(oc.getContext("2d"), src.bitmap, 0, 0, src.width, src.height, oc.width, oc.height);
          cv.toBlob((blob) => {
            oc.toBlob((orig) => {
              if (blob && orig) { blob.original = orig; blob.crop = crop; }
              done = true; releaseOriginal?.(); close(); resolve(blob || null);
            }, "image/jpeg", 0.9);
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

/** 자르기 틀 위에 겹쳐 그리는 안내선 (좌표는 너비 100 · 높이 125 기준)
 *  · 점선 사람 모양 — 머리(정수리~턱)와 목·어깨가 올 자리
 *  · 양옆 눈금 — 눈 높이 (머리 한가운데)
 *  · 흰 동그라미 — 목록·사진첩 동그라미로 쓰이는 부분 */
function frameGuideSvg() {
  const H = FRAME.head, C = FRAME.circle;
  const cx = H.cx * 100, cy = H.cy * 100, rx = H.rx * 100, ry = H.ry * 100;
  const chin = cy + ry;
  return `
  <svg class="crop-frame" viewBox="0 0 100 125" preserveAspectRatio="none" aria-hidden="true">
    <circle class="cf-circle" cx="${C.cx * 100}" cy="${C.cy * 100}" r="${(C.d * 100) / 2}"></circle>
    <ellipse class="cf-head" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"></ellipse>
    <path class="cf-body" d="M${cx - 8} ${chin - 1.5} L${cx - 8.5} ${chin + 9}
      C${cx - 20} ${chin + 11} ${cx - 38} ${chin + 17} ${cx - 42} 125
      M${cx + 8} ${chin - 1.5} L${cx + 8.5} ${chin + 9}
      C${cx + 20} ${chin + 11} ${cx + 38} ${chin + 17} ${cx + 42} 125"></path>
    <path class="cf-eye" d="M${cx - rx - 6} ${cy} h4.5 M${cx + rx + 1.5} ${cy} h4.5"></path>
  </svg>`;
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
