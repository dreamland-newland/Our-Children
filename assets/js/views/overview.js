// ── 개요 대시보드 ──────────────────────────────────────────
import {
  state, birthdayList, activeCells, cellIdOf, cellMembers, currentVersion, versionLabel, isLoggedIn,
  gradeOf, statusOf, photoOf, schoolYear, cellNameOf,
} from "../data.js";
import { esc, barChart, avatar, showSkyBadge } from "../ui.js";
import { showStudent } from "./students.js";
import { GRADES } from "../config.js";
import { bindDownload as bindXlsx } from "../xlsx.js";

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

export function overviewView() {
  const S = state.students;
  const active = S.filter((s) => statusOf(s) === "재적");
  const mid  = active.filter((s) => (gradeOf(s) || "").startsWith("중")).length;
  const high = active.filter((s) => (gradeOf(s) || "").startsWith("고")).length;
  const pre  = active.filter((s) => gradeOf(s) === "예비중1").length;
  const absent = S.filter((s) => statusOf(s) === "장기결석").length;
  const unassigned = active.filter((s) => !cellIdOf(s.id)).length;

  // 교사진이 가장 어려워하는 부분 — 올해 새로 올라온 중1 얼굴 익히기
  const newbies = active
    .filter((s) => gradeOf(s) === "중1")
    .sort((a, b) => (a.gender === b.gender
      ? a.name.localeCompare(b.name, "ko") : a.gender === "남" ? -1 : 1));

  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  const today = now.getDate();
  const bdays = birthdayList().filter((b) => b.month === thisMonth);

  const gradeRows = GRADES
    .map((g) => ({ label: g, value: active.filter((s) => gradeOf(s) === g).length }))
    .filter((r) => r.value > 0);

  const male   = active.filter((s) => s.gender === "남").length;
  const female = active.filter((s) => s.gender === "여").length;
  const gTotal = Math.max(1, male + female);

  const cellRows = activeCells()
    .map((c) => ({ label: c.name.replace(/\s*(선생님|간사)/g, "").replace(/\s*\/\s*/g, "·"),
                   value: cellMembers(c.id).length }))
    .sort((a, b) => b.value - a.value);

  const teacherCount = state.teachers.length;
  const claimed = state.teachers.filter((t) => t.user_id).length;

  return `
  <div class="page-head">
    <div>
      <h1>개요</h1>
      <p>총 ${S.length}명의 교적 · 셀편성 ${esc(versionLabel(currentVersion()) || "미등록")}</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-sm" id="xlsxBtn">📥 엑셀 받기 (교적부 전체)</button>
      ${isLoggedIn() ? `<a class="btn btn-sm" href="#/import">파일로 가져오기</a>` : ""}
    </div>
  </div>

  <div class="grid grid-4" style="margin-bottom:16px">
    ${tile("재적 인원", active.length, "명", `장기결석 ${absent}명 별도`)}
    ${tile("중등부", mid, "명", pre ? `예비중1 ${pre}명 포함` : "중1 · 중2 · 중3")}
    ${tile("고등부", high, "명", "고1 · 고2 · 고3")}
    ${tile("셀", activeCells().length, "개", unassigned ? `미배정 ${unassigned}명` : "전원 배정 완료")}
  </div>

  <section class="card" style="margin-bottom:16px">
    <div class="card-head">
      <h3>올해 중1 — 얼굴 익히기</h3>
      <span class="sub">${schoolYear()}학년도 · ${newbies.length}명 <a href="#/promoted" style="color:var(--series-1);margin-left:8px">자세히 →</a></span>
    </div>
    <div class="card-pad" style="padding-top:12px">
      ${newbies.length ? `<div class="face-grid">${newbies.map((s) => `
        <button class="face" data-student="${s.id}" title="${esc(s.name)} — 눌러서 신상 보기">
          ${avatar(s.name, photoOf(s.id), 56)}
          <span class="fname">${esc(s.name)}${showSkyBadge() && s.is_promoted ? '<i class="dot" title="하늘아이 출신"></i>' : ""}</span>
          <span class="fsub">${esc(shortCell(cellNameOf(s.id)))}</span>
        </button>`).join("")}</div>
        <p style="margin:14px 0 0;font-size:12.5px;color:var(--text-muted)">
          이름을 누르면 신상이 열립니다.${showSkyBadge() ? ' · <i class="dot" style="display:inline-block;vertical-align:middle"></i> 표시는 <b>하늘아이</b>(초등부) 출신' : ""}
          ${isLoggedIn() ? "· 사진은 주소록에서 아이를 열어 올릴 수 있습니다." : "· 사진은 로그인하면 보입니다."}
        </p>`
        : `<div class="empty" style="padding:28px 0">올해 중1로 올라온 아이가 아직 없습니다.</div>`}
    </div>
  </section>

  <div class="grid grid-2" style="margin-bottom:16px">
    <section class="card">
      <div class="card-head"><h3>학년별 인원</h3><span class="sub">재적 ${active.length}명</span></div>
      <div class="chart">${barChart(gradeRows)}</div>
    </section>

    <section class="card">
      <div class="card-head"><h3>이번 달 생일</h3><span class="sub">${thisMonth}월 · ${bdays.length}명</span></div>
      <div class="card-pad" style="padding-top:10px;max-height:288px;overflow:auto">
        ${bdays.length ? `<ul style="list-style:none;margin:0;padding:0">${bdays.map((b) => `
          <li style="display:flex;gap:10px;align-items:center;padding:5px 0;font-size:13.5px;
                     ${b.day === today ? "font-weight:650" : ""}">
            <span style="width:34px;text-align:right;color:var(--text-muted);font-size:12px;
                         font-variant-numeric:tabular-nums">${b.day}일</span>
            <span>${esc(b.name)}</span>
            <span class="badge ${b.kind === "학생" ? "" : "blue"}" style="margin-left:auto">
              ${esc(b.kind === "학생" ? b.grade || "학생" : b.kind)}</span>
            ${b.day === today ? '<span class="badge orange">오늘</span>' : ""}
          </li>`).join("")}</ul>`
          : `<div class="empty" style="padding:28px 0">${thisMonth}월 생일자가 없습니다.</div>`}
      </div>
    </section>
  </div>

  <div class="grid grid-2">
    <section class="card">
      <div class="card-head"><h3>셀별 인원</h3><span class="sub">${esc(currentVersion()?.label || "-")}</span></div>
      <div class="chart">${barChart(cellRows)}</div>
    </section>

    <div class="stack">
      <section class="card">
        <div class="card-head"><h3>성별 분포</h3><span class="sub">재적 기준</span></div>
        <div class="chart">
          <div class="split-bar">
            <span style="background:var(--series-1);width:${(male / gTotal) * 100}%"></span>
            <span style="background:var(--series-2);width:${(female / gTotal) * 100}%"></span>
          </div>
          <div class="legend">
            <span><i style="background:var(--series-1)"></i>남 ${male}명 (${Math.round(male / gTotal * 100)}%)</span>
            <span><i style="background:var(--series-2)"></i>여 ${female}명 (${Math.round(female / gTotal * 100)}%)</span>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>교사 · 간사</h3><span class="sub">${teacherCount}명</span></div>
        <div class="chart">
          ${barChart(["담임목사", "교역자", "사모", "교사", "간사"]
            .map((r) => ({ label: r, value: state.teachers.filter((t) => t.role === r).length }))
            .filter((r) => r.value), { alt: true })}
          <p style="margin:12px 0 0;font-size:12.5px;color:var(--text-secondary)">
            ${claimed}명이 계정을 만들었습니다.
            ${claimed < teacherCount ? `<a href="#/signup" style="color:var(--series-1)">회원가입 →</a>` : ""}
          </p>
        </div>
      </section>
    </div>
  </div>

  <section class="card" style="margin-top:16px">
    <div class="card-head"><h3>월별 생일 인원</h3><span class="sub">학생 · 교사진 합계</span></div>
    <div class="chart">
      ${barChart(MONTHS.map((m, i) => ({
        label: m, value: birthdayList().filter((b) => b.month === i + 1).length })))}
    </div>
  </section>`;
}

export function mount(root, rerender) {
  root.querySelectorAll("[data-student]").forEach((el) => el.addEventListener("click", () =>
    showStudent(state.students.find((s) => s.id === el.dataset.student), rerender)));
  bindXlsx(root.querySelector("#xlsxBtn"), async () => {
    const { exportWorkbook } = await import("../xlsx.js");
    await exportWorkbook();
  }, "📥 엑셀 받기 (교적부 전체)");
}

const shortCell = (n) =>
  n ? n.replace(/\s*(선생님|간사|목사|전도사|사모)/g, "").replace(/\s*\/\s*/g, "·") + " 셀" : "미배정";

const tile = (label, value, unit, foot) => `
  <div class="card tile">
    <div class="label">${esc(label)}</div>
    <div class="value">${value}<small>${esc(unit)}</small></div>
    <div class="foot">${esc(foot)}</div>
  </div>`;
