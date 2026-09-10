// ============================================================
//  앱 진입점 — 라우터와 상단바
// ============================================================
import { initData, api, state, isConfigured, isLoggedIn, isAdmin, teacherPhotoOf } from "./data.js";
import { esc, toast, confirmDialog, installTelCopy, avatar } from "./ui.js";
import * as overview from "./views/overview.js";
import * as students from "./views/students.js";
import * as cells from "./views/cells.js";
import * as birthdays from "./views/birthdays.js";
import * as promoted from "./views/promoted.js";
import * as photos from "./views/photos.js";
import * as teachers from "./views/teachers.js";
import * as importer from "./views/import.js";
import { login, signup, resetSignup } from "./views/auth.js";
import { initInstallPrompt, nudgeInstallPrompt } from "./pwa.js";

const ROUTES = {
  // «개요»는 화면 목록(위 채널)에는 두지 않습니다 — 왼쪽 위 로고를 누르면 바로 옵니다.
  "/":          { title: "개요",       view: { html: overview.overviewView, mount: overview.mount } },
  "/students":  { title: "주소록",     nav: "주소록",    view: students,  group: "roster" },
  "/cells":     { title: "셀편성",     nav: "셀편성",    view: cells,     group: "roster" },
  "/birthdays": { title: "생일",       nav: "생일",      view: birthdays, group: "roster" },
  "/promoted":  { title: "올해 중1",   nav: "올해 중1",  view: promoted,  group: "roster" },
  "/photos":    { title: "사진첩",     nav: "사진첩",    view: photos, staffOnly: true, group: "staff" },
  "/teachers":  { title: "교사·간사",  nav: "교사·간사", view: teachers,  group: "staff" },
  "/import":    { title: "가져오기",   nav: "가져오기",  view: importer, staffOnly: true, group: "staff" },
  "/login":     { title: "로그인",     view: login,  guestOnly: true },
  "/signup":    { title: "회원가입",   view: signup, guestOnly: true },
};

const appEl = document.getElementById("app");

// ── 테마 (라이트 · 시스템 · 다크) ────────────────────────
//   저장된 값이 없거나 "system" 이면 data-theme 을 아예 없애서
//   기기의 밝기 설정(prefers-color-scheme)을 그대로 따르게 둡니다.
const THEME_MODES = ["light", "system", "dark"];
function currentThemeMode() {
  const saved = localStorage.getItem("kkumttang.theme");
  return THEME_MODES.includes(saved) ? saved : "system";
}
function applyThemeMode(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
  localStorage.setItem("kkumttang.theme", mode);
  syncThemeSeg();
}
/** 화면 모드 알약. 상단바에 하나, 휴대폰에서는 프로필 차림표 안에도 하나 —
 *  둘 다 같은 모양이라 «지금 켜진 칸» 을 각자의 실제 너비에 맞춰 옮겨 줍니다. */
function syncThemeSeg() {
  const mode = currentThemeMode();
  document.querySelectorAll(".theme-seg").forEach((seg) => {
    const btns = [...seg.querySelectorAll("button[data-mode]")];
    btns.forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    const thumb = seg.querySelector(".tseg-thumb");
    const on = btns[THEME_MODES.indexOf(mode)];
    if (!thumb || !on || !seg.offsetParent) return;      // 화면에 없으면 계산하지 않습니다
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft - btns[0].offsetLeft}px)`;
  });
}
applyThemeMode(currentThemeMode());
window.addEventListener("resize", syncThemeSeg);
// 상단바든 차림표 안이든, 알약을 누르면 한 곳에서 받아 처리합니다
document.addEventListener("click", (e) => {
  const b = e.target.closest(".theme-seg button[data-mode]");
  if (b) applyThemeMode(b.dataset.mode);
});

/** 화면 모드 알약 한 벌 (상단바 index.html 의 것과 같은 모양) */
function themeSegHtml() {
  return `
    <div class="theme-seg theme-seg-wide" role="group" aria-label="화면 모드">
      <span class="tseg-thumb"></span>
      <button type="button" data-mode="light" title="라이트 모드" aria-label="라이트 모드">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.2M12 19.4v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.4 12h2.2M19.4 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>
      </button>
      <button type="button" data-mode="system" title="시스템 설정을 따름" aria-label="시스템 설정을 따름">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.6" y="4" width="18.8" height="13" rx="2.4"/><path d="M8.6 21h6.8M12 17v4"/></svg>
      </button>
      <button type="button" data-mode="dark" title="다크 모드" aria-label="다크 모드">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.3A8.2 8.2 0 0 1 9.7 3.5a8.4 8.4 0 1 0 10.8 10.8Z"/></svg>
      </button>
    </div>`;
}

// ── 라우팅 ──────────────────────────────────────────────
const currentPath = () => {
  const h = location.hash.replace(/^#/, "");
  return ROUTES[h] ? h : "/";
};

function renderNav(path) {
  const nav = document.getElementById("nav");
  let lastGroup = null;
  nav.innerHTML = Object.entries(ROUTES)
    .filter(([, r]) => r.nav && (!r.staffOnly || isLoggedIn()))
    .map(([p, r]) => {
      const sep = lastGroup && r.group && r.group !== lastGroup ? '<span class="nav-sep"></span>' : "";
      lastGroup = r.group || lastGroup;
      return sep + `<a href="#${p}" data-route="${p}"${p === path ? ' class="active"' : ""}>${esc(r.nav)}</a>`;
    })
    .join("");
}

function render() {
  const path = currentPath();
  const route = ROUTES[path];

  if (route.guestOnly && isLoggedIn()) { location.hash = "#/students"; return; }
  if (route.staffOnly && !isLoggedIn()) { location.hash = "#/login"; return; }

  document.title = path === "/" ? "꿈땅새땅 교적부" : `${route.title} · 꿈땅새땅 교적부`;
  renderNav(path);

  try {
    appEl.innerHTML = route.view.html();
    route.view.mount?.(appEl, render);
  } catch (err) {
    console.error(err);
    appEl.innerHTML = `<div class="card card-pad"><b>화면을 그리는 중 오류가 발생했습니다.</b>
      <pre style="white-space:pre-wrap;font-size:12px;color:var(--text-muted)">${esc(err.message)}</pre></div>`;
  }
  window.scrollTo({ top: 0 });
  renderAuthSlot();
}

window.addEventListener("hashchange", () => {
  // 휴대폰에서 «뒤로 가기» 로 창을 닫는 게 자연스러워서, 화면을 옮기면 열린 창은 닫습니다
  document.getElementById("modalRoot").innerHTML = "";
  closeMeMenu();
  document.querySelectorAll(".hpop").forEach((el) => el.remove());
  syncTopButton();
  resetSignup();
  if (location.hash !== "#/cells") cells.parkDraft();
  render();
});

// 편집 중 실수로 창을 닫는 것 방지
window.addEventListener("beforeunload", (e) => {
  if (cells.isEditing()) { e.preventDefault(); e.returnValue = ""; }
});

// ── 상단바 로그인 영역 ──────────────────────────────────
function renderAuthSlot() {
  const slot = document.getElementById("authSlot");
  if (!isLoggedIn()) {
    slot.innerHTML = `
      <a class="btn btn-sm" href="#/login">로그인</a>
      <a class="btn btn-primary btn-sm" href="#/signup">회원가입</a>`;
    return;
  }

  const p = state.profile;
  const me = state.teachers.find((x) => x.id === p.teacher_id);
  const role = me?.role || "교사진";
  slot.innerHTML = `
    <button type="button" class="whoami" id="meBtn" aria-haspopup="menu" aria-expanded="false"
            title="${esc(p.name)} ${esc(role)} — 눌러서 내 정보·설정">
      ${avatar(p.name, teacherPhotoOf(p.teacher_id), 30)}
      <span class="who-text">
        <b>${esc(p.name)} ${esc(role)}</b>
        <small>@${esc(p.username)}${p.is_admin ? " · 관리자" : ""}</small>
      </span>
      <svg class="who-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>
    </button>`;
  slot.querySelector("#meBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    openMeMenu(slot.querySelector("#meBtn"));
  });
}

/** 상단바 프로필을 누르면 열리는 작은 차림표 (macOS·iOS 의 계정 메뉴처럼) */
function openMeMenu(btn) {
  if (document.querySelector(".me-pop")) { closeMeMenu(); return; }

  const p = state.profile;
  const me = state.teachers.find((x) => x.id === p.teacher_id);
  const role = me?.role || "교사진";

  const pop = document.createElement("div");
  pop.className = "hpop me-pop";
  pop.setAttribute("role", "menu");
  pop.innerHTML = `
    <div class="me-card">
      ${avatar(p.name, teacherPhotoOf(p.teacher_id), 46)}
      <div class="me-id">
        <b>${esc(p.name)} <span class="me-role">${esc(role)}</span></b>
        <small>@${esc(p.username)}</small>
      </div>
      ${p.is_admin ? `<span class="me-badge">관리자</span>` : ""}
    </div>
    <div class="me-sep"></div>
    ${me ? `
    <button type="button" class="hpop-item me-item" data-act="profile">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5a7.4 7.4 0 0 1 14.4 0"/></svg>
      <div><b>내 프로필 수정</b><span>사진 · 연락처 · 생일을 고칩니다</span></div>
    </button>
    <button type="button" class="hpop-item me-item" data-act="photo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.4"/><path d="M8.5 6l1.2-2h4.6l1.2 2"/></svg>
      <div><b>프로필 사진 바꾸기</b><span>얼굴 맞추기로 예쁘게 잘라 줍니다</span></div>
    </button>` : `
    <button type="button" class="hpop-item me-item" data-act="link">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.7 6.6"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.4-1.4"/></svg>
      <div><b>명부와 연결하기</b><span>아직 교사·간사 명부의 내 자리와 이어져 있지 않습니다</span></div>
    </button>`}
    <div class="me-sep"></div>
    <a class="hpop-item me-item" href="#/teachers">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9.2" cy="9" r="3.1"/><path d="M3.2 19a6.2 6.2 0 0 1 12 0"/><path d="M16 6.3a3.1 3.1 0 0 1 0 5.6M17.4 14.6a5.4 5.4 0 0 1 3.4 4.4"/></svg>
      <div><b>교사·간사 연락처</b><span>우리 교사진 전체를 봅니다</span></div>
    </a>
    ${isAdmin() ? `
    <button type="button" class="hpop-item me-item" data-act="admin">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l7 2.6v5.4c0 4.3-2.9 7.6-7 9.6-4.1-2-7-5.3-7-9.6V5.8z"/><path d="M9.2 12.1l2 2 3.6-3.9"/></svg>
      <div><b>관리자 설정</b><span>가입 승인 · 계정 · 직함</span></div>
    </button>` : ""}
    <div class="me-sep"></div>
    <button type="button" class="hpop-item me-item me-out" data-act="logout">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 8V6.2A2.2 2.2 0 0 0 12.8 4H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20h6.6a2.2 2.2 0 0 0 2.2-2.2V16"/><path d="M11 12h9M17.5 8.8L20.7 12l-3.2 3.2"/></svg>
      <div><b>로그아웃</b></div>
    </button>
    <div class="me-theme">
      <span>화면 모드</span>
      ${themeSegHtml()}
    </div>`;

  const scrim = document.createElement("div");
  scrim.className = "me-scrim";
  document.body.append(scrim, pop);
  placeMePop(pop, btn);
  syncThemeSeg();                     // 차림표 안 알약의 «켜진 칸» 을 제자리에
  btn.setAttribute("aria-expanded", "true");

  scrim.addEventListener("click", closeMeMenu);
  const onDoc = (e) => { if (!pop.contains(e.target)) closeMeMenu(); };
  const onKey = (e) => { if (e.key === "Escape") closeMeMenu(); };
  const onWin = () => placeMePop(pop, btn);
  pop._off = () => {
    document.removeEventListener("click", onDoc);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onWin);
    window.removeEventListener("scroll", onWin, true);
    btn.setAttribute("aria-expanded", "false");
  };
  setTimeout(() => {
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
  }, 0);

  pop.querySelectorAll("[data-act]").forEach((b) =>
    b.addEventListener("click", () => runMeAction(b.dataset.act)));
  pop.querySelector('a[href="#/teachers"]')?.addEventListener("click", closeMeMenu);
}

function placeMePop(pop, btn) {
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth || 268;
  const left = Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w));
  pop.style.top = `${Math.round(r.bottom + window.scrollY + 8)}px`;
  pop.style.left = `${Math.round(left + window.scrollX)}px`;
}

function closeMeMenu() {
  document.querySelector(".me-scrim")?.remove();
  const pop = document.querySelector(".me-pop");
  if (!pop) return;
  pop._off?.();
  pop.remove();
  syncThemeSeg();                     // 상단바 알약으로 돌아왔을 때를 위해
}

async function runMeAction(act) {
  closeMeMenu();
  const p = state.profile;
  const me = state.teachers.find((x) => x.id === p.teacher_id);

  if (act === "logout") {
    if (cells.isEditing() && !(await confirmDialog(
      "편집 중인 셀편성이 있습니다. 저장하지 않고 로그아웃할까요?", { okText: "로그아웃" }))) return;
    cells.discardDraft();
    await api.signOut();
    await api.refresh();
    toast("로그아웃했습니다.");
    location.hash = "#/";
    render();
    return;
  }

  if (act === "admin") { teachers.openAdminSettings(() => render()); return; }

  // 아직 명부의 «내 자리» 와 이어져 있지 않은 계정
  if (!me) {
    if (isAdmin()) {
      toast("«가입 승인 · 계정» 에서 내 이름을 명부와 연결해 주세요.");
      teachers.openAdminSettings(() => render(), "accounts");
    } else {
      toast("계정이 교사·간사 명부와 아직 연결되지 않았습니다. 관리자에게 부탁해 주세요.", "err");
    }
    return;
  }
  teachers.editTeacher(me, () => { render(); }, { title: "내 프로필" });
  if (act === "photo") setTimeout(() => document.getElementById("pickPhoto")?.click(), 60);
}

// ── 모드 배너 ───────────────────────────────────────────
function renderBanner() {
  const el = document.getElementById("modeBanner");
  if (state.mode === "supabase") { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div class="banner demo">
      <b>데모 모드</b> · 엑셀 데이터를 그대로 불러왔습니다. 변경사항은 <b>이 브라우저에만</b> 저장됩니다.
      실제로 함께 쓰려면 <code>assets/js/config.js</code>에 Supabase 정보를 넣어 주세요.
      <button class="btn btn-sm" id="resetDemo" style="margin-left:8px">처음 데이터로 되돌리기</button>
    </div>`;
  el.querySelector("#resetDemo").addEventListener("click", async () => {
    if (!(await confirmDialog("데모 데이터를 엑셀 원본 상태로 되돌릴까요? 만든 계정도 사라집니다.",
      { okText: "되돌리기" }))) return;
    api.resetDemo();
    location.reload();
  });
}

// ── 시작 ────────────────────────────────────────────────
(async function boot() {
  try {
    await initData();
  } catch (err) {
    console.error(err);
    appEl.innerHTML = `
      <div class="card card-pad">
        <h2 style="font-size:17px;margin-bottom:8px">데이터를 불러오지 못했습니다</h2>
        <p style="color:var(--text-secondary);font-size:14px">
          ${isConfigured()
            ? "Supabase 연결에 실패했습니다. URL과 anon 키, 그리고 SQL 스크립트 실행 여부를 확인해 주세요."
            : "데모 데이터를 불러오지 못했습니다. 파일을 직접 여는 대신 로컬 서버로 실행해 주세요."}
        </p>
        <pre style="white-space:pre-wrap;font-size:12px;color:var(--text-muted);margin-top:10px">${esc(err.message)}</pre>
      </div>`;
    return;
  }
  installTelCopy();
  installTopButton();
  registerServiceWorker();
  initInstallPrompt();
  renderBanner();
  render();
})();

// ── 서비스 워커 ────────────────────────────────────────────
//   «홈 화면에 추가» 가 뜨게 하고, 잠깐 인터넷이 끊겨도 화면이 열리게 합니다.
//   (새로 올린 내용을 먼저 가져오는 방식이라 오래된 화면이 남지 않습니다)
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  const go = () => navigator.serviceWorker
    .register("./sw.js")
    .catch(() => { /* 없어도 앱은 그대로 돕니다 */ });
  // app.js 는 화면이 다 뜬 뒤에 실행될 수도 있어서, 이미 끝났으면 바로 등록합니다
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

export { isAdmin };


// ── 맨 위로 가기 (생일 화면에서만, 조금 내려가면 나타납니다) ──
//   12칸이 세로로 길게 늘어서는 생일 화면에서만 필요해서 거기만 붙입니다.
const TOP_BTN_PAGES = ["#/birthdays"];
let topBtn = null;
function installTopButton() {
  if (!topBtn) {
    topBtn = document.createElement("button");
    topBtn.id = "toTop";
    topBtn.className = "to-top";
    topBtn.type = "button";
    topBtn.setAttribute("aria-label", "맨 위로");
    topBtn.title = "맨 위로";
    topBtn.textContent = "↑";
    topBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    document.body.appendChild(topBtn);
    window.addEventListener("scroll", syncTopButton, { passive: true });
  }
  syncTopButton();
}
function syncTopButton() {
  if (!topBtn) return;
  const here = location.hash || "#/";
  const show = TOP_BTN_PAGES.includes(here) && window.scrollY > 260;
  topBtn.classList.toggle("on", show);
}
