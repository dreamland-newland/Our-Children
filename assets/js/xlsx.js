// ============================================================
//  엑셀 내보내기 / 읽기 (SheetJS)
//  원본 출석부와 같은 5개 시트 구조로 통째 내려받습니다.
// ============================================================
import {
  state, birthdayList, versionCells, currentVersion, cellMembers, cellNameOf,
  birthYearOf,
  gradeOf, statusOf, isGraduated,
} from "./data.js";
import { toast, loadScript } from "./ui.js";
import { GROUP_NAME, GRADES } from "./config.js";

// SheetJS 는 저장소에 함께 들어 있습니다(assets/vendor). 인터넷 없이도 동작합니다.
/** 생년월일이 없으면 «태어난 해» 만이라도 (예: 2013) */
const birthCell = (s) => s?.birth || (birthYearOf(s) ? String(birthYearOf(s)) : "");

export async function loadXLSX() {
  if (!window.XLSX) await loadScript("./assets/vendor/xlsx.full.min.js");
  return window.XLSX;
}

const ORDER = GRADES;
const gradeRank = (g) => { const i = ORDER.indexOf(g); return i < 0 ? 99 : i; };
const gr = (s) => gradeRank(gradeOf(s));
const today = () => new Date().toISOString().slice(0, 10);

/** 교적부 전체를 .xlsx 한 파일로 (현재 선택된 셀편성 버전 기준) */
export async function exportWorkbook() {
  try {
    const X = await loadXLSX();
    const wb = X.utils.book_new();
    const v = currentVersion();

    // 1) 주소록
    const addr = [
      [`${new Date().getFullYear()}년 ${GROUP_NAME} 주소록`],
      ["연번", "이름", "성별", "학년", "학교", "생년월일", "전화번호",
       "어머니성함", "어머니연락처", "아버지성함", "아버지연락처",
       "형제관계", "집주소", "비고(특이사항)", "셀", "상태", "하늘아이"],
      ...[...state.students]
        .sort((a, b) => (a.seq || 0) - (b.seq || 0))
        .map((s, i) => [
          s.seq ?? i + 1, s.name, s.gender, gradeOf(s), s.school, birthCell(s), s.phone,
          s.mother_name, s.mother_phone, s.father_name, s.father_phone,
          s.siblings, s.address, s.note, cellNameOf(s.id) || "", statusOf(s),
          s.is_promoted ? "O" : "",
        ]),
    ];
    add(X, wb, "주소록", addr, [6, 10, 6, 8, 16, 12, 15, 11, 15, 11, 15, 18, 40, 24, 20, 8, 8]);

    // 2) 월별 생일명단 — 원본처럼 6개월씩 두 블록
    const bd = birthdayList();
    const blocks = [[1, 6], [7, 12]];
    const rows = [[`${GROUP_NAME} 월별 생일명단`]];
    for (const [from, to] of blocks) {
      const cols = [];
      for (let m = from; m <= to; m++) cols.push(bd.filter((b) => b.month === m));
      const head = [];
      for (let m = from; m <= to; m++) head.push(`${m}월`, "", "");
      rows.push(head);
      const depth = Math.max(...cols.map((c) => c.length), 0);
      for (let r = 0; r < depth; r++) {
        const line = [];
        for (const c of cols) {
          const e = c[r];
          line.push(e ? e.day : "", e ? e.name + (e.kind === "학생" ? "" : ` ${e.kind}`) : "", "");
        }
        rows.push(line);
      }
      rows.push([]);
    }
    add(X, wb, "월별 생일명단", rows, Array(18).fill(11));

    // 3) 셀편성 — 4개 블록씩 격자 (원본과 동일한 배치)
    const cs = versionCells();
    const latest = state.versions[0]?.id === v?.id;
    const grid = [[`${v ? v.label : ""} 셀편성`, "", "", "",
                   v ? `등록일 ${v.created_at.slice(0, 10)}` : ""]];
    for (let i = 0; i < cs.length; i += 4) {
      const group = cs.slice(i, i + 4);
      const head = [], sub = [];
      for (const c of group) { head.push(c.name, "", "", "", ""); sub.push("이름", "학년", "생년월일", "전화번호", ""); }
      grid.push(head, sub);
      const lists = group.map((c) => cellMembers(c.id).filter((s) => !latest || !isGraduated(s))
        .sort((a, b) => gr(a) - gr(b) || a.name.localeCompare(b.name, "ko")));
      const depth = Math.max(...lists.map((l) => l.length), 0);
      for (let r = 0; r < depth; r++) {
        const line = [];
        for (const l of lists) {
          const s = l[r];
          line.push(s ? s.name : "", s ? gradeOf(s) || "" : "", s ? birthCell(s) : "", s ? s.phone || "" : "", "");
        }
        grid.push(line);
      }
      grid.push([]);
    }
    add(X, wb, "셀편성", grid, Array(20).fill(12));

    // 4) 진급자(하늘아이)명단
    const promo = [
      ["올해 중1 주소록 (하늘아이 출신 포함)"],
      ["연번", "이름", "성별", "생년월일", "전화번호", "어머니성함", "어머니연락처",
       "아버지성함", "아버지연락처", "형제관계", "집주소", "비고/특이사항"],
      ...state.students.filter((s) => gradeOf(s) === "중1")
        .sort((a, b) => (a.gender === b.gender ? a.name.localeCompare(b.name, "ko") : a.gender === "남" ? -1 : 1))
        .map((s, i) => [i + 1, s.name, s.gender, birthCell(s), s.phone, s.mother_name, s.mother_phone,
                        s.father_name, s.father_phone, s.siblings, s.address, s.note]),
    ];
    add(X, wb, "진급자(하늘아이)명단", promo, [6, 10, 6, 12, 15, 11, 15, 11, 15, 20, 40, 22]);

    // 5) 교사간사연락처
    const tea = [
      [`${GROUP_NAME} 교사/간사 연락처`],
      ["연번", "이름", "구분", "생년월일", "전화번호", "비고/특이사항", "계정"],
      ...[...state.teachers].sort((a, b) => (a.seq || 0) - (b.seq || 0))
        .map((t, i) => [t.seq ?? i + 1, t.name, t.role, t.birth || t.birth_md || "",
                        t.phone, t.note, t.user_id ? "가입" : ""]),
    ];
    add(X, wb, "교사간사연락처", tea, [6, 10, 8, 13, 15, 22, 8]);

    saveWorkbook(X, wb, `${GROUP_NAME}_교적부_${today()}.xlsx`);
    toast("엑셀 파일을 내려받았습니다.");
  } catch (e) {
    console.error(e);
    toast("엑셀을 만들지 못했습니다: " + e.message, "err");
  }
}

/** 현재 셀편성 버전만 .xlsx 로 */
export async function exportCurrentVersion() {
  try {
    const X = await loadXLSX();
    const v = currentVersion();
    if (!v) return toast("내려받을 셀편성이 없습니다.", "err");
    const wb = X.utils.book_new();
    const rows = [
      [`${v.label} 셀편성`, `등록일 ${v.created_at.slice(0, 10)}`, v.note || ""],
      [],
      ["셀", "담당", "이름", "학년", "생년월일", "전화번호"],
    ];
    for (const c of versionCells(v.id)) {
      const ms = [...cellMembers(c.id)]
        .sort((a, b) => gr(a) - gr(b) || a.name.localeCompare(b.name, "ko"));
      if (!ms.length) { rows.push([c.name, (c.leaders || []).join(", "), "(없음)"]); continue; }
      ms.forEach((s, i) => rows.push([
        i === 0 ? c.name : "", i === 0 ? (c.leaders || []).join(", ") : "",
        s.name, gradeOf(s) || "", birthCell(s), s.phone || "",
      ]));
      rows.push([]);
    }
    add(X, wb, v.label.slice(0, 28), rows, [22, 16, 10, 8, 12, 15]);
    saveWorkbook(X, wb, `${GROUP_NAME}_셀편성_${v.label}_${v.created_at.slice(0, 10)}.xlsx`);
    toast("셀편성을 내려받았습니다.");
  } catch (e) {
    console.error(e);
    toast("엑셀을 만들지 못했습니다: " + e.message, "err");
  }
}

// ── 화면별 «지금 보이는 것» 내려받기 ──────────────────────
//   버튼 이름을 «📥 엑셀 받기» 로 통일했습니다 (CSV 대신).
//   isMasked 상태(비로그인)면 연락처 열은 아예 빼고 만듭니다.

/** 주소록 — 지금 화면의 걸러진 목록 그대로 */
export async function exportStudentList(rows, { masked = false, what = "주소록" } = {}) {
  try {
    const X = await loadXLSX();
    const wb = X.utils.book_new();
    const head = masked
      ? ["연번", "이름", "성별", "학년", "학교", "생년월일", "셀", "상태", "하늘아이"]
      : ["연번", "이름", "성별", "학년", "학교", "생년월일", "전화번호",
         "어머니성함", "어머니연락처", "아버지성함", "아버지연락처",
         "형제관계", "집주소", "비고(특이사항)", "셀", "상태", "하늘아이"];
    const body = rows.map((s, i) => masked
      ? [s.seq ?? i + 1, s.name, s.gender, gradeOf(s), s.school, birthCell(s),
         cellNameOf(s.id) || "", statusOf(s), s.is_promoted ? "O" : ""]
      : [s.seq ?? i + 1, s.name, s.gender, gradeOf(s), s.school, birthCell(s), s.phone,
         s.mother_name, s.mother_phone, s.father_name, s.father_phone,
         s.siblings, s.address, s.note, cellNameOf(s.id) || "", statusOf(s),
         s.is_promoted ? "O" : ""]);
    add(X, wb, what, [
      [`${GROUP_NAME} ${what}`, `${rows.length}명`, `${today()} 기준`],
      [],
      head, ...body,
    ], masked ? [6, 10, 6, 8, 14, 12, 16, 10, 8]
              : [6, 10, 6, 8, 14, 12, 15, 10, 15, 10, 15, 14, 34, 24, 16, 10, 8]);
    saveWorkbook(X, wb, `${GROUP_NAME}_${what}_${today()}.xlsx`);
    toast(masked ? "연락처를 뺀 명단을 내려받았습니다. 전체는 로그인 후 받을 수 있습니다."
                 : "엑셀로 내려받았습니다.");
  } catch (e) {
    console.error(e);
    toast("엑셀을 만들지 못했습니다: " + e.message, "err");
  }
}

/** 월별 생일명단 */
export async function exportBirthdays() {
  try {
    const X = await loadXLSX();
    const wb = X.utils.book_new();
    const bd = birthdayList();
    const rows = [[`${GROUP_NAME} 월별 생일명단`, `${bd.length}명`, `${today()} 기준`], [],
                  ["월", "일", "이름", "구분", "학년"]];
    for (let m = 1; m <= 12; m++) {
      const list = bd.filter((x) => x.month === m);
      if (!list.length) continue;
      list.forEach((x, i) => rows.push([i === 0 ? `${m}월` : "", x.day, x.name, x.kind, x.grade || ""]));
      rows.push([]);
    }
    add(X, wb, "월별생일명단", rows, [8, 6, 12, 10, 10]);
    saveWorkbook(X, wb, `${GROUP_NAME}_월별생일명단_${today()}.xlsx`);
    toast("엑셀로 내려받았습니다.");
  } catch (e) {
    console.error(e);
    toast("엑셀을 만들지 못했습니다: " + e.message, "err");
  }
}

/** 교사·간사 연락처 */
export async function exportTeachers({ masked = false } = {}) {
  try {
    const X = await loadXLSX();
    const wb = X.utils.book_new();
    const head = masked ? ["연번", "이름", "구분", "생일", "계정"]
                        : ["연번", "이름", "구분", "생년월일", "전화번호", "비고/특이사항", "계정"];
    const body = [...state.teachers]
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))
      .map((t, i) => masked
        ? [t.seq ?? i + 1, t.name, t.role, t.birth || t.birth_md || "", t.user_id ? "가입" : "미가입"]
        : [t.seq ?? i + 1, t.name, t.role, t.birth || t.birth_md || "", t.phone || "",
           t.note || "", t.user_id ? "가입" : "미가입"]);
    add(X, wb, "교사간사연락처", [
      [`${GROUP_NAME} 교사·간사 연락처`, `${body.length}명`, `${today()} 기준`], [], head, ...body,
    ], masked ? [6, 12, 10, 14, 10] : [6, 12, 10, 14, 16, 30, 10]);
    saveWorkbook(X, wb, `${GROUP_NAME}_교사간사연락처_${today()}.xlsx`);
    toast(masked ? "전화번호를 뺀 명단을 내려받았습니다. 전체는 로그인 후 받을 수 있습니다."
                 : "엑셀로 내려받았습니다.");
  } catch (e) {
    console.error(e);
    toast("엑셀을 만들지 못했습니다: " + e.message, "err");
  }
}

/** 브라우저에서 안전하게 내려받기 (SheetJS 의 writeFile 대신 Blob 사용) */
function saveWorkbook(X, wb, filename) {
  const out = X.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

function add(X, wb, name, aoa, widths) {
  const ws = X.utils.aoa_to_sheet(aoa);
  if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
  X.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31));
}
