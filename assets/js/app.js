// ============================================================
//  앱 진입점 — 라우터와 상단바
// ============================================================
import { initData, api, state, isConfigured, isLoggedIn, isAdmin } from "./data.js";
import { esc, toast, confirmDialog, installTelCopy } from "./ui.js";
import * as overview from "./views/overview.js";
import * as students from "./views/students.js";
import * as cells from "./views/cells.js";
import * as birthdays from "./views/birthdays.js";
import * as promoted from "./views/promoted.js";
import * as teachers from "./views/teachers.js";
import * as importer from "./views/import.js";
import { login, signup, resetSignup } from "./views/auth.js";

const ROUTES = {
  "/":          { title: "개요",       nav: "개요",      view: { html: overview.overviewView, mount: overview.mount } },
  "/students":  { title: "주소록",     nav: "주소록",    view: students },
  "/cells":     { title: "셀편성",     nav: "셀편성",    view: cells },
  "/birthdays": { title: "생일",       nav: "생일",      view: birthdays },
  "/promoted":  { title: "올해 중1",   nav: "올해 중1",  view: promoted },
  "/teachers":  { title: "교사·간사",  nav: "교사·간사", view: teachers },
  "/import":    { title: "가져오기",   nav: "가져오기",  view: importer, staffOnly: true },
  "/login":     { title: "로그인",     view: login,  guestOnly: true },
  "/signup":    { title: "회원가입",   view: signup, guestOnly: true },
};

const appEl = document.getElementById("app");

// ── 테마 ────────────────────────────────────────────────
const savedTheme = localStorage.getItem("kkumttang.theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

document.getElementById("themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("kkumttang.theme", next);
});

// ── 라우팅 ──────────────────────────────────────────────
const currentPath = () => {
  const h = location.hash.replace(/^#/, "");
  return ROUTES[h] ? h : "/";
};

function renderNav(path) {
  const nav = document.getElementById("nav");
  nav.innerHTML = Object.entries(ROUTES)
    .filter(([, r]) => r.nav && (!r.staffOnly || isLoggedIn()))
    .map(([p, r]) => `<a href="#${p}" data-route="${p}"${p === path ? ' class="active"' : ""}>${esc(r.nav)}</a>`)
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
  resetSignup();
  if (location.hash !== "#/cells") cells.discardDraft();
  render();
});

// 편집 중 실수로 창을 닫는 것 방지
window.addEventListener("beforeunload", (e) => {
  if (cells.isEditing()) { e.preventDefault(); e.returnValue = ""; }
});

// ── 상단바 로그인 영역 ──────────────────────────────────
function renderAuthSlot() {
  const slot = document.getElementById("authSlot");
  if (isLoggedIn()) {
    const p = state.profile;
    const t = state.teachers.find((x) => x.id === p.teacher_id);
    const role = t?.role || "교사진";
    slot.innerHTML = `
      <span class="whoami" title="${esc(p.name)} · @${esc(p.username)}${p.is_admin ? " · 관리자" : ""}">
        <span class="avatar">${esc((p.name || "?").slice(-2))}</span>
        <span class="who-text">
          <b>${esc(p.name)} ${esc(role)}</b>
          <small>@${esc(p.username)}${p.is_admin ? " · 관리자" : ""}</small>
        </span>
      </span>
      <button class="btn btn-sm" id="logoutBtn">로그아웃</button>`;
    slot.querySelector("#logoutBtn").addEventListener("click", async () => {
      if (cells.isEditing() && !(await confirmDialog(
        "편집 중인 셀편성이 있습니다. 저장하지 않고 로그아웃할까요?", { okText: "로그아웃" }))) return;
      cells.discardDraft();
      await api.signOut();
      await api.refresh();
      toast("로그아웃했습니다.");
      location.hash = "#/";
      render();
    });
  } else {
    slot.innerHTML = `
      <a class="btn btn-sm" href="#/login">로그인</a>
      <a class="btn btn-primary btn-sm" href="#/signup">회원가입</a>`;
  }
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
  renderBanner();
  render();
})();

export { isAdmin };
