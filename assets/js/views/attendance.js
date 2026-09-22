// ============================================================
//  출석부 — 주일예배 · 수련회 · 행사
//   · 기본은 «전부 안 옴». 이름을 두 번 톡톡 치면 출석으로 바뀝니다.
//   · 이름을 꾹 누르고 있으면 그 아이 신상이 뜹니다.
//   · 지난 기록도 폰에서 보고, «수정» 을 누르면 고칠 수 있습니다.
// ============================================================
import {
  state, api, isLoggedIn, isAdmin, isActive, photoOf, gradeOf,
  activeCells, cellMembers, cellRoleOf, roleRank, currentVersion,
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

/** 다른 화면으로 옮겨 갈 때 자동 새로고침을 멈춥니다 */
export function stopWatch() {
  if (timer) { clearInterval(timer); timer = null; }
  document.body.classList.remove("att-page");
}

const isToday = () => target.held_on === sundayOf() || target.held_on >= ymd();
const canEdit = () => unlocked;

// ── 명단 ────────────────────────────────────────────────────
/** 셀별로 묶은 아이들 (셀에 없는 아이는 맨 아래 «셀 미배정») */
function roster() {
  const used = new Set();
  const groups = activeCells().map((c) => {
    const kids = cellMembers(c.id).filter(isActive).sort((a, b) =>
      roleRank(cellRoleOf(a.id)) - roleRank(cellRoleOf(b.id)) || byName(a.name, b.name));
    kids.forEach((k) => used.add(k.id));
    return { id: c.id, name: c.name, leaders: c.leaders || [], kids };
  }).filter((g) => g.kids.length);
  const rest = state.students.filter((s) => isActive(s) && !used.has(s.id))
    .sort((a, b) => byName(a.name, b.name));
  if (rest.length) groups.push({ id: "_none", name: "셀 미배정", leaders: [], kids: rest });
  return groups;
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

  return `
  <div class="att" id="att">
    <div class="att-wip">
      <span class="att-wip-t">공사중</span>
      <span>아직 만들고 있는 화면입니다. 시험 삼아 눌러 보셔도 되지만,
            <b>정식으로 쓰기 전까지는 기록이 지워질 수 있어요.</b></span>
    </div>
    <div class="att-pull" id="attPull"><span class="att-quote"></span></div>

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
        ${desk || searchOpen || query ? `
        <label class="att-find">
          ${ICO.find}
          <input id="attQ" type="search" placeholder="이름 찾기" value="${esc(query)}" autocomplete="off">
        </label>` : `<button class="att-ico" id="attFind" title="이름 찾기" aria-label="이름 찾기">${ICO.find}</button>`}
        <div class="att-seg" id="attFilter">
          ${seg("all", "전체", filter)}${seg("in", `출석 ${c.inn}`, filter)}${seg("out", `결석 ${c.out}`, filter)}
        </div>
        <div class="att-seg att-seg-i" id="attView">
          ${seg("cell", "셀", viewMode)}${seg("list", "목록", viewMode)}${seg("photo", "사진", viewMode)}
        </div>
        <button class="att-ico" id="attLog" title="지난 기록" aria-label="지난 기록">${ICO.log}</button>
        ${desk ? `<button class="att-ico" id="attPrint" title="인쇄" aria-label="인쇄">${ICO.print}</button>
                  <button class="att-ico" id="attXlsx" title="엑셀 받기" aria-label="엑셀 받기">${ICO.down}</button>` : ""}
      </div>
    </div>

    ${canEdit() ? "" : `<div class="att-locked">지난 기록을 보는 중입니다 — 고치려면 위 «수정» 을 누르세요.</div>`}

    <div class="att-body${canEdit() ? "" : " ro"}" id="attBody">
      ${groups.length ? groups.map(groupHtml).join("")
        : `<div class="empty" style="padding:38px 0">${query ? "찾는 이름이 없습니다." : "해당하는 아이가 없습니다."}</div>`}
    </div>

    <div class="att-foot">
      ${esc(ver?.label || "")} 편성 기준 · 두 번 톡톡 치면 출석 · 꾹 누르면 신상
      ${ev?.updated_by_name || ev?.created_by_name
        ? ` · 마지막 기록 ${esc(ev.updated_by_name || ev.created_by_name)}` : ""}
    </div>
  </div>`;
}

// 작은 아이콘 — 기기마다 달라 보이는 그림문자 대신 직접 그립니다
const ICO = {
  find:  `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.4"/><path d="m16 16 4.4 4.4"/></svg>`,
  log:   `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 12a8.4 8.4 0 1 0 2.5-6"/><path d="M3 4.4V10h5.6"/><path d="M12 7.6V12l3.2 2"/></svg>`,
  print: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3.6h10V9"/><rect x="3.4" y="9" width="17.2" height="7.6" rx="2"/><path d="M7 14h10v6.4H7z"/></svg>`,
  down:  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6v11.2"/><path d="m7.6 10.6 4.4 4.4 4.4-4.4"/><path d="M4.4 19.6h15.2"/></svg>`,
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
      ${canEdit() && filter !== "out" ? `<button class="att-all" data-all="${g.id}" data-on="${inn < g.kids.length ? 1 : 0}"
        >${inn < g.kids.length ? "모두 출석" : "모두 해제"}</button>` : ""}
    </div>`;

  if (filter === "out") return `<section class="att-cell">${head}${g.kids.map(visitRow).join("")}</section>`;
  if (viewMode === "list") return `<section class="att-cell">${head}${g.kids.map(listRow).join("")}</section>`;
  if (viewMode === "photo")
    return `<section class="att-cell">${head}<div class="att-faces">${g.kids.map(faceCell).join("")}</div></section>`;
  return `<section class="att-cell">${head}<div class="att-chips">${g.kids.map(chip).join("")}</div></section>`;
}

const kidAttrs = (s) => `data-s="${s.id}" data-name="${esc(s.name)}"`;

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
  return `<div class="att-visit" data-v="${s.id}">
    <div class="att-row" ${kidAttrs(s)}>
      <span class="att-dot"></span>
      <span class="att-nm">${esc(s.name)}</span>
      <span class="att-sub">${esc(gradeOf(s) || "")}</span>
      <button class="att-memo-b" data-memo="${s.id}">${m ? "심방 ✎" : "심방"}</button>
    </div>
    ${m ? `<div class="att-memo-p" data-peek="${s.id}">${esc(m)}</div>` : ""}
    <div class="att-memo" hidden>
      <textarea rows="2" placeholder="결석 사유 · 통화 내용을 적어 두세요" ${canEdit() ? "" : "disabled"}>${esc(m)}</textarea>
      <div class="att-memo-f">
        ${marks.get(s.id)?.memo_by ? `<small>${esc(marks.get(s.id).memo_by)}</small>` : "<small></small>"}
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

  syncEvent();
  if (ev && !marks.size) load(rerender);

  // 날짜 옮기기
  root.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
    const step = Number(b.dataset.move) * (target.kind === "주일예배" ? 7 : 1);
    const d = parseYmd(target.held_on); d.setDate(d.getDate() + step);
    goto({ ...target, held_on: ymd(d) }, rerender);
  }));
  root.querySelector("#attPick")?.addEventListener("click", () => pickEvent(rerender));
  root.querySelector("#attEdit")?.addEventListener("click", () => { unlocked = true; rerender(); });
  root.querySelector("#attLog")?.addEventListener("click", () => openLog(rerender));

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
  root.querySelector("#attPrint")?.addEventListener("click", () => window.print());
  root.querySelector("#attXlsx")?.addEventListener("click", async () => {
    try {
      const { exportAttendance } = await import("../xlsx.js");
      await exportAttendance(ev || target, roster(), marks);
    } catch (e) { toast("엑셀을 만들지 못했습니다: " + e.message, "err"); }
  });

  // 출석당번이 두 분일 때를 위해 — 20초마다 조용히 서버 쪽을 다시 읽어 옵니다
  timer = setInterval(() => {
    if (location.hash !== "#/attend") return stopWatch();
    if (document.hidden || busy || !ev) return;
    load(rerender, true);
  }, 20000);
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
      const s = state.students.find((x) => x.id === el.dataset.s);
      showStudent(s, rerender);
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
    if (!canEdit()) { toast("지난 기록입니다. 위 «수정» 을 누르면 고칠 수 있습니다."); return; }
    await toggle(el, id, rerender);
  });

  // 컴퓨터에서 마우스로 쓸 때도 두 번 눌러 바꾸는 건 같습니다 (텍스트 선택만 막습니다)
  body.addEventListener("dblclick", (e) => { if (kid(e)) e.preventDefault(); });
}

async function toggle(el, id, rerender) {
  const next = !isIn(id);
  el.classList.toggle("on", next);                   // 눈에 먼저 반영 (기다리지 않게)
  if (next) { buzz(28); burstAt(el); } else buzz(10);
  try {
    await ensureEvent();
    const row = await api.mark(ev.id, id, { present: next, ...(next ? {} : {}) });
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
    if (!pane.hidden) pane.querySelector("textarea")?.focus();
  }));
  body.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const box = b.closest(".att-visit");
    box.querySelector(".att-memo").hidden = true;
    const peek = box.querySelector(".att-memo-p"); if (peek) peek.hidden = false;
  }));
  body.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const id = b.dataset.save;
    const box = b.closest(".att-visit");
    const memo = box.querySelector("textarea").value.trim();
    try {
      await ensureEvent();
      const row = await api.mark(ev.id, id, {
        present: isIn(id), memo: memo || null,
        memo_by: memo ? (state.profile?.name || null) : null,
        memo_at: memo ? new Date().toISOString() : null,
      });
      marks.set(id, { ...marks.get(id), ...row });
      toast(memo ? "심방 기록을 저장했습니다." : "심방 기록을 지웠습니다.");
      rerender();
    } catch (err) { toast(err.message, "err"); }
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
  let y0 = null, ready = false;
  const set = (h) => { bar.style.height = `${h}px`; };

  root.addEventListener("touchstart", (e) => {
    if (window.scrollY > 2 || e.touches.length !== 1) { y0 = null; return; }
    y0 = e.touches[0].clientY; ready = false;
    bar.querySelector(".att-quote").textContent = randomQuote();
  }, { passive: true });

  root.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0) { set(0); ready = false; return; }
    const h = Math.min(96, dy * 0.55);
    set(h);
    ready = h >= 62;
    bar.classList.toggle("ready", ready);
  }, { passive: true });

  const end = async () => {
    if (y0 == null) return;
    y0 = null;
    if (!ready) { set(0); bar.classList.remove("ready"); return; }
    bar.classList.add("run"); set(56);
    buzz(14);
    await refreshAll(rerender);
    setTimeout(() => {
      const b = document.getElementById("attPull");
      if (b) { b.style.height = "0px"; b.classList.remove("ready", "run"); }
    }, 850);
  };
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", end);
}

// ── 모임 고르기 · 지난 기록 ─────────────────────────────────
function pickEvent(rerender) {
  let kind = target.kind, date = target.held_on, title = target.title || "";
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
      box.querySelector("#pkGo").addEventListener("click", () => {
        date = box.querySelector("#pkDate").value || date;
        title = kind === "주일예배" ? "" : box.querySelector("#pkTitle").value.trim();
        close();
        goto({ held_on: date, kind, title }, rerender);
      });
    },
  });
}

function openLog(rerender) {
  const rows = [...state.attendEvents];
  modal({
    title: "지난 기록",
    slim: true,
    body: rows.length ? `
      <div class="att-log">
        ${rows.map((e) => `
          <button class="att-log-r" data-e="${e.id}">
            <b>${esc(dateLabel(e.held_on))}</b>
            <span>${esc(eventName(e))}</span>
            <small>${esc(e.updated_by_name || e.created_by_name || "")}</small>
          </button>`).join("")}
      </div>
      <div style="font-size:12.5px;color:var(--text-muted);margin-top:10px">
        누르면 그날 출석부가 열립니다. 처음엔 잠겨 있고, «수정» 을 눌러야 고칠 수 있습니다.
      </div>`
      : `<div class="empty" style="padding:26px 0">아직 기록이 없습니다.</div>`,
    footer: `<button class="btn" data-close>닫기</button>`,
    onMount: (box, close) => {
      box.querySelectorAll("[data-e]").forEach((b) => b.addEventListener("click", () => {
        const e = state.attendEvents.find((x) => x.id === b.dataset.e); if (!e) return;
        close();
        goto({ held_on: e.held_on, kind: e.kind, title: e.title || "" }, rerender);
      }));
    },
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
  rerender();
  if (ev) load(rerender);
}

async function load(rerender, quiet = false) {
  if (!ev || busy) return;
  busy = true;
  try {
    const rows = await api.listMarks(ev.id);
    const next = new Map();
    rows.forEach((r) => next.set(r.student_id, r));
    const changed = next.size !== marks.size
      || [...next].some(([k, v]) => marks.get(k)?.present !== v.present || marks.get(k)?.memo !== v.memo);
    marks = next;
    if (!quiet || changed) rerender();
  } catch (e) {
    if (!quiet) toast(e.message, "err");
  } finally { busy = false; }
}

async function refreshAll(rerender) {
  try {
    await api.reloadAttendance();
    syncEvent();
    if (ev) await load(rerender);
    else rerender();
  } catch (e) { toast(e.message, "err"); }
}

/** 첫 표시를 누르는 순간 그 모임을 서버에 만듭니다 (미리 만들어 두지 않습니다) */
async function ensureEvent() {
  if (ev) return ev;
  ev = await api.openEvent(target);
  return ev;
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
