// ── 셀편성 (버전 관리 + 편집 모드) ──────────────────────────
//  · 조회 모드: 버전을 골라 그대로 열람
//  · 편집 모드: 고친 내용은 화면에만 있다가 "저장"을 눌러야 버전으로 확정
// ============================================================
import {
  state, api, isLoggedIn, isAdmin, versionCells, currentVersion,
  versionLabel, cellMembers, cellIdOf, photoOf, uid, gradeOf, gradeWithYear, statusOf, isActive, isGraduated,
} from "../data.js";
import { esc, modal, toast, confirmDialog, avatar } from "../ui.js";
import { DEFAULT_TERM_LABEL } from "../config.js";
import { showStudent } from "./students.js";

// 편집 중인 초안 (저장 전까지 서버/저장소에 반영되지 않습니다)
let draft = null;
// { base, label, note, cells:[{key,name,leaders,kind,sort_order}], assign:{studentId: key|null} }

// ── 되돌리기 / 다시하기 (각 30단계) ────────────────────────
const HISTORY_MAX = 30;
let past = [];     // 이전 상태 스냅샷
let future = [];   // 되돌린 뒤의 상태 스냅샷
const snapshot = () => JSON.stringify({ cells: draft.cells, assign: draft.assign,
                                        label: draft.label, note: draft.note });
const restore = (snap) => {
  const o = JSON.parse(snap);
  draft.cells = o.cells; draft.assign = o.assign; draft.label = o.label; draft.note = o.note;
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
  after?.();
}
export function redo(after) {
  if (!draft || !future.length) return;
  past.push(snapshot());
  if (past.length > HISTORY_MAX) past.shift();
  restore(future.pop());
  after?.();
}
export const canUndo = () => !!draft && past.length > 0;
export const canRedo = () => !!draft && future.length > 0;

const ORDER = ["예비중1", "중1", "중2", "중3", "고1", "고2", "고3"];
const gradeRank = (g) => { const i = ORDER.indexOf(g); return i < 0 ? 99 : i; };
/** 최신 편성에서는 졸업생을 감추고, 지난 편성에서는 기록 그대로 보여줍니다. */
const visibleMembers = (cellId, isLatest) =>
  cellMembers(cellId).filter((s) => (isLatest ? !isGraduated(s) : true));
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
  };
  if (v) for (const m of state.members.filter((x) => x.version_id === v.id))
    draft.assign[m.student_id] = m.cell_id;
  past = []; future = [];
}
export const isEditing = () => !!draft;
const dCells = () => [...draft.cells].sort((a, b) => a.sort_order - b.sort_order);
const dMembers = (key) => state.students.filter((s) => draft.assign[s.id] === key && !isGraduated(s));
const dCellOf = (sid) => draft.assign[sid] || null;

// ════════════════════════════════════════════════════════════
//  화면
// ════════════════════════════════════════════════════════════
export function html() {
  if (draft) return editHtml();

  const v = currentVersion();
  if (!v) {
    return `
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

  return `
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
      <button class="btn btn-sm" id="xlsxVer">📥 현재 버전 받기</button>
      ${isLoggedIn() ? `<button class="btn btn-primary btn-sm" id="editBtn">✏️ 편집</button>` : ""}
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
    ${state.versions[0]?.id === v.id
      ? `<span class="badge good" style="margin-left:auto">최신 버전</span>`
      : `<span class="badge warn" style="margin-left:auto">지난 버전</span>`}
  </div>

  <div class="grid grid-auto">
    ${cells.map((c) => cellCard({ ...c, key: c.id }, visibleMembers(c.id, isLatest), false)).join("")}
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
    <b>✏️ 편집 중</b>
    <span>고친 내용은 <b>저장을 눌러야</b> 버전으로 기록됩니다.
      되돌리기는 최대 ${HISTORY_MAX}단계까지 가능합니다.</span>
    <span style="margin-left:auto;display:flex;gap:8px;align-items:center">
      <span style="display:flex;gap:4px">
        <button class="btn btn-sm" id="undoBtn" ${past.length ? "" : "disabled"}
          title="되돌리기 (Ctrl+Z)">↶ 되돌리기${past.length ? ` <b>${past.length}</b>` : ""}</button>
        <button class="btn btn-sm" id="redoBtn" ${future.length ? "" : "disabled"}
          title="다시하기 (Ctrl+Shift+Z)">↷ 다시하기${future.length ? ` <b>${future.length}</b>` : ""}</button>
      </span>
      <button class="btn btn-sm" id="cancelEdit">취소</button>
      <button class="btn btn-primary btn-sm" id="saveEdit">저장하기</button>
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

  <div class="grid grid-auto">
    ${cells.map((c) => cellCard(c, dMembers(c.key), true)).join("")}
    ${cellCard({ key: "__none", name: "미배정", kind: "기타", leaders: [] }, unassigned, true)}
  </div>`;
}

function cellCard(c, members, editing) {
  const special = c.kind !== "셀";
  members = [...members].sort(
    (a, b) => gradeRank(gradeOf(a)) - gradeRank(gradeOf(b)) || a.name.localeCompare(b.name, "ko"));
  return `
  <section class="card cell-card" data-cell="${esc(c.key)}">
    <div class="cell-top">
      <div>
        <h4>${esc(c.name)}</h4>
        ${c.leaders?.length
          ? `<div style="font-size:12px;color:var(--text-muted)">${esc(c.leaders.join(" · "))}</div>` : ""}
      </div>
      <span class="badge ${special ? "warn" : "blue"}">${members.length}명</span>
    </div>
    ${members.length ? `<ul>${members.map((s) => `
      <li data-student="${s.id}">
        ${avatar(s.name, photoOf(s.id), 22)}
        <span>${esc(s.name)}</span>
        ${s.is_promoted ? '<span class="badge blue" title="초등부 하늘아이에서 올라온 아이">하늘아이</span>' : ""}
        <span class="g"${gradeOf(s) ? ` title="${esc(gradeWithYear(s))}"` : ""}>${esc(gradeOf(s) || "")}</span>
        ${editing ? `<button class="icon-btn" data-move="${s.id}" title="셀 옮기기"
                       style="width:24px;height:24px;font-size:12px">⇄</button>` : ""}
      </li>`).join("")}</ul>`
      : `<div class="empty" style="padding:24px 0;font-size:13px">
           ${editing && c.key === "__none" ? "전원 배정 완료" : "배정된 학생이 없습니다."}</div>`}
    ${editing && c.key !== "__none" ? `
      <div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" data-add-member="${c.key}">＋ 학생 배정</button>
        <button class="btn btn-ghost btn-sm" data-edit-cell="${c.key}">이름 편집</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-del-cell="${c.key}">셀 삭제</button>
      </div>` : ""}
  </section>`;
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
  root.querySelector("#xlsxVer")?.addEventListener("click", async () => {
    const { exportCurrentVersion } = await import("../xlsx.js");
    await exportCurrentVersion();
  });
  root.querySelector("#editBtn")?.addEventListener("click", () => { startDraft(); rerender(); });

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

  root.querySelectorAll("[data-student]").forEach((li) => li.addEventListener("click", (e) => {
    if (e.target.closest("[data-move]")) return;
    showStudent(state.students.find((s) => s.id === li.dataset.student), rerender);
  }));
  root.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    moveStudent(state.students.find((s) => s.id === b.dataset.move), rerender);
  }));
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
    rerender();
  }));
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
            .map(([sid, k]) => ({ version_id: versionId, cell_id: keyToId[k], student_id: sid }));
          await api.saveMembers(rows);

          await api.refresh();
          state.versionId = versionId;
          draft = null; past = []; future = [];
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
        close(); after?.();
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
        close();
        if (location.hash !== "#/cells") location.hash = "#/cells"; else after?.();
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
        }
        close(); after?.();
      });
    },
  });
}

/** 다른 화면으로 이동할 때 편집 초안을 정리 */
export function discardDraft() { draft = null; past = []; future = []; }

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
