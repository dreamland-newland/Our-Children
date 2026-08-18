// ── 올해 중1 (하늘아이에서 올라온 아이들 포함) ───────────────
import { state, cellNameOf, isLoggedIn, isMasked, photoOf, gradeOf, isActive, schoolYear } from "../data.js";
import { esc, dash, telLink, avatar } from "../ui.js";
import { showStudent, editStudent } from "./students.js";

export function html() {
  const rows = state.students
    .filter((s) => gradeOf(s) === "중1" && isActive(s))
    .sort((a, b) => (a.gender === b.gender ? a.name.localeCompare(b.name, "ko") : a.gender === "남" ? -1 : 1));

  const male = rows.filter((r) => r.gender === "남").length;

  return `
  <div class="page-head">
    <div>
      <h1>올해 중1 — 새로 올라온 아이들</h1>
      <p>${schoolYear()}학년도 중1 · ${rows.length}명 (남 ${male} · 여 ${rows.length - male}) ·
         그중 <b>하늘아이</b> 출신 ${rows.filter((s) => s.is_promoted).length}명
         ${isMasked() ? "· 연락처·보호자 정보는 <b>로그인해야</b> 보입니다." : ""}</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-sm" id="csvBtn">📥 엑셀 받기</button>
      ${isLoggedIn() ? `<button class="btn btn-primary btn-sm" id="addBtn">＋ 새 친구 등록</button>` : ""}
    </div>
  </div>

  <div class="card table-wrap">
    ${rows.length ? `
    <table class="data">
      <thead><tr>
        <th>#</th><th>이름</th><th>성별</th><th>생년월일</th><th>셀</th>
        ${isMasked() ? "" : `<th>전화번호</th><th>어머니</th><th>아버지</th>
        <th>형제관계</th><th>특이사항</th>`}
      </tr></thead>
      <tbody>
        ${rows.map((s, i) => `
        <tr class="clickable" data-id="${s.id}">
          <td class="num">${i + 1}</td>
          <td><span style="display:inline-flex;align-items:center;gap:8px">
              ${avatar(s.name, photoOf(s.id), 26)}<b>${esc(s.name)}</b></span>
              ${s.is_promoted ? ' <span class="badge blue">하늘아이</span>' : ""}</td>
          <td>${dash(s.gender)}</td>
          <td class="num">${s.birth ? esc(s.birth) : (s.birth_year ? esc(s.birth_year) + "년" : "—")}</td>
          <td>${cellNameOf(s.id) ? esc(cellNameOf(s.id)) : '<span class="badge">미배정</span>'}</td>
          ${isMasked() ? "" : `<td>${telLink(s.phone)}</td>
          <td>${dash(s.mother_name)}${s.mother_phone ? " · " + telLink(s.mother_phone) : ""}</td>
          <td>${dash(s.father_name)}${s.father_phone ? " · " + telLink(s.father_phone) : ""}</td>
          <td>${dash(s.siblings)}</td>
          <td class="wrap" style="color:var(--text-secondary)">${dash(s.note)}</td>`}
        </tr>`).join("")}
      </tbody>
    </table>` : `<div class="empty">올해 중1로 올라온 아이가 아직 없습니다.</div>`}
  </div>

  ${(() => {
    const fixed = rows.filter((s) => s.grade && !s.birth).map((s) => s.name);
    return fixed.length ? `
    <div class="card card-pad" style="margin-top:16px;font-size:13px;color:var(--text-secondary)">
      <b>생년월일이 없어 학년을 직접 지정해 둔 아이 ${fixed.length}명</b> — ${esc(fixed.join(", "))}
      <div style="color:var(--text-muted);margin-top:3px;font-size:12.5px">
        주소록에서 생년월일을 채우고 학년을 «자동» 으로 두면, 해가 바뀔 때 저절로 올라갑니다.</div>
    </div>` : "";
  })()}

  <div class="card card-pad" style="margin-top:16px;font-size:13px;color:var(--text-secondary)">
    이 명단은 <b>생년월일에서 자동으로</b> 만들어집니다. 해가 바뀌면 새 중1이 저절로 채워지고
    지금 아이들은 중2로 넘어갑니다. <b>하늘아이</b>는 초등부 부서 이름이며, 주소록에서 학생을 편집할 때
    «하늘아이» 를 체크해 두면 배지로 구분해 보여줍니다.
  </div>`;
}

export function mount(root, rerender) {
  root.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    showStudent(state.students.find((s) => s.id === tr.dataset.id), rerender);
  }));
  root.querySelector("#addBtn")?.addEventListener("click", () =>
    editStudent({ is_promoted: true, status: "재적" }, rerender));
  root.querySelector("#csvBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "만드는 중…";
    try {
      const { exportStudentList } = await import("../xlsx.js");
      const rows = state.students.filter((s) => gradeOf(s) === "중1" && isActive(s));
      await exportStudentList(rows, { masked: isMasked(), what: "올해 중1" });
    } finally { btn.disabled = false; btn.textContent = "📥 엑셀 받기"; }
  });

}
