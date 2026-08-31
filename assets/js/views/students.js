// ── 주소록 (교적 명단) ─────────────────────────────────────
import {
  state, api, isLoggedIn, isMasked, photoOf, cellIdOf, cellNameOf, versionCells, currentVersion,
  gradeOf, statusOf, isAutoGrade, autoGrade, schoolYear, gradeWithYear,
} from "../data.js";
import {
  esc, dash, telLink, fmtBirth, modal, toast, confirmDialog, byName,
  avatar, cropImage, showSkyBadge,
} from "../ui.js";
import { GRADES } from "../config.js";
import { moveStudent } from "./cells.js";
import { bindDownload as bindXlsx } from "../xlsx.js";

const f = {
  q: "", grade: "", gender: "", cell: "", status: "재학",
  school: "", birthYear: "", phone: "", guardian: "", note: "",   // 표 머리에서 거는 필터
  sort: "seq", dir: 1,
};
/** 위쪽 칸과 표 머리 필터가 같이 쓰는 «걸어 둔 것» 목록 */
const ACTIVE = ["q", "grade", "gender", "cell", "school", "birthYear", "phone", "guardian", "note"];
const anyFilter = () => ACTIVE.some((k) => f[k]) || f.status !== "재학";

export function html() {
  return `
  <div class="page-head">
    <div>
      <h1>주소록</h1>
      <p><span class="badge blue" title="3월 1일에 다음 학년도로 올라갑니다">${schoolYear()}학년도 기준</span>
        ${isMasked()
        ? "이름·학교로 검색할 수 있습니다. 연락처·주소·보호자 정보는 <b>로그인해야</b> 보입니다."
        : "이름·학교·전화번호·보호자 이름으로 검색할 수 있습니다."}</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-sm" id="xlsxBtn">📥 엑셀 받기</button>
      ${isLoggedIn() ? `<button class="btn btn-primary btn-sm" id="addBtn">＋ 학생 등록</button>`
                     : `<a class="btn btn-sm" href="#/login">로그인하고 등록하기</a>`}
    </div>
  </div>

  <div class="card filters">
    <div class="search"><input type="search" id="q"
      placeholder="${isMasked() ? "이름, 학교…" : "이름, 학교, 전화번호, 보호자…"}" value="${esc(f.q)}"></div>
    <select id="grade">${opts("전체 학년", GRADES, f.grade)}</select>
    <select id="gender">${opts("성별", ["남", "여"], f.gender)}</select>
    <select id="cell">
      <option value="">전체 셀</option>
      ${versionCells().map((c) => `<option value="${c.id}"${f.cell === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}
      <option value="__none"${f.cell === "__none" ? " selected" : ""}>미배정</option>
    </select>
    <select id="status" title="지금 우리 부서에 있는 아이만 볼지, 떠난 아이까지 볼지 고릅니다">
      ${[["재학",  "지금 우리 부서 아이들"],
         ["재적",  "└ 잘 나오는 아이만"],
         ["장기결석", "└ 오래 못 본 아이만"],
         ["졸업",  "졸업 — 청년부로 올라감"],
         ["전출",  "전출 — 다른 교회로 옮김"],
         ["",      "전부 (떠난 아이까지)"]].map(([v, t]) =>
        `<option value="${v}"${f.status === v ? " selected" : ""}>${t}</option>`).join("")}
    </select>
    <span class="count" id="count"></span>
  </div>

  <div class="card table-wrap" id="tableWrap"></div>`;
}

export function mount(root) {
  const rerender = () => draw(root);
  root.querySelector("#q").addEventListener("input", (e) => { f.q = e.target.value; rerender(); });
  for (const k of ["grade", "gender", "cell", "status"])
    root.querySelector("#" + k).addEventListener("change", (e) => { f[k] = e.target.value; rerender(); });
  bindXlsx(root.querySelector("#xlsxBtn"), async () => {
    const { exportStudentList } = await import("../xlsx.js");
    await exportStudentList(filtered(), { masked: isMasked(), what: "주소록" });
  });
  root.querySelector("#addBtn")?.addEventListener("click", () => editStudent(null, rerender));
  draw(root);
}

function opts(all, list, cur) {
  return `<option value="">${esc(all)}</option>` +
    list.map((v) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(v)}</option>`).join("");
}

const hasGuardian = (s) => !!(s.mother_name || s.father_name || s.mother_phone || s.father_phone);
const yearOf = (s) => (s.birth ? String(s.birth).slice(0, 4) : (s.birth_year ? String(s.birth_year) : ""));

/** except 로 넘긴 칸의 필터는 빼고 거릅니다 (그 칸 목록의 «몇 명» 을 셀 때 씁니다) */
function filtered(except) {
  const on = (k) => k !== except && f[k];
  const q = on("q") ? f.q.trim().toLowerCase() : "";
  let rows = state.students.filter((s) => {
    const st = statusOf(s);
    if (on("grade") && gradeOf(s) !== f.grade) return false;
    if (on("gender") && s.gender !== f.gender) return false;
    if (on("school") && (f.school === "__none" ? !!s.school : s.school !== f.school)) return false;
    if (on("birthYear") && yearOf(s) !== f.birthYear) return false;
    if (on("phone") && (f.phone === "있음") !== !!s.phone) return false;
    if (on("guardian") && (f.guardian === "있음") !== hasGuardian(s)) return false;
    if (on("note") && (f.note === "있음") !== !!s.note) return false;
    if (f.status === "재학") { if (st !== "재적" && st !== "장기결석") return false; }
    else if (f.status && st !== f.status) return false;
    const cid = cellIdOf(s.id);
    if (on("cell")) {
      if (f.cell === "__none") { if (cid) return false; }
      else if (cid !== f.cell) return false;
    }
    if (!q) return true;
    return [s.name, s.school, s.phone, s.mother_name, s.mother_phone,
            s.father_name, s.father_phone, s.address, s.note, s.siblings]
      .some((v) => String(v || "").toLowerCase().includes(q));
  });
  const key = f.sort;
  rows.sort((a, b) => {
    let x = a[key], y = b[key];
    if (key === "grade") { x = GRADES.indexOf(gradeOf(a)); y = GRADES.indexOf(gradeOf(b)); }
    if (key === "cell_id") { x = cellNameOf(a.id) || "힣"; y = cellNameOf(b.id) || "힣"; }
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === "number" ? x - y : byName(x, y)) * f.dir;
  });
  return rows;
}

function draw(root) {
  const rows = filtered();
  const total = state.students.filter((s) => ["재적", "장기결석"].includes(statusOf(s))).length;
  root.querySelector("#count").innerHTML = anyFilter()
    ? `<b>${rows.length}명</b> <span style="color:var(--text-muted)">/ ${total}명</span>`
    : `${rows.length}명`;
  syncTopFilters(root);
  const wrap = root.querySelector("#tableWrap");
  const admin = isLoggedIn();

  if (!rows.length) {
    wrap.innerHTML = `
      <table class="data"><thead><tr>${headRow(admin)}</tr></thead></table>
      <div class="empty">조건에 맞는 아이가 없습니다.
        ${anyFilter() ? `<div style="margin-top:10px">
          <button class="btn btn-sm" id="clearAll">필터 모두 지우기</button></div>` : ""}</div>`;
    bindHead(wrap, root);
    return;
  }

  wrap.innerHTML = `
  <table class="data">
    <thead><tr>${headRow(admin)}</tr></thead>
    <tbody>
      ${rows.map((s, i) => `
      <tr class="clickable" data-id="${s.id}">
        <td class="num" title="교적 번호 ${s.seq ?? "-"}">${i + 1}</td>
        <td><span style="display:inline-flex;align-items:center;gap:8px">
            ${avatar(s.name, photoOf(s.id), 26)}
            <b>${esc(s.name)}</b></span>${showSkyBadge() && s.is_promoted
              ? ' <span class="badge blue" title="초등부 하늘아이에서 올라온 아이">하늘아이</span>' : ""}
            ${statusOf(s) === "장기결석" ? ' <span class="badge warn">장기결석</span>' : ""}
            ${statusOf(s) === "졸업" ? ' <span class="badge">졸업</span>' : ""}</td>
        <td>${dash(s.gender)}</td>
        <td${gradeOf(s) ? ` title="${esc(gradeWithYear(s))}"` : ""}>${gradeOf(s) ? esc(gradeOf(s)) : dash(null)}${
          s.grade ? ' <span class="badge" title="직접 적어둔 학년입니다">고정</span>' : ""}</td>
        <td>${dash(s.school)}</td>
        <td class="num">${s.birth ? esc(s.birth)
          : (s.birth_year ? `<span title="월·일은 아직 모릅니다">${esc(s.birth_year)}년</span>` : "—")}</td>
        <td>${cellNameOf(s.id) ? esc(cellNameOf(s.id)) : '<span class="badge">미배정</span>'}</td>
        ${isMasked() ? "" : `<td>${telLink(s.phone)}</td>
        <td>${guardian(s)}</td>
        <td class="wrap" style="color:var(--text-secondary)">${dash(s.note)}</td>`}
        ${admin ? `<td><button class="btn btn-ghost btn-sm" data-edit="${s.id}">편집</button></td>` : ""}
      </tr>`).join("")}
    </tbody>
  </table>`;

  bindHead(wrap, root);
  wrap.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("a,[data-edit]")) return;
    showStudent(state.students.find((s) => s.id === tr.dataset.id), () => draw(root));
  }));
  wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () =>
    editStudent(state.students.find((s) => s.id === b.dataset.edit), () => draw(root))));
}

// ── 표 머리 (정렬 + 칸마다 필터) ──────────────────────────
//   위쪽 드롭다운과 «같은 값» 을 쓰므로 어느 쪽에서 걸든 함께 움직입니다.
const COLS = [
  { key: "seq",     label: "#" },
  { key: "name",    label: "이름",     filter: "q" },
  { key: "gender",  label: "성별",     filter: "gender" },
  { key: "grade",   label: "학년",     filter: "grade" },
  { key: "school",  label: "학교",     filter: "school" },
  { key: "birth",   label: "생년월일", filter: "birthYear" },
  { key: "cell_id", label: "셀",       filter: "cell" },
  { key: "phone",   label: "전화번호", filter: "phone",    masked: true },
  { key: "guardian", label: "보호자",  filter: "guardian", masked: true },
  { key: "note",    label: "특이사항", filter: "note",     masked: true },
];

/** 그 칸에서 고를 수 있는 것들 — [값, 보이는 글자] (개수는 따로 셉니다) */
function choicesFor(key) {
  const pool = filtered(key);
  const count = (fn) => pool.filter(fn).length;
  const uniq = (get) => [...new Set(pool.map(get).filter(Boolean))];
  switch (key) {
    case "gender":
      return [["남", "남", count((s) => s.gender === "남")], ["여", "여", count((s) => s.gender === "여")]];
    case "grade":
      return GRADES.map((g) => [g, g, count((s) => gradeOf(s) === g)]).filter((r) => r[2]);
    case "school": {
      const list = uniq((s) => s.school).sort((a, b) => byName(a, b))
        .map((v) => [v, v, count((s) => s.school === v)]);
      const none = count((s) => !s.school);
      return none ? [...list, ["__none", "학교 미등록", none]] : list;
    }
    case "birthYear":
      return uniq(yearOf).sort().reverse().map((y) => [y, `${y}년생`, count((s) => yearOf(s) === y)]);
    case "cell": {
      const list = versionCells().map((c) => [c.id, c.name, count((s) => cellIdOf(s.id) === c.id)])
        .filter((r) => r[2]);
      const none = count((s) => !cellIdOf(s.id));
      return none ? [...list, ["__none", "미배정", none]] : list;
    }
    case "phone":
      return [["있음", "번호 있음", count((s) => !!s.phone)], ["없음", "번호 없음", count((s) => !s.phone)]]
        .filter((r) => r[2]);
    case "guardian":
      return [["있음", "보호자 있음", count(hasGuardian)], ["없음", "보호자 없음", count((s) => !hasGuardian(s))]]
        .filter((r) => r[2]);
    case "note":
      return [["있음", "특이사항 있음", count((s) => !!s.note)], ["없음", "없음", count((s) => !s.note)]]
        .filter((r) => r[2]);
    default: return [];
  }
}

/** 지금 걸려 있는 값을 사람 말로 */
function activeLabel(key) {
  const v = f[key];
  if (!v) return "";
  if (key === "q") return `"${f.q}"`;
  const hit = choicesFor(key).find((c) => c[0] === v);
  return hit ? hit[1] : v;
}

function headRow(admin) {
  return COLS.filter((c) => !(c.masked && isMasked()))
    .map((c) => {
      const sorted = f.sort === c.key;
      const on = c.filter && f[c.filter];
      return `
      <th class="hcol${on ? " filtered" : ""}">
        <button class="hsort${sorted ? " on" : ""}" data-sort="${c.key}"
          title="이 칸으로 정렬">${esc(c.label)}${sorted ? (f.dir > 0 ? " ↑" : " ↓") : ""}</button>
        ${c.filter ? `<button class="hfil${on ? " on" : ""}" data-filter="${c.filter}"
          title="${on ? esc(activeLabel(c.filter)) + " — 눌러서 바꾸기" : "이 칸으로 거르기"}">▾</button>` : ""}
        ${on ? `<span class="hchip" title="${esc(activeLabel(c.filter))}">${esc(activeLabel(c.filter))}
          <b data-clear="${c.filter}" title="이 필터만 지우기">✕</b></span>` : ""}
      </th>`;
    }).join("") + (admin ? "<th></th>" : "");
}

/** 표 머리의 정렬·필터 버튼 연결 */
function bindHead(wrap, root) {
  wrap.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.sort;
    if (f.sort === k) f.dir *= -1; else { f.sort = k; f.dir = 1; }
    draw(root);
  }));
  wrap.querySelectorAll("[data-clear]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    f[b.dataset.clear] = ""; draw(root);
  }));
  wrap.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    openHeadFilter(b, b.dataset.filter, root);
  }));
  wrap.querySelector("#clearAll")?.addEventListener("click", () => {
    for (const k of ACTIVE) f[k] = "";
    f.status = "재학";
    draw(root);
  });
}

/** 칸 머리 ▾ 를 누르면 뜨는 작은 목록 */
function openHeadFilter(btn, key, root) {
  document.querySelector(".hpop")?.remove();
  const pop = document.createElement("div");
  pop.className = "hpop";
  const cur = f[key];

  if (key === "q") {
    pop.innerHTML = `
      <div class="hpop-head">이름·학교·연락처로 찾기</div>
      <div class="searchbar" style="margin:0 8px 8px"><span class="s-ico">🔍</span>
        <input type="search" id="hq" value="${esc(f.q)}" placeholder="예: 홍길동"></div>
      <button class="hpop-item${cur ? "" : " on"}" data-v="">전체 보기</button>`;
  } else {
    const list = choicesFor(key);
    pop.innerHTML = `
      <div class="hpop-head">${esc(COLS.find((c) => c.filter === key)?.label || "")} 고르기</div>
      <div class="hpop-list">
        <button class="hpop-item${cur ? "" : " on"}" data-v="">전체 <span>${filtered(key).length}</span></button>
        ${list.map(([v, t, n]) => `
          <button class="hpop-item${cur === v ? " on" : ""}" data-v="${esc(v)}">
            ${esc(t)} <span>${n}</span></button>`).join("")}
      </div>`;
  }

  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.top = `${window.scrollY + r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left - 8,
    window.scrollX + window.innerWidth - pop.offsetWidth - 8))}px`;

  const close = () => { pop.remove(); document.removeEventListener("click", onOut, true);
                        document.removeEventListener("keydown", onKey); };
  const onOut = (e) => { if (!pop.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  setTimeout(() => {
    document.addEventListener("click", onOut, true);
    document.addEventListener("keydown", onKey);
  }, 0);

  pop.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => {
    f[key] = b.dataset.v;
    if (key === "q" && !b.dataset.v) f.q = "";
    close(); draw(root);
  }));
  const qi = pop.querySelector("#hq");
  if (qi) {
    qi.focus();
    qi.addEventListener("input", () => { f.q = qi.value; draw(root); });
    qi.addEventListener("keydown", (e) => { if (e.key === "Enter") close(); });
  }
}

/** 표 머리에서 건 것을 위쪽 칸에도 그대로 보이게 */
function syncTopFilters(root) {
  const q = root.querySelector("#q");
  if (q && q.value !== f.q) q.value = f.q;
  for (const k of ["grade", "gender", "cell", "status"]) {
    const el = root.querySelector("#" + k);
    if (el && el.value !== f[k]) el.value = f[k];
  }
}

function guardian(s) {
  const parts = [];
  if (s.mother_name) parts.push(`모 ${esc(s.mother_name)}`);
  if (s.father_name) parts.push(`부 ${esc(s.father_name)}`);
  return parts.length ? parts.join(" · ") : dash("");
}

// ── 상세 보기 ────────────────────────────────────────────
export function showStudent(s, after) {
  if (!s) return;
  const admin = isLoggedIn();
  modal({
    title: `${s.name} · ${gradeOf(s) || ""}`,
    body: `
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:18px">
        ${avatar(s.name, photoOf(s.id), 76)}
        <div>
          <div style="font-size:19px;font-weight:680">${esc(s.name)}</div>
          <div style="font-size:13px;color:var(--text-secondary)">
            ${esc([s.gender, gradeOf(s), s.school].filter(Boolean).join(" · "))}</div>
          ${!isLoggedIn() && !photoOf(s.id)
            ? '<div style="font-size:12px;color:var(--text-muted);margin-top:3px">🔒 사진은 로그인한 교사진에게만 보입니다</div>' : ""}
        </div>
      </div>
      <div class="detail-grid">
        <dt>이름</dt><dd><b>${esc(s.name)}</b>
          ${showSkyBadge() && s.is_promoted ? ' <span class="badge blue" title="초등부 하늘아이에서 올라온 아이">하늘아이</span>' : ""}
          ${statusOf(s) !== "재적" ? ` <span class="badge warn">${esc(statusOf(s))}</span>` : ""}</dd>
        <dt>성별 · 학년</dt><dd>${dash([s.gender, gradeOf(s)].filter(Boolean).join(" · "))}
          ${gradeOf(s) ? `<span style="color:var(--text-muted);font-size:12px">· ${esc(gradeWithYear(s))}${
            isAutoGrade(s) ? " · 자동" : " · 직접 지정"}</span>` : ""}</dd>
        <dt>학교</dt><dd>${dash(s.school)}</dd>
        <dt>생년월일</dt><dd>${s.birth ? esc(fmtBirth(s.birth))
          : (s.birth_year ? `${esc(s.birth_year)}년 <span style="color:var(--text-muted);font-size:12px">(월·일 미등록)</span>`
                          : dash(""))}</dd>
        <dt>연락처</dt><dd>${isMasked() ? lockNote() : telLink(s.phone)}</dd>
        <dt>셀</dt><dd>${cellNameOf(s.id) ? esc(cellNameOf(s.id)) : '<span class="badge">미배정</span>'}
          <span style="color:var(--text-muted);font-size:12px">(${esc(currentVersion()?.label || "")})</span>
          ${isLoggedIn() ? '<button class="btn btn-ghost btn-sm" data-move>셀 옮기기</button>' : ""}</dd>
      </div>
      <div class="section-label">가정</div>
      ${isMasked() ? `<div class="form-note" style="margin:0">
        보호자 연락처와 집주소는 <b>로그인한 교사진에게만</b> 보입니다.</div>`
      : `<div class="detail-grid">
        <dt>어머니</dt><dd>${dash(s.mother_name)} ${s.mother_phone ? "· " + telLink(s.mother_phone) : ""}</dd>
        <dt>아버지</dt><dd>${dash(s.father_name)} ${s.father_phone ? "· " + telLink(s.father_phone) : ""}</dd>
        <dt>형제관계</dt><dd>${dash(s.siblings)}</dd>
        <dt>집주소</dt><dd>${dash(s.address)}</dd>
      </div>
      <div class="section-label">특이사항</div>
      <div style="font-size:14px">${s.note ? esc(s.note) : '<span style="color:var(--text-muted)">기록된 특이사항이 없습니다.</span>'}</div>`}`,
    footer: admin
      ? `<button class="btn btn-danger" data-del>삭제</button>
         <div style="flex:1"></div>
         <button class="btn" data-close>닫기</button>
         <button class="btn btn-primary" data-edit>편집</button>`
      : `<button class="btn" data-close>닫기</button>`,
    onMount(box, close) {
      box.querySelector("[data-edit]")?.addEventListener("click", () => { close(); editStudent(s, after); });
      box.querySelector("[data-move]")?.addEventListener("click", () => { close(); moveStudent(s, after); });
      box.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!(await confirmDialog(`${s.name} 학생의 교적을 삭제할까요? 되돌릴 수 없습니다.`))) return;
        try { await api.deleteStudent(s.id); await api.refresh(); close(); after?.(); toast("삭제했습니다."); }
        catch (e) { toast(e.message, "err"); }
      });
    },
  });
}

// ── 등록 / 편집 ──────────────────────────────────────────
export function editStudent(s, after) {
  const isNew = !s?.id;
  s = { status: "재적", is_promoted: false, ...(s || {}) };
  const form = document.createElement("form");
  form.id = "stForm";
  let pendingPhoto = null;      // 저장을 눌러야 실제로 올라갑니다
  let removePhoto = false;
  form.innerHTML = `
    ${isNew ? "" : `
    <div class="photo-edit" style="margin-bottom:18px">
      <label class="photo-drop" title="사진 바꾸기" id="photoBox">
        ${avatar(s.name, photoOf(s.id), 76)}
        <input type="file" accept="image/*" id="photoFile" style="display:none">
      </label>
      <div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="pickPhoto">사진 올리기</button>
          ${photoOf(s.id) ? `<button type="button" class="btn btn-sm btn-danger" id="dropPhoto">사진 지우기</button>` : ""}
        </div>
        <div class="hintbox" style="margin-top:6px">
          사진을 고르면 <b>위치와 크기를 맞추는 창</b>이 열립니다.<br>
          사진은 <b>로그인한 교사진에게만</b> 보입니다.
        </div>
      </div>
    </div>`}
    <div class="grid grid-3">
      ${fld("이름", `<input type="text" name="name" required value="${esc(s.name)}">`)}
      ${fld("성별", sel("gender", ["", "남", "여"], s.gender))}
      ${fld("학년", `<select name="grade">
        <option value="">자동 (나이로 계산)</option>
        ${GRADES.map((g) => `<option value="${g}"${s.grade === g ? " selected" : ""}>${g} (고정)</option>`).join("")}
      </select><span class="hint" id="gradeHint"></span>`)}
    </div>
    <div class="grid grid-3" style="margin-top:12px">
      ${fld("학교", `<input type="text" name="school" value="${esc(s.school)}">`)}
      ${fld("생년월일", `<input type="date" name="birth" value="${esc(s.birth)}">
        <span class="hint">모르면 비워두고 옆에 <b>태어난 해</b>만 적어도 됩니다.</span>`)}
      ${fld("태어난 해", `<input type="number" name="birth_year" inputmode="numeric"
        min="1900" max="2100" step="1" placeholder="예: 2013" value="${esc(s.birth_year)}">
        <span class="hint">생년월일을 적으면 이 칸은 쓰지 않습니다.</span>`)}
    </div>
    <div class="grid grid-3" style="margin-top:12px">
      ${fld("전화번호", `<input type="tel" name="phone" placeholder="010-0000-0000" value="${esc(s.phone)}">`)}
    </div>
    <div class="section-label">가정</div>
    <div class="grid grid-2">
      ${fld("어머니 성함", `<input type="text" name="mother_name" value="${esc(s.mother_name)}">`)}
      ${fld("어머니 연락처", `<input type="tel" name="mother_phone" value="${esc(s.mother_phone)}">`)}
      ${fld("아버지 성함", `<input type="text" name="father_name" value="${esc(s.father_name)}">`)}
      ${fld("아버지 연락처", `<input type="tel" name="father_phone" value="${esc(s.father_phone)}">`)}
    </div>
    <div style="margin-top:12px">${fld("형제관계", `<input type="text" name="siblings" placeholder="예: 홍길순(동생)" value="${esc(s.siblings)}">`)}</div>
    <div style="margin-top:12px">${fld("집주소", `<input type="text" name="address" value="${esc(s.address)}">`)}</div>
    <div class="section-label">교적 관리</div>
    <div class="grid grid-2">
      ${fld("상태", `<select name="status">
        ${[["재적", "재적 — 지금 잘 나옴"],
           ["장기결석", "장기결석 — 오래 못 봄 (계속 챙길 아이)"],
           ["전출", "전출 — 다른 교회로 옮김"]].map(([v, t]) =>
          `<option value="${v}"${(s.status || "재적") === v ? " selected" : ""}>${t}</option>`).join("")}
      </select><span class="hint">«졸업»은 고3을 지나면 자동이라 여기 없습니다.
        장기결석도 셀편성에는 그대로 남습니다.</span>`)}
      ${fld("하늘아이", `<label style="display:flex;gap:8px;align-items:center;cursor:pointer;
        padding:7px 0;font-size:14px">
        <input type="checkbox" name="is_promoted" style="width:auto"${s.is_promoted ? " checked" : ""}>
        <span>초등부 하늘아이에서 올라옴</span></label>`)}
    </div>
    <div class="form-note" style="margin-top:12px">
      셀 배정은 <b>셀편성</b> 화면에서 편집한 뒤 저장하면 버전으로 기록됩니다.
    </div>
    <div style="margin-top:12px">${fld("특이사항", `<textarea name="note" placeholder="알레르기, 건강, 기타 참고사항">${esc(s.note)}</textarea>`)}</div>`;

  modal({
    title: isNew ? "학생 등록" : `${s.name} 편집`,
    body: form,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="stForm" type="submit">저장</button>`,
    onMount(box, close) {
      const gradeSel = box.querySelector('select[name="grade"]');
      const birthEl = box.querySelector('input[name="birth"]');
      const yearEl = box.querySelector('input[name="birth_year"]');
      const hint = box.querySelector("#gradeHint");
      const syncHint = () => {
        if (!hint) return;
        const auto = autoGrade(birthEl?.value || yearEl?.value);
        hint.innerHTML = gradeSel.value
          ? `직접 적은 학년으로 표시됩니다. 자동이면 <b>${esc(auto || "계산 불가")}</b> 입니다.`
          : (auto ? `${schoolYear()}학년도 기준 <b>${esc(auto)}</b> 로 표시되고, 해마다 저절로 올라갑니다.`
                  : "생년월일(또는 태어난 해)이 없으면 자동 계산이 안 됩니다. 학년을 직접 골라 주세요.");
      };
      gradeSel?.addEventListener("change", syncHint);
      birthEl?.addEventListener("input", syncHint);
      yearEl?.addEventListener("input", syncHint);
      syncHint();

      const fileEl = box.querySelector("#photoFile");
      const boxEl = box.querySelector("#photoBox");
      box.querySelector("#pickPhoto")?.addEventListener("click", () => fileEl.click());
      fileEl?.addEventListener("change", async () => {
        const f = fileEl.files?.[0];
        if (!f) return;
        try {
          pendingPhoto = await cropImage(f);
          if (!pendingPhoto) { fileEl.value = ""; return; }
          removePhoto = false;
          const { blobToDataURL } = await import("../ui.js");
          boxEl.querySelector(".ava")?.replaceWith(
            Object.assign(document.createElement("span"), {
              className: "ava",
              style: "width:76px;height:76px",
              innerHTML: `<img src="${await blobToDataURL(pendingPhoto)}" alt="">`,
            }));
          toast("저장을 누르면 반영됩니다.");
        } catch (err) { toast(err.message, "err"); }
      });
      box.querySelector("#dropPhoto")?.addEventListener("click", () => {
        removePhoto = true; pendingPhoto = null;
        boxEl.innerHTML = avatar(s.name, null, 76) + boxEl.querySelector("input").outerHTML;
        toast("저장을 누르면 사진이 지워집니다.");
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        const row = { ...fd };
        row.is_promoted = fd.is_promoted === "on";
        for (const k of Object.keys(row)) if (row[k] === "") row[k] = null;
        // 생년월일을 적었으면 «태어난 해» 는 따로 저장하지 않습니다 (한 곳만 보게)
        row.birth_year = row.birth ? null : (Number(row.birth_year) || null);
        if (!isNew) { row.id = s.id; row.seq = s.seq; }
        try {
          const saved = await api.saveStudent(row);
          if (pendingPhoto) await api.uploadPhoto(saved?.id || s.id, pendingPhoto);
          else if (removePhoto) await api.removePhoto(s.id);
          await api.refresh();
          close(); after?.();
          toast(isNew ? "등록했습니다." : "저장했습니다.");
        } catch (err) { toast(err.message, "err"); }
      });
    },
  });
}

const lockNote = () => '<span style="color:var(--text-muted)">🔒 로그인 후 표시</span>';
const fld = (label, input) => `<div class="field"><label>${esc(label)}</label>${input}</div>`;
const sel = (name, list, cur) =>
  `<select name="${name}">${list.map((v) =>
    `<option value="${esc(v)}"${(cur || "") === v ? " selected" : ""}>${esc(v || "선택 안 함")}</option>`).join("")}</select>`;


