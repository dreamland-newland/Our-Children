// ============================================================
//  출석부 — 주일예배 · 수련회 · 행사
//   · 기본은 «전부 안 옴». 이름을 두 번 톡톡 치면 출석으로 바뀝니다.
//   · 이름을 꾹 누르고 있으면 그 아이 신상이 뜹니다.
//   · 지난 기록도 폰에서 보고, «수정» 을 누르면 고칠 수 있습니다.
// ============================================================
import {
  state, api, isLoggedIn, isAdmin, isActive, photoOf, gradeOf, ENROLL_AFTER, GUEST_RECENT_WEEKS,
  activeCells, cellMembers, cellRoleOf, roleRank, currentVersion, versionOn, versionLabel,
  dateLabel, dateShort, eventName, sundayOf, ymd, parseYmd, ATTEND_KINDS,
} from "../data.js";
import { esc, toast, modal, confirmDialog, avatar, isDesktop, byName } from "../ui.js";
import { showStudent } from "./students.js";

// ── 화면이 기억하는 것 ──────────────────────────────────────
let target = { held_on: sundayOf(), kind: "주일예배", title: "" };
let ev = null;                 // 서버에 만들어진 모임 (아직 없으면 null)
let marks = new Map();         // student_id → { present, memo, … }
let viewMode = "cell";         // cell | list | photo
let filter = "all";            // all | in | out
let query = "";
let searchOpen = false;
let unlocked = true;           // 지난 기록은 잠가 두고, «수정» 을 눌러야 열립니다
let busy = false;
let timer = null;
let syncTick = null;           // «몇 분 전에 맞췄는지» 를 1분마다 고쳐 쓰는 시계
let unwatch = null;            // 실시간 구독 끊기
let syncedAt = 0;              // 마지막으로 서버와 맞춘 시각
let live = false;              // 실시간 연결이 살아 있는가
let redraw = null;             // 화면 다시 그리기 (app.js 가 넘겨 준 것)
let tourQueued = false;        // 처음 오신 분께 사용법을 한 번만 띄우기 위한 표시
let openMemos = new Set();     // 펼쳐 둔 심방 칸 (저장해도 닫히지 않게)
let holdRender = false;        // 당겨서 새로고침하는 동안엔 화면을 갈아엎지 않습니다
let pendingRender = false;     //  (다 끝나고 판이 접힌 뒤에 한 번만 다시 그립니다)

/** 다른 화면으로 옮겨 갈 때 자동 새로고침을 멈춥니다 */
export function stopWatch() {
  if (timer) { clearInterval(timer); timer = null; }
  if (syncTick) { clearInterval(syncTick); syncTick = null; }
  if (unwatch) { try { unwatch(); } catch { /* 이미 끊김 */ } unwatch = null; }
  live = false;
  openMemos = new Set();
  document.body.classList.remove("att-page");
}

// ── «언제 맞췄는지» ─────────────────────────────────────────
/** 방금 · 3분 전 · 1시간 전 … */
function agoText(t) {
  if (!t) return "아직 새로고침 전";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금 새로고침했습니다";
  if (m < 60) return `${m}분 전에 새로고침`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전에 새로고침` : "한참 전에 새로고침";
}
const syncText = () => (live ? "실시간으로 함께 보는 중" : agoText(syncedAt));

/** 화면 전체를 다시 그리지 않고 그 한 줄만 고쳐 씁니다 (보던 자리가 튀지 않게) */
function paintSync() {
  const t = document.getElementById("attSyncT");
  if (t) t.textContent = syncText();
  const d = document.getElementById("attSyncDot");
  if (d) {
    const stale = !live && syncedAt && Date.now() - syncedAt > 5 * 60000;
    d.classList.toggle("live", live);
    d.classList.toggle("stale", !!stale);
  }
}

const isToday = () => target.held_on === sundayOf() || target.held_on >= ymd();
const canEdit = () => unlocked;

// ── 명단 ────────────────────────────────────────────────────
/** 이 모임을 어느 셀편성으로 묶어 볼지
 *  · 이미 만들어진 모임이면 그때 적어 둔 편성
 *  · 아직 없으면 그 날짜에 쓰이던 편성 */
const rosterVersion = () => ev?.version_id || versionOn(target.held_on);

/** 셀별로 묶은 아이들 (셀에 없는 아이는 맨 아래 «셀 미배정») */
function roster() {
  const used = new Set();
  const vid = rosterVersion();
  const groups = activeCells(vid).map((c) => {
    const kids = cellMembers(c.id).filter(isActive).sort((a, b) =>
      roleRank(cellRoleOf(a.id, vid)) - roleRank(cellRoleOf(b.id, vid)) || byName(a.name, b.name));
    kids.forEach((k) => used.add(k.id));
    return { id: c.id, name: c.name, leaders: c.leaders || [], kids };
  }).filter((g) => g.kids.length);
  const rest = state.students.filter((s) => isActive(s) && !used.has(s.id))
    .sort((a, b) => byName(a.name, b.name));
  if (rest.length) groups.push({ id: "_none", name: "셀 미배정", leaders: [], kids: rest });

  //  오늘 처음 온 아이 — 교적부에 없는, 친구 따라왔거나 둘러보러 온 아이들.
  //  이 모임에 이름을 올려 둔 아이만 보입니다.
  const guests = guestsHere();
  if (guests.length)
    groups.push({ id: "_guest", name: "오늘 처음 온 아이", leaders: [], guest: true, kids: guests });
  return groups;
}

/** 지금 보고 있는 모임에 이름이 올라 있는 손님들 (결석으로 바꿔도 목록엔 남습니다) */
function guestsHere() {
  if (!ev) return [];
  return state.attendGuests
    .filter((g) => marks.has(g.id))
    .sort((a, b) => byName(a.name, b.name));
}
const isGuest = (id) => state.attendGuests.some((g) => g.id === id);

/** 최근 몇 주 안에 왔던 손님 중, 오늘 아직 올리지 않은 아이들
 *  (지난주에 온 아이가 이번 주에도 왔을 때, 이름을 다시 적지 않아도 되도록) */
function recentGuests() {
  const end = parseYmd(target.held_on);
  const from = new Date(end); from.setDate(from.getDate() - GUEST_RECENT_WEEKS * 7);
  const lo = ymd(from), hi = target.held_on;
  return state.attendGuests
    .filter((g) => {
      if (g.enrolled_student_id) return false;      // 교적부로 옮긴 아이는 이제 주소록에 있습니다
      if (marks.has(g.id)) return false;            // 오늘 이미 올린 아이
      const d = state.guestLastOn[g.id] || g.first_on;
      return d && d >= lo && d <= hi;
    })
    .sort((a, b) => String(state.guestLastOn[b.id] || "").localeCompare(String(state.guestLastOn[a.id] || "")));
}

const isIn = (id) => marks.get(id)?.present === true;
const memoOf = (id) => marks.get(id)?.memo || "";

/** 검색·걸러보기를 적용한 명단 */
function shown() {
  const q = query.trim();
  return roster().map((g) => ({
    ...g,
    kids: g.kids.filter((s) => {
      if (q && !String(s.name).includes(q)) return false;
      if (filter === "in" && !isIn(s.id)) return false;
      if (filter === "out" && isIn(s.id)) return false;
      return true;
    }),
  })).filter((g) => g.kids.length);
}

function counts() {
  const all = roster().flatMap((g) => g.kids);
  const inn = all.filter((s) => isIn(s.id)).length;
  return { total: all.length, inn, out: all.length - inn };
}

// ── 그리기 ──────────────────────────────────────────────────
export function html() {
  if (!isLoggedIn())
    return card("출석부는 로그인한 교사·간사만 볼 수 있습니다.",
      `<a class="btn btn-primary btn-sm" href="#/login">로그인</a>`);

  if (!state.attendReady)
    return card("출석부가 아직 켜지지 않았습니다.",
      `<div style="font-size:13px;color:var(--text-secondary);line-height:1.7">
         관리자가 Supabase → SQL Editor 에서
         <code>supabase/10_attendance.sql</code> 을 한 번 실행하면 바로 쓸 수 있습니다.
         <br>한 번만 하면 되고, 기존 자료는 건드리지 않습니다.</div>`);

  const ver = currentVersion();
  if (!roster().length)
    return card("셀편성이 아직 없습니다.",
      `<div style="font-size:13px;color:var(--text-secondary)">
         먼저 «셀편성» 에서 아이들을 셀에 넣어 주세요.
         (셀에 없는 아이도 출석부에는 «셀 미배정» 으로 나옵니다.)</div>`);

  const c = counts();
  const groups = shown();
  const desk = isDesktop();
  //  지금 보고 있는 편성이 «가장 최근 편성» 과 다르면 알려 줍니다
  const rv = rosterVersion();
  const verNote = rv && rv !== state.versions[0]?.id
    ? `${versionLabel(state.versions.find((v) => v.id === rv)) || "예전"} 편성으로 보는 중` : "";                         // 마우스가 있는 «컴퓨터» 인가
  const roomy = desk || window.innerWidth > 700;    // 태블릿처럼 화면이 넓은가

  return `
  <div class="att" id="att">
    <div class="att-pull" id="attPull">
      <div class="att-pull-in">
        <div class="att-ring" id="attRing">
          <svg viewBox="0 0 52 52" aria-hidden="true">
            <circle class="rg-bg" cx="26" cy="26" r="21"></circle>
            <circle class="rg-fg" cx="26" cy="26" r="21"></circle>
          </svg>
          <span class="rg-clover" aria-hidden="true"><i>🍀</i></span>
        </div>
        <div class="att-pull-txt">
          <b id="attPullT">아래로 당기면 새로고침</b>
          <span class="att-quote"></span>
        </div>
      </div>
    </div>

    <div class="att-bar">
      <div class="att-row1">
        <button class="att-nav" data-move="-1" aria-label="이전">‹</button>
        <button class="att-when" id="attPick">
          <b>${esc(dateLabel(target.held_on))}</b>
          <small>${esc(target.title ? `${target.kind} · ${target.title}` : target.kind)}</small>
        </button>
        <button class="att-nav" data-move="1" aria-label="다음">›</button>
        <span class="att-sum">
          <i class="in">${c.inn}</i><span class="sl">/</span><i class="tot">${c.total}</i>
        </span>
        ${canEdit() ? "" : `<button class="att-lock" id="attEdit">✏️ 수정</button>`}
      </div>
      <div class="att-row2">
        ${roomy || searchOpen || query ? `
        <label class="att-find">
          ${ICO.find}
          <input id="attQ" type="search" placeholder="이름 찾기" value="${esc(query)}" autocomplete="off">
        </label>` : `<button class="att-ico" id="attFind" aria-label="이름 찾기" data-tip="이름으로 찾기">${ICO.find}</button>`}
        <div class="att-seg" id="attFilter">
          ${seg("all", "전체", filter)}${seg("in", `출석 ${c.inn}`, filter)}${seg("out", `결석 ${c.out}`, filter)}
        </div>
        <div class="att-seg att-seg-i" id="attView">
          ${seg("cell", "셀", viewMode)}${seg("list", "목록", viewMode)}${seg("photo", "사진", viewMode)}
        </div>
        <button class="att-ico" id="attLog" aria-label="지난 기록"
                data-tip="지난 기록 — 다른 날짜 출석부 열기">${ICO.log}</button>
        ${desk ? `<button class="att-ico" id="attRedo" aria-label="새로고침"
                data-tip="새로고침 — 다른 선생님이 누른 내용 받아 오기">${ICO.redo}</button>
                  <button class="att-ico" id="attPrint" aria-label="인쇄"
                data-tip="인쇄 — 오늘 출석지를 종이로">${ICO.print}</button>
                  <button class="att-ico" id="attXlsx" aria-label="엑셀 받기"
                data-tip="엑셀 받기 — 명단·요약 두 장으로">${ICO.down}</button>` : ""}
      </div>

      <div class="att-sync" id="attSync">
        <span class="sy-dot" id="attSyncDot"></span>
        <span id="attSyncT">${esc(syncText())}</span>
        ${verNote ? `<span class="sy-ver" id="attVer">· ${esc(verNote)}</span>` : ""}
        <span class="sy-hint">· 아래로 당겨 새로고침</span>
      </div>
    </div>

    ${canEdit() ? "" : `<div class="att-locked">지난 기록을 보는 중입니다 — 고치려면 위 «수정» 을 누르세요.</div>`}

    <div class="att-body${canEdit() ? "" : " ro"}" id="attBody">
      ${groups.length ? groups.map(groupHtml).join("")
        : `<div class="empty" style="padding:38px 0">${query ? "찾는 이름이 없습니다." : "해당하는 아이가 없습니다."}</div>`}
    </div>

    ${canEdit() && !query && filter !== "in" ? `
    ${(() => {
      const r = recentGuests();
      if (!r.length) return "";
      return `<div class="att-past">
        <div class="att-past-h">최근 ${GUEST_RECENT_WEEKS}주에 왔던 아이
          <small>누르면 오늘 출석으로 들어갑니다</small></div>
        <div class="att-chips">
          ${r.map((g) => `<button type="button" class="att-chip att-chip-g att-chip-past"
              data-past="${g.id}">${esc(g.name)}
              <i class="att-when-s">${esc(dateShort(state.guestLastOn[g.id] || g.first_on))}</i>
            </button>`).join("")}
        </div>
      </div>`;
    })()}
    <button type="button" class="att-add" id="attAddGuest">
      ＋ 처음 온 아이
      <small>친구 따라왔거나 교회를 둘러보러 온 아이</small>
    </button>` : ""}

    <div class="att-foot">
      <button type="button" class="att-help-btn" id="attHelp2">${ICO.help}사용법 보기</button>
    </div>
  </div>`;
}

// 작은 아이콘 — 기기마다 달라 보이는 그림문자 대신 직접 그립니다
const ICO = {
  find:  `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.4"/><path d="m16 16 4.4 4.4"/></svg>`,
  log:   `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 12a8.4 8.4 0 1 0 2.5-6"/><path d="M3 4.4V10h5.6"/><path d="M12 7.6V12l3.2 2"/></svg>`,
  print: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3.6h10V9"/><rect x="3.4" y="9" width="17.2" height="7.6" rx="2"/><path d="M7 14h10v6.4H7z"/></svg>`,
  down:  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6v11.2"/><path d="m7.6 10.6 4.4 4.4 4.4-4.4"/><path d="M4.4 19.6h15.2"/></svg>`,
  redo:  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 12a8.4 8.4 0 1 1-2.5-6"/><path d="M21 4.4V10h-5.6"/></svg>`,
  help:  `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3.1 2.3c-.6.2-.9.7-.9 1.3v.5"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/></svg>`,
};

const card = (title, inner) => `
  <div class="page-head"><div><h1>출석부</h1></div></div>
  <div class="card card-pad"><b>${esc(title)}</b><div style="margin-top:8px">${inner}</div></div>`;

const seg = (v, label, cur) =>
  `<button data-v="${v}"${v === cur ? ' class="on"' : ""}>${esc(label)}</button>`;

function groupHtml(g) {
  const inn = g.kids.filter((s) => isIn(s.id)).length;
  const head = `
    <div class="att-ch">
      <b>${esc(g.name)}</b>
      ${(() => {
        const lead = (g.leaders || []).filter((n) => n && !g.name.includes(n));
        return lead.length ? `<span class="att-lead">${esc(lead.join(" · "))}</span>` : "";
      })()}
      <span class="att-cnt">${inn}/${g.kids.length}</span>
      ${canEdit() && filter !== "out" && !g.guest
        ? `<button class="att-all" data-all="${g.id}" data-on="${inn < g.kids.length ? 1 : 0}"
            >${inn < g.kids.length ? "모두 출석" : "모두 해제"}</button>` : ""}
    </div>`;

  if (filter === "out") return `<section class="att-cell">${head}${g.kids.map(visitRow).join("")}</section>`;
  if (g.guest) return `<section class="att-cell att-cell-guest">${head}
    <div class="att-chips">${g.kids.map(guestChip).join("")}</div></section>`;
  if (viewMode === "list") return `<section class="att-cell">${head}${g.kids.map(listRow).join("")}</section>`;
  if (viewMode === "photo")
    return `<section class="att-cell">${head}<div class="att-faces">${g.kids.map(faceCell).join("")}</div></section>`;
  return `<section class="att-cell">${head}<div class="att-chips">${g.kids.map(chip).join("")}</div></section>`;
}

const kidAttrs = (s) => `data-s="${s.id}" data-name="${esc(s.name)}"`;

/** 손님 이름표 — 교적부 아이와 구별되게 점선 테두리 */
function guestChip(g) {
  const on = isIn(g.id);
  const n = state.guestCounts[g.id] || 0;
  return `<button class="att-chip att-chip-g${on ? " on" : ""}${memoOf(g.id) ? " memo" : ""}"
    data-s="${g.id}" data-name="${esc(g.name)}" data-guest="1"
    >${esc(g.name)}${n >= 2 ? `<i class="att-n">${n}</i>` : ""}</button>`;
}

function chip(s) {
  const on = isIn(s.id);
  return `<button class="att-chip${on ? " on" : ""}${memoOf(s.id) ? " memo" : ""}" ${kidAttrs(s)}
    >${esc(s.name)}</button>`;
}

function listRow(s) {
  const on = isIn(s.id);
  return `<div class="att-row${on ? " on" : ""}" ${kidAttrs(s)}>
    <span class="att-dot"></span>
    <span class="att-nm">${esc(s.name)}</span>
    <span class="att-sub">${esc(gradeOf(s) || "")}</span>
    ${memoOf(s.id) ? `<span class="att-pin">✎</span>` : ""}
    <span class="att-st">${on ? "출석" : "결석"}</span>
  </div>`;
}

function faceCell(s) {
  const on = isIn(s.id);
  return `<div class="att-face${on ? " on" : ""}" ${kidAttrs(s)}>
    ${avatar(s.name, photoOf(s.id), 54)}
    <span>${esc(s.name)}</span>
  </div>`;
}

/** 결석만 볼 때 — 이름 아래에 심방(결석 사유) 칸이 접혀 있습니다 */
function visitRow(s) {
  const m = memoOf(s.id);
  const who = marks.get(s.id)?.memo_by || "";
  return `<div class="att-visit" data-v="${s.id}">
    <div class="att-row" ${kidAttrs(s)}>
      <span class="att-dot"></span>
      <span class="att-nm">${esc(s.name)}</span>
      <span class="att-sub">${esc(gradeOf(s) || "")}</span>
      <button class="att-memo-b${m ? " on" : ""}" data-memo="${s.id}">심방${m ? " ✎" : ""}</button>
    </div>
    ${m ? `<div class="att-memo-p" data-peek="${s.id}"${openMemos.has(s.id) ? " hidden" : ""}>
        <span class="mp-t">${esc(m)}</span>
        ${who ? `<span class="mp-by">${esc(who)}</span>` : ""}
      </div>` : ""}
    <div class="att-memo"${openMemos.has(s.id) ? "" : " hidden"}>
      <textarea rows="2" placeholder="결석 사유 · 통화 내용을 적어 두세요"
        ${canEdit() ? "" : 'readonly data-locked="1"'}>${esc(m)}</textarea>
      <div class="att-memo-f">
        <small>${who ? `${esc(who)} 적음` : ""}</small>
        <button class="btn btn-sm" data-cancel="${s.id}">닫기</button>
        ${canEdit() ? `<button class="btn btn-primary btn-sm" data-save="${s.id}">저장</button>` : ""}
      </div>
    </div>
  </div>`;
}

// ── 붙이기 ──────────────────────────────────────────────────
export function mount(root, rerender) {
  stopWatch();
  if (!isLoggedIn() || !state.attendReady) return;
  const body = root.querySelector("#attBody");
  if (!body) return;

  //  휴대폰에서는 아이 이름을 한 줄이라도 더 보여 드리려고
  //  위 채널을 같이 붙여 두지 않고(스크롤과 함께 올라갑니다) 출석부 머리띠만 남깁니다.
  //  컴퓨터에서는 위 채널이 그대로 붙어 있으니 그 높이만큼 아래에 놓습니다.
  document.body.classList.add("att-page");
  const fixTop = () => {
    const phone = window.matchMedia("(max-width: 640px)").matches;
    const h = phone ? 0 : Math.min(140, Math.round(document.querySelector(".topbar")?.offsetHeight || 52));
    root.querySelector("#att")?.style.setProperty("--att-top", `${h}px`);
  };
  fixTop(); window.addEventListener("resize", fixTop);

  redraw = rerender;
  syncEvent();
  if (ev && !marks.size) load(rerender);
  else if (!ev) syncedAt = syncedAt || Date.now();   // 아직 아무도 표시하지 않은 날 — 맞출 게 없습니다

  // 날짜 옮기기
  root.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
    const step = Number(b.dataset.move) * (target.kind === "주일예배" ? 7 : 1);
    const d = parseYmd(target.held_on); d.setDate(d.getDate() + step);
    goto({ ...target, held_on: ymd(d) }, rerender);
  }));
  root.querySelector("#attPick")?.addEventListener("click", () => pickEvent(rerender));
  root.querySelector("#attEdit")?.addEventListener("click", () => { unlocked = true; rerender(); });
  root.querySelector("#attLog")?.addEventListener("click", () => openLog(rerender));
  root.querySelector("#attHelp2")?.addEventListener("click", () => openTour());
  root.querySelector("#attAddGuest")?.addEventListener("click", () => guestForm(null, rerender));
  root.querySelectorAll("[data-past]").forEach((b) => b.addEventListener("click", async () => {
    const g = state.attendGuests.find((x) => x.id === b.dataset.past);
    if (!g || !canEdit()) return;
    try {
      b.classList.add("on");
      await ensureEvent();
      const row = await api.markGuest(ev.id, g.id, { present: true });
      marks.set(g.id, row);
      buzz(24); burstAt(b);
      toast(`${g.name} — 오늘 출석으로 넣었습니다.`);
      rerender();
    } catch (e) { b.classList.remove("on"); toast(e.message, "err"); }
  }));
  root.querySelector("#attHelp2")?.addEventListener("click", () => openTour());
  //  처음 들어오신 분께는 사용법이 저절로 한 번 열립니다.
  //  («사용법 보기» 단추는 화면 맨 아래에 있어서, 반짝여도 눈에 띄지 않기 때문입니다.
  //    한 번 보고 나면 다시는 저절로 열리지 않습니다.)
  if (!tourSeen() && !tourQueued) {
    tourQueued = true;
    setTimeout(() => { if (location.hash === "#/attend" && !tourSeen()) openTour(); }, 700);
  }

  // 찾기 · 걸러보기 · 보는 방식
  root.querySelector("#attFind")?.addEventListener("click", () => { searchOpen = true; rerender(); });
  const qi = root.querySelector("#attQ");
  if (searchOpen && qi && !query) qi.focus();
  qi?.addEventListener("input", () => {
    query = qi.value;
    const at = qi.selectionStart;
    rerender();
    const n = document.querySelector("#attQ");
    if (n) { n.focus(); n.setSelectionRange(at, at); }
  });
  root.querySelector("#attFilter")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    filter = b.dataset.v; rerender();
  });
  root.querySelector("#attView")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    viewMode = b.dataset.v; rerender();
  });

  // 셀 전체 출석 / 해제
  body.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", async () => {
    if (!canEdit()) return;
    const g = shown().find((x) => x.id === b.dataset.all); if (!g) return;
    const on = b.dataset.on === "1";
    await ensureEvent();
    const ids = g.kids.filter((s) => isIn(s.id) !== on).map((s) => s.id);
    if (!ids.length) return;
    try {
      const rows = await api.markMany(ev.id, ids, on);
      rows.forEach((r) => marks.set(r.student_id, r));
      if (on) { buzz(24); burstAt(b); }
      rerender();
    } catch (e) { toast(e.message, "err"); }
  }));

  wireTaps(body, rerender);
  wireMemo(body, rerender);
  wirePull(root, rerender);

  // 인쇄 · 엑셀 (컴퓨터에서만 단추가 보입니다)
  root.querySelector("#attRedo")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.classList.add("spin");
    await refreshAll(rerender);
    document.getElementById("attRedo")?.classList.remove("spin");
    toast("새로고침했습니다.");
  });
  root.querySelector("#attPrint")?.addEventListener("click", () => window.print());
  root.querySelector("#attXlsx")?.addEventListener("click", async () => {
    try {
      const { exportAttendance } = await import("../xlsx.js");
      await exportAttendance(ev || target, roster(), marks);
    } catch (e) { toast("엑셀을 만들지 못했습니다: " + e.message, "err"); }
  });

  // 출석당번이 두 분일 때 —
  //  ① 실시간 연결이 되면 상대가 누르는 즉시 받아 옵니다
  //  ② 연결이 안 되거나 끊겨도 1분마다 조용히 다시 읽어 와서 결국 맞습니다
  if (ev) {
    try {
      unwatch = api.watchMarks(ev.id, () => { load(rerender, true); });
      live = state.mode === "supabase";
    } catch { live = false; }
  }
  paintSync();
  syncTick = setInterval(paintSync, 30000);
  timer = setInterval(() => {
    if (location.hash !== "#/attend") return stopWatch();
    if (document.hidden || busy || !ev) return;
    load(rerender, true);
  }, 60000);
  // 화면을 다시 켜면(주머니에서 꺼내면) 바로 한 번 맞춥니다
  document.addEventListener("visibilitychange", onWake);
}

/** 화면을 다시 켰을 때 — 그 사이에 바뀐 게 있으면 받아 옵니다 */
function onWake() {
  if (document.hidden || location.hash !== "#/attend") return;
  const root = document.getElementById("att");
  if (!root) { document.removeEventListener("visibilitychange", onWake); return; }
  if (redraw) load(redraw, true);
}

// ── 톡톡 두 번 / 꾹 누르기 ──────────────────────────────────
function wireTaps(body, rerender) {
  let downAt = 0, downXY = null, hold = null, held = false, target2 = null;
  let lastId = null, lastTap = 0;

  const kid = (e) => e.target.closest("[data-s]");

  body.addEventListener("pointerdown", (e) => {
    const el = kid(e); if (!el) return;
    if (e.target.closest("[data-memo],[data-save],[data-cancel]")) return;
    target2 = el; held = false; downAt = Date.now();
    downXY = { x: e.clientX, y: e.clientY };
    el.classList.add("press");
    hold = setTimeout(() => {
      held = true;
      el.classList.remove("press");
      buzz(12);
      const id = el.dataset.s;
      const g = state.attendGuests.find((x) => x.id === id);
      if (g) showGuest(g, rerender);
      else showStudent(state.students.find((x) => x.id === id), rerender);
    }, 480);
  });

  const cancel = () => {
    clearTimeout(hold); hold = null;
    target2?.classList.remove("press");
  };
  body.addEventListener("pointermove", (e) => {
    if (!downXY || !target2) return;
    if (Math.abs(e.clientX - downXY.x) > 10 || Math.abs(e.clientY - downXY.y) > 10) {
      cancel(); target2 = null; downXY = null;
    }
  });
  body.addEventListener("pointercancel", () => { cancel(); target2 = null; });

  body.addEventListener("pointerup", async (e) => {
    const el = target2; cancel(); target2 = null; downXY = null;
    if (!el || held) return;
    if (Date.now() - downAt > 480) return;

    const id = el.dataset.s;
    const now = Date.now();
    const second = lastId === id && now - lastTap < 400;
    lastId = id; lastTap = second ? 0 : now;
    if (!second) {                                   // 첫 번째 톡 — 살짝 눌린 느낌만
      el.classList.add("tap1");
      setTimeout(() => el.classList.remove("tap1"), 420);
      return;
    }
    if (!canEdit()) {
      const r = el.getBoundingClientRect();
      floatHint(r.left + r.width / 2, r.top, "위 «✏️ 수정» 을 눌러 주세요");
      return;
    }
    await toggle(el, id, rerender);
  });

  // 컴퓨터에서 마우스로 쓸 때도 두 번 눌러 바꾸는 건 같습니다 (텍스트 선택만 막습니다)
  body.addEventListener("dblclick", (e) => { if (kid(e)) e.preventDefault(); });
}

async function toggle(el, id, rerender) {
  const next = !isIn(id);
  el.classList.toggle("on", next);                   // 눈에 먼저 반영 (기다리지 않게)
  if (next) {
    buzz(28); burstAt(el);
    el.classList.remove("pop"); void el.offsetWidth; // 연달아 눌러도 다시 반짝이도록
    el.classList.add("pop");
    setTimeout(() => el.classList.remove("pop"), 460);
  } else buzz(10);
  try {
    await ensureEvent();
    const row = isGuest(id)
      ? await api.markGuest(ev.id, id, { present: next })
      : await api.mark(ev.id, id, { present: next });
    marks.set(id, { ...marks.get(id), ...row });
    rerender();
  } catch (e) {
    el.classList.toggle("on", !next);
    toast(e.message, "err");
  }
}

// ── 심방(결석 사유) ─────────────────────────────────────────
function wireMemo(body, rerender) {
  body.querySelectorAll("[data-memo]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const box = b.closest(".att-visit");
    const pane = box.querySelector(".att-memo");
    const peek = box.querySelector(".att-memo-p");
    pane.hidden = !pane.hidden;
    if (peek) peek.hidden = !pane.hidden;
    const id = b.dataset.memo;
    if (pane.hidden) openMemos.delete(id); else { openMemos.add(id); pane.querySelector("textarea")?.focus(); }
  }));
  body.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const box = b.closest(".att-visit");
    box.querySelector(".att-memo").hidden = true;
    openMemos.delete(b.dataset.cancel);
    const peek = box.querySelector(".att-memo-p"); if (peek) peek.hidden = false;
  }));
  //  잠긴 기록에서 적으려고 하면 — 두꺼운 안내 대신, 누른 자리에서 쪽지가 살짝 떠올랐다 사라집니다
  body.querySelectorAll("textarea[data-locked]").forEach((t) => {
    const nudge = (e) => {
      e.preventDefault();
      t.blur();
      floatHint(e.clientX ?? 0, e.clientY ?? 0, "위 «✏️ 수정» 을 눌러 주세요");
    };
    t.addEventListener("pointerdown", nudge);
    t.addEventListener("focus", () => {
      t.blur();
      const r = t.getBoundingClientRect();
      floatHint(r.left + r.width / 2, r.top + 16, "위 «✏️ 수정» 을 눌러 주세요");
    });
  });
  body.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const id = b.dataset.save;
    const box = b.closest(".att-visit");
    const memo = box.querySelector("textarea").value.trim();
    try {
      await ensureEvent();
      const patch = {
        present: isIn(id), memo: memo || null,
        //  심방은 «누가 전화했는지» 가 뒤에 필요하므로 이름을 남깁니다
        //  (출석을 누른 사람 이름은 남기지 않습니다 — 그건 별개입니다)
        memo_by: memo ? (state.profile?.name || null) : null,
        memo_at: memo ? new Date().toISOString() : null,
      };
      b.disabled = true; b.textContent = "저장 중…";
      const row = isGuest(id) ? await api.markGuest(ev.id, id, patch)
                              : await api.mark(ev.id, id, patch);
      marks.set(id, { ...marks.get(id), ...row });
      toast(memo ? "심방 기록을 저장했습니다." : "심방 기록을 지웠습니다.");
      openMemos = memo ? new Set([...openMemos, id]) : new Set([...openMemos].filter((x) => x !== id));
      rerender();
    } catch (err) {
      b.disabled = false; b.textContent = "저장";
      toast("저장하지 못했습니다 — " + err.message, "err");
    }
  }));
}

// ── 당겨서 새로고침 (폰) ────────────────────────────────────
function randomQuote() {
  const list = state.attendQuotes;
  if (!list.length) return "오늘도 수고 많으십니다.";
  return list[Math.floor(Math.random() * list.length)].text;
}

function wirePull(root, rerender) {
  const bar = root.querySelector("#attPull");
  if (!bar || isDesktop()) return;

  const label = bar.querySelector("#attPullT");
  const quote = bar.querySelector(".att-quote");
  const arc   = bar.querySelector(".rg-fg");
  const ring  = bar.querySelector("#attRing");
  const C = 2 * Math.PI * 21;                    // 동그라미 둘레 (r=21)

  const MAX  = 200;   // 손가락을 따라 여기까지 늘어납니다 (더 당길수록 뻑뻑해집니다)
  const TRIG = 74;    // 이만큼 당기면 «놓으면 새로고침»
  const REST = 62;    // 새로고침하는 동안 머무는 높이

  let y0 = null, h = 0, ready = false, running = false;

  const setH = (v, smooth = false) => {
    h = v;
    bar.style.transition = smooth ? "height .3s cubic-bezier(.22,.9,.24,1)" : "none";
    bar.style.height = `${Math.round(v)}px`;
  };
  const setPct = (p) => {                         // 0~1
    const v = Math.max(0, Math.min(1, p));
    arc.style.strokeDasharray = `${C}`;
    arc.style.strokeDashoffset = `${C * (1 - v)}`;
    //  클로버는 당길수록 커지고 색이 살아납니다 (숫자 대신 이게 진행 정도를 말해 줍니다)
    ring.style.setProperty("--grow", `${0.5 + 0.5 * v}`);
    ring.style.setProperty("--gray", `${1 - v}`);
    ring.classList.toggle("full", v >= 1);
    bar.style.setProperty("--p", `${Math.min(1, v * 1.7)}`);
  };

  // 고무줄 느낌 — 처음엔 손가락을 그대로 따라오고, 갈수록 뻑뻑해집니다
  const band = (dy) => MAX * (1 - 1 / (dy / MAX + 1));

  root.addEventListener("touchstart", (e) => {
    if (running || window.scrollY > 2 || e.touches.length !== 1) { y0 = null; return; }
    y0 = e.touches[0].clientY;
    ready = false;
    quote.textContent = randomQuote();
    label.textContent = "아래로 당기면 새로고침";
    setPct(0);
  }, { passive: true });

  root.addEventListener("touchmove", (e) => {
    if (y0 == null || running) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0) { setH(0); setPct(0); ready = false; bar.classList.remove("ready"); return; }
    setH(band(dy));
    setPct(h / TRIG);
    const next = h >= TRIG;
    if (next !== ready) {
      ready = next;
      bar.classList.toggle("ready", ready);
      label.textContent = ready ? "손을 놓으면 새로고침됩니다" : "아래로 당기면 새로고침";
      if (ready) buzz(10);
    }
  }, { passive: true });

  const end = async () => {
    if (y0 == null || running) return;
    y0 = null;
    if (!ready) { setH(0, true); setPct(0); bar.classList.remove("ready"); return; }

    running = true;
    holdRender = true; pendingRender = false;
    bar.classList.add("run");
    label.textContent = "새로고침 중입니다";
    setH(REST, true);
    buzz(14);

    //  퍼센트는 «척하는 숫자» 가 아니라 실제 단계에 맞춰 올라갑니다.
    //  다만 서버가 빨리 답하면 숫자가 튀어 보여서, 90%까지는 부드럽게 채웁니다.
    let p = 0, done = false;
    setPct(0);
    const grow = setInterval(() => { if (!done) { p = Math.min(0.9, p + 0.07); setPct(p); } }, 60);

    await refreshAll(rerender);
    done = true; clearInterval(grow);
    setPct(1);

    label.textContent = "다 맞췄습니다";
    bar.classList.remove("run");
    paintSync();
    buzz(8);
    setTimeout(() => {
      setH(0, true);
      bar.classList.remove("ready");
      setTimeout(() => {
        running = false;
        holdRender = false;
        if (pendingRender) { pendingRender = false; rerender(); }
        else paintSync();
      }, 340);
    }, 480);
  };
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", end);
}


// ════════════════════════════════════════════════════════════
//  사용법 — 손가락으로 어떻게 쓰는지 한 장씩 보여 줍니다
//  (처음 들어오면 오른쪽 위 «?» 단추가 잠깐 반짝입니다)
// ════════════════════════════════════════════════════════════
const TOUR_KEY = "kkumttang.attend.tour";
function tourSeen() {
  try { return localStorage.getItem(TOUR_KEY) === "1"; } catch { return true; }
}
function markTourSeen() {
  try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* 저장 못 해도 그만 */ }
}

/** 안내 창 안에서만 쓰는 «연습용» 손가락 인식기 — 실제 출석에는 아무 영향이 없습니다 */
function practiceTaps(box, { onDouble, onHold } = {}) {
  let hold = null, held = false, target = null, downXY = null;
  let lastId = null, lastAt = 0;

  box.addEventListener("pointerdown", (e) => {
    const el = e.target.closest("[data-p]"); if (!el) return;
    target = el; held = false; downXY = { x: e.clientX, y: e.clientY };
    el.classList.add("press");
    if (onHold) hold = setTimeout(() => {
      held = true; el.classList.remove("press"); buzz(12); onHold(el);
    }, 480);
  });
  const cancel = () => { clearTimeout(hold); hold = null; target?.classList.remove("press"); };
  box.addEventListener("pointermove", (e) => {
    if (!downXY || !target) return;
    if (Math.abs(e.clientX - downXY.x) > 10 || Math.abs(e.clientY - downXY.y) > 10) {
      cancel(); target = null; downXY = null;
    }
  });
  box.addEventListener("pointercancel", () => { cancel(); target = null; });
  box.addEventListener("pointerup", () => {
    const el = target; cancel(); target = null; downXY = null;
    if (!el || held || !onDouble) return;
    const id = el.dataset.p, now = Date.now();
    const second = lastId === id && now - lastAt < 400;
    lastId = id; lastAt = second ? 0 : now;
    if (!second) {
      el.classList.add("tap1");
      setTimeout(() => el.classList.remove("tap1"), 420);
      return;
    }
    onDouble(el);
  });
  box.addEventListener("dblclick", (e) => { if (e.target.closest("[data-p]")) e.preventDefault(); });
}

const pchip = (n, i) => `<span class="tt-chip" data-p="${i}">${n}</span>`;

const TOUR = () => [
  // ── ① 두 번 톡톡 ─────────────────────────────────────
  { title: isDesktop() ? "이름을 두 번 클릭해 보세요" : "이름을 두 번 톡톡 쳐 보세요",
    body: "그 아이가 <b>출석</b>으로 바뀝니다."
          + (isDesktop() ? "" : " 손끝이 살짝 울리고 꽃이 터져요."),
    task: "아래 이름 중 아무거나 두 번",
    hint: '[data-p="1"]',
    note: "한 번만 누르면 아무 일도 일어나지 않습니다 — 실수로 눌리는 걸 막으려고요.",
    art: `<div class="tt-play">
            <div class="tt-chips">${["서연", "하준", "예린"].map(pchip).join("")}</div>
          </div>`,
    wire(box, done) {
      practiceTaps(box, { onDouble: (el) => {
        const on = el.classList.toggle("on");
        if (on) { buzz(28); burstAt(el); el.classList.add("pop");
                  setTimeout(() => el.classList.remove("pop"), 460); done(); }
        else buzz(10);
      } });
    } },

  // ── ② 꾹 누르기 ──────────────────────────────────────
  { title: "이번엔 꾹 눌러 보세요",
    body: "이름을 <b>1초쯤 누르고 있으면</b> 그 아이 신상이 열립니다. 얼굴·학년·연락처를 바로 볼 수 있어요.",
    task: "«하준» 을 꾹",
    hint: '[data-p="h"]',
    note: "출석 표시는 바뀌지 않습니다. 보기만 하는 겁니다.",
    art: `<div class="tt-play">
            <div class="tt-chips"><span class="tt-chip" data-p="h">하준</span></div>
            <div class="tt-peek" hidden>
              <span class="tt-face">하</span>
              <div><b>김하준</b><small>중2 · ○○중 · 3셀</small></div>
            </div>
          </div>`,
    wire(box, done) {
      practiceTaps(box, { onHold: () => {
        const peek = box.querySelector(".tt-peek");
        if (peek.hidden) { peek.hidden = false; done(); }
      } });
    } },

  // ── ③ 셀 통째로 ──────────────────────────────────────
  { title: "셀은 통째로 한 번에",
    body: "셀 이름 오른쪽 <b>«모두 출석»</b> 을 누르면 그 셀이 전부 출석이 됩니다.<br>" +
          "안 온 아이만 두 번 눌러서 풀면 훨씬 빨라요.",
    task: "«모두 출석» 을 눌러 보세요",
    hint: "[data-pall]",
    art: `<div class="tt-play">
            <div class="tt-ch"><b>3셀</b><span class="tt-cnt">0/4</span>
              <button type="button" class="tt-all" data-pall>모두 출석</button></div>
            <div class="tt-chips sm">${["서연", "하준", "예린", "도윤"].map(pchip).join("")}</div>
          </div>`,
    wire(box, done) {
      box.querySelector("[data-pall]").addEventListener("click", (e) => {
        const chips = [...box.querySelectorAll(".tt-chip")];
        const on = !chips[0].classList.contains("on");
        chips.forEach((c, i) => setTimeout(() => {
          c.classList.toggle("on", on);
          if (on) { c.classList.add("pop"); setTimeout(() => c.classList.remove("pop"), 460); }
        }, i * 70));
        box.querySelector(".tt-cnt").textContent = (on ? chips.length : 0) + "/" + chips.length;
        e.currentTarget.textContent = on ? "모두 해제" : "모두 출석";
        if (on) { buzz(24); burstAt(e.currentTarget); done(); }
      });
    } },

  // ── ④ 결석자 심방 ────────────────────────────────────
  { title: "안 온 아이는 «심방» 에 적어 두기",
    body: "위에서 <b>«결석»</b> 을 누르면 안 온 아이만 모입니다.<br>" +
          "이름 옆 <b>«심방»</b> 을 누르면 결석 사유를 적어 둘 수 있어요.",
    task: "«심방» 을 눌러 칸을 열어 보세요",
    hint: "[data-pmemo]",
    note: "적어 둔 아이는 이름표에 주황색 점이 붙습니다.",
    art: `<div class="tt-play">
            <div class="tt-seg"><span>전체</span><span class="on">결석</span></div>
            <div class="tt-row"><i></i>박지훈
              <button type="button" class="tt-memo-b" data-pmemo>심방</button></div>
            <div class="tt-memo" hidden>
              <textarea rows="2" placeholder="결석 사유 · 통화 내용을 적어 두세요"></textarea>
            </div>
          </div>`,
    wire(box, done) {
      box.querySelector("[data-pmemo]").addEventListener("click", (e) => {
        const m = box.querySelector(".tt-memo");
        m.hidden = !m.hidden;
        e.currentTarget.textContent = m.hidden ? "심방" : "심방 ✎";
        if (!m.hidden) { m.querySelector("textarea").focus(); done(); }
      });
    } },

  // ── ⑤ 처음 온 아이 ───────────────────────────────────
  { title: "교적부에 없는 아이가 왔다면",
    body: "친구 따라왔거나 교회를 둘러보러 온 아이는 명단 <b>맨 아래</b> " +
          "«＋ 처음 온 아이» 로 적어 두세요. 이름만 적으면 바로 오늘 출석이 됩니다.",
    task: "«＋ 처음 온 아이» 를 눌러 보세요",
    hint: "[data-pguest]",
    note: "교적부에는 넣지 않습니다. " + ENROLL_AFTER + "번 넘게 나오면 개요 화면에서 «교적부에 등록할까요?» 하고 물어봐요.",
    art: `<div class="tt-play">
            <div class="tt-ch"><b>오늘 처음 온 아이</b></div>
            <div class="tt-guests"></div>
            <div class="tt-type" hidden><span class="tt-typed"></span><i class="tt-caret"></i></div>
            <button type="button" class="tt-add" data-pguest>＋ 처음 온 아이</button>
          </div>`,
    wire(box, done) {
      const NAMES = [{ n: "박하늘", s: "김서연 친구 · 중2" }, { n: "정예솔", s: "박하늘 친구 · 중2" }];
      let made = 0, busy2 = false;
      const list = box.querySelector(".tt-guests");
      const type = box.querySelector(".tt-type");
      const typed = box.querySelector(".tt-typed");
      const add = box.querySelector(".tt-add");

      const run = () => {
        if (busy2 || made >= NAMES.length) return;
        busy2 = true;
        const { n, s: sub } = NAMES[made];
        add.hidden = true; type.hidden = false; typed.textContent = "";
        let i = 0;
        const t = setInterval(() => {                    // 이름이 한 글자씩 쳐집니다
          typed.textContent = n.slice(0, ++i);
          buzz(6);
          if (i >= n.length) {
            clearInterval(t);
            setTimeout(() => {
              type.hidden = true;
              const chip = document.createElement("span");
              chip.className = "tt-chip tt-g on";
              chip.innerHTML = `${n}<small>${sub}</small>`;
              list.appendChild(chip);
              made += 1;
              buzz(24); burstAt(chip);
              //  손님이 둘일 수도 있으니 ＋ 는 이름표 옆에 작게 남습니다
              add.hidden = false;
              add.classList.add("small");
              add.textContent = "＋";
              add.setAttribute("aria-label", "처음 온 아이 더 넣기");
              if (made >= NAMES.length) add.hidden = true;
              busy2 = false;
              done();
            }, 420);
          }
        }, 110);
      };
      add.addEventListener("click", run);
    } },

  // ── ⑥ 새로고침 (보여 드리기만) ───────────────────────
  isDesktop()
    ? { title: "↻ 를 누르면 새로고침",
        body: "다른 선생님이 방금 누른 내용까지 받아 옵니다.<br>누르지 않아도 1분마다 저절로 맞춰집니다.",
        note: "출석당번이 두 분이어도 서로 누른 게 섞이지 않습니다. 각자 누른 아이만 저장돼요.",
        art: `<div class="tt-play mid"><span class="tt-ico">${ICO.redo}</span></div>` }
    : { title: "아래로 당기면 새로고침",
        body: "클로버가 다 자라면 손을 놓으세요.<br>다른 선생님이 누른 내용까지 바로 맞춰집니다.",
        note: "출석당번이 두 분이어도 서로 누른 게 섞이지 않습니다. 각자 누른 아이만 저장돼요.",
        art: `<div class="tt-play mid"><div class="tt-ring">
                <svg viewBox="0 0 52 52"><circle class="rg-bg" cx="26" cy="26" r="21"/>
                <circle class="tt-arc" cx="26" cy="26" r="21"/></svg><i>🍀</i></div></div>` },

  // ── ⑦ 지난 기록 · 행사 ───────────────────────────────
  { title: "지난 기록 · 수련회 · 행사",
    body: "<b>‹ ›</b> 로 주를 옮기고, 날짜를 누르면 <b>수련회·행사</b> 도 만들 수 있습니다.<br>" +
          "시계 단추를 누르면 지금까지 기록이 전부 나옵니다.",
    note: "지난 기록은 잠겨서 열립니다 — «수정» 을 눌러야 고쳐져요. (심방 칸 안에서도 바로 풀 수 있습니다.)",
    art: `<div class="tt-play mid">
            <div class="tt-date"><span>‹</span><b>9/20 (9월 3주차)</b><span>›</span></div>
            <span class="tt-ico">${ICO.log}</span>
          </div>` },
];

export function openTour() {
  if (document.querySelector(".tt")) return () => {};   // 이미 열려 있으면 또 열지 않습니다
  const steps = TOUR();
  let i = 0;
  const cleared = new Set();
  markTourSeen();
  document.getElementById("attHelp2")?.classList.remove("hint");

  const box = document.createElement("div");
  box.className = "tt";

  const draw = () => {
    const st = steps[i];
    const needs = !!st.wire;
    const okAlready = cleared.has(i);
    box.innerHTML = `
      <div class="tt-art">
        ${st.art}
        <span class="tt-count">${i + 1} / ${steps.length}</span>
        <button type="button" class="tt-x" id="ttX" aria-label="닫기">✕</button>
      </div>
      ${needs ? `<div class="tt-task${okAlready ? " ok" : ""}" id="ttTask">
          <span class="tt-tick">${okAlready ? "✓" : "👆"}</span>
          <span>${okAlready ? "잘하셨어요!" : st.task}</span>
        </div>` : ""}
      <div class="tt-txt">
        <h4>${st.title}</h4>
        <p>${st.body}</p>
        ${st.note ? `<small>${st.note}</small>` : ""}
      </div>`;

    box.querySelector("#ttX").addEventListener("click", () => close());
    const art = box.querySelector(".tt-art");
    //  «여기를 누르세요» — 눌러야 할 것을 동그랗게 반짝이게 합니다
    const point = st.hint && !okAlready ? art.querySelector(st.hint) : null;
    point?.classList.add("tt-point");
    st.wire?.(art, () => {
      point?.classList.remove("tt-point");
      if (cleared.has(i)) return;
      cleared.add(i);
      const t = box.querySelector("#ttTask");
      if (t) {
        t.classList.add("ok");
        t.querySelector(".tt-tick").textContent = "✓";
        t.lastElementChild.textContent = "잘하셨어요!";
      }
      box.querySelectorAll("[data-go]")[i]?.classList.add("done");
    });

    drawNav();
  };

  //  단추 줄은 창 «밖» 아래 가운데에 고정해 둡니다.
  //  창 크기가 장마다 달라져도 «다음» 자리는 늘 같은 곳에 있습니다.
  const nav = document.createElement("div");
  nav.className = "tt-nav";
  const drawNav = () => {
    nav.innerHTML = `
      <span class="tt-dots">${steps.map((_, n) =>
        `<i class="${n === i ? "on" : ""}${cleared.has(n) ? " done" : ""}" data-go="${n}"></i>`).join("")}</span>
      <div class="tt-btns">
        <button type="button" class="tt-skip" data-x
          ${i === steps.length - 1 ? 'hidden-slot="1" tabindex="-1"' : ""}>그만 볼래요</button>
        <button type="button" class="btn btn-sm" data-prev
          ${i > 0 ? "" : 'hidden-slot="1" tabindex="-1"'}>이전</button>
        <button type="button" class="btn btn-primary btn-sm" data-next>
          ${i === steps.length - 1 ? "다 알았어요" : "다음"}</button>
      </div>`;
    nav.querySelector("[data-next]").addEventListener("click", () => {
      if (i === steps.length - 1) close(); else { i += 1; draw(); }
    });
    nav.querySelector("[data-prev]")?.addEventListener("click", () => { i -= 1; draw(); });
    nav.querySelectorAll("[data-x]").forEach((x) => x.addEventListener("click", () => close()));
    nav.querySelectorAll("[data-go]").forEach((d) => d.addEventListener("click", () => {
      i = Number(d.dataset.go); draw();
    }));
  };

  let close = () => {};
  close = modal({
    bare: true, slim: true, body: box,
    onMount: (m, c) => { close = c; m.parentElement?.appendChild(nav); },
  });
  draw();
  return close;
}

// ════════════════════════════════════════════════════════════
//  처음 온 아이
//   교적부에는 넣지 않습니다. 출석부에만 적어 두고,
//   ENROLL_AFTER 주 넘게 나오면 개요 화면에서 등록을 권합니다.
// ════════════════════════════════════════════════════════════
export function guestForm(g, after) {
  const isNew = !g?.id;
  const v = { name: "", gender: "", grade: "", school: "", phone: "",
              guardian: "", invited_by: "", note: "", ...(g || {}) };
  //  전에 왔던 아이를 또 적지 않도록, 이름 칸 위에 먼저 보여 줍니다.
  const again = isNew ? recentGuests() : [];
  const form = document.createElement("form");
  form.id = "guestForm";
  form.innerHTML = `
    ${again.length ? `<div class="att-again">
      <div class="att-again-h">전에 왔던 아이 <small>누르면 새로 적지 않아도 바로 출석</small></div>
      <div class="att-chips">
        ${again.map((g) => `<button type="button" class="att-chip att-chip-g att-chip-past"
            data-again="${g.id}">${esc(g.name)}
            <i class="att-when-s">${esc(dateShort(state.guestLastOn[g.id] || g.first_on))}</i>
          </button>`).join("")}
      </div>
    </div>` : ""}
    <div class="field">
      <label>이름 <b style="color:var(--critical)">*</b></label>
      <input name="name" required value="${esc(v.name)}" placeholder="아이 이름" autocomplete="off">
    </div>
    <div class="grid grid-2" style="gap:10px">
      <div class="field"><label>성별</label>
        <select name="gender">
          <option value=""${!v.gender ? " selected" : ""}>모름</option>
          <option value="남"${v.gender === "남" ? " selected" : ""}>남</option>
          <option value="여"${v.gender === "여" ? " selected" : ""}>여</option>
        </select></div>
      <div class="field"><label>학년</label>
        <input name="grade" value="${esc(v.grade || "")}" placeholder="중1 · 고2 …" autocomplete="off"></div>
    </div>
    <div class="field"><label>누구 친구로 왔나요</label>
      <input name="invited_by" value="${esc(v.invited_by || "")}" placeholder="예: 김서연 친구" autocomplete="off"></div>
    <details class="att-more"${v.school || v.phone || v.guardian || v.note ? " open" : ""}>
      <summary>더 적어 두기 <small>학교 · 연락처 · 메모</small></summary>
      <div class="field"><label>학교</label>
        <input name="school" value="${esc(v.school || "")}" autocomplete="off"></div>
      <div class="grid grid-2" style="gap:10px">
        <div class="field"><label>본인 연락처</label>
          <input name="phone" type="tel" value="${esc(v.phone || "")}" autocomplete="off"></div>
        <div class="field"><label>보호자 연락처</label>
          <input name="guardian" type="tel" value="${esc(v.guardian || "")}" autocomplete="off"></div>
      </div>
      <div class="field"><label>메모</label>
        <textarea name="note" rows="2" placeholder="기억해 둘 것">${esc(v.note || "")}</textarea></div>
    </details>
    <div class="form-note" style="margin-bottom:0">
      교적부에는 넣지 않습니다. 출석부에만 적어 둬요.
      <b>${ENROLL_AFTER}주 넘게 나오면</b> 개요 화면에서 «교적부에 등록할까요?» 하고 물어봅니다.
    </div>`;

  modal({
    title: isNew ? "처음 온 아이" : "처음 온 아이 고치기",
    slim: true, body: form,
    footer: `${isNew ? "" : `<button class="btn btn-danger btn-sm" id="gDel">삭제</button>`}
             <button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="guestForm" type="submit">저장</button>`,
    onMount(box, close) {
      box.querySelectorAll("[data-again]").forEach((btn) => btn.addEventListener("click", async () => {
        const gg = state.attendGuests.find((x) => x.id === btn.dataset.again);
        if (!gg) return;
        try {
          await ensureEvent();
          const m = await api.markGuest(ev.id, gg.id, { present: true });
          marks.set(gg.id, m);
          buzz(24);
          close(); toast(`${gg.name} — 오늘 출석으로 넣었습니다.`); after?.();
        } catch (err) { toast(err.message, "err"); }
      }));
      box.querySelector("#gDel")?.addEventListener("click", async () => {
        if (!(await confirmDialog(`«${g.name}» 을(를) 출석부에서 지울까요?\n` +
                                  `지금까지의 출석 기록도 함께 사라집니다.`))) return;
        try {
          await api.deleteGuest(g.id);
          marks.delete(g.id);
          close(); toast("지웠습니다."); after?.();
        } catch (e) { toast(e.message, "err"); }
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const row = { ...(g?.id ? { id: g.id } : {}) };
        ["name", "gender", "grade", "school", "phone", "guardian", "invited_by", "note"]
          .forEach((k) => { row[k] = String(f.get(k) || "").trim() || null; });
        if (!row.name) { toast("이름을 적어 주세요.", "err"); return; }
        //  지난 주일을 뒤늦게 적을 수도 있어서, «처음 온 날» 은 오늘이 아니라 그 모임 날짜로 둡니다
        if (isNew) row.first_on = target.held_on;
        try {
          await ensureEvent();
          const saved = await api.saveGuest(row);
          if (isNew) {
            //  적자마자 «왔음» 으로 둡니다 — 오늘 온 아이라서 적는 것이니까요
            const m = await api.markGuest(ev.id, saved.id, { present: true });
            marks.set(saved.id, m);
            buzz(24);
          }
          close();
          toast(isNew ? `${saved.name} — 오늘 출석으로 넣었습니다.` : "고쳤습니다.");
          after?.();
        } catch (err) { toast(err.message, "err"); }
      });
    },
  });
}

/** 손님 이름을 꾹 누르면 — 적어 둔 것을 보여 주고, 바로 고칠 수 있게 */
function showGuest(g, after) {
  const n = state.guestCounts[g.id] || 0;
  const rows = [
    ["학년", g.grade], ["성별", g.gender], ["학교", g.school],
    ["누구 친구", g.invited_by],
    ["본인 연락처", g.phone], ["보호자", g.guardian],
    ["처음 온 날", g.first_on], ["지금까지", n ? `${n}번 나옴` : null],
    ["메모", g.note],
  ].filter(([, v]) => v);

  modal({
    title: g.name, slim: true,
    body: `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <span class="badge orange">처음 온 아이</span>
        ${n >= ENROLL_AFTER ? `<span class="badge blue">${n}주째 — 교적부 등록 권함</span>` : ""}
      </div>
      <div class="dtl-list">
        ${rows.map(([k, v]) => `<div class="dtl-row"><span class="k">${esc(k)}</span>
          <span class="v">${esc(String(v))}</span></div>`).join("")
          || `<div class="empty" style="padding:16px 0">적어 둔 것이 없습니다.</div>`}
      </div>
      <div class="form-note" style="margin-bottom:0">
        출석을 풀어도 이름은 목록에 그대로 남습니다.
        아주 지우시려면 아래 <b>«삭제»</b> 를 눌러 주세요.
      </div>`,
    footer: `<button class="btn btn-danger btn-sm" id="gDel2">삭제</button>
             <button class="btn" data-close>닫기</button>
             <button class="btn btn-primary" id="gEdit">고치기</button>`,
    onMount(box, close) {
      box.querySelector("#gEdit").addEventListener("click", () => { close(); guestForm(g, after); });
      box.querySelector("#gDel2").addEventListener("click", async () => {
        if (!(await confirmDialog(`«${g.name}» 을(를) 출석부에서 지울까요?\n` +
                                  `지금까지의 출석 기록도 함께 사라집니다.`))) return;
        try {
          await api.deleteGuest(g.id);
          marks.delete(g.id);
          close(); toast("지웠습니다."); after?.();
        } catch (e) { toast(e.message, "err"); }
      });
    },
  });
}

// ── 모임 고르기 · 지난 기록 ─────────────────────────────────
function pickEvent(rerender) {
  let kind = target.kind, date = target.held_on, title = target.title || "";
  const verId = ev?.version_id || "";
  modal({
    title: "모임 고르기",
    slim: true,
    body: `
      <div class="field">
        <label>날짜</label>
        <input type="date" id="pkDate" value="${esc(date)}">
      </div>
      <div class="field">
        <label>종류</label>
        <div class="att-seg att-seg-wide" id="pkKind">
          ${ATTEND_KINDS.map((k) => `<button data-v="${k}"${k === kind ? ' class="on"' : ""}>${k}</button>`).join("")}
        </div>
      </div>
      <div class="field" id="pkTitleWrap"${kind === "주일예배" ? " hidden" : ""}>
        <label>이름 <small style="color:var(--text-muted)">예: 여름수련회 2일차</small></label>
        <input id="pkTitle" value="${esc(title)}" placeholder="행사 이름">
      </div>
      <details class="att-more">
        <summary>셀편성 고르기 <small>보통은 그대로 두시면 됩니다</small></summary>
        <div class="field">
          <label>어느 편성으로 묶어 볼까요</label>
          <select id="pkVer">
            <option value="">그날 쓰던 편성 (자동)</option>
            ${state.versions.map((v) => `<option value="${v.id}"${v.id === verId ? " selected" : ""}
              >${esc(versionLabel(v) || "이름 없음")}</option>`).join("")}
          </select>
          <div class="hint">알파 행사처럼 <b>임시로 셀을 짜셨다면</b> 그 편성을 골라 두세요.
            출석 기록 자체는 아이마다 붙어 있어서, 편성을 바꿔도 사라지지 않습니다.</div>
        </div>
      </details>
      <div style="font-size:12.5px;color:var(--text-muted);line-height:1.6">
        같은 날에 예배와 행사를 따로 기록할 수 있습니다.
        수련회는 날짜별로 «1일차 · 2일차» 처럼 하나씩 만들면 됩니다.
      </div>`,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" id="pkGo">열기</button>`,
    onMount: (box, close) => {
      box.querySelector("#pkKind").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]"); if (!b) return;
        kind = b.dataset.v;
        box.querySelectorAll("#pkKind button").forEach((x) => x.classList.toggle("on", x === b));
        box.querySelector("#pkTitleWrap").hidden = kind === "주일예배";
      });
      box.querySelector("#pkGo").addEventListener("click", async () => {
        date = box.querySelector("#pkDate").value || date;
        title = kind === "주일예배" ? "" : box.querySelector("#pkTitle").value.trim();
        const pickedVer = box.querySelector("#pkVer").value || null;
        close();
        goto({ held_on: date, kind, title }, rerender);
        //  편성을 손수 고르셨으면 그 모임에 적어 둡니다
        if (pickedVer !== verId) {
          try {
            await ensureEvent();
            ev = await api.saveEvent({ id: ev.id, version_id: pickedVer || versionOn(date) });
            rerender();
          } catch (e) { toast(e.message, "err"); }
        }
      });
    },
  });
}

//  지난 기록은 한 번에 몇 개씩 볼지 — 고른 값을 기기에 기억해 둡니다
const LOG_SIZES = [15, 30, 50];
let logSize = Number(localStorage.getItem("kkumttang.attend.logSize")) || 15;
if (!LOG_SIZES.includes(logSize)) logSize = 15;

/** 지난 기록 — 15개씩 넘겨 보고, «오늘» 로 바로 갈 수 있습니다 */
function openLog(rerender) {
  const rows = [...state.attendEvents];
  const today = ymd();
  const thisSunday = sundayOf();
  let page = 0;

  const pages = () => Math.max(1, Math.ceil(rows.length / logSize));
  //  지금 보고 있는 모임이 몇 쪽에 있는지 (처음 열 때 그 쪽을 펴 주려고)
  const at = rows.findIndex((e) => e.held_on === target.held_on && e.kind === target.kind
                                   && (e.title || "") === (target.title || ""));
  if (at >= 0) page = Math.floor(at / logSize);

  const box = document.createElement("div");
  box.className = "logbox";

  /** 쪽 번호 — 앞뒤 두 개씩만 보이고 멀면 … 으로 접습니다 */
  const pageBtns = () => {
    const n = pages(); if (n <= 1) return "";
    const near = new Set([0, n - 1, page, page - 1, page + 1, page - 2, page + 2]);
    const list = [...near].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
    let out = "", prev = -1;
    list.forEach((i) => {
      if (prev >= 0 && i - prev > 1) out += `<span class="lg-gap">…</span>`;
      out += `<button type="button" class="lg-p${i === page ? " on" : ""}" data-p="${i}">${i + 1}</button>`;
      prev = i;
    });
    return out;
  };

  const draw = () => {
    const n = pages();
    page = Math.min(Math.max(0, page), n - 1);
    const slice = rows.slice(page * logSize, page * logSize + logSize);
    box.innerHTML = rows.length ? `
      <div class="lg-top">
        <button type="button" class="btn btn-sm" data-today>오늘로 가기</button>
        <span class="lg-cnt">${rows.length}개 중 ${page * logSize + 1}–${page * logSize + slice.length}</span>
        <label class="lg-size">한 번에
          <select data-size>${LOG_SIZES.map((v) =>
            `<option value="${v}"${v === logSize ? " selected" : ""}>${v}개</option>`).join("")}</select>
        </label>
      </div>
      <div class="att-log">
        ${slice.map((e) => `
          <button class="att-log-r${e.held_on === target.held_on && e.kind === target.kind
              && (e.title || "") === (target.title || "") ? " on" : ""}" data-e="${e.id}">
            <b>${esc(dateLabel(e.held_on))}</b>
            <span>${esc(eventName(e))}</span>
            ${e.held_on === today ? `<i class="lg-now">오늘</i>`
              : e.held_on === thisSunday ? `<i class="lg-now">이번 주</i>` : ""}
          </button>`).join("")}
      </div>
      ${n > 1 ? `<div class="lg-nav">
        <button type="button" class="lg-a" data-go="-1"${page === 0 ? " disabled" : ""} aria-label="앞 쪽">‹</button>
        ${pageBtns()}
        <button type="button" class="lg-a" data-go="1"${page === n - 1 ? " disabled" : ""} aria-label="뒤 쪽">›</button>
      </div>` : ""}
      <div class="lg-note">
        누르면 그날 출석부가 열립니다. 처음엔 잠겨 있고, «수정» 을 눌러야 고칠 수 있습니다.
      </div>`
      : `<div class="empty" style="padding:26px 0">아직 기록이 없습니다.</div>`;
    wire();
  };

  let closeIt = () => {};
  const wire = () => {
    box.querySelector("[data-today]")?.addEventListener("click", () => {
      closeIt();
      goto({ held_on: sundayOf(), kind: "주일예배", title: "" }, rerender);
    });
    box.querySelector("[data-size]")?.addEventListener("change", (e) => {
      const first = page * logSize;               // 보고 있던 자리를 잃지 않도록
      logSize = Number(e.target.value) || 15;
      localStorage.setItem("kkumttang.attend.logSize", String(logSize));
      page = Math.floor(first / logSize);
      draw();
    });
    box.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
      page = Number(b.dataset.p); draw(); box.scrollIntoView({ block: "nearest" });
    }));
    box.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
      page += Number(b.dataset.go); draw(); box.scrollIntoView({ block: "nearest" });
    }));
    box.querySelectorAll("[data-e]").forEach((b) => b.addEventListener("click", () => {
      const e = state.attendEvents.find((x) => x.id === b.dataset.e); if (!e) return;
      closeIt();
      goto({ held_on: e.held_on, kind: e.kind, title: e.title || "" }, rerender);
    }));
  };

  draw();
  modal({
    title: "지난 기록",
    slim: true,
    body: box,
    footer: `<button class="btn" data-close>닫기</button>`,
    onMount: (_b, close) => { closeIt = close; },
  });
}

// ── 오가기 · 불러오기 ───────────────────────────────────────
function syncEvent() {
  ev = state.attendEvents.find((e) =>
    e.held_on === target.held_on && e.kind === target.kind
    && (e.title || "") === (target.title || "")) || null;
}

function goto(next, rerender) {
  target = { ...next, title: next.title || "" };
  marks = new Map();
  syncEvent();
  // 오늘(이번 주) 것은 바로 쓸 수 있고, 지난 기록은 잠가 둡니다 — «수정» 을 눌러야 열립니다
  unlocked = isToday();
  if (!ev) syncedAt = Date.now();
  rerender();
  if (ev) load(rerender);
}

async function load(rerender, quiet = false) {
  if (!ev || busy) return;
  busy = true;
  try {
    const rows = await api.listMarks(ev.id);
    const next = new Map();
    //  한 줄은 «교적부 아이» 이거나 «처음 온 아이» 입니다 — 둘 다 챙겨야 목록에서 사라지지 않습니다
    rows.forEach((r) => next.set(r.student_id || r.guest_id, r));
    const changed = next.size !== marks.size
      || [...next].some(([k, v]) => marks.get(k)?.present !== v.present || marks.get(k)?.memo !== v.memo);
    marks = next;
    syncedAt = Date.now();
    if (!quiet || changed) draw(rerender); else paintSync();
  } catch (e) {
    if (!quiet) toast(e.message, "err");
  } finally { busy = false; }
}

async function refreshAll(rerender) {
  try {
    await api.reloadAttendance();
    syncEvent();
    if (ev) await load(rerender);
    else draw(rerender);
    syncedAt = Date.now();
  } catch (e) { toast(e.message, "err"); }
}

/** 화면 다시 그리기 — 단, 당기는 중에는 미뤄 둡니다 (판이 손에서 사라지지 않도록) */
function draw(rerender) {
  if (holdRender) { pendingRender = true; return; }
  rerender();
}

/** 첫 표시를 누르는 순간 그 모임을 서버에 만듭니다 (미리 만들어 두지 않습니다) */
async function ensureEvent() {
  if (ev) return ev;
  ev = await api.openEvent(target);
  return ev;
}

/** 누른 자리에서 살짝 떠올랐다 사라지는 쪽지 — 창을 띄우지 않고 한마디만 */
function floatHint(x, y, text) {
  let layer = document.getElementById("attFx");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "attFx"; layer.className = "att-fx";
    document.body.appendChild(layer);
  }
  layer.querySelectorAll(".att-hint").forEach((e) => e.remove());   // 겹쳐 쌓이지 않게
  const el = document.createElement("span");
  el.className = "att-hint";
  el.textContent = text;
  el.style.left = `${Math.min(Math.max(x, 90), window.innerWidth - 90)}px`;
  el.style.top = `${Math.max(y - 12, 56)}px`;
  layer.appendChild(el);
  buzz(8);
  setTimeout(() => el.remove(), 1500);
}

// ── 작은 즐거움 ─────────────────────────────────────────────
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* 지원 안 하면 조용히 */ } };

const PETALS = ["🌸", "🌼", "✨", "💛", "🌷", "🎉"];
function burstAt(el) {
  const r = el.getBoundingClientRect();
  let layer = document.getElementById("attFx");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "attFx"; layer.className = "att-fx";
    document.body.appendChild(layer);
  }
  const n = 7;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.textContent = PETALS[(Math.random() * PETALS.length) | 0];
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const d = 22 + Math.random() * 30;
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height / 2}px`;
    s.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    s.style.setProperty("--dy", `${Math.sin(a) * d - 16}px`);
    s.style.animationDelay = `${i * 12}ms`;
    layer.appendChild(s);
    setTimeout(() => s.remove(), 800 + i * 12);
  }
}
