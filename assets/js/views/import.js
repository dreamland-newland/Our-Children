// ============================================================
//  파일 가져오기 — 엑셀/CSV를 던지면 알아서 정리해서 교적부에 반영
//  · 한글 헤더 자동 인식 (띄어쓰기·순서·별칭 허용)
//  · 셀편성 격자(담당자별 블록)도 자동 인식 → 새 버전으로 등록
//  · 반영 전 신규 / 변경 / 동일 미리보기 후 확인
// ============================================================
import {
  state, api, isLoggedIn, currentVersion, cellIdOf, cellNameOf, cellRoleOf, uid, autoGrade,
} from "../data.js";
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
  cell:         ["셀", "셀이름", "소속셀", "셀명", "담당", "담당교사", "담당간사",
                 "교사간사", "교사/간사", "담당자", "셀담당", "담당선생님"],
  status:       ["상태", "재적상태"],
  role:         ["구분", "역할", "직분", "직책"],
  seat:         ["자리", "셀자리", "셀역할", "셀직분", "리더헬퍼"],
  seq:          ["연번", "번호", "no", "순번"],
  promoted:     ["하늘아이", "진급자", "예비중1"],
};

const norm = (v) => String(v ?? "").replace(/[\s()（）/·.\-_]/g, "").toLowerCase();

/** «리더» «셀리더» «★» «leader» … → "셀리더" / «헬퍼» «보조» «☆» → "셀헬퍼" */
function cleanSeat(v) {
  const t = norm(v).replace(/[★☆*]/g, (m) => (m === "★" ? "리더" : "헬퍼"));
  if (!t) return null;
  if (/리더|leader|짱|대표/.test(t)) return "셀리더";
  if (/헬퍼|helper|보조|도우미|부리더/.test(t)) return "셀헬퍼";
  return null;
}
/** 이름 칸에 «홍길동(리더)» 처럼 적혀 있으면 떼어 냅니다 */
function splitSeat(name) {
  const m = String(name || "").match(/^(.*?)\s*[(（\[]\s*(부?리더|셀리더|헬퍼|셀헬퍼|보조|도우미)\s*[)）\]]\s*$/);
  if (m) return { name: m[1].trim(), seat: cleanSeat(m[2]) };
  const st = String(name || "").match(/^\s*([★☆])\s*(.+)$|^(.+?)\s*([★☆])\s*$/);
  if (st) return { name: (st[2] || st[3] || "").trim(), seat: (st[1] || st[4]) === "★" ? "셀리더" : "셀헬퍼" };
  return { name: String(name || "").trim(), seat: null };
}

function matchField(header) {
  const h = norm(header);
  if (!h) return null;
  for (const [field, list] of Object.entries(ALIASES)) {
    for (const a of list) {
      const n = norm(a);
      if (h === n) return field;
    }
  }
  // 머리글은 짧습니다. 문장(메모·설명)은 부분 일치로 잡지 않습니다.
  //   예) "* 파란색 이름 = 출석 빈도가 낮은 아이들" 을 «이름» 칸으로 착각하지 않도록
  if (h.length > 12) return null;
  const pairs = Object.entries(ALIASES)
    .flatMap(([f, l]) => l.map((a) => [f, norm(a)]))
    .sort((a, b) => b[1].length - a[1].length);
  for (const [f, n] of pairs) if (n.length >= 2 && h.includes(n)) return f;
  return null;
}

/** 이 줄이 «머리글 줄» 다울수록 점수가 높습니다 (이름 칸이 없으면 0점) */
function headerScore(row) {
  let score = 0, hasName = false;
  for (const c of row || []) {
    const t = String(c ?? "").trim();
    if (!t || t.length > 12) continue;
    const f = matchField(t);
    if (!f) continue;
    score += 1;
    if (f === "name") hasName = true;
  }
  return hasName ? score : 0;
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
  // 0) 설명용 시트(«읽어보기» 등)는 데이터가 아니니 건너뜁니다
  if (/읽어보기|안내|설명|가이드|readme|사용법/i.test(String(title).replace(/\s/g, "")))
    return { title, kind: "guide" };

  // 1) 셀편성 격자인가? — 한 행에 '이름' 이 2번 이상 등장
  for (let r = 0; r < Math.min(aoa.length, 12); r++) {
    const nameCols = aoa[r].map((c, i) => (norm(c) === "이름" ? i : -1)).filter((i) => i >= 0);
    if (nameCols.length >= 2) return parseCellGrid(title, aoa);
  }

  // 2) 머리글 줄 찾기 — 위쪽 20줄 중 «가장 머리글다운» 줄
  let hr = -1, best = 0;
  for (let r = 0; r < Math.min(aoa.length, 20); r++) {
    const sc = headerScore(aoa[r]);
    if (sc > best) { best = sc; hr = r; }
  }
  if (hr < 0) return { title, kind: "unknown", peek: peekOf(aoa),
    reason: "‘이름’ 이라고 적힌 열을 찾지 못했습니다." };

  const map = {};
  const ignored = [];          // 머리글에 있지만 앱이 모르는 칸 (양식에서 벗어난 부분)
  aoa[hr].forEach((c, i) => {
    const f = matchField(c);
    if (f) { if (!(f in map)) map[f] = i; return; }
    const t = String(c ?? "").trim();
    if (t && t.length <= 20) ignored.push(t);
  });

  const records = [];
  let lastCell = null;          // 셀 칸은 블록의 첫 줄에만 적는 경우가 많습니다
  for (let r = hr + 1; r < aoa.length; r++) {
    const row = aoa[r];
    const name = cleanText(row[map.name]);
    if (!name || norm(name) === "이름") continue;
    if (isNoteLine(name, row, map.name)) continue;      // «※ …» 같은 안내 줄은 건너뜁니다
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
    // 셀 칸이 비어 있으면 «위 줄과 같은 셀» 로 이어 봅니다 (합쳐진 칸·첫 줄만 적은 표)
    if ("cell" in map) {
      if (rec.cell) lastCell = rec.cell;
      else if (lastCell) rec.cell = lastCell;
    }
    records.push(rec);
  }

  // 2-1) 머리글은 찾았는데 아래에 이름이 한 줄도 없는 경우 — 왜인지 알려 줍니다
  if (!records.length)
    return { title, kind: "unknown", peek: peekOf(aoa), headerRow: hr, nameCol: map.name,
             reason: `${hr + 1}번째 줄에서 ‘이름’ 열(${cellRef(map.name)}칸)은 찾았지만, `
                   + "그 아래에 이름이 적힌 줄이 하나도 없습니다." };

  // 2-2) 학생 표에서 «역할/구분» 칸이 리더·헬퍼·셀원 이면 그건 교사 구분이 아니라 «자리» 입니다
  if ("role" in map && !("seat" in map)) {
    const vals = records.map((r) => norm(r.role)).filter(Boolean);
    const seatish = vals.filter((v) => /리더|헬퍼|셀원|보조|도우미/.test(v)).length;
    if (vals.length && seatish >= vals.length * 0.6) {
      for (const r of records) { if (r.role) r.seat = r.role; delete r.role; }
      map.seat = map.role; delete map.role;
    }
  }

  // 3) 학생 명부인가, 교사 명부인가?
  //   시트 이름을 먼저 봅니다 (양식의 세 가지: 셀편성 · 올해중1 · 교사간사)
  const t = String(title).replace(/\s/g, "");
  const looksTeacher = /교사|간사|교역|선생|스탭|스태프/.test(t) ||
    ("role" in map && !("grade" in map) && !("mother_name" in map));
  const kind = looksTeacher ? "teachers" : "students";
  // «올해중1» 시트로 새로 등록되는 아이에게만 «하늘아이» 표시를 붙입니다
  const promoted = /올해중1|진급|하늘아이|예비중1/.test(t);

  // 교사 명부에서 연도가 1900년 이하이면 '연도 미상' 으로 보고 월-일만 저장
  if (kind === "teachers") {
    for (const rec of records) {
      if (rec.birth && Number(rec.birth.slice(0, 4)) <= 1900) {
        rec.birth_md = rec.birth.slice(5);
        delete rec.birth;
      }
    }
  }

  // 3-1) «셀» 칸이 있고 아이마다 셀이 적혀 있으면 → 세로로 늘어놓은 «셀편성» 표입니다.
  //      (교사/간사 이름 아래로 아이들이 줄줄이 있는 형태)
  if (kind === "students" && "cell" in map) {
    const withCell = records.filter((r) => r.cell).length;
    // 주소록다운 칸(성별·학교·보호자·주소…)이 있으면 그건 «학생명단» 이지 셀편성이 아닙니다
    const rosterish = ["gender", "school", "mother_name", "mother_phone", "father_name",
      "father_phone", "address", "siblings", "note"].filter((f) => f in map).length;
    const titled = /셀편성|셀\s*편성/.test(String(title) + " " + (aoa[0] || []).join(" "));
    const looksCells = withCell >= 3 &&
      (titled || (rosterish === 0 && withCell >= Math.max(3, records.length * 0.6)));
    if (looksCells) return longFormCells(title, records, aoa, ignored);
  }

  return { title, kind, map, records, promoted, headerRow: hr, ignored };
}

/** 세로형 셀편성 표(«교사/간사 · 이름 · 학년 …») → 셀별 명단으로 묶습니다 */
function longFormCells(title, records, aoa, ignored = []) {
  const order = [];
  const byCell = new Map();
  for (const r of records) {
    const key = r.cell || "미배정";
    if (!byCell.has(key)) { byCell.set(key, []); order.push(key); }
    byCell.get(key).push({
      name: r.name,
      seat: cleanSeat(r.seat),
      grade: r.grade || null,
      birth: r.birth || null,
      birth_year: r.birth ? null : (r.birth_year || null),
      phone: r.phone || null,
    });
  }
  return {
    title, kind: "cells", longForm: true, ignored,
    // 파일 첫 줄에 «2026-2학기 셀편성» 처럼 적혀 있으면 버전 이름 후보로 씁니다
    suggestLabel: guessLabel(title, aoa),
    cells: order.map((name) => ({ name, members: byCell.get(name) })),
  };
}

/** 파일에서 «2026-2학기» 같은 학기 이름을 찾아 봅니다 */
function guessLabel(title, aoa) {
  const hay = [String(title || ""), ...(aoa[0] || []).map((c) => String(c ?? ""))].join(" ");
  const m = hay.match(/(\d{4})\s*[-–~]?\s*([12])\s*학기/);
  if (m) return `${m[1]}-${m[2]}학기`;
  return String(title || "").trim() || null;
}

/** 표 아래에 적어 둔 «※ 안내» 같은 줄인가 (이름으로 잘못 읽지 않도록) */
function isNoteLine(name, row, nameIdx) {
  if (/^[※*·•▶◆■□○-]/.test(name)) return true;
  if (name.length > 12) return true;                       // 사람 이름은 이렇게 길지 않습니다
  const others = (row || []).filter((c, i) => i !== nameIdx && String(c ?? "").trim()).length;
  return others === 0 && /\s/.test(name);                  // 그 줄에 이름 칸만 있고 띄어쓰기가 있으면 문장
}

/** 파일 앞부분을 그대로 떠서 «앱이 본 것» 을 보여줄 때 씁니다 */
const peekOf = (aoa) => (aoa || []).slice(0, 10).map((r) => (r || []).slice(0, 9)
  .map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c)));
/** 0 → A, 1 → B … 엑셀 열 이름 */
const cellRef = (i) => String.fromCharCode(65 + Math.max(0, Number(i) || 0));

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
      for (let c = col; c < Math.min(col + 7, headerRow.length); c++) {
        const f = matchField(headerRow[c]);
        if (f && !(f in sub)) sub[f] = c;
      }
      const members = [];
      for (let rr = r + 1; rr < aoa.length; rr++) {
        const v = cleanText(aoa[rr]?.[col]);
        if (!v) break;
        if (norm(v) === "이름") break;
        if (/선생님$|간사$|전도사$|목사$/.test(v)) break;
        const { name, seat } = splitSeat(v);
        members.push({
          name,
          seat: seat || cleanSeat(aoa[rr][sub.seat]) || cleanSeat(aoa[rr][sub.role]),
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
        const n0 = cleanText(aoa[rr]?.[c]);
        if (!n0 || norm(n0) === "이름") break;
        const { name: n, seat } = splitSeat(n0);
        members.push({
          name: n,
          seat,
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
  cell: "셀", seat: "자리",
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
      if (f === "name" || f === "cell" || f === "seat" || v === null || v === undefined || v === "") continue;
      if (!(f in FIELD_LABEL)) continue;
      const before = t[f] ?? null;
      if (String(before ?? "") !== String(v)) changes.push({ f, before, after: v });
    }
    // 셀이 바뀌었으면 그것도 «변경» 으로 봅니다 (지금 보고 있는 편성 기준)
    if (sheet.kind === "students" && rec.cell) {
      const now = cellNameOf(t.id);
      if (nameKey(now || "") !== nameKey(rec.cell))
        changes.push({ f: "cell", before: now, after: rec.cell });
    }
    // 셀리더·셀헬퍼(자리)가 바뀌었으면 그것도 «변경» — «자리» 열이 있는 파일에서만 봅니다
    if (sheet.kind === "students" && sheet.map && "seat" in sheet.map && cellIdOf(t.id)) {
      const nowSeat = cellRoleOf(t.id);
      const want = cleanSeat(rec.seat);
      if ((nowSeat || "") !== (want || ""))
        changes.push({ f: "seat", before: nowSeat || "없음", after: want || "없음" });
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
      <p>올릴 수 있는 것은 <b>셀편성 · 올해중1 · 교사간사</b> 세 가지입니다.
        올린 내용을 먼저 보여 드리고, <b>«반영하기»를 눌러야</b> 저장됩니다.</p>
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
      .xlsx · .csv — <b>셀편성 · 올해중1 · 교사간사</b> 세 가지를 알아봅니다.
      «양식 파일 받기» 로 받은 파일에 채워 넣으시면 가장 확실합니다.</div>
    <input type="file" id="file" accept=".xlsx,.xls,.csv" style="display:none">
  </div>

  <div class="card card-pad" style="margin-top:16px">
    <div class="section-label" style="margin-top:0">어떻게 되는 건가요</div>
    <div class="import-steps">
      <div><b>① 올리기</b><span>엑셀/CSV를 올리면 열 이름을 보고 알아서 읽습니다.
        이 단계에서는 <b>교적부가 전혀 바뀌지 않습니다.</b></span></div>
      <div><b>② 확인하기</b><span>파일에서 읽은 내용을 그대로 보여 주고,
        지금 교적부와 견줘 <b>새로 등록 / 고칠 내용 / 그대로</b>로 나눠 줍니다.</span></div>
      <div><b>③ 반영하기</b><span>맨 아래 <b>«반영하기»</b> 를 눌러야 저장됩니다.
        파일에 없는 칸과 없는 아이는 <b>건드리지 않습니다.</b></span></div>
    </div>
  </div>

  <div class="card card-pad" style="margin-top:16px">
    <div class="section-label" style="margin-top:0">어떤 시트가 어디로 들어가나요</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">
      올릴 수 있는 것은 <b>이 세 가지</b>입니다. «양식 파일 받기» 를 누르면 세 시트가 한 파일로 들어 있습니다.
    </div>
    <div class="rowmap">
      <div><b>셀편성</b><span>→ 셀편성 화면에 <b>새 편성 버전</b>으로. 셀리더·셀헬퍼도 함께 들어갑니다</span></div>
      <div><b>올해중1</b><span>→ 주소록. <b>교적부에 없던 아이에게만</b> «하늘아이» 표시가 붙고,
        이미 있는 아이는 정보만 고쳐집니다</span></div>
      <div><b>교사간사</b><span>→ 교사·간사 명부. 회원가입 «나예요!» 확인에 쓰입니다</span></div>
    </div>
    <div style="font-size:12.5px;color:var(--text-muted);margin-top:8px">
      생일 명단과 «올해 중1» 화면은 따로 올리지 않습니다 — <b>생년월일만 있으면 저절로</b> 만들어집니다.
      아이 한 명 고치기·셀 하나 옮기기는 파일보다 앱에서 하시는 편이 빠릅니다.
    </div>
    <div class="form-note warn-note" style="margin-top:12px">
      <b>양식을 바꾸지 말아 주세요.</b> 아래 세 가지만 지키면 나머지는 자유롭게 쓰셔도 됩니다.
      <div style="margin-top:6px">
        ① <b>머리글 줄</b>(이름 · 교사/간사 · 생년월일 …)의 <b>칸 이름을 바꾸거나 지우지 마세요.</b>
           칸 순서를 옮기거나 필요 없는 칸을 빼는 건 괜찮습니다.<br>
        ② <b>머리글 줄 위에는 메모를 넣지 마세요.</b> 굳이 넣으신다면 «이름» «학년» «생일» 같은
           <b>칸 이름과 같은 낱말은 피해</b> 주세요 — 그 줄을 머리글로 착각할 수 있습니다.<br>
        ③ <b>시트 이름</b>은 «셀편성» · «올해중1» · «교사간사» 로 두세요.
           앱이 무엇으로 읽을지 이 이름으로 먼저 판단합니다.
      </div>
      <div style="margin-top:6px">
        올리시면 <b>«이 시트를 ○○로 봤습니다»</b> 와 <b>못 알아본 칸</b>을 먼저 보여 드립니다.
        거기서 어긋난 곳을 바로 확인하실 수 있습니다.
      </div>
    </div>
  </div>

  <div class="card card-pad" style="margin-top:16px;font-size:13px;color:var(--text-secondary)">
    <b>인식하는 열 이름</b> — 이름 · 성별 · 학년 · 학교 · 생년월일 · 전화번호(연락처·휴대폰) ·
    어머니성함/연락처 · 아버지성함/연락처 · 형제관계 · 집주소 · 비고(특이사항) · 셀 · 구분 · 자리.
    띄어쓰기나 순서가 달라도 됩니다. 파일에 <b>없는 열은 기존 값을 그대로 둡니다.</b>
    <div style="margin-top:6px">
      <b>셀리더 · 셀헬퍼</b>는 셀편성 표에서 <b>«자리»</b> 열에 «셀리더»·«셀헬퍼»(리더·헬퍼도 됩니다)라고 적거나,
      이름 칸에 <b>홍길동(리더)</b> · <b>★홍길동</b> 처럼 적어 두면 그대로 읽어옵니다.
      아이들 중에서 세우는 자리라, <b>편성을 새로 짜면 함께 새로 정합니다.</b>
    </div>
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
  const usable = sheets.filter((s) => s.kind !== "unknown" && s.kind !== "guide");
  if (!usable.length) {
    res.innerHTML = `
      <div class="card card-pad" style="margin-bottom:14px">
        <b>${esc(fileName)}</b>
        <span style="color:var(--text-muted);font-size:13px"> · 반영할 자료를 찾지 못했습니다</span>
        <div class="form-note" style="margin-top:10px">
          아래 표는 <b>앱이 이 파일에서 읽은 그대로</b>입니다. 무엇이 비어 있는지 확인해 보세요.
          <b>«양식 파일 받기»</b> 로 표준 양식을 받아 그 위에 채워 넣으면 가장 확실합니다.
        </div>
      </div>
      ${sheets.map((s, i) => sheetCard(s, i)).join("")}`;
    return;
  }

  res.innerHTML = `
    <div class="card card-pad" style="margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <b>${esc(fileName)}</b>
      <span style="color:var(--text-muted);font-size:13px">시트 ${
        sheets.filter((s) => s.kind !== "guide").length}개 중 ${usable.length}개 인식</span>
    </div>
    ${sheets.map((s, i) => sheetCard(s, i)).join("")}`;

  res.querySelectorAll("[data-apply]").forEach((b) => b.addEventListener("click", () =>
    applySheet(sheets[+b.dataset.apply], rerender)));
}

function sheetCard(s, i) {
  if (s.kind === "guide") return "";        // 설명용 시트는 보여줄 것이 없습니다
  if (s.kind === "unknown") {
    return `<section class="card" style="margin-bottom:14px">
      <div class="card-head">
        <h3>${esc(s.title)} <span class="badge warn">읽지 못했습니다</span></h3>
        <span class="sub">이 시트는 반영되지 않습니다</span>
      </div>
      <div class="card-pad">
        <div style="font-size:13.5px;margin-bottom:10px">${esc(s.reason)}</div>
        ${peekTable(s)}
        <div class="form-note" style="margin-top:10px">
          위 표는 <b>앱이 이 파일에서 실제로 읽은 앞부분</b>입니다.
          ‘이름’ 이라고 적힌 칸 <b>바로 아래 줄부터</b> 아이 이름이 있어야 합니다.
          맨 윗줄에 제목이 있어도 괜찮습니다.
        </div>
      </div>
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
        <span class="sub">파일에서 <b>${s.cells.length}개 셀 · ${total}명</b>을 읽었습니다</span>
      </div>
      <div class="card-pad">
        <div class="section-label" style="margin-top:0">① 파일에서 읽은 셀편성</div>
        ${ignoredNote(s)}
        ${kindNote(s, "셀편성")}
        <div style="font-size:12.5px;color:var(--text-muted);margin:8px 0">
          아래는 <b>파일에 적힌 그대로</b>입니다. 아직 아무것도 저장되지 않았습니다.</div>
        <div class="grid grid-auto" style="gap:8px">
          ${s.cells.map((c) => `<div style="border:1px solid var(--border);border-radius:8px;padding:9px 12px">
            <b style="font-size:13.5px">${esc(c.name)}</b>
            <span class="badge" style="float:right">${c.members.length}명</span>
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:4px">
              ${c.members.map((m) => esc(m.name) + (m.seat
                ? ` <span class="badge ${m.seat === "셀리더" ? "good" : "blue"}"
                     >${esc(m.seat.replace("셀", ""))}</span>` : "")).join(", ")}</div>
          </div>`).join("")}
        </div>
        <div class="section-label">② 반영하면 이렇게 됩니다</div>
        <div class="import-sum">
          <div class="is-item"><span class="badge blue">새 편성 버전</span>
            <b>1개</b><span>오늘 날짜로 만들어집니다</span></div>
          <div class="is-item"><span class="badge">셀</span>
            <b>${s.cells.length}개</b><span>파일에 있는 그대로</span></div>
          <div class="is-item"><span class="badge">배정</span>
            <b>${total}명</b><span>아이들이 이 셀들에 들어갑니다</span></div>
          ${unknown.length ? `<div class="is-item"><span class="badge good">새로 등록</span>
            <b>${unknown.length}명</b><span>교적부에 없는 이름입니다</span></div>` : ""}
        </div>
        ${unknown.length ? `<div class="form-note" style="margin-top:10px">
          교적부에 없는 이름 ${unknown.length}명 (${esc(unknown.map((u) => u.name).join(", "))})은
          <b>새 학생으로 함께 등록</b>됩니다.</div>` : ""}
        ${s.cells.some((c) => c.members.some((m) => m.seat)) ? "" : `
        <div class="form-note" style="margin-top:12px">
          셀리더·셀헬퍼 표시가 없습니다. 파일에 <b>«자리»</b> 열을 두고 «셀리더»·«셀헬퍼» 라고 적거나,
          이름 옆에 <b>홍길동(리더)</b> 처럼 적어 두면 그대로 읽어옵니다. 나중에 셀편성 화면에서 정해도 됩니다.</div>`}
        <div class="form-note" style="margin-top:10px">
          · <b>기존 편성 버전은 지워지지 않습니다.</b> 새 버전이 하나 더 생기고, 드롭다운에서 언제든 지난 편성을 볼 수 있습니다.<br>
          · 이 파일로는 <b>셀 배치만</b> 바뀝니다. 연락처·보호자 같은 <b>교적 내용은 고치지 않습니다</b>
            (그건 «학생명단» 시트로 올려 주세요).<br>
          · <b>«반영하기»를 누르기 전까지</b> 교적부는 하나도 바뀌지 않습니다.
        </div>
      </div>
      <div class="modal-foot">
        <span style="margin-right:auto;font-size:12.5px;color:var(--text-muted)">
          ③ 위 내용이 맞으면 눌러 주세요</span>
        <button class="btn btn-primary" data-apply="${i}">새 편성 버전으로 반영하기</button>
      </div>
    </section>`;
  }

  const diffs = diffRecords(s);
  s._diffs = diffs;
  const n = (k) => diffs.filter((d) => d.kind === k).length;
  const isTeacher = s.kind === "teachers";
  const label = isTeacher ? "교사·간사 명부" : (s.promoted ? "올해중1" : "학생 명단");
  const who = isTeacher ? "선생님·간사님" : "아이";
  const todo = n("new") + n("update");

  // 파일에서 실제로 읽어온 칸 이름들 (이름은 늘 맨 앞)
  const cols = ["name", ...Object.keys(s.map || {}).filter((f) => f !== "name" && f !== "seq"
    && s.records.some((r) => r[f] !== undefined && r[f] !== null && r[f] !== ""))];
  const head = (f) => (f === "name" ? "이름" : FIELD_LABEL[f] || f);

  return `
  <section class="card" style="margin-bottom:14px">
    <div class="card-head">
      <h3>${esc(s.title)} <span class="badge ${isTeacher ? "orange" : "blue"}">${label}</span></h3>
      <span class="sub">파일에서 ${who} <b>${s.records.length}명</b>을 읽었습니다</span>
    </div>

    <div class="card-pad" style="padding-bottom:6px">
      <div class="section-label" style="margin-top:0">① 파일에서 읽은 내용</div>
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">
        이 파일의 <b>«${esc(s.title)}»</b> 시트에서 ${who} <b>${s.records.length}명</b>,
        칸 <b>${cols.length}개</b>를 읽었습니다 —
        ${cols.map((f) => `<span class="badge">${esc(head(f))}</span>`).join(" ")}
        ${ignoredNote(s)}
        <div style="margin-top:4px;color:var(--text-muted);font-size:12.5px">
          아래는 <b>파일에 적힌 그대로</b>입니다. 아직 아무것도 저장되지 않았습니다.</div>
      </div>
      ${kindNote(s, label)}
      <div class="table-wrap" style="max-height:230px;overflow:auto;border:1px solid var(--border);border-radius:8px">
        <table class="data">
          <thead><tr>${cols.map((f) => `<th>${esc(head(f))}</th>`).join("")}</tr></thead>
          <tbody>
            ${s.records.map((r) => `<tr>${cols.map((f) =>
              `<td${f === "name" ? "" : ' style="color:var(--text-secondary)"'}>${
                f === "name" ? `<b>${esc(r.name)}</b>` : esc(r[f] ?? "")}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card-pad" style="padding-top:10px">
      <div class="section-label" style="margin-top:0">② 지금 교적부와 견줘 본 결과</div>
      <div class="import-sum">
        <div class="is-item"><span class="badge good">새로 등록</span>
          <b>${n("new")}명</b><span>교적부에 없는 ${who}입니다</span></div>
        <div class="is-item"><span class="badge warn">고칠 내용</span>
          <b>${n("update")}명</b><span>파일 내용이 지금과 다릅니다</span></div>
        <div class="is-item"><span class="badge">그대로</span>
          <b>${n("same")}명</b><span>건드리지 않습니다</span></div>
        ${n("ambiguous") ? `<div class="is-item"><span class="badge crit">확인 필요</span>
          <b>${n("ambiguous")}명</b><span>같은 이름이 여럿이라 건너뜁니다</span></div>` : ""}
      </div>

      ${todo || n("ambiguous") ? `
      <div class="table-wrap" style="max-height:300px;overflow:auto;border:1px solid var(--border);
           border-radius:8px;margin-top:10px">
        <table class="data">
          <thead><tr><th>구분</th><th>이름</th><th>무엇이 바뀌나요</th></tr></thead>
          <tbody>
            ${diffs.filter((d) => d.kind !== "same").map((d) => `
            <tr>
              <td>${badgeFor(d.kind)}</td>
              <td><b>${esc(d.rec.name)}</b></td>
              <td class="wrap" style="color:var(--text-secondary)">
                ${d.kind === "new"
                  ? "새로 등록됩니다 — " + esc(Object.entries(d.rec).filter(([k]) => k !== "name")
                      .map(([k, v]) => `${FIELD_LABEL[k] || k} ${v}`).join(" · ") || "이름만 있습니다")
                  : d.kind === "update"
                  ? d.changes.map((c) => `${esc(FIELD_LABEL[c.f] || c.f)}
                      <s style="opacity:.55">${esc(c.before ?? "(비어 있음)")}</s> →
                      <b>${esc(c.after)}</b>`).join(" · ")
                  : "같은 이름이 여러 명입니다 — 반영하지 않습니다. 생년월일이나 전화번호를 함께 넣어 주세요."}
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`
      : `<div class="form-note" style="margin-top:10px">
          <b>바뀌는 내용이 없습니다.</b> 파일 내용이 지금 교적부와 똑같습니다.
          ${s.map && "cell" in s.map ? "" : "셀을 옮기시려면 파일에 «셀» 열을 넣어 주세요."}</div>`}

      <div class="form-note" style="margin-top:10px">
        · 파일에 <b>없는 칸</b>은 지금 값을 그대로 둡니다 (빈칸으로 지워지지 않습니다).<br>
        · 파일에 <b>없는 ${who}</b>는 교적부에서 지워지지 않습니다.<br>
        · <b>«반영하기»를 누르기 전까지</b> 교적부는 하나도 바뀌지 않습니다.
      </div>
    </div>

    <div class="modal-foot">
      <span style="margin-right:auto;font-size:12.5px;color:var(--text-muted)">
        ③ 위 내용이 맞으면 눌러 주세요</span>
      <button class="btn btn-primary" data-apply="${i}" ${todo ? "" : "disabled"}>
        ${todo ? `${todo}건 교적부에 반영하기` : "반영할 내용이 없습니다"}</button>
    </div>
  </section>`;
}

/** 머리글에 있었지만 앱이 모르는 칸 — 양식에서 벗어난 부분을 알려 줍니다 */
function ignoredNote(s) {
  const ig = (s.ignored || []).filter(Boolean);
  if (!ig.length) return "";
  return `
  <div class="form-note warn-note" style="margin:8px 0 0">
    <b>못 알아본 칸이 있습니다</b> — ${ig.map((t) => `<span class="badge crit">${esc(t)}</span>`).join(" ")}
    <div style="margin-top:3px">
      이 칸들은 <b>그냥 넘어갔습니다.</b> 칸 이름을 바꾸셨다면 양식의 이름으로 되돌려 주세요
      (예: «연락처» «휴대폰» 은 되지만 «폰번호» 는 모릅니다).
    </div>
  </div>`;
}

/** «이 시트를 무엇으로 봤는지» 를 분명히 알려 줍니다 */
function kindNote(s, label) {
  const where = {
    "셀편성": "셀편성 화면에 <b>새 편성 버전</b>으로 들어갑니다",
    "학생 명단": "<b>주소록</b>에 들어갑니다 (생일 명단·올해 중1 화면은 생년월일로 저절로 만들어집니다)",
    "올해중1": "<b>주소록</b>에 들어갑니다. 교적부에 <b>없던 아이에게만</b> «하늘아이» 표시가 붙습니다",
    "교사·간사 명부": "<b>교사·간사</b> 화면에 들어갑니다",
  }[label] || "";
  return `
  <div class="form-note" style="margin:8px 0 0">
    이 시트를 <b>«${esc(label)}»</b> 로 봤습니다${where ? ` — ${where}` : ""}.
    <div style="margin-top:3px;color:var(--text-muted)">
      다르게 읽히길 원하시면 <b>시트 이름</b>을 «셀편성» · «올해중1» · «교사간사» 중 하나로 바꿔 주세요.
    </div>
  </div>`;
}

/** 앱이 본 파일 앞부분 (셀 주소까지 붙여서) */
function peekTable(s) {
  const rows = s.peek || [];
  if (!rows.length) return `<div class="empty" style="padding:14px 0">시트가 완전히 비어 있습니다.</div>`;
  const width = Math.max(...rows.map((r) => r.length), 1);
  return `
  <div class="table-wrap" style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:8px">
    <table class="data peek">
      <thead><tr><th></th>${Array.from({ length: width }, (_, c) =>
        `<th>${cellRef(c)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((r, i) => `<tr${i === s.headerRow ? ' class="hit"' : ""}>
          <th>${i + 1}</th>
          ${Array.from({ length: width }, (_, c) => `<td${
            i === s.headerRow && c === s.nameCol ? ' class="hit"' : ""}>${
            esc(r[c] ?? "")}</td>`).join("")}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
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

  const missed = new Set();          // 파일에 적힌 셀 이름이 지금 편성에 없는 경우
  const hasSeatCol = !!(s.map && "seat" in s.map);   // «자리» 열이 있는 파일인가
  try {
    for (const d of todo) {
      const base = d.kind === "update" ? { ...d.target } : {};
      const row = { ...base, ...d.rec };
      delete row.cell;
      delete row.seat;
      if (s.kind === "students") {
        // «올해중1» 시트로 «새로 등록되는» 아이에게만 하늘아이 표시를 붙입니다.
        // 이미 교적에 있는 아이는 표시를 건드리지 않습니다(이 시트로 정보만 고칠 수 있게).
        if (s.promoted && d.kind === "new") row.is_promoted = true;
        row.status ||= "재적";
        const saved = await api.saveStudent(row);
        // 파일에 '셀' 열이 있으면 지금 보고 있는 편성에 배정 ('자리' 도 함께)
        if (currentVersion() && (d.rec.cell || hasSeatCol)) {
          const c = d.rec.cell
            ? state.cells.find(
                (x) => x.version_id === state.versionId && nameKey(x.name) === nameKey(d.rec.cell))
            : null;
          const cid = c ? c.id : cellIdOf(saved.id);
          // «자리» 열이 없는 파일이면 지금 자리를 그대로 지킵니다
          const seat = hasSeatCol ? cleanSeat(d.rec.seat) : cellRoleOf(saved.id);
          if (cid) await api.setMembership(saved.id, cid, state.versionId, seat);
          else if (d.rec.cell) missed.add(d.rec.cell);
        }
      } else {
        row.role ||= "간사";
        await api.saveTeacher(row);
      }
    }
    await api.refresh();
    toast(`${todo.length}건을 반영했습니다.`);
    if (missed.size) toast(
      `«${[...missed].join(", ")}» 셀은 지금 편성에 없어서 배정하지 못했습니다. ` +
      "셀편성 화면에서 셀을 먼저 만들어 주세요.", "err");
    rerender();
  } catch (e) {
    console.error(e);
    toast("반영 중 오류: " + e.message, "err");
  }
}

async function applyCells(s, rerender) {
  const total = s.cells.reduce((a, c) => a + c.members.length, 0);
  const label = await askLabel(s.suggestLabel || DEFAULT_TERM_LABEL, s.cells.length, total);
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
      // «홍길동, 김철수» «홍길동 간사 / 김철수 간사» 처럼 담당이 여러 명이어도 갈라 둡니다
      leaders: /장기결석|미배정/.test(c.name) ? [] : c.name.split(/[/,·]/)
        .map((x) => x.replace(/\s*(선생님|간사|전도사|목사|사모)\s*$/, "").trim()).filter(Boolean),
    })));
    const rows = [];
    made.forEach((cell, i) => {
      for (const m of s.cells[i].members) {
        const st = state.students.find((p) => nameKey(p.name) === nameKey(m.name));
        if (st) rows.push({ version_id: v.id, cell_id: cell.id, student_id: st.id,
                            role: m.seat || null });
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

/** 새 셀편성 버전의 이름을 묻는 창 (브라우저 기본 창보다 설명을 넣을 수 있어서) */
function askLabel(suggest, cellCount, total) {
  return new Promise((resolve) => {
    const form = document.createElement("form");
    form.id = "verForm";
    form.innerHTML = `
      <div class="form-note" style="margin:0 0 14px">
        <b>${cellCount}개 셀 · ${total}명</b> 으로 <b>새 셀편성 버전</b>을 만듭니다.
        지금까지의 편성은 그대로 남고, 셀편성 화면 드롭다운에서 언제든 다시 볼 수 있습니다.
      </div>
      <div class="field"><label>이 편성의 이름</label>
        <input type="text" name="label" required maxlength="40" value="${esc(suggest || "")}"
               placeholder="예: 2026-2학기">
        <span class="hint">파일에서 찾은 이름을 넣어 두었습니다. 그대로 두셔도 됩니다.</span></div>`;
    let done = false;
    modal({
      title: "새 셀편성 버전 만들기", narrow: true, body: form,
      footer: `<button class="btn" data-close>취소</button>
               <button class="btn btn-primary" form="verForm" type="submit">만들기</button>`,
      onMount(box, close) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          done = true;
          const v = new FormData(form).get("label").trim();
          close();
          resolve(v || suggest || DEFAULT_TERM_LABEL);
        });
        // 창이 닫히면(✕ · 취소 · Esc · 바깥 클릭) «취소» 로 봅니다
        const overlay = box.parentElement;
        new MutationObserver((_, ob) => {
          if (!overlay.isConnected) { ob.disconnect(); if (!done) resolve(null); }
        }).observe(overlay.parentElement, { childList: true });
      },
    });
  });
}

// ── 양식 파일 ────────────────────────────────────────────
async function downloadTemplate() {
  const X = await loadXLSX();
  const wb = X.utils.book_new();

  // 0) 읽어보기 — 어느 시트에 무엇을 적는지
  const s0 = X.utils.aoa_to_sheet([
    ["꿈땅새땅 교적부 — 가져오기 양식"],
    [],
    ["올릴 수 있는 것은 이 세 가지입니다"],
    ["시트", "무엇을 적나요", "어디로 들어가나요"],
    ["셀편성", "셀별 명단 (교사/간사 · 이름 · 자리 …)", "셀편성 화면에 새 편성 버전으로"],
    ["올해중1", "새로 올라온 아이들 인적사항", "주소록 (새로 등록되는 아이에게 «하늘아이» 표시)"],
    ["교사간사", "선생님·간사님 명부", "교사·간사 화면 (회원가입 «나예요!» 확인에 씁니다)"],
    [],
    ["※ 생일 명단과 «올해 중1» 화면은 따로 올리지 않습니다 — 생년월일만 있으면 저절로 만들어집니다."],
    ["※ 아이 한 명 고치기, 셀 하나 옮기기는 파일 말고 앱에서 하시는 편이 빠릅니다."],
    ["※ 이미 교적에 있는 아이를 «올해중1» 시트에 적으면 정보만 고쳐집니다(하늘아이 표시는 안 붙습니다)."],
    [],
    ["양식을 바꾸지 말아 주세요 — 이 세 가지만 지키면 됩니다"],
    ["① 머리글 줄의 칸 이름을 바꾸거나 지우지 마세요. 순서를 옮기거나 안 쓰는 칸을 빼는 건 괜찮습니다."],
    ["② 머리글 줄 위에 메모를 넣지 마세요. 굳이 넣으신다면 «이름» «학년» «생일» 같은 낱말은 피해 주세요."],
    ["③ 시트 이름(셀편성 · 올해중1 · 교사간사)은 그대로 두세요. 앱이 이 이름으로 무엇인지 판단합니다."],
    [],
    ["그 밖에 알아두면 좋은 것"],
    ["· 열 순서가 달라도, 띄어쓰기가 있어도 알아봅니다."],
    ["· 파일에 없는 칸은 지금 값을 그대로 둡니다. 빈칸으로 지워지지 않습니다."],
    ["· 파일에 없는 아이는 교적부에서 지워지지 않습니다."],
    ["· 학년은 비워 두는 편이 낫습니다. 생년월일만 있으면 3월 1일에 저절로 올라갑니다."],
    ["· 생년월일을 모르면 태어난 해(2013)만 적어도 됩니다."],
    ["· 올린 뒤 «반영하기» 를 누르기 전까지는 교적부가 하나도 바뀌지 않습니다."],
  ]);
  s0["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 46 }];
  X.utils.book_append_sheet(wb, s0, "읽어보기");

  // 1) 셀편성 — 위에서 아래로 쭉 (담당 선생님은 셀의 첫 줄에만 적어도 됩니다)
  const s1 = X.utils.aoa_to_sheet([
    ["교사/간사", "이름", "자리", "학년", "생년월일", "전화번호"],
    ["김○○ 선생님", "홍길동", "리더", "", "2013-03-01", "010-0000-0000"],
    ["", "박○○", "헬퍼", "", "2013-07-07", "010-4444-4444"],
    ["", "이몽룡", "", "", "2012-02-02", "010-6666-6666"],
    ["", "", "", "", "", ""],
    ["이○○ 간사", "김철수", "리더", "", "2010-05-05", "010-3333-3333"],
    ["", "김영희", "", "", "2010-09-09", "010-5555-5555"],
    ["", "", "", "", "", ""],
    ["장기결석자", "최○○", "", "", "2011-04-04", ""],
    [],
    ["※ «교사/간사» 는 셀의 첫 줄에만 적어도 됩니다 — 아래 빈 칸은 같은 셀로 봅니다."],
    ["※ «자리» 는 리더 · 헬퍼 · 셀원(또는 비움). 없어도 되고, 리더·헬퍼가 여러 명이어도 됩니다."],
    ["※ 담당이 두 분이면 «김○○, 이○○» 처럼 쉼표로 적어 주세요."],
    ["※ 반영하면 새 편성 버전이 만들어지고, 지난 편성은 그대로 남습니다."],
  ]);
  s1["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 16 }];
  X.utils.book_append_sheet(wb, s1, "셀편성");

  // 2) 올해중1 — 새로 올라온 아이들
  const s2 = X.utils.aoa_to_sheet([
    ["이름", "성별", "학교", "생년월일", "전화번호", "어머니성함", "어머니연락처",
     "아버지성함", "아버지연락처", "형제관계", "집주소", "비고(특이사항)"],
    ["홍길동", "남", "○○중학교", "2013-03-01", "010-0000-0000", "김○○", "010-1111-1111",
     "홍○○", "010-2222-2222", "홍길순(누나)", "경기도 …", "○○ 알레르기"],
    ["홍길순", "여", "○○중학교", "2013-05-05", "", "김○○", "010-1111-1111",
     "홍○○", "010-2222-2222", "홍길동(오빠)", "경기도 …", ""],
    [],
    ["※ 학년 칸은 없습니다 — 생년월일로 저절로 정해지고 해마다 올라갑니다."],
    ["※ 여기 적은 아이 중 «교적부에 없는 아이» 에게만 «하늘아이» 표시가 붙습니다."],
    ["※ 이미 있는 아이를 적으면 그 아이의 정보만 고쳐집니다 — 주소록을 한꺼번에 고칠 때도 이 시트를 쓰세요."],
  ]);
  s2["!cols"] = Array(12).fill({ wch: 14 });
  X.utils.book_append_sheet(wb, s2, "올해중1");

  // 3) 교사간사
  const s3 = X.utils.aoa_to_sheet([
    ["이름", "구분", "생년월일", "전화번호", "비고"],
    ["김○○", "교사", "1990-01-01", "010-0000-0000", ""],
    ["이○○", "간사", "2000-01-01", "010-0000-0000", ""],
    [],
    ["※ «구분» 은 교역자 · 사모 · 교사 · 간사 중 하나입니다."],
    ["※ 생년을 모르면 «0000-05-05» 처럼 적으면 월·일만 저장됩니다(생일 명단에 나옵니다)."],
  ]);
  s3["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 26 }];
  X.utils.book_append_sheet(wb, s3, "교사간사");

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
