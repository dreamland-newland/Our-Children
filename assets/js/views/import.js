// ============================================================
//  파일 가져오기 — 엑셀/CSV를 던지면 알아서 정리해서 교적부에 반영
//  · 한글 헤더 자동 인식 (띄어쓰기·순서·별칭 허용)
//  · 셀편성 격자(담당자별 블록)도 자동 인식 → 새 버전으로 등록
//  · 반영 전 신규 / 변경 / 동일 미리보기 후 확인
// ============================================================
import { state, api, isLoggedIn, currentVersion, cellIdOf, uid, autoGrade } from "../data.js";
import { esc, toast, digits, modal, confirmDialog } from "../ui.js";
import { GRADES, DEFAULT_TERM_LABEL } from "../config.js";
import { loadXLSX } from "../xlsx.js";

let sheets = [];        // 분석 결과
let fileName = "";

// ── 헤더 별칭 사전 ────────────────────────────────────────
const ALIASES = {
  name:         ["이름", "성명", "학생명", "성함", "name"],
  gender:       ["성별", "남녀", "gender"],
  grade:        ["학년", "grade"],
  school:       ["학교", "재학학교", "학교명", "school"],
  birth:        ["생년월일", "생일", "출생일", "생년", "birth", "birthday"],
  phone:        ["전화번호", "연락처", "휴대폰", "휴대폰번호", "핸드폰", "본인연락처", "학생연락처", "phone"],
  mother_name:  ["어머니성함", "어머니이름", "모성함", "어머니", "모친", "母"],
  mother_phone: ["어머니연락처", "어머니전화", "어머니번호", "모연락처", "어머니휴대폰"],
  father_name:  ["아버지성함", "아버지이름", "부성함", "아버지", "부친", "父"],
  father_phone: ["아버지연락처", "아버지전화", "아버지번호", "부연락처", "아버지휴대폰"],
  siblings:     ["형제관계", "형제자매", "형제", "자매"],
  address:      ["집주소", "주소", "거주지", "address"],
  note:         ["비고특이사항", "비고", "특이사항", "메모", "참고", "note"],
  cell:         ["셀", "셀이름", "소속셀", "셀명", "담당", "담당교사", "담당간사"],
  status:       ["상태", "재적상태"],
  role:         ["구분", "역할", "직분", "직책"],
  seq:          ["연번", "번호", "no", "순번"],
  promoted:     ["하늘아이", "진급자", "예비중1"],
};

const norm = (v) => String(v ?? "").replace(/[\s()（）/·.\-_]/g, "").toLowerCase();

function matchField(header) {
  const h = norm(header);
  if (!h) return null;
  for (const [field, list] of Object.entries(ALIASES)) {
    for (const a of list) {
      const n = norm(a);
      if (h === n) return field;
    }
  }
  // 부분 일치 (긴 별칭 우선)
  const pairs = Object.entries(ALIASES)
    .flatMap(([f, l]) => l.map((a) => [f, norm(a)]))
    .sort((a, b) => b[1].length - a[1].length);
  for (const [f, n] of pairs) if (n.length >= 2 && h.includes(n)) return f;
  return null;
}

// ── 값 정리 ───────────────────────────────────────────────
function cleanDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v))
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
/** 연도만 적힌 칸 (2013 / 2013년) → 2013 */
function cleanYear(v) {
  if (v === null || v === undefined || v === "") return null;
  const m = String(v).trim().match(/^(\d{4})\s*년?$/);
  const y = m ? Number(m[1]) : null;
  return y && y >= 1900 && y <= 2100 ? y : null;
}
function cleanPhone(v) {
  const d = digits(v);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d ? String(v).trim() : null;
}
function cleanGrade(v) {
  const s = String(v ?? "").replace(/\s/g, "");
  if (!s) return null;
  if (GRADES.includes(s)) return s;
  const m = s.match(/(예비)?\s*([중고])\s*(\d)/);
  if (m) return `${m[1] ? "예비" : ""}${m[2]}${m[3]}`;
  if (/^\d$/.test(s)) return null;
  return s;
}
const cleanText = (v) => {
  const s = String(v ?? "").trim();
  return s === "" || s === "-" ? null : s;
};
const nameKey = (n) => String(n || "").replace(/\s/g, "").trim();

// ════════════════════════════════════════════════════════════
//  시트 분석
// ════════════════════════════════════════════════════════════
function analyzeSheet(title, aoa) {
  // 1) 셀편성 격자인가? — 한 행에 '이름' 이 2번 이상 등장
  for (let r = 0; r < Math.min(aoa.length, 12); r++) {
    const nameCols = aoa[r].map((c, i) => (norm(c) === "이름" ? i : -1)).filter((i) => i >= 0);
    if (nameCols.length >= 2) return parseCellGrid(title, aoa);
  }

  // 2) 헤더 행 찾기 — '이름' 이 있는 첫 행
  let hr = -1;
  for (let r = 0; r < Math.min(aoa.length, 15); r++) {
    if (aoa[r].some((c) => matchField(c) === "name")) { hr = r; break; }
  }
  if (hr < 0) return { title, kind: "unknown", reason: "‘이름’ 열을 찾지 못했습니다." };

  const map = {};
  aoa[hr].forEach((c, i) => { const f = matchField(c); if (f && !(f in map)) map[f] = i; });

  const records = [];
  for (let r = hr + 1; r < aoa.length; r++) {
    const row = aoa[r];
    const name = cleanText(row[map.name]);
    if (!name || norm(name) === "이름") continue;
    const rec = { name };
    for (const [f, i] of Object.entries(map)) {
      if (f === "name" || f === "seq") continue;
      const raw = row[i];
      if (f === "birth") { rec.birth = cleanDate(raw); if (!rec.birth) rec.birth_year = cleanYear(raw); }
      else if (f.endsWith("phone")) rec[f] = cleanPhone(raw);
      else if (f === "grade") rec.grade = cleanGrade(raw);
      else if (f === "gender") {
        const g = cleanText(raw);
        rec.gender = g ? (g.startsWith("남") || g.toUpperCase() === "M" ? "남" : "여") : null;
      } else rec[f] = cleanText(raw);
    }
    for (const k of Object.keys(rec)) if (rec[k] === null) delete rec[k];
    records.push(rec);
  }

  // 3) 학생 명부인가, 교사 명부인가?
  const looksTeacher =
    /교사|간사|교역|선생|리더|스탭|스태프/.test(title) ||
    ("role" in map && !("grade" in map) && !("mother_name" in map));
  const kind = looksTeacher ? "teachers" : "students";
  const promoted = /진급|하늘아이|예비중1/.test(title);

  // 교사 명부에서 연도가 1900년 이하이면 '연도 미상' 으로 보고 월-일만 저장
  if (kind === "teachers") {
    for (const rec of records) {
      if (rec.birth && Number(rec.birth.slice(0, 4)) <= 1900) {
        rec.birth_md = rec.birth.slice(5);
        delete rec.birth;
      }
    }
  }

  return { title, kind, map, records, promoted, headerRow: hr };
}

/** 담당자 블록이 가로로 반복되는 셀편성 격자 */
function parseCellGrid(title, aoa) {
  const cells = [];
  for (let r = 0; r < aoa.length; r++) {
    const nameCols = aoa[r].map((c, i) => (norm(c) === "이름" ? i : -1)).filter((i) => i >= 0);
    if (nameCols.length < 1) continue;
    const headerRow = aoa[r];
    for (const col of nameCols) {
      // 담당자 이름: 위쪽 행에서 이 열(또는 근처)에 있는 값
      let leader = "";
      for (let up = r - 1; up >= Math.max(0, r - 3) && !leader; up--) {
        for (let c = col; c >= Math.max(0, col - 1); c--) {
          const v = cleanText(aoa[up]?.[c]);
          if (v && norm(v) !== "이름") { leader = v; break; }
        }
      }
      if (!leader) continue;

      // 이 블록의 열 매핑 (이름 오른쪽으로 최대 4칸)
      const sub = {};
      for (let c = col; c < Math.min(col + 5, headerRow.length); c++) {
        const f = matchField(headerRow[c]);
        if (f && !(f in sub)) sub[f] = c;
      }
      const members = [];
      for (let rr = r + 1; rr < aoa.length; rr++) {
        const v = cleanText(aoa[rr]?.[col]);
        if (!v) break;
        if (norm(v) === "이름") break;
        if (/선생님$|간사$|전도사$|목사$/.test(v)) break;
        members.push({
          name: v,
          grade: cleanGrade(aoa[rr][sub.grade]),
          birth: cleanDate(aoa[rr][sub.birth]),
          birth_year: cleanDate(aoa[rr][sub.birth]) ? null : cleanYear(aoa[rr][sub.birth]),
          phone: cleanPhone(aoa[rr][sub.phone]),
        });
      }
      if (members.length) cells.push({ name: leader, members });
    }
  }

  // '장기결석자' · '미배정' 처럼 머리글 없이 이름만 줄지어 있는 블록
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < (aoa[r] || []).length; c++) {
      const v = cleanText(aoa[r][c]);
      if (!v || !/^(장기결석자?|미배정|기타)$/.test(v.replace(/\s/g, ""))) continue;
      if (cells.some((x) => x.name === v)) continue;
      const members = [];
      for (let rr = r + 1; rr < aoa.length; rr++) {
        const n = cleanText(aoa[rr]?.[c]);
        if (!n || norm(n) === "이름") break;
        members.push({
          name: n,
          grade: cleanGrade(aoa[rr][c + 1]),
          birth: cleanDate(aoa[rr][c + 2]),
          birth_year: cleanDate(aoa[rr][c + 2]) ? null : cleanYear(aoa[rr][c + 2]),
          phone: cleanPhone(aoa[rr][c + 3]),
        });
      }
      if (members.length) cells.push({ name: v, members });
    }
  }
  return { title, kind: "cells", cells };
}

// ════════════════════════════════════════════════════════════
//  기존 데이터와 대조
// ════════════════════════════════════════════════════════════
const FIELD_LABEL = {
  gender: "성별", grade: "학년", school: "학교", birth: "생년월일", birth_year: "태어난 해",
  phone: "전화번호",
  mother_name: "어머니", mother_phone: "어머니연락처", father_name: "아버지",
  father_phone: "아버지연락처", siblings: "형제관계", address: "집주소",
  note: "특이사항", status: "상태", role: "구분", birth_md: "생일(월-일)",
};

function diffRecords(sheet) {
  const pool = sheet.kind === "teachers" ? state.teachers : state.students;
  const out = [];
  for (const rec of sheet.records) {
    if (sheet.kind !== "teachers" && rec.grade && autoGrade(rec.birth || rec.birth_year) === rec.grade) delete rec.grade;
    let hits = pool.filter((p) => nameKey(p.name) === nameKey(rec.name));
    if (hits.length > 1) {
      const narrowed = hits.filter((p) =>
        (rec.birth && p.birth === rec.birth) ||
        (rec.phone && digits(p.phone).slice(-8) === digits(rec.phone).slice(-8)));
      if (narrowed.length === 1) hits = narrowed;
    }
    if (!hits.length) { out.push({ rec, kind: "new", changes: [] }); continue; }
    if (hits.length > 1) { out.push({ rec, kind: "ambiguous", changes: [], target: null }); continue; }
    const t = hits[0];
    // 학년이 생년월일에서 계산되는 값과 같으면 굳이 저장하지 않습니다 (해마다 저절로 올라가도록).
    if (sheet.kind !== "teachers" && rec.grade &&
        autoGrade(rec.birth || rec.birth_year || t.birth || t.birth_year) === rec.grade)
      delete rec.grade;
    const changes = [];
    for (const [f, v] of Object.entries(rec)) {
      if (f === "name" || f === "cell" || v === null || v === undefined || v === "") continue;
      if (!(f in FIELD_LABEL)) continue;
      const before = t[f] ?? null;
      if (String(before ?? "") !== String(v)) changes.push({ f, before, after: v });
    }
    out.push({ rec, kind: changes.length ? "update" : "same", changes, target: t });
  }
  return out;
}

// ════════════════════════════════════════════════════════════
//  화면
// ════════════════════════════════════════════════════════════
export function html() {
  if (!isLoggedIn()) {
    return `
    <div class="page-head"><div><h1>파일로 가져오기</h1>
      <p>교적부에 자료를 반영하려면 로그인이 필요합니다.</p></div></div>
    <div class="card card-pad"><div class="empty">
      <a class="btn btn-primary" href="#/login">로그인</a></div></div>`;
  }

  return `
  <div class="page-head">
    <div>
      <h1>파일로 가져오기</h1>
      <p>엑셀(.xlsx)이나 CSV를 올리면 열 이름을 알아서 인식해 교적부에 반영합니다.</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-sm" id="tplBtn">양식 파일 받기</button>
    </div>
  </div>

  <div class="card" id="drop" style="border-style:dashed;border-width:2px;text-align:center;
       padding:44px 20px;cursor:pointer;transition:background .15s">
    <div style="font-size:34px;line-height:1">📄</div>
    <div style="font-weight:650;margin-top:10px">여기에 파일을 끌어다 놓거나 클릭해서 선택하세요</div>
    <div style="color:var(--text-muted);font-size:13px;margin-top:5px">
      .xlsx · .xls · .csv — 올려주신 출석부 형식(주소록 / 셀편성 / 진급자 / 교사간사)을 그대로 알아봅니다.</div>
    <input type="file" id="file" accept=".xlsx,.xls,.csv" style="display:none">
  </div>

  <div class="card card-pad" style="margin-top:16px;font-size:13px;color:var(--text-secondary)">
    <b>인식하는 열 이름</b> — 이름 · 성별 · 학년 · 학교 · 생년월일 · 전화번호(연락처·휴대폰) ·
    어머니성함/연락처 · 아버지성함/연락처 · 형제관계 · 집주소 · 비고(특이사항) · 셀 · 구분.
    띄어쓰기나 순서가 달라도 됩니다. 파일에 <b>없는 열은 기존 값을 그대로 둡니다.</b>
  </div>

  <div id="result" style="margin-top:16px"></div>`;
}

export function mount(root, rerender) {
  if (!isLoggedIn()) return;
  const drop = root.querySelector("#drop");
  const input = root.querySelector("#file");

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault(); drop.style.background = "var(--surface-2)";
  });
  drop.addEventListener("dragleave", () => { drop.style.background = ""; });
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.style.background = "";
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], root, rerender);
  });
  input.addEventListener("change", () => {
    if (input.files[0]) handleFile(input.files[0], root, rerender);
  });
  root.querySelector("#tplBtn").addEventListener("click", downloadTemplate);
}

async function handleFile(file, root, rerender) {
  const res = root.querySelector("#result");
  res.innerHTML = `<div class="card card-pad"><div class="empty">파일을 읽는 중…</div></div>`;
  try {
    const X = await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = X.read(buf, { type: "array", cellDates: true });
    fileName = file.name;
    sheets = wb.SheetNames.map((n) => {
      const aoa = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: true, defval: null });
      return analyzeSheet(n, aoa);
    });
    drawResult(root, rerender);
  } catch (e) {
    console.error(e);
    res.innerHTML = `<div class="card card-pad"><div class="form-error" style="margin:0">
      파일을 읽지 못했습니다: ${esc(e.message)}</div></div>`;
  }
}

function drawResult(root, rerender) {
  const res = root.querySelector("#result");
  const usable = sheets.filter((s) => s.kind !== "unknown");
  if (!usable.length) {
    res.innerHTML = `<div class="card card-pad"><div class="empty">
      알아볼 수 있는 표를 찾지 못했습니다. 첫 행에 <b>이름</b> 열이 있는지 확인해 주세요.</div></div>`;
    return;
  }

  res.innerHTML = `
    <div class="card card-pad" style="margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <b>${esc(fileName)}</b>
      <span style="color:var(--text-muted);font-size:13px">시트 ${sheets.length}개 중 ${usable.length}개 인식</span>
    </div>
    ${sheets.map((s, i) => sheetCard(s, i)).join("")}`;

  res.querySelectorAll("[data-apply]").forEach((b) => b.addEventListener("click", () =>
    applySheet(sheets[+b.dataset.apply], rerender)));
}

function sheetCard(s, i) {
  if (s.kind === "unknown") {
    return `<section class="card card-pad" style="margin-bottom:14px;opacity:.65">
      <b>${esc(s.title)}</b>
      <span style="color:var(--text-muted);font-size:13px"> · 건너뜀 — ${esc(s.reason)}</span>
    </section>`;
  }

  if (s.kind === "cells") {
    const total = s.cells.reduce((a, c) => a + c.members.length, 0);
    const unknown = s.cells.flatMap((c) => c.members)
      .filter((m) => !state.students.some((p) => nameKey(p.name) === nameKey(m.name)));
    return `
    <section class="card" style="margin-bottom:14px">
      <div class="card-head">
        <h3>${esc(s.title)} <span class="badge blue">셀편성</span></h3>
        <span class="sub">${s.cells.length}개 셀 · ${total}명</span>
      </div>
      <div class="card-pad">
        <div class="grid grid-auto" style="gap:8px">
          ${s.cells.map((c) => `<div style="border:1px solid var(--border);border-radius:8px;padding:9px 12px">
            <b style="font-size:13.5px">${esc(c.name)}</b>
            <span class="badge" style="float:right">${c.members.length}명</span>
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:4px">
              ${esc(c.members.map((m) => m.name).join(", "))}</div>
          </div>`).join("")}
        </div>
        ${unknown.length ? `<div class="form-note" style="margin-top:12px">
          교적부에 없는 이름 ${unknown.length}명 (${esc(unknown.map((u) => u.name).join(", "))})은
          <b>새 학생으로 함께 등록</b>됩니다.</div>` : ""}
        <div class="form-note" style="margin-top:12px">
          반영하면 <b>새 셀편성 버전</b>이 오늘 날짜로 만들어집니다. 기존 버전은 그대로 남습니다.</div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" data-apply="${i}">새 버전으로 반영하기</button></div>
    </section>`;
  }

  const diffs = diffRecords(s);
  s._diffs = diffs;
  const n = (k) => diffs.filter((d) => d.kind === k).length;
  const label = s.kind === "teachers" ? "교사·간사 명부" : (s.promoted ? "진급자(하늘아이)" : "학생 교적");

  return `
  <section class="card" style="margin-bottom:14px">
    <div class="card-head">
      <h3>${esc(s.title)} <span class="badge ${s.kind === "teachers" ? "orange" : "blue"}">${label}</span></h3>
      <span class="sub">
        <span class="badge good">신규 ${n("new")}</span>
        <span class="badge warn">변경 ${n("update")}</span>
        <span class="badge">동일 ${n("same")}</span>
        ${n("ambiguous") ? `<span class="badge crit">확인필요 ${n("ambiguous")}</span>` : ""}
      </span>
    </div>
    <div class="table-wrap" style="max-height:420px;overflow:auto">
      <table class="data">
        <thead><tr><th>구분</th><th>이름</th><th>내용</th></tr></thead>
        <tbody>
          ${diffs.map((d) => `
          <tr>
            <td>${badgeFor(d.kind)}</td>
            <td><b>${esc(d.rec.name)}</b></td>
            <td class="wrap" style="color:var(--text-secondary)">
              ${d.kind === "new"
                ? esc(Object.entries(d.rec).filter(([k]) => k !== "name")
                    .map(([k, v]) => `${FIELD_LABEL[k] || k} ${v}`).join(" · ") || "이름만")
                : d.kind === "update"
                ? d.changes.map((c) => `${esc(FIELD_LABEL[c.f] || c.f)}
                    <s style="opacity:.55">${esc(c.before ?? "(없음)")}</s> →
                    <b>${esc(c.after)}</b>`).join(" · ")
                : d.kind === "ambiguous"
                ? "같은 이름이 여러 명입니다 — 반영하지 않습니다. 생년월일이나 전화번호를 함께 넣어 주세요."
                : "바뀐 내용 없음"}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="modal-foot">
      <span style="margin-right:auto;font-size:12.5px;color:var(--text-muted)">
        파일에 없는 열은 기존 값을 유지합니다.</span>
      <button class="btn btn-primary" data-apply="${i}"
        ${n("new") + n("update") === 0 ? "disabled" : ""}>
        ${n("new") + n("update")}건 반영하기</button>
    </div>
  </section>`;
}

const badgeFor = (k) => ({
  new: '<span class="badge good">신규</span>',
  update: '<span class="badge warn">변경</span>',
  same: '<span class="badge">동일</span>',
  ambiguous: '<span class="badge crit">확인필요</span>',
}[k]);

// ════════════════════════════════════════════════════════════
//  반영
// ════════════════════════════════════════════════════════════
async function applySheet(s, rerender) {
  if (s.kind === "cells") return applyCells(s, rerender);

  const diffs = s._diffs || diffRecords(s);
  const todo = diffs.filter((d) => d.kind === "new" || d.kind === "update");
  if (!todo.length) return;
  if (!(await confirmDialog(
    `${todo.length}건을 교적부에 반영할까요? (신규 ${todo.filter((d) => d.kind === "new").length}건 · ` +
    `변경 ${todo.filter((d) => d.kind === "update").length}건)`,
    { danger: false, okText: "반영하기" }))) return;

  try {
    for (const d of todo) {
      const base = d.kind === "update" ? { ...d.target } : {};
      const row = { ...base, ...d.rec };
      delete row.cell;
      if (s.kind === "students") {
        if (s.promoted) row.is_promoted = true;
        row.status ||= "재적";
        const saved = await api.saveStudent(row);
        // 파일에 '셀' 열이 있으면 현재 버전에 배정
        if (d.rec.cell && currentVersion()) {
          const c = state.cells.find(
            (x) => x.version_id === state.versionId && nameKey(x.name) === nameKey(d.rec.cell));
          if (c) await api.setMembership(saved.id, c.id);
        }
      } else {
        row.role ||= "간사";
        await api.saveTeacher(row);
      }
    }
    await api.refresh();
    toast(`${todo.length}건을 반영했습니다.`);
    rerender();
  } catch (e) {
    console.error(e);
    toast("반영 중 오류: " + e.message, "err");
  }
}

async function applyCells(s, rerender) {
  const label = prompt("새 셀편성 버전의 이름을 정해 주세요.", DEFAULT_TERM_LABEL);
  if (label === null) return;
  try {
    // 1) 없는 학생 먼저 등록
    for (const c of s.cells) {
      for (const m of c.members) {
        if (state.students.some((p) => nameKey(p.name) === nameKey(m.name))) continue;
        await api.saveStudent({
          name: m.name,
          grade: m.grade && autoGrade(m.birth || m.birth_year) !== m.grade ? m.grade : null,
          birth: m.birth || null, birth_year: m.birth ? null : (m.birth_year || null),
          phone: m.phone || null, status: "재적", is_promoted: false,
        });
      }
    }
    await api.refresh();

    // 2) 버전 + 셀 + 소속
    const v = await api.saveVersion({
      label: (label || DEFAULT_TERM_LABEL).trim(),
      note: `${fileName} 에서 가져옴`,
      created_by_name: state.profile?.name || null,
    });
    const made = await api.saveCells(s.cells.map((c, i) => ({
      version_id: v.id, name: c.name, sort_order: i + 1,
      kind: /장기결석|미배정/.test(c.name) ? "장기결석" : "셀",
      leaders: /장기결석|미배정/.test(c.name)
        ? [] : c.name.split("/").map((x) => x.replace(/\s*(선생님|간사|전도사|목사)\s*$/, "").trim()).filter(Boolean),
    })));
    const rows = [];
    made.forEach((cell, i) => {
      for (const m of s.cells[i].members) {
        const st = state.students.find((p) => nameKey(p.name) === nameKey(m.name));
        if (st) rows.push({ version_id: v.id, cell_id: cell.id, student_id: st.id });
      }
    });
    await api.saveMembers(rows);
    await api.refresh();
    state.versionId = v.id;
    toast(`새 셀편성 버전(${v.label})을 만들었습니다.`);
    location.hash = "#/cells";
  } catch (e) {
    console.error(e);
    toast("반영 중 오류: " + e.message, "err");
  }
}

// ── 양식 파일 ────────────────────────────────────────────
async function downloadTemplate() {
  const X = await loadXLSX();
  const wb = X.utils.book_new();
  const s1 = X.utils.aoa_to_sheet([
    ["이름", "성별", "학년", "학교", "생년월일", "전화번호", "어머니성함", "어머니연락처",
     "아버지성함", "아버지연락처", "형제관계", "집주소", "비고(특이사항)", "셀"],
    ["홍길동", "남", "중1", "○○중학교", "2013-03-01", "010-0000-0000", "김○○", "010-1111-1111",
     "홍○○", "010-2222-2222", "홍길순(누나)", "경기도 …", "○○ 알레르기", "홍길동 선생님"],
  ]);
  s1["!cols"] = Array(14).fill({ wch: 14 });
  X.utils.book_append_sheet(wb, s1, "학생명단");

  const s2 = X.utils.aoa_to_sheet([
    ["이름", "구분", "생년월일", "전화번호", "비고"],
    ["김○○", "간사", "2000-01-01", "010-0000-0000", ""],
  ]);
  s2["!cols"] = Array(5).fill({ wch: 15 });
  X.utils.book_append_sheet(wb, s2, "교사간사연락처");

  const s3 = X.utils.aoa_to_sheet([
    ["김○○ 선생님", "", "", "", "", "이○○ 간사"],
    ["이름", "학년", "생년월일", "전화번호", "", "이름", "학년", "생년월일", "전화번호"],
    ["홍길동", "중1", "2013-03-01", "010-0000-0000", "", "홍길순", "고1", "2010-05-05", "010-3333-3333"],
  ]);
  s3["!cols"] = Array(9).fill({ wch: 14 });
  X.utils.book_append_sheet(wb, s3, "셀편성");

  const out = X.write(wb, { bookType: "xlsx", type: "array" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = "꿈땅새땅_가져오기_양식.xlsx";
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  toast("양식 파일을 내려받았습니다.");
}

export { uid, cellIdOf, modal };
