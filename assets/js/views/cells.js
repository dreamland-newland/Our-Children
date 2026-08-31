// ── 셀편성 (버전 관리 + 편집 모드) ──────────────────────────
//  · 조회 모드: 버전을 골라 그대로 열람
//  · 편집 모드: 고친 내용은 화면에만 있다가 "저장"을 눌러야 버전으로 확정
// ============================================================
import {
  state, api, isLoggedIn, isAdmin, versionCells, currentVersion,
  versionLabel, cellMembers, cellIdOf, photoOf, uid, gradeOf, gradeWithYear, statusOf, isActive, isGraduated,
  cellRoleOf, roleRank,
} from "../data.js";
import { esc, modal, toast, confirmDialog, avatar, showSkyBadge } from "../ui.js";
import { DEFAULT_TERM_LABEL } from "../config.js";
import { showStudent } from "./students.js";
import { bindDownload as bindXlsx } from "../xlsx.js";

// 편집 중인 초안 (저장 전까지 서버/저장소에 반영되지 않습니다)
let draft = null;
// { base, label, note, cells:[{key,name,leaders,kind,sort_order}], assign:{studentId: key|null} }

// ── 되돌리기 / 다시하기 (각 30단계) ────────────────────────
const HISTORY_MAX = 30;
let past = [];     // 이전 상태 스냅샷
let future = [];   // 되돌린 뒤의 상태 스냅샷
const snapshot = () => JSON.stringify({ cells: draft.cells, assign: draft.assign, roles: draft.roles,
                                        label: draft.label, note: draft.note });
const restore = (snap) => {
  const o = JSON.parse(snap);
  draft.cells = o.cells; draft.assign = o.assign; draft.roles = o.roles || {};
  draft.label = o.label; draft.note = o.note;
};

/** 초안을 바꾸기 "직전"에 호출 — 현재 상태를 되돌리기 스택에 쌓습니다. */
function pushHistory() {
  if (!draft) return;
  past.push(snapshot());
  if (past.length > HISTORY_MAX) past.shift();
  future = [];                       // 새 작업을 하면 다시하기는 사라집니다
}
export function undo(after) {
  if (!draft || !past.length) return;
  future.push(snapshot());
  if (future.length > HISTORY_MAX) future.shift();
  restore(past.pop());
  keepDraft();
  after?.();
}
export function redo(after) {
  if (!draft || !future.length) return;
  past.push(snapshot());
  if (past.length > HISTORY_MAX) past.shift();
  restore(future.pop());
  keepDraft();
  after?.();
}
export const canUndo = () => !!draft && past.length > 0;
export const canRedo = () => !!draft && future.length > 0;

// ── 짜던 편성 보관 (이 브라우저에만) ────────────────────────
//   저장을 누르기 전까지는 서버에 올라가지 않지만, 창을 닫았다 열어도
//   «이어서 하기» 를 할 수 있도록 브라우저에 잠깐 넣어 둡니다.
const DRAFT_KEY = "kkumttang.celldraft.v1";
function keepDraft() {
  if (!draft) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch { /* 저장 공간이 꽉 차도 편집은 계속됩니다 */ }
}
function storedDraft() {
  try {
    const o = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return o && Array.isArray(o.cells) ? o : null;
  } catch { return null; }
}
function forgetDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }
export const hasKeptDraft = () => !draft && !!storedDraft();

// ── 임시저장 (이름 붙여 여러 개 보관) ──────────────────────
//   «저장하기» 는 모두가 보는 버전으로 확정하는 것이고,
//   «임시저장» 은 내 브라우저에만 안(案) 을 쌓아 두는 것입니다.
const SLOTS_KEY = "kkumttang.cellslots.v1";
const SLOTS_MAX = 20;
function readSlots() {
  try {
    const a = JSON.parse(localStorage.getItem(SLOTS_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function writeSlots(list) {
  try { localStorage.setItem(SLOTS_KEY, JSON.stringify(list.slice(0, SLOTS_MAX))); }
  catch { toast("브라우저 저장 공간이 부족합니다. 오래된 임시저장을 지워 주세요.", "err"); }
}
export const slotCount = () => readSlots().length;

/** 지금 편집 중인 것을 이름을 붙여 임시저장 */
function saveSlot() {
  if (!draft) return null;
  const list = readSlots();
  const d = new Date();
  const n = list.length + 1;
  const item = {
    id: uid(),
    name: `모의 ${n}차 (${d.getMonth() + 1}/${d.getDate()})`,
    savedAt: d.toISOString(),
    base: draft.base, label: draft.label, note: draft.note,
    cells: draft.cells, assign: draft.assign, roles: draft.roles || {}, orig: draft.orig || {},
  };
  writeSlots([item, ...list]);
  return item;
}
function loadSlot(id) {
  const it = readSlots().find((x) => x.id === id);
  if (!it) return false;
  draft = { base: it.base ?? null, label: it.label || DEFAULT_TERM_LABEL, note: it.note || "",
            cells: it.cells, assign: it.assign || {}, roles: it.roles || {}, orig: it.orig || {} };
  past = []; future = [];
  keepDraft();
  return true;
}
const renameSlot = (id, name) => {
  const list = readSlots();
  const it = list.find((x) => x.id === id);
  if (it) { it.name = name; writeSlots(list); }
};
const deleteSlot = (id) => writeSlots(readSlots().filter((x) => x.id !== id));

/** 임시저장 목록 카드 (조회 화면·편집 화면 공용) */
function slotsCard() {
  const list = readSlots();
  if (!list.length) return "";
  return `
  <div class="card" style="margin-bottom:16px">
    <div class="card-head">
      <h3>임시저장한 모의편성 <span class="badge">${list.length}</span></h3>
      <span class="sub">내 브라우저에만 있습니다 · 다른 선생님에게는 보이지 않습니다</span>
    </div>
    <div class="slot-list">
      ${list.map((it) => `
      <div class="slot-row">
        <div style="min-width:0;flex:1">
          <b>${esc(it.name)}</b>
          <div class="slot-sub">${esc(fmtDateTime(it.savedAt))}
            · 셀 ${it.cells.length}개
            · 배정 ${Object.values(it.assign || {}).filter(Boolean).length}명</div>
        </div>
        <button class="btn btn-sm btn-primary" data-slot-load="${it.id}">불러오기</button>
        <button class="btn btn-sm" data-slot-rename="${it.id}">이름 바꾸기</button>
        <button class="btn btn-sm btn-danger" data-slot-del="${it.id}">삭제</button>
      </div>`).join("")}
    </div>
  </div>`;
}


/** 임시저장 목록의 버튼들 — 화면 아래 카드와 «불러오기» 창에서 함께 씁니다 */
function bindSlots(scope, rerender, done) {
  scope.querySelectorAll("[data-slot-load]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.slotLoad;
    const it = readSlots().find((x) => x.id === id);
    if (draft && !(await confirmDialog(
      `지금 짜던 것을 두고 «${it?.name || ""}» 을 불러올까요? 저장하지 않은 지금 내용은 사라집니다.`,
      { okText: "불러오기", danger: false }))) return;
    if (loadSlot(id)) { done?.(); rerender(); toast(`«${it.name}» 을 불러왔습니다.`); }
  }));
  scope.querySelectorAll("[data-slot-rename]").forEach((b) => b.addEventListener("click", () => {
    const it = readSlots().find((x) => x.id === b.dataset.slotRename);
    if (!it) return;
    const form = document.createElement("form");
    form.id = "slotForm";
    form.innerHTML = `
      <div class="field"><label>임시저장 이름</label>
        <input type="text" name="name" required maxlength="40" value="${esc(it.name)}"
               placeholder="예: 형제 나눠본 안">
        <span class="hint">내 브라우저에만 있는 이름입니다.</span></div>`;
    modal({
      title: "이름 바꾸기", narrow: true, body: form,
      footer: `<button class="btn" data-close>취소</button>
               <button class="btn btn-primary" form="slotForm" type="submit">저장</button>`,
      onMount(box, close) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const nm = new FormData(form).get("name").trim();
          if (!nm) return;
          renameSlot(it.id, nm);
          close(); done?.(); rerender(); toast("이름을 바꿨습니다.");
        });
      },
    });
  }));
  scope.querySelectorAll("[data-slot-del]").forEach((b) => b.addEventListener("click", async () => {
    const it = readSlots().find((x) => x.id === b.dataset.slotDel);
    if (!(await confirmDialog(`«${it?.name || ""}» 을 지울까요?`, { okText: "삭제" }))) return;
    deleteSlot(b.dataset.slotDel); done?.(); rerender(); toast("지웠습니다.");
  }));
}

/** 임시저장 목록 창 — 모의편성 중에도 바로 열어 볼 수 있습니다 */
function slotsModal(rerender) {
  const box = document.createElement("div");
  let close = null;
  const draw = () => {
    const list = readSlots();
    box.innerHTML = list.length ? `
      <div class="form-note" style="margin:0 0 12px">
        임시저장은 <b>내 브라우저에만</b> 있습니다. 다른 선생님에게는 보이지 않고,
        <b>«저장하기»</b> 를 눌러야 모두가 보는 편성이 됩니다.
      </div>
      <div class="slot-list" style="border:1px solid var(--border);border-radius:10px">
        ${list.map((it) => `
        <div class="slot-row">
          <div style="min-width:0;flex:1">
            <b>${esc(it.name)}</b>
            <div class="slot-sub">${esc(fmtDateTime(it.savedAt))}
              · 셀 ${it.cells.length}개
              · 배정 ${Object.values(it.assign || {}).filter(Boolean).length}명</div>
          </div>
          <button class="btn btn-sm btn-primary" data-slot-load="${it.id}">불러오기</button>
          <button class="btn btn-sm" data-slot-rename="${it.id}">이름 바꾸기</button>
          <button class="btn btn-sm btn-danger" data-slot-del="${it.id}">삭제</button>
        </div>`).join("")}
      </div>`
    : `<div class="empty" style="padding:26px 0">아직 임시저장한 안(案)이 없습니다.<br>
         <span style="font-size:12.5px;color:var(--text-muted)">
           모의편성 중에 «💾 임시저장» 을 누르면 여기에 쌓입니다.</span></div>`;
    // 불러오면 창을 닫고, 이름 바꾸기·삭제는 목록만 다시 그립니다
    bindSlots(box, rerender, () => { if (box.querySelector("[data-slot-load]")) draw(); });
    box.querySelectorAll("[data-slot-load]").forEach((b) =>
      b.addEventListener("click", () => setTimeout(() => close?.(), 0)));
  };
  draw();

  modal({
    title: "임시저장한 모의편성",
    body: box,
    footer: `<button class="btn" data-close>닫기</button>`,
    onMount(b, done) { close = done; },
  });
}

/** 보관해 둔 편성을 다시 불러옵니다. */
function resumeDraft() {
  const o = storedDraft();
  if (!o) return false;
  draft = { base: o.base ?? null, label: o.label || DEFAULT_TERM_LABEL, note: o.note || "",
            cells: o.cells, assign: o.assign || {}, roles: o.roles || {}, orig: o.orig || {} };
  past = []; future = [];
  return true;
}

const ORDER = ["예비중1", "중1", "중2", "중3", "고1", "고2", "고3"];
const gradeRank = (g) => { const i = ORDER.indexOf(g); return i < 0 ? 99 : i; };
/** 최신 편성에서는 졸업생을 감추고, 지난 편성에서는 기록 그대로 보여줍니다. */
const visibleMembers = (cellId, isLatest) =>
  cellMembers(cellId).filter((s) => (isLatest ? !isGraduated(s) : true));
// ── 편성할 때 도움이 되는 정보들 ──────────────────────────
/** 만 나이 (생년월일을 모르고 연도만 있으면 그 해 기준 어림값) */
function ageOf(st) {
  const n = new Date();
  if (st?.birth) {
    const b = new Date(st.birth);
    let a = n.getFullYear() - b.getFullYear();
    const m = n.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a -= 1;
    return a >= 0 && a < 100 ? `${a}세` : "";
  }
  if (st?.birth_year) return `약 ${n.getFullYear() - Number(st.birth_year)}세`;
  return "";
}
const shortSchool = (v) => String(v || "").replace(/(중학교|고등학교|중|고)$/, "").trim();
const nk = (v) => String(v || "").replace(/\s/g, "");

/** 형제자매 찾기 — «형제관계» 칸의 이름, 또는 집주소가 같은 아이 */
let sibCache = null;
function siblingsOf(id) {
  if (!sibCache) {
    sibCache = new Map();
    const byName = new Map(state.students.map((x) => [nk(x.name), x]));
    const link = (a, b) => {
      if (a === b) return;
      if (!sibCache.has(a)) sibCache.set(a, new Set());
      sibCache.get(a).add(b);
    };
    for (const st of state.students) {
      for (const raw of String(st.siblings || "").split(/[,·/]/)) {
        const t = byName.get(nk(raw).replace(/\(.*?\)/g, ""));
        if (t) { link(st.id, t.id); link(t.id, st.id); }
      }
      const ad = nk(st.address);
      if (ad.length >= 10) {
        for (const o of state.students)
          if (o.id !== st.id && nk(o.address) === ad) { link(st.id, o.id); link(o.id, st.id); }
      }
    }
  }
  return [...(sibCache.get(id) || [])].map((x) => state.students.find((y) => y.id === x)).filter(Boolean);
}
const clearSibCache = () => { sibCache = null; };

/** 로그인한 교사진 본인이 담당하는 셀인가 */
function isMyCell(c) {
  const me = state.profile;
  if (!me) return false;
  const t = state.teachers.find((x) => x.id === me.teacher_id);
  const names = [t?.name, me.name].filter(Boolean).map(nk);
  if (!names.length) return false;
  const hay = [...(c.leaders || []), c.name].map(nk).join(" ");
  return names.some((n) => n && hay.includes(n));
}
/** 보여주는 순서 — 내 셀이 맨 앞, 장기결석·기타는 늘 맨 뒤.
 *  (표시 순서만 바꿉니다. 저장되는 순서는 건드리지 않습니다.) */
const dispRank = (c) => (isMyCell(c) ? 0 : c.kind === "셀" ? 1 : 2);
const myFirst = (list) => [...list].sort(
  (a, b) => dispRank(a) - dispRank(b) || (a.sort_order || 0) - (b.sort_order || 0));

/** 셀 카드 머리말에 붙는 «남 3 · 여 4 | 중1 2 · 중2 3» 요약 */
function cellStats(members) {
  const m = members.filter((x) => x.gender === "남").length;
  const f = members.filter((x) => x.gender === "여").length;
  const g = {};
  for (const x of members) { const k = gradeOf(x) || "?"; g[k] = (g[k] || 0) + 1; }
  const gs = ORDER.filter((k) => g[k]).map((k) => `${k} ${g[k]}`).join(" · ");
  const sex = [m ? `남 ${m}` : "", f ? `여 ${f}` : ""].filter(Boolean).join(" · ");
  return [sex, gs].filter(Boolean).join("  |  ");
}

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};
const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ── 초안 만들기 / 읽기 ────────────────────────────────────
function startDraft() {
  const v = currentVersion();
  draft = {
    base: v?.id || null,
    label: v ? v.label : DEFAULT_TERM_LABEL,
    note: "",
    cells: (v ? versionCells(v.id) : []).map((c) => ({
      key: c.id, name: c.name, leaders: [...(c.leaders || [])],
      kind: c.kind, sort_order: c.sort_order,
    })),
    assign: {},
    roles: {},
  };
  if (v) for (const m of state.members.filter((x) => x.version_id === v.id)) {
    draft.assign[m.student_id] = m.cell_id;
    if (m.role) draft.roles[m.student_id] = m.role;
  }
  draft.orig = { ...draft.assign };      // 지난 버전과 비교해 «옮겨진 아이» 를 표시하려고
  past = []; future = [];
  keepDraft();
}
export const isEditing = () => !!draft;
const dCells = () => [...draft.cells].sort((a, b) => a.sort_order - b.sort_order);
const dMembers = (key) => state.students.filter((s) => draft.assign[s.id] === key && !isGraduated(s));
const dCellOf = (sid) => draft.assign[sid] || null;

// ════════════════════════════════════════════════════════════
//  화면
// ════════════════════════════════════════════════════════════
export function html() {
  clearSibCache();
  if (draft) { keepDraft(); return editHtml(); }

  const kept = isLoggedIn() ? storedDraft() : null;
  const resumeBox = kept ? `
  <div class="card card-pad" style="margin-bottom:16px;border-color:var(--warning);
       display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <span class="badge orange">짜던 편성 있음</span>
    <span style="font-size:13.5px">
      <b>${esc(kept.label || "이름 없음")}</b> 편성을 만들다 멈추셨습니다
      ${kept.savedAt ? ` · ${esc(fmtDateTime(kept.savedAt))}` : ""}
      <div style="color:var(--text-muted);font-size:12.5px;margin-top:2px">
        아직 저장 전이라 다른 선생님에게는 보이지 않습니다.</div>
    </span>
    <span style="margin-left:auto;display:flex;gap:6px">
      <button class="btn btn-primary btn-sm" id="resumeDraft">이어서 하기</button>
      <button class="btn btn-sm btn-danger" id="dropDraft">버리기</button>
    </span>
  </div>` : "";

  const slots = isLoggedIn() ? slotsCard() : "";
  const v = currentVersion();
  if (!v) {
    return `${resumeBox}${slots}
    <div class="page-head"><div><h1>셀편성</h1><p>아직 등록된 셀편성이 없습니다.</p></div></div>
    <div class="card card-pad"><div class="empty">
      ${isLoggedIn()
        ? `첫 셀편성을 만들어 주세요.<div style="margin-top:14px">
             <button class="btn btn-primary" id="editBtn">✏️ 셀편성 만들기</button></div>`
        : "로그인한 교사진이 셀편성을 등록할 수 있습니다."}
    </div></div>`;
  }

  const cells = versionCells(v.id);
  const assigned = state.members.filter((m) => m.version_id === v.id)
    .filter((m) => { const s = state.students.find((x) => x.id === m.student_id);
                     return s && (state.versions[0]?.id !== v.id || !isGraduated(s)); }).length;
  const isLatest = state.versions[0]?.id === v.id;
  const unassigned = state.students.filter((s) => isActive(s) && !cellIdOf(s.id, v.id));
  const edited = v.updated_at && v.updated_at !== v.created_at;

  return `${resumeBox}${slots}
  <div class="page-head">
    <div>
      <h1>셀편성</h1>
      <p>${cells.filter((c) => c.kind === "셀").length}개 셀 · ${assigned}명 배정
         ${unassigned.length ? ` · 미배정 ${unassigned.length}명` : ""}</p>
    </div>
    <div class="page-actions">
      <select id="verSel" style="width:auto;max-width:300px">
        ${state.versions.map((x) => `<option value="${x.id}"${x.id === v.id ? " selected" : ""}>
          ${esc(versionLabel(x))}</option>`).join("")}
      </select>
      <button class="btn btn-sm" id="xlsxVer">📥 엑셀 받기</button>
      ${isLoggedIn() ? `<button class="btn btn-primary btn-sm" id="editBtn">✏️ 편집 (모의편성)</button>` : ""}
      ${isAdmin() ? `<button class="btn btn-sm btn-danger" id="delVer">버전 삭제</button>` : ""}
    </div>
  </div>

  <div class="card card-pad" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <span class="badge blue">${esc(v.label)}</span>
    <span style="font-size:13px;color:var(--text-secondary)">
      등록 <b>${esc(fmtDateTime(v.created_at))}</b>
      ${v.created_by_name ? ` · ${esc(v.created_by_name)}` : ""}
      ${edited ? ` &nbsp;|&nbsp; 최종 저장 <b>${esc(fmtDateTime(v.updated_at))}</b>${
        v.updated_by_name ? ` · ${esc(v.updated_by_name)}` : ""}` : ""}
      ${v.note ? ` &nbsp;|&nbsp; ${esc(v.note)}` : ""}
    </span>
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
      ${isLoggedIn() ? `<button class="btn btn-ghost btn-sm" id="renameVer"
          title="이 편성의 이름과 메모를 고칩니다">✏️ 이름 바꾸기</button>` : ""}
      ${isLoggedIn() && state.versions[0]?.id !== v.id
        ? `<button class="btn btn-sm" id="restoreVer"
             title="이 편성을 그대로 다시 최신 편성으로 만듭니다">↩ 이 편성으로 되돌리기</button>` : ""}
      ${state.versions[0]?.id === v.id
        ? `<span class="badge good">최신 버전</span>`
        : `<span class="badge warn">지난 버전</span>`}
    </span>
  </div>

  <div class="grid grid-auto">
    ${myFirst(cells).map((c) => cellCard({ ...c, key: c.id }, visibleMembers(c.id, isLatest), false)).join("")}
    ${unassigned.length
      ? cellCard({ key: "__none", name: "미배정", kind: "기타", leaders: [] }, unassigned, false)
      : ""}
  </div>`;
}

function editHtml() {
  const cells = dCells();
  const assignedIds = new Set(Object.entries(draft.assign).filter(([, k]) => k).map(([s]) => s));
  const unassigned = state.students.filter((s) => isActive(s) && !assignedIds.has(s.id));
  const total = [...assignedIds].length;

  return `
  <div class="banner setup" style="border-radius:12px;margin-bottom:16px;text-align:left;
       display:flex;gap:12px;align-items:center;flex-wrap:wrap;border:1px solid var(--border)">
    <b>✏️ 모의편성 중</b>
    <span>끌어서 옮겨 보세요. <b>«저장하기»를 눌러야</b> 모두에게 보이는 버전이 됩니다.
      여러 안을 비교하려면 <b>«임시저장»</b> · 되돌리기 ${HISTORY_MAX}단계.</span>
    <span style="margin-left:auto;display:flex;gap:8px;align-items:center">
      <span style="display:flex;gap:4px">
        <button class="btn btn-sm" id="undoBtn" ${past.length ? "" : "disabled"}
          title="되돌리기 (Ctrl+Z)">↶ 되돌리기${past.length ? ` <b>${past.length}</b>` : ""}</button>
        <button class="btn btn-sm" id="redoBtn" ${future.length ? "" : "disabled"}
          title="다시하기 (Ctrl+Shift+Z)">↷ 다시하기${future.length ? ` <b>${future.length}</b>` : ""}</button>
      </span>
      <button class="btn btn-sm" id="slotSave" title="내 브라우저에만 안(案)으로 보관합니다">💾 임시저장</button>
      <button class="btn btn-sm" id="slotList" title="임시저장해 둔 안(案)을 열어 봅니다"
        ${readSlots().length ? "" : "disabled"}>📂 임시저장 목록${
        readSlots().length ? ` <b>${readSlots().length}</b>` : ""}</button>
      <button class="btn btn-sm" id="cancelEdit">취소</button>
      <button class="btn btn-primary btn-sm" id="saveEdit" title="모두가 보는 버전으로 확정합니다">저장하기</button>
    </span>
  </div>

  <div class="page-head">
    <div>
      <h1>셀편성 편집</h1>
      <p>${cells.filter((c) => c.kind === "셀").length}개 셀 · ${total}명 배정
         ${unassigned.length ? ` · 미배정 ${unassigned.length}명` : ""}
         ${draft.base ? ` · ${esc(currentVersion()?.label || "")} 에서 시작` : " · 새로 만드는 중"}</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-sm" id="addCell">＋ 셀 추가</button>
    </div>
  </div>

  <div class="card unassigned-tray droppable" data-cell="__none">
    <div class="tray-head">
      <b>미배정</b>
      <span class="badge ${unassigned.length ? "warn" : "good"}">${unassigned.length}명</span>
      <span class="tray-hint">여기로 끌어다 놓으면 셀에서 빠집니다 · 여기서 셀로 끌어다 넣으세요</span>
    </div>
    <div class="tray-body">
      ${unassigned.length ? unassigned
        .sort((a, b) => gradeRank(gradeOf(a)) - gradeRank(gradeOf(b)) || a.name.localeCompare(b.name, "ko"))
        .map((s) => `
        <span class="chip" data-student="${s.id}" draggable="true"
              data-school="${esc(nk(s.school))}" data-sibs="${esc(siblingsOf(s.id).map((x) => x.id).join(" "))}"
              title="끌어서 셀에 넣으세요">
          ${avatar(s.name, photoOf(s.id), 20)}
          <b>${esc(s.name)}</b>
          <i>${esc(gradeOf(s) || "")}</i>
        </span>`).join("")
        : `<span class="tray-empty">전원 배정 완료 ✔</span>`}
    </div>
  </div>

  <div class="grid grid-auto" id="cellGrid">
    ${myFirst(cells).map((c) => cellCard(c, dMembers(c.key), true)).join("")}
    <button type="button" class="card add-cell-card" id="addCellBottom">
      <span class="plus">＋</span>
      <b>셀 추가</b>
      <span class="sub">담당 선생님 이름으로 새 셀을 만듭니다</span>
    </button>
  </div>

`;
}

/** 셀 이름에 이미 들어 있는 담당자는 아래에 또 적지 않습니다
 *  («홍길동 선생님» 셀이면 «홍길동» 을 되풀이하지 않습니다) */
const extraLeaders = (c) =>
  (c.leaders || []).filter((n) => n && !nk(c.name).includes(nk(n)));

/** 셀 이름 아래 잔글씨 — 이름에 없는 담당자 · 셀리더 · 셀헬퍼 */
function cellSub(c, members, editing) {
  const who = (seat) => members.filter((s) => seatOf(s.id, editing) === seat).map((s) => s.name);
  const lead = who("셀리더"), help = who("셀헬퍼");
  return [
    extraLeaders(c).join(" · "),
    lead.length ? `리더 ${lead.join("·")}` : "",
    help.length ? `헬퍼 ${help.join("·")}` : "",
  ].filter(Boolean).join(" · ");
}

/** 셀 안에서 맡은 자리 — 편집 중이면 초안에서, 아니면 저장된 편성에서 */
const seatOf = (sid, editing) =>
  (editing ? (draft?.roles?.[sid] || null) : cellRoleOf(sid));
/** «셀리더» → «리더» 처럼 짧게 */
const seatBadge = (seat) => (seat
  ? `<span class="badge ${seat === "셀리더" ? "good" : "blue"}"
       title="${esc(seat)}">${esc(seat.replace("셀", ""))}</span>` : "");

function cellCard(c, members, editing) {
  const special = c.kind !== "셀";
  members = [...members].sort(
    (a, b) => roleRank(seatOf(a.id, editing)) - roleRank(seatOf(b.id, editing))
      || gradeRank(gradeOf(a)) - gradeRank(gradeOf(b))
      || a.name.localeCompare(b.name, "ko"));
  const stats = editing && members.length ? cellStats(members) : "";
  return `
  <section class="card cell-card${editing ? " droppable" : ""}${isMyCell(c) ? " mine" : ""}"
           data-cell="${esc(c.key)}">
    <div class="cell-top">
      <div style="min-width:0">
        <h4>${esc(c.name)}</h4>
        ${cellSub(c, members, editing)
          ? `<div style="font-size:12px;color:var(--text-muted)">${esc(cellSub(c, members, editing))}</div>` : ""}
        ${stats ? `<div class="cell-stats">${esc(stats)}</div>` : ""}
      </div>
      <span style="display:flex;gap:5px;align-items:center;flex:0 0 auto">
        ${isMyCell(c) ? '<span class="badge good" title="로그인한 내가 담당하는 셀입니다">내 셀</span>' : ""}
        <span class="badge ${special ? "warn" : "blue"}">${members.length}명</span>
      </span>
    </div>
    ${members.length ? `<ul>${members.map((s) => studentRow(s, editing)).join("")}</ul>`
      : `<div class="empty" style="padding:24px 0;font-size:13px">
           ${editing ? (c.key === "__none" ? "전원 배정 완료" : "여기로 끌어다 놓으세요")
                     : "배정된 학생이 없습니다."}</div>`}
    ${editing && c.key !== "__none" ? `
      <div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" data-add-member="${c.key}">＋ 학생 배정</button>
        ${members.length ? `<button class="btn btn-ghost btn-sm" data-seats="${c.key}"
          title="이 셀의 셀리더·셀헬퍼를 정합니다">🙋 리더·헬퍼</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-edit-cell="${c.key}">이름 편집</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-del-cell="${c.key}">셀 삭제</button>
      </div>` : ""}
  </section>`;
}

/** 셀 카드 안의 학생 한 줄 */
function studentRow(s, editing) {
  if (!editing) {
    return `
    <li data-student="${s.id}">
      ${avatar(s.name, photoOf(s.id), 22)}
      <span>${esc(s.name)}</span>
      ${seatBadge(seatOf(s.id, false))}
      ${showSkyBadge() && s.is_promoted ? '<span class="badge blue" title="초등부 하늘아이에서 올라온 아이">하늘아이</span>' : ""}
      <span class="g"${gradeOf(s) ? ` title="${esc(gradeWithYear(s))}"` : ""}>${esc(gradeOf(s) || "")}</span>
    </li>`;
  }
  const sibs = siblingsOf(s.id);
  const seat = seatOf(s.id, true);
  const moved = draft && (draft.orig?.[s.id] ?? null) !== (draft.assign[s.id] ?? null);
  // 한 줄에 다 들어가도록 배지 대신 잔글씨로 (마우스를 올리면 자세한 설명이 뜹니다)
  const meta = [
    s.gender, ageOf(s), shortSchool(s.school),
    showSkyBadge() && s.is_promoted ? "하늘아이" : "",
    sibs.length ? `남매 ${sibs.map((x) => x.name).join("·")}` : "",
  ].filter(Boolean).join(" · ");
  return `
  <li data-student="${s.id}" draggable="true"
      data-school="${esc(nk(s.school))}" data-sibs="${esc(sibs.map((x) => x.id).join(" "))}">
    <span class="grip" title="끌어서 다른 셀로 옮기기">⠿</span>
    ${avatar(s.name, photoOf(s.id), 24)}
    <div class="who">
      <div class="line1">
        <b>${esc(s.name)}</b>
        ${seatBadge(seat)}
        ${moved ? '<span class="badge orange" title="지난 편성에서 옮겨졌습니다">이동</span>' : ""}
      </div>
      ${meta ? `<div class="line2" title="${esc(meta)}">${esc(meta)}</div>` : ""}
    </div>
    <span class="g"${gradeOf(s) ? ` title="${esc(gradeWithYear(s))}"` : ""}>${esc(gradeOf(s) || "")}</span>
    <button class="icon-btn" data-move="${s.id}" title="셀 옮기기 (휴대폰용)"
            style="width:24px;height:24px;font-size:12px">⇄</button>
  </li>`;
}

// ════════════════════════════════════════════════════════════
//  이벤트
// ════════════════════════════════════════════════════════════
export function mount(root, rerender) {
  // ── 조회 모드 ──
  root.querySelector("#verSel")?.addEventListener("change", (e) => {
    state.versionId = e.target.value; rerender();
  });
  root.querySelector("#delVer")?.addEventListener("click", () => deleteVersion(rerender));
  root.querySelector("#renameVer")?.addEventListener("click", () => renameVersion(rerender));
  root.querySelector("#restoreVer")?.addEventListener("click", () => restoreVersion(rerender));

  // ── 임시저장 ──
  root.querySelector("#slotSave")?.addEventListener("click", () => {
    const it = saveSlot();
    if (!it) return;
    rerender();
    toast(`«${it.name}» 으로 임시저장했습니다.`);
  });
  bindSlots(root, rerender);
  root.querySelector("#slotList")?.addEventListener("click", () => slotsModal(rerender));
  bindXlsx(root.querySelector("#xlsxVer"), async () => {
    const { exportCurrentVersion } = await import("../xlsx.js");
    await exportCurrentVersion();
  });
  root.querySelector("#editBtn")?.addEventListener("click", () => { startDraft(); rerender(); });
  root.querySelector("#resumeDraft")?.addEventListener("click", () => {
    if (resumeDraft()) { toast("짜던 편성을 불러왔습니다."); rerender(); }
    else toast("불러올 편성을 찾지 못했습니다.", "err");
  });
  root.querySelector("#dropDraft")?.addEventListener("click", async () => {
    if (!(await confirmDialog("짜던 편성을 버릴까요? 되돌릴 수 없습니다.", { okText: "버리기" }))) return;
    forgetDraft(); rerender(); toast("버렸습니다.");
  });

  // ── 편집 모드 ──
  root.querySelector("#cancelEdit")?.addEventListener("click", async () => {
    if (!(await confirmDialog("편집한 내용을 버리고 나갈까요? 저장하지 않은 변경은 사라집니다.",
      { okText: "버리기" }))) return;
    discardDraft(); rerender();
  });
  root.querySelector("#saveEdit")?.addEventListener("click", () => saveDraft(rerender));
  root.querySelector("#undoBtn")?.addEventListener("click", () => undo(rerender));
  root.querySelector("#redoBtn")?.addEventListener("click", () => redo(rerender));
  bindShortcuts(rerender);
  root.querySelector("#addCell")?.addEventListener("click", () => editCell(null, rerender));
  root.querySelector("#addCellBottom")?.addEventListener("click", () => editCell(null, rerender));
  if (draft) bindDragDrop(root, rerender);

  root.querySelectorAll("[data-student]").forEach((li) => li.addEventListener("click", (e) => {
    if (e.target.closest("[data-move]")) return;
    showStudent(state.students.find((s) => s.id === li.dataset.student), rerender);
  }));
  root.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    moveStudent(state.students.find((s) => s.id === b.dataset.move), rerender);
  }));
  // 셀 단위로 리더·헬퍼 정하기
  root.querySelectorAll("[data-seats]").forEach((b) => b.addEventListener("click", () =>
    editSeats(b.dataset.seats, rerender)));
  root.querySelectorAll("[data-add-member]").forEach((b) => b.addEventListener("click", () =>
    addMembers(b.dataset.addMember, rerender)));
  root.querySelectorAll("[data-edit-cell]").forEach((b) => b.addEventListener("click", () =>
    editCell(draft.cells.find((c) => c.key === b.dataset.editCell), rerender)));
  root.querySelectorAll("[data-del-cell]").forEach((b) => b.addEventListener("click", async () => {
    const c = draft.cells.find((x) => x.key === b.dataset.delCell);
    const n = dMembers(c.key).length;
    if (!(await confirmDialog(`"${c.name}" 셀을 뺄까요?${n ? ` 소속 ${n}명은 미배정이 됩니다.` : ""}`,
      { okText: "빼기" }))) return;
    pushHistory();
    draft.cells = draft.cells.filter((x) => x.key !== c.key);
    for (const [sid, k] of Object.entries(draft.assign)) if (k === c.key) draft.assign[sid] = null;
    keepDraft(); rerender();
  }));
}

// ── 마우스로 끌어 옮기기 ──────────────────────────────────
//   · 학생 줄을 잡아서 다른 셀 카드 위에 놓으면 배정이 바뀝니다.
//   · 되돌리기(30단계)와 그대로 연결됩니다.
//   · 휴대폰처럼 끌기가 어려운 곳에서는 ⇄ 버튼을 쓰시면 됩니다.
function bindDragDrop(root, rerender) {
  let dragId = null;

  root.querySelectorAll("[data-student][draggable]").forEach((li) => {
    li.addEventListener("dragstart", (e) => {
      dragId = li.dataset.student;
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragId); } catch {}
      li.classList.add("dragging");
      root.querySelectorAll(".droppable").forEach((c) => c.classList.add("drop-ready"));
    });
    li.addEventListener("dragend", () => {
      dragId = null;
      li.classList.remove("dragging");
      root.querySelectorAll(".droppable").forEach((c) =>
        c.classList.remove("drop-ready", "drop-over"));
    });

    // 마우스를 올리면 형제자매·같은 학교 아이를 함께 밝혀 줍니다
    li.addEventListener("mouseenter", () => {
      const sibs = (li.dataset.sibs || "").split(" ").filter(Boolean);
      const school = li.dataset.school;
      root.querySelectorAll("[data-student]").forEach((o) => {
        if (o === li) return;
        if (sibs.includes(o.dataset.student)) o.classList.add("hl-sib");
        else if (school && o.dataset.school === school) o.classList.add("hl-school");
      });
    });
    li.addEventListener("mouseleave", () => {
      root.querySelectorAll(".hl-sib, .hl-school").forEach((o) =>
        o.classList.remove("hl-sib", "hl-school"));
    });
  });

  root.querySelectorAll(".droppable").forEach((card) => {
    card.addEventListener("dragover", (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.add("drop-over");
    });
    card.addEventListener("dragleave", (e) => {
      if (!card.contains(e.relatedTarget)) card.classList.remove("drop-over");
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      const sid = dragId || e.dataTransfer.getData("text/plain");
      card.classList.remove("drop-over");
      if (!sid) return;
      const key = card.dataset.cell === "__none" ? null : card.dataset.cell;
      if ((draft.assign[sid] || null) === key) return;      // 제자리면 아무 일 없음
      pushHistory();
      draft.assign[sid] = key;
      keepDraft();
      const who = state.students.find((x) => x.id === sid);
      const to = key ? draft.cells.find((c) => c.key === key)?.name : "미배정";
      rerender();
      toast(`${who?.name || ""} → ${to}`);
    });
  });
}

// ── 저장 (여기서 비로소 버전이 기록됩니다) ────────────────
function saveDraft(after) {
  const base = draft.base ? state.versions.find((v) => v.id === draft.base) : null;
  const who = state.profile?.name || state.profile?.username || "";
  const form = document.createElement("form");
  form.id = "saveForm";
  form.innerHTML = `
    <div class="field"><label>버전 이름</label>
      <input type="text" name="label" required value="${esc(draft.label)}" placeholder="예: 2026-2학기"></div>
    <div class="field" style="margin-top:12px"><label>메모</label>
      <input type="text" name="note" value="${esc(draft.note)}" placeholder="예: 여름 수련회 이후 재편성"></div>
    ${base ? `
    <div class="section-label">저장 방식</div>
    <div class="stack" style="gap:8px">
      <label style="display:flex;gap:9px;align-items:flex-start;padding:11px 13px;cursor:pointer;
                    border:1px solid var(--border-strong);border-radius:8px">
        <input type="radio" name="mode" value="new" checked style="width:auto;margin-top:3px">
        <span><b>새 버전으로 저장</b>
          <div style="font-size:12.5px;color:var(--text-muted)">
            오늘 날짜로 새 버전이 만들어지고, 기존 «${esc(base.label)}» 은 그대로 남습니다.</div></span>
      </label>
      <label style="display:flex;gap:9px;align-items:flex-start;padding:11px 13px;cursor:pointer;
                    border:1px solid var(--border-strong);border-radius:8px">
        <input type="radio" name="mode" value="overwrite" style="width:auto;margin-top:3px">
        <span><b>현재 버전에 덮어쓰기</b>
          <div style="font-size:12.5px;color:var(--text-muted)">
            «${esc(base.label)}» 을 고칩니다. 등록일은 그대로, 최종 저장 시각만 갱신됩니다.</div></span>
      </label>
    </div>` : ""}
    <div class="form-note" style="margin-top:16px">
      저장하는 사람: <b>${esc(who || "-")}</b> · 저장 시각이 버전에 기록됩니다.
    </div>`;

  modal({
    title: "셀편성 저장", narrow: true, body: form,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="saveForm" type="submit">저장</button>`,
    onMount(box, close) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = box.querySelector('[type="submit"]');
        btn.disabled = true; btn.textContent = "저장 중…";
        const fd = Object.fromEntries(new FormData(form).entries());
        const mode = fd.mode || "new";
        try {
          let versionId;
          if (mode === "overwrite" && base) {
            await api.saveVersion({
              id: base.id, label: fd.label.trim(), note: fd.note?.trim() || null,
              created_at: base.created_at, created_by_name: base.created_by_name,
              updated_at: new Date().toISOString(), updated_by_name: who,
            });
            for (const c of versionCells(base.id)) await api.deleteCell(c.id);
            versionId = base.id;
          } else {
            const v = await api.saveVersion({
              label: fd.label.trim(), note: fd.note?.trim() || null,
              created_by_name: who, updated_by_name: who,
            });
            versionId = v.id;
          }

          const made = await api.saveCells(dCells().map((c, i) => ({
            version_id: versionId, name: c.name, leaders: c.leaders,
            kind: c.kind, sort_order: c.sort_order || i + 1,
          })));
          const keyToId = {};
          dCells().forEach((c, i) => { keyToId[c.key] = made[i].id; });

          const rows = Object.entries(draft.assign)
            .filter(([, k]) => k && keyToId[k])
            .map(([sid, k]) => ({ version_id: versionId, cell_id: keyToId[k], student_id: sid,
                                  role: draft.roles?.[sid] || null }));
          await api.saveMembers(rows);

          await api.refresh();
          state.versionId = versionId;
          draft = null; past = []; future = []; forgetDraft();
          close(); after?.();
          toast(mode === "overwrite" ? "현재 버전에 저장했습니다." : "새 버전으로 저장했습니다.");
        } catch (err) {
          console.error(err);
          toast(err.message, "err");
          btn.disabled = false; btn.textContent = "저장";
        }
      });
    },
  });
}

// ── 지금 버전의 이름·메모 고치기 ─────────────────────────
function renameVersion(after) {
  const v = currentVersion();
  if (!v) return;
  const who = state.profile?.name || state.profile?.username || "";
  const form = document.createElement("form");
  form.id = "renForm";
  form.innerHTML = `
    <div class="field"><label>편성 이름</label>
      <input type="text" name="label" required value="${esc(v.label)}" placeholder="예: 2026-2학기">
      <span class="hint">드롭다운과 엑셀에 이 이름으로 나옵니다.</span></div>
    <div class="field" style="margin-top:12px"><label>메모</label>
      <input type="text" name="note" value="${esc(v.note || "")}" placeholder="예: 여름 수련회 이후 재편성"></div>
    <div class="form-note" style="margin-top:14px">
      편성 내용(누가 어느 셀인지)은 그대로입니다. 이름과 메모만 바뀝니다.
    </div>`;
  modal({
    title: "편성 이름 바꾸기", narrow: true, body: form,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="renForm" type="submit">저장</button>`,
    onMount(box, close) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = box.querySelector('[type="submit"]');
        btn.disabled = true; btn.textContent = "저장 중…";
        const fd = Object.fromEntries(new FormData(form).entries());
        try {
          await api.saveVersion({
            id: v.id, label: fd.label.trim(), note: fd.note?.trim() || null,
            created_at: v.created_at, created_by_name: v.created_by_name,
            updated_at: new Date().toISOString(), updated_by_name: who,
          });
          await api.refresh();
          close(); after?.();
          toast("이름을 바꿨습니다.");
        } catch (err) {
          toast(err.message, "err");
          btn.disabled = false; btn.textContent = "저장";
        }
      });
    },
  });
}

// ── 지난 편성을 통째로 다시 최신으로 ──────────────────────
//   지운 게 아니라 «그대로 복사해서 새 버전» 을 만듭니다.
//   그래서 되돌린 뒤에도 그 사이 버전들이 기록으로 남습니다.
function restoreVersion(after) {
  const v = currentVersion();
  if (!v) return;
  const who = state.profile?.name || state.profile?.username || "";
  const n = state.members.filter((m) => m.version_id === v.id).length;
  const form = document.createElement("form");
  form.id = "resForm";
  form.innerHTML = `
    <div class="form-note" style="margin-top:0">
      <b>«${esc(v.label)}»</b> (${esc(fmtDate(v.created_at))} 등록) 의 편성을
      그대로 가져와 <b>새 최신 편성</b>으로 만듭니다.
      셀 ${versionCells(v.id).length}개 · 배정 ${n}명.
    </div>
    <div class="field" style="margin-top:14px"><label>새 편성 이름</label>
      <input type="text" name="label" required value="${esc(v.label)} (되돌림)"></div>
    <div class="form-note" style="margin-top:14px">
      지금 최신 편성 «${esc(state.versions[0]?.label || "")}» 은 <b>지워지지 않고</b>
      지난 버전으로 남습니다. 마음이 바뀌면 다시 그쪽으로 되돌릴 수 있습니다.
    </div>`;
  modal({
    title: "이 편성으로 되돌리기", narrow: true, body: form,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="resForm" type="submit">되돌리기</button>`,
    onMount(box, close) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = box.querySelector('[type="submit"]');
        btn.disabled = true; btn.textContent = "만드는 중…";
        const fd = Object.fromEntries(new FormData(form).entries());
        try {
          const src = versionCells(v.id);
          const nv = await api.saveVersion({
            label: fd.label.trim(),
            note: `${fmtDate(v.created_at)} «${v.label}» 편성을 그대로 되돌림`,
            created_by_name: who, updated_by_name: who,
          });
          const made = await api.saveCells(src.map((c, i) => ({
            version_id: nv.id, name: c.name, leaders: c.leaders,
            kind: c.kind, sort_order: c.sort_order || i + 1,
          })));
          const map = {};
          src.forEach((c, i) => { map[c.id] = made[i].id; });
          const rows = state.members
            .filter((m) => m.version_id === v.id && map[m.cell_id])
            .map((m) => ({ version_id: nv.id, cell_id: map[m.cell_id], student_id: m.student_id,
                           role: m.role || null }));
          await api.saveMembers(rows);
          await api.refresh();
          state.versionId = nv.id;
          close(); after?.();
          toast("이 편성으로 되돌렸습니다.");
        } catch (err) {
          console.error(err);
          toast(err.message, "err");
          btn.disabled = false; btn.textContent = "되돌리기";
        }
      });
    },
  });
}

// ── 버전 삭제 ────────────────────────────────────────────
async function deleteVersion(after) {
  const v = currentVersion();
  if (!v) return;
  if (state.versions.length <= 1) return toast("마지막 남은 버전은 삭제할 수 없습니다.", "err");
  const n = state.members.filter((m) => m.version_id === v.id).length;
  if (!(await confirmDialog(
    `«${versionLabel(v)}» 버전을 삭제할까요? 이 버전의 셀 ${versionCells(v.id).length}개와 배정 ${n}건이 함께 사라집니다. 학생 교적 자체는 지워지지 않습니다.`,
    { okText: "버전 삭제" }))) return;
  try {
    await api.deleteVersion(v.id);
    state.versionId = null;
    await api.refresh();
    after?.();
    toast("버전을 삭제했습니다.");
  } catch (e) { toast(e.message, "err"); }
}

// ── 초안 안에서의 셀 편집 ────────────────────────────────
function editCell(c, after) {
  const isNew = !c;
  c = c || { key: "new_" + uid(), name: "", leaders: [], kind: "셀", sort_order: draft.cells.length + 1 };
  const form = document.createElement("form");
  form.id = "cellForm";
  form.innerHTML = `
    <div class="field"><label>셀 이름</label>
      <input type="text" name="name" required placeholder="예: 홍길동 선생님" value="${esc(c.name)}"></div>
    <div class="field" style="margin-top:12px"><label>담당 교사·간사</label>
      <input type="text" name="leaders" placeholder="쉼표로 구분 · 예: 김선생, 이간사"
             value="${esc((c.leaders || []).join(", "))}">
      <span class="hint">두 명 이상이면 쉼표로 나눠 적어 주세요.</span></div>
    <div class="grid grid-2" style="margin-top:12px">
      <div class="field"><label>구분</label>
        <select name="kind">${["셀", "장기결석", "기타"].map((k) =>
          `<option value="${k}"${c.kind === k ? " selected" : ""}>${k}</option>`).join("")}</select></div>
      <div class="field"><label>표시 순서</label>
        <input type="text" inputmode="numeric" name="sort_order" value="${esc(c.sort_order ?? 0)}"></div>
    </div>`;

  modal({
    title: isNew ? "셀 추가" : "셀 편집", narrow: true, body: form,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="cellForm" type="submit">확인</button>`,
    onMount(box, close) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        const name = fd.name.trim();
        if (draft.cells.some((x) => x.name === name && x.key !== c.key))
          return toast("같은 이름의 셀이 이미 있습니다.", "err");
        pushHistory();
        Object.assign(c, {
          name, kind: fd.kind,
          sort_order: parseInt(fd.sort_order, 10) || draft.cells.length + 1,
          leaders: fd.leaders.split(",").map((x) => x.trim()).filter(Boolean),
        });
        if (isNew) draft.cells.push(c);
        keepDraft(); close(); after?.();
      });
    },
  });
}

/** 학생 한 명의 셀을 옮깁니다. 편집 모드가 아니면 편집 모드를 시작합니다. */
export function moveStudent(s, after) {
  if (!s) return;
  if (!isLoggedIn()) return toast("로그인이 필요합니다.", "err");
  if (!draft) startDraft();
  const cur = dCellOf(s.id);
  const form = document.createElement("form");
  form.id = "moveForm";
  form.innerHTML = `
    <div class="field"><label>${esc(s.name)} (${esc(gradeOf(s) || "")}) 를 배정할 셀</label>
      <select name="cell">
        <option value="">미배정</option>
        ${dCells().map((c) =>
          `<option value="${esc(c.key)}"${cur === c.key ? " selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
      <span class="hint">편집 중인 편성에만 적용되며, <b>저장</b>을 눌러야 확정됩니다.</span></div>`;
  modal({
    title: "셀 옮기기", narrow: true, body: form,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="moveForm" type="submit">확인</button>`,
    onMount(box, close) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        pushHistory();
        draft.assign[s.id] = new FormData(form).get("cell") || null;
        keepDraft();
        close();
        if (location.hash !== "#/cells") location.hash = "#/cells"; else after?.();
      });
    },
  });
}

/** 셀 하나의 셀리더·셀헬퍼를 한 화면에서 정합니다 (여러 명 가능) */
function editSeats(cellKey, after) {
  if (!draft) return;
  const cell = draft.cells.find((c) => c.key === cellKey);
  const members = dMembers(cellKey)
    .sort((a, b) => gradeRank(gradeOf(a)) - gradeRank(gradeOf(b)) || a.name.localeCompare(b.name, "ko"));
  if (!members.length) return toast("이 셀에는 아직 아이가 없습니다.", "err");

  // 창을 닫을 때까지는 여기서만 바뀝니다
  const pick = {};
  for (const s of members) pick[s.id] = draft.roles?.[s.id] || null;

  const box = document.createElement("div");
  const draw = () => {
    const lead = members.filter((s) => pick[s.id] === "셀리더");
    const help = members.filter((s) => pick[s.id] === "셀헬퍼");
    box.innerHTML = `
      <div class="form-note" style="margin:0 0 12px">
        이름 오른쪽에서 <b>리더</b> 나 <b>헬퍼</b> 를 누르세요. 한 번 더 누르면 풀립니다.
        <b>여러 명이어도 되고, 아무도 없어도 됩니다.</b>
      </div>
      <div class="seat-pick">
        ${members.map((s) => `
        <div class="seat-row">
          ${avatar(s.name, photoOf(s.id), 28)}
          <span class="seat-name">
            <b>${esc(s.name)}</b>
            <span class="seat-sub">${esc([gradeOf(s), s.gender, shortSchool(s.school)]
              .filter(Boolean).join(" · "))}</span>
          </span>
          <span class="seat-btns">
            <button type="button" class="seat-pill lead${pick[s.id] === "셀리더" ? " on" : ""}"
              data-pick="${s.id}" data-role="셀리더">리더</button>
            <button type="button" class="seat-pill help${pick[s.id] === "셀헬퍼" ? " on" : ""}"
              data-pick="${s.id}" data-role="셀헬퍼">헬퍼</button>
          </span>
        </div>`).join("")}
      </div>
      <div class="form-note" style="margin:12px 0 0">
        ${lead.length || help.length
          ? `${lead.length ? `<b>리더</b> ${esc(lead.map((s) => s.name).join(" · "))}` : "리더 없음"}
             &nbsp;|&nbsp;
             ${help.length ? `<b>헬퍼</b> ${esc(help.map((s) => s.name).join(" · "))}` : "헬퍼 없음"}`
          : "아직 아무도 정하지 않았습니다. 이대로 두어도 괜찮습니다."}
      </div>`;
    box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.pick;
      pick[id] = pick[id] === b.dataset.role ? null : b.dataset.role;   // 같은 걸 또 누르면 해제
      draw();
    }));
  };
  draw();

  modal({
    title: `${cell?.name || "셀"} — 리더 · 헬퍼 정하기`,
    narrow: true,
    body: box,
    footer: `<button class="btn btn-danger" data-clear>모두 없음</button>
             <div style="flex:1"></div>
             <button class="btn" data-close>취소</button>
             <button class="btn btn-primary" data-ok>확인</button>`,
    onMount(b, close) {
      b.querySelector("[data-clear]").addEventListener("click", () => {
        for (const id of Object.keys(pick)) pick[id] = null;
        draw();
      });
      b.querySelector("[data-ok]").addEventListener("click", () => {
        pushHistory();
        draft.roles = { ...(draft.roles || {}) };
        for (const [id, v] of Object.entries(pick)) {
          if (v) draft.roles[id] = v; else delete draft.roles[id];
        }
        keepDraft();
        close();
        after?.();
      });
    },
  });
}

function addMembers(cellKey, after) {
  const assigned = new Set(Object.entries(draft.assign).filter(([, k]) => k).map(([s]) => s));
  const pool = state.students.filter((s) => !assigned.has(s.id) && !isGraduated(s))
    .sort((a, b) => gradeRank(gradeOf(a)) - gradeRank(gradeOf(b)) || a.name.localeCompare(b.name, "ko"));
  const box = document.createElement("div");
  box.innerHTML = pool.length ? `
    <p style="margin:0 0 10px;font-size:13px;color:var(--text-secondary)">
      아직 배정되지 않은 학생 ${pool.length}명입니다. 체크한 뒤 확인하세요.</p>
    <div style="max-height:46vh;overflow:auto;border:1px solid var(--border);border-radius:8px">
      ${pool.map((s) => `
        <label style="display:flex;gap:9px;align-items:center;padding:7px 12px;
                      border-bottom:1px solid var(--grid);cursor:pointer;font-size:13.5px">
          <input type="checkbox" value="${s.id}" style="width:auto">
          <span>${esc(s.name)}</span>
          <span style="margin-left:auto;color:var(--text-muted);font-size:12px">${esc(gradeOf(s) || "")}</span>
        </label>`).join("")}
    </div>`
    : `<div class="empty" style="padding:24px 0">배정되지 않은 학생이 없습니다.</div>`;

  modal({
    title: "학생 배정", body: box,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" data-save>확인</button>`,
    onMount(m, close) {
      m.querySelector("[data-save]").addEventListener("click", () => {
        const picked = [...box.querySelectorAll("input:checked")];
        if (picked.length) {
          pushHistory();
          for (const i of picked) draft.assign[i.value] = cellKey;
          keepDraft();
        }
        close(); after?.();
      });
    },
  });
}

/** 편집을 완전히 그만둡니다 (취소·저장 완료) — 보관해 둔 것도 지웁니다. */
export function discardDraft() { draft = null; past = []; future = []; forgetDraft(); }
/** 화면만 잠깐 떠날 때 — 편집 상태는 그대로 두고 보관만 해둡니다.
 *  (주소록 보러 갔다 와도 짜던 게 그대로 있습니다. 창을 닫으면 «이어서 하기» 로 복구) */
export function parkDraft() { keepDraft(); }

// ── 키보드 단축키 (Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z, Ctrl/⌘ + Y) ──
let shortcutHandler = null;
function bindShortcuts(rerender) {
  if (shortcutHandler) document.removeEventListener("keydown", shortcutHandler);
  shortcutHandler = (e) => {
    if (!draft) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(rerender); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(rerender); }
  };
  document.addEventListener("keydown", shortcutHandler);
}
