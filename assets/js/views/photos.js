// ── 사진첩 — 얼굴만 크게 모아 보는 화면 (인쇄해서 붙여 두기 좋습니다) ──
import {
  state, isLoggedIn, photoOf, teacherPhotoOf, gradeOf, isActive, schoolYear,
} from "../data.js";
import { esc, avatar, byName, toast } from "../ui.js";
import { GRADES } from "../config.js";
import { showStudent } from "./students.js";
import { editTeacher } from "./teachers.js";

const ROLE_ORDER = ["담임목사", "교역자", "사모", "교사", "간사"];
let tab = "students";     // 'students' | 'teachers'
let q = "";

const byGenderThenName = (a, b) =>
  a.gender === b.gender ? byName(a.name, b.name) : a.gender === "남" ? -1 : 1;

export function html() {
  if (!isLoggedIn()) {
    return `
    <div class="page-head"><div><h1>사진첩</h1>
      <p>사진은 로그인한 교사진에게만 보입니다.</p></div></div>
    <div class="card card-pad"><div class="empty">
      <a class="btn btn-primary" href="#/login">로그인</a></div></div>`;
  }

  const groups = tab === "students" ? studentGroups() : teacherGroups();
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return `
  <div class="page-head">
    <div>
      <h1>사진첩</h1>
      <p>${schoolYear()}학년도 기준 · ${total}명 · 얼굴과 이름만 크게 모아 봅니다.
        선생님·간사님이 <b>아이들 얼굴을 빨리 익히시라고</b> 만들었습니다.</p>
    </div>
    <div class="page-actions">
      <div class="seg" id="tabSeg" role="tablist">
        <button class="seg-btn${tab === "students" ? " on" : ""}" data-tab="students">학생</button>
        <button class="seg-btn${tab === "teachers" ? " on" : ""}" data-tab="teachers">교사·간사</button>
      </div>
      <button class="btn btn-sm" id="printBtn">🖨️ 인쇄하기</button>
    </div>
  </div>

  <div class="card filters">
    <div class="search"><input type="search" id="q" placeholder="이름으로 찾기…" value="${esc(q)}"></div>
    <span class="count" id="count">${total}명</span>
  </div>

  <div id="groups">${groupsHtml(groups)}</div>

  <div class="card card-pad" style="margin-top:16px;font-size:12.5px;color:var(--text-secondary)">
    사진은 <b>${tab === "students" ? "주소록" : "교사·간사"}</b> 화면에서 이름을 눌러 편집할 때 올릴 수 있습니다.
    사진이 없는 아이·선생님은 이름 첫 글자로 대신 보여줍니다.
    <b>«🖨️ 인쇄하기»</b>를 누르면 학년(구분)별로 나눠 인쇄됩니다.
  </div>`;
}

function studentGroups() {
  const rows = state.students.filter(isActive).sort(byGenderThenName);
  return GRADES
    .map((g) => ({ key: g, label: g, rows: rows.filter((s) => gradeOf(s) === g) }))
    .concat([{ key: "__none", label: "학년 미상", rows: rows.filter((s) => !gradeOf(s)) }])
    .filter((grp) => grp.rows.length);
}

function teacherGroups() {
  const rows = [...state.teachers].sort((a, b) => byName(a.name, b.name));
  return ROLE_ORDER
    .map((r) => ({ key: r, label: r, rows: rows.filter((t) => t.role === r) }))
    .filter((grp) => grp.rows.length);
}

function groupsHtml(groups) {
  const needle = q.trim().toLowerCase();
  const sections = groups.map((grp) => {
    const rows = needle ? grp.rows.filter((r) => r.name.toLowerCase().includes(needle)) : grp.rows;
    if (!rows.length) return "";
    return `
    <section class="card face-section" style="margin-bottom:16px">
      <div class="card-head">
        <h3>${esc(grp.label)}</h3><span class="sub">${rows.length}명</span>
      </div>
      <div class="card-pad" style="padding-top:12px">
        <div class="face-grid face-grid-lg">
          ${rows.map((r) => `
          <button class="face" data-id="${r.id}" title="${esc(r.name)} — 눌러서 신상 보기">
            ${avatar(r.name, (tab === "students" ? photoOf(r.id) : teacherPhotoOf(r.id)), 84)}
            <span class="fname">${esc(r.name)}</span>
            ${tab === "teachers" && r.role !== grp.label ? `<span class="fsub">${esc(r.role)}</span>` : ""}
          </button>`).join("")}
        </div>
      </div>
    </section>`;
  }).filter(Boolean).join("");

  return sections || `<div class="card card-pad"><div class="empty">
    ${needle ? "이름이 일치하는 사람이 없습니다." : "표시할 사람이 없습니다."}</div></div>`;
}

export function mount(root, rerender) {
  if (!isLoggedIn()) return;

  root.querySelector("#printBtn")?.addEventListener("click", () => window.print());
  root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    tab = b.dataset.tab; q = ""; rerender();
  }));

  const qEl = root.querySelector("#q");
  qEl?.addEventListener("input", () => {
    q = qEl.value;
    const groups = tab === "students" ? studentGroups() : teacherGroups();
    root.querySelector("#groups").innerHTML = groupsHtml(groups);
    const shown = groups.reduce((n, g) => n +
      (q.trim() ? g.rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())).length : g.rows.length), 0);
    root.querySelector("#count").textContent = `${shown}명`;
    bindFaces(root, rerender);
  });

  bindFaces(root, rerender);
}

function bindFaces(root, rerender) {
  root.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.id;
    if (tab === "students") {
      const s = state.students.find((x) => x.id === id);
      if (s) showStudent(s, rerender);
    } else {
      const t = state.teachers.find((x) => x.id === id);
      if (t) editTeacher(t, rerender);
      else toast("정보를 찾을 수 없습니다.", "err");
    }
  }));
}
