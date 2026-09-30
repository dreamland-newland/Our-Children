// ── 개요 대시보드 ──────────────────────────────────────────
//  색은 «파스텔로 칠하고 글자는 먹으로» 가 원칙입니다.
//  연한 색만으로는 눈이 구분하기 어려워서, 숫자를 늘 함께 적어 둡니다.
//    · 중등부는 파랑 계열, 고등부는 주황 계열 — 학년이 올라갈수록 진해집니다
//    · 초록(출석)·노랑·빨강은 «상태» 전용이라 학년·성별 색으로는 쓰지 않습니다
import {
  state, birthdayList, activeCells, cellIdOf, cellMembers, currentVersion, versionLabel, isLoggedIn,
  gradeOf, statusOf, photoOf, schoolYear, cellNameOf, dateLabel, eventName,
  api, guestsToEnroll, ENROLL_AFTER,
} from "../data.js";
import {
  esc, barChart, avatar, showSkyBadge, toast, confirmDialog,
  donutChart, donutLegend, dotGauge, areaChart,
} from "../ui.js";
import { showStudent, editStudent } from "./students.js";
import { GRADES } from "../config.js";
import { bindDownload as bindXlsx } from "../xlsx.js";

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

//  학년 색 — 중등부(파랑)·고등부(주황) 각각 학년이 올라갈수록 진해집니다.
//  여섯 검사(밝기대·채도·색각·대비)를 통과한 값입니다. 어두운 화면 값은 style.css 에 있습니다.
const GRADE_TONE = {
  "예비중1": "--g-m1", "중1": "--g-m2", "중2": "--g-m3", "중3": "--g-m4",
  "고1": "--g-h1", "고2": "--g-h2", "고3": "--g-h3",
};
const toneOf = (g) => `var(${GRADE_TONE[g] || "--g-etc"})`;

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
    .map((g) => ({ label: g, value: active.filter((s) => gradeOf(s) === g).length, color: toneOf(g) }))
    .filter((r) => r.value > 0);

  const male   = active.filter((s) => s.gender === "남").length;
  const female = active.filter((s) => s.gender === "여").length;
  const gTotal = Math.max(1, male + female);

  const teacherCount = state.teachers.length;
  const claimed = state.teachers.filter((t) => t.user_id).length;

  return `
  <div class="page-head ov-head">
    <div>
      <h1 class="sr-only">개요</h1>
      <p>총 ${S.length}명의 교적 · 셀편성 ${esc(versionLabel(currentVersion()) || "미등록")}</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-sm" id="xlsxBtn">📥 엑셀 받기 (교적부 전체)</button>
      ${isLoggedIn() ? `<a class="btn btn-sm" href="#/import">파일로 가져오기</a>` : ""}
    </div>
  </div>

  ${enrollHtml()}

  <div class="grid grid-4 tiles" style="margin-bottom:16px">
    ${tile("재적 인원", active.length, "명", absent ? `장기결석 ${absent}명 별도` : "모두 출석 중", "t-all")}
    ${tile("중등부", mid, "명", pre ? `예비중1 ${pre}명 포함` : "중1 · 중2 · 중3", "t-mid")}
    ${tile("고등부", high, "명", "고1 · 고2 · 고3", "t-high")}
    ${tile("셀", activeCells().length, "개", unassigned ? `미배정 ${unassigned}명` : "전원 배정 완료", "t-cell")}
  </div>

  <section class="card" style="margin-bottom:16px">
    <div class="card-head">
      <h3>올해 중1 — 얼굴 익히기</h3>
      <span class="sub">${schoolYear()}학년도 · ${newbies.length}명 <a class="more" href="#/promoted">자세히 →</a></span>
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

  ${cellSection()}

  <div class="grid grid-2" style="margin-bottom:16px">
    <section class="card">
      <div class="card-head"><h3>학년별 인원</h3><span class="sub">재적 ${active.length}명</span></div>
      <div class="card-pad dn-wrap">
        ${gradeRows.length
          ? donutChart(gradeRows, { size: 156, thickness: 22, mid: active.length, midSub: "재적" })
            + `<div class="dn-keys2">
                 ${donutLegend(gradeRows.filter((r) => !r.label.startsWith("고")), active.length)}
                 ${donutLegend(gradeRows.filter((r) => r.label.startsWith("고")), active.length)}
               </div>`
          : `<div class="empty" style="padding:28px 0">아직 등록된 아이가 없습니다.</div>`}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>이번 달 생일</h3><span class="sub">${thisMonth}월 · ${bdays.length}명 <a class="more" href="#/birthdays">자세히 →</a></span></div>
      <div class="card-pad bday-list${bdays.length > 4 ? " two" : ""}">
        ${bdays.length ? `<ul>${bdays.map((b) => `
          <li class="${b.day === today ? "now" : ""}">
            <span class="d">${b.day}</span>
            <span class="n">${esc(b.name)}</span>
            <span class="badge ${b.kind === "학생" ? "" : "blue"}">
              ${esc(b.kind === "학생" ? b.grade || "학생" : b.kind)}</span>
            ${b.day === today ? '<span class="badge orange">오늘</span>' : ""}
          </li>`).join("")}</ul>`
          : `<div class="empty" style="padding:28px 0">${thisMonth}월 생일자가 없습니다.</div>`}
      </div>
    </section>
  </div>

  <div class="grid grid-2" style="margin-bottom:16px">
    <section class="card">
      <div class="card-head"><h3>성별 분포</h3><span class="sub">재적 기준</span></div>
      <div class="card-pad">
        <div class="split-bar">
          <span class="sb-b" style="width:${(male / gTotal) * 100}%"></span>
          <span class="sb-g" style="width:${(female / gTotal) * 100}%"></span>
        </div>
        <div class="legend">
          <span><i class="sw-b"></i>남 <b>${male}</b>명 · ${Math.round(male / gTotal * 100)}%</span>
          <span><i class="sw-g"></i>여 <b>${female}</b>명 · ${Math.round(female / gTotal * 100)}%</span>
        </div>
        <p class="card-note">
          재적 ${active.length}명 기준입니다.${absent ? ` 장기결석 ${absent}명은 빼고 셌어요.` : ""}
          ${unassigned ? `셀이 아직 정해지지 않은 아이가 ${unassigned}명 있습니다.` : "모두 셀에 들어가 있습니다."}
        </p>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>교사진 구성</h3><span class="sub">직분별 인원 · ${teacherCount}명 <a class="more" href="#/teachers">연락처 →</a></span></div>
      <div class="card-pad">
        ${barChart(["담임목사", "교역자", "사모", "교사", "간사"]
          .map((r) => ({ label: r, value: state.teachers.filter((t) => t.role === r).length }))
          .filter((r) => r.value), { alt: true })}
        <p class="card-note">
          교역자 · 교사 · 간사가 각각 몇 분인지입니다.
          ${teacherCount} 분 중 <b>${claimed}</b> 분이 교적부에 가입하셨어요.
          ${claimed < teacherCount ? `<a href="#/signup">가입 안내 →</a>` : ""}
        </p>
      </div>
    </section>
  </div>

  <section class="card">
    <div class="card-head"><h3>월별 생일 인원</h3><span class="sub">학생 · 교사진 합계</span></div>
    <div class="card-pad" style="padding-top:6px">
      ${areaChart(MONTHS.map((m, i) => ({
        label: m, value: birthdayList().filter((b) => b.month === i + 1).length })),
        { hi: thisMonth - 1 })}
      <p class="card-note">가장 진한 점이 이번 달(${thisMonth}월)입니다.</p>
    </div>
  </section>`;
}

/** 셀별 인원 + 지난 주일에 몇 명이 왔는지를 한 칸에 모아 보여 줍니다.
 *  점 하나가 아이 한 명 — 불이 켜진 점이 그날 온 아이입니다. */
function cellSection() {
  const cells = activeCells();
  if (!cells.length) return "";
  const rec = state.attendRecent;
  const came = new Set(rec.present);
  const showAttend = isLoggedIn() && !!rec.event;

  const rows = cells.map((c) => {
    const kids = cellMembers(c.id);
    const on = kids.filter((s) => came.has(s.id)).length;
    return { name: shortName(c.name), total: kids.length, on };
  }).sort((a, b) => b.total - a.total);

  const total = rows.reduce((a, r) => a + r.total, 0);
  const onAll = rows.reduce((a, r) => a + r.on, 0);

  return `
  <section class="card cellsec" style="margin-bottom:16px">
    <div class="card-head">
      <h3>셀별 출결 현황</h3>
      <span class="sub">
        ${showAttend
          ? `${esc(dateLabel(rec.event.held_on))} ${esc(eventName(rec.event))} 기준 ·
             <b class="cs-on">${onAll}</b>/${total}명`
          : isLoggedIn()
            ? `아직 출석 기록이 없습니다 · ${total}명`
            : `${total}명`}
        ${isLoggedIn() ? `<a class="more" href="#/attend">출석부 →</a>` : ""}
      </span>
    </div>
    <div class="card-pad">
      <div class="cellg${showAttend ? "" : " plain"}">
        ${rows.map((r) => `
          <div class="cellg-r" title="${esc(r.name)} — ${showAttend ? `${r.total}명 중 ${r.on}명 왔습니다` : `${r.total}명`}">
            <span class="cellg-n">${esc(r.name)}</span>
            <span class="cellg-v">${showAttend ? `<b>${r.on}</b><small>/${r.total}</small>`
                                               : `<b>${r.total}</b><small>명</small>`}</span>
            ${dotGauge(showAttend ? r.on : 0, r.total)}
          </div>`).join("")}
      </div>
      <p class="card-note">
        ${showAttend
          ? "점 하나가 아이 한 명입니다. 불이 켜진 점이 그날 온 아이예요."
          : isLoggedIn()
            ? "출석부에 한 주라도 기록하면 여기에 그날 온 아이가 함께 보입니다."
            : "출석 현황은 로그인하면 보입니다."}
      </p>
    </div>
  </section>`;
}

/** 출석부에 «처음 온 아이» 로 적어 둔 아이가 여러 주 나오면 등록을 권합니다 */
function enrollHtml() {
  if (!isLoggedIn()) return "";
  const list = guestsToEnroll();
  if (!list.length) return "";
  return `
  <div class="enroll" id="enrollBox">
    <div class="enroll-h">
      <span class="enroll-ico">🌱</span>
      <b>${list.length === 1 ? `${esc(list[0].name)} 이(가) 계속 나오고 있어요`
                             : `계속 나오고 있는 아이가 ${list.length}명 있어요`}</b>
    </div>
    <p class="enroll-p">
      출석부에 «처음 온 아이» 로 적어 두신 아이입니다.
      <b>${ENROLL_AFTER}번 넘게</b> 나왔으니 이제 교적부에 넣어 두시는 건 어떨까요?
    </p>
    <div class="enroll-list">
      ${list.map((g) => `
        <div class="enroll-row" data-g="${g.id}">
          <b>${esc(g.name)}</b>
          <span>${esc([g.grade, g.school, g.invited_by && `${g.invited_by} 친구`]
            .filter(Boolean).join(" · ") || "적어 둔 것 없음")}</span>
          <span class="enroll-n">${state.guestCounts[g.id] || 0}번</span>
          <button type="button" class="btn btn-sm" data-later="${g.id}">나중에</button>
          <button type="button" class="btn btn-primary btn-sm" data-enroll="${g.id}">교적부에 등록</button>
        </div>`).join("")}
    </div>
  </div>`;
}

export function mount(root, rerender) {
  //  «교적부에 등록» — 출석부에 적어 둔 내용을 그대로 채운 등록 창이 열립니다
  root.querySelectorAll("[data-enroll]").forEach((b) => b.addEventListener("click", () => {
    const g = state.attendGuests.find((x) => x.id === b.dataset.enroll);
    if (!g) return;
    editStudent({
      name: g.name, gender: g.gender || null, grade: g.grade || null,
      school: g.school || null, phone: g.phone || null,
      note: [g.note, g.invited_by ? `${g.invited_by} 친구로 처음 옴` : null,
             g.first_on ? `처음 온 날 ${g.first_on}` : null].filter(Boolean).join(" · ") || null,
    }, async (saved) => {
      //  등록이 끝나면 그 아이는 더 이상 «처음 온 아이» 가 아닙니다
      try {
        if (saved?.id) await api.saveGuest({ id: g.id, enrolled_student_id: saved.id });
        await api.refresh();
        toast(`${g.name} — 교적부에 등록했습니다.`);
      } catch (e) { toast(e.message, "err"); }
      rerender();
    });
  }));
  root.querySelectorAll("[data-later]").forEach((b) => b.addEventListener("click", async () => {
    const g = state.attendGuests.find((x) => x.id === b.dataset.later);
    if (!g) return;
    if (!(await confirmDialog(
      `«${g.name}» 은(는) 다시 묻지 않을까요?\n출석부에는 그대로 남아 있습니다.`,
      { danger: false, okText: "다시 묻지 않기" }))) return;
    try { await api.saveGuest({ id: g.id, dismissed: true }); rerender(); }
    catch (e) { toast(e.message, "err"); }
  }));

  root.querySelectorAll("[data-student]").forEach((el) => el.addEventListener("click", () =>
    showStudent(state.students.find((s) => s.id === el.dataset.student), rerender)));
  //  «지난 주일에 누가 왔나» 는 개요에 들어올 때 한 번만 받아 옵니다.
  //  받은 뒤에 한 번 다시 그려야 점에 불이 들어옵니다.
  if (isLoggedIn() && !state.attendRecent.loaded) {
    api.loadRecentAttendance().then(() => rerender()).catch(() => {});
  }

  bindXlsx(root.querySelector("#xlsxBtn"), async () => {
    const { exportWorkbook } = await import("../xlsx.js");
    await exportWorkbook();
  }, "📥 엑셀 받기 (교적부 전체)");
}

const shortName = (n) =>
  String(n || "").replace(/\s*(선생님|간사|목사|전도사|사모)/g, "").replace(/\s*\/\s*/g, "·").trim();

const shortCell = (n) => (n ? shortName(n) + " 셀" : "미배정");

const tile = (label, value, unit, foot, kind = "") => `
  <div class="card tile ${kind}">
    <div class="label">${esc(label)}</div>
    <div class="value">${value}<small>${esc(unit)}</small></div>
    <div class="foot">${esc(foot)}</div>
  </div>`;
