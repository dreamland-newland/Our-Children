// ── 월별 생일명단 ──────────────────────────────────────────
import { state, birthdayList, isActive } from "../data.js";
import { esc, downloadCSV, toast } from "../ui.js";
import { showStudent } from "./students.js";

let filter = "all"; // all | student | staff

export function html() {
  const now = new Date();
  const M = now.getMonth() + 1, D = now.getDate();
  let list = birthdayList();
  if (filter === "student") list = list.filter((b) => b.kind === "학생");
  if (filter === "staff") list = list.filter((b) => b.kind !== "학생");

  const noBirth = state.students.filter((s) => !s.birth && isActive(s)).map((s) => s.name);

  return `
  <div class="page-head">
    <div>
      <h1>월별 생일명단</h1>
      <p>학생 ${birthdayList().filter((b) => b.kind === "학생").length}명 ·
         교사진 ${birthdayList().filter((b) => b.kind !== "학생").length}명 ·
         생년월일 기준으로 자동 정리됩니다.</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-primary btn-sm" id="jumpNow">📅 이번 달(${M}월)로 가기</button>
      <select id="who" style="width:auto">
        <option value="all"${filter === "all" ? " selected" : ""}>전체</option>
        <option value="student"${filter === "student" ? " selected" : ""}>학생만</option>
        <option value="staff"${filter === "staff" ? " selected" : ""}>교사·간사만</option>
      </select>
      <button class="btn btn-sm" id="csvBtn">CSV 내려받기</button>
    </div>
  </div>

  <div class="grid grid-4">
    ${Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
      const rows = list.filter((b) => b.month === m);
      return `
      <section class="card month-card${m === M ? " now" : ""}"${m === M ? ' id="nowMonth"' : ""}>
        <div class="m-head">
          <b>${m}월</b>
          <span style="font-size:12px;color:var(--text-muted)">${rows.length}명</span>
        </div>
        ${rows.length ? `<ul>${rows.map((b) => `
          <li class="${m === M && b.day === D ? "today" : ""}"
              ${b.kind === "학생" ? `data-student="${b.ref.id}" style="cursor:pointer"` : ""}>
            <span class="d">${b.day}</span>
            <span>${esc(b.name)}</span>
            ${b.kind !== "학생" ? `<span class="badge blue" style="margin-left:auto">${esc(b.kind)}</span>`
              : `<span class="d" style="margin-left:auto;width:auto">${esc(b.grade || "")}</span>`}
          </li>`).join("")}</ul>`
          : `<div class="empty" style="padding:18px 0;font-size:12.5px">없음</div>`}
      </section>`;
    }).join("")}
  </div>

  ${noBirth.length ? `
  <div class="card card-pad" style="margin-top:16px">
    <div style="font-size:13px;color:var(--text-secondary)">
      <b>생년월일 미등록 ${noBirth.length}명</b> — ${esc(noBirth.join(", "))}
      <div style="color:var(--text-muted);margin-top:3px;font-size:12.5px">
        주소록에서 생년월일을 입력하면 이 명단에 자동으로 나타납니다.</div>
    </div>
  </div>` : ""}`;
}

export function mount(root, rerender) {
  const jump = () => {
    const el = root.querySelector("#nowMonth");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1400);
  };
  root.querySelector("#jumpNow")?.addEventListener("click", jump);
  root.querySelector("#who").addEventListener("change", (e) => { filter = e.target.value; rerender(); });
  root.querySelectorAll("[data-student]").forEach((li) => li.addEventListener("click", () =>
    showStudent(state.students.find((s) => s.id === li.dataset.student), rerender)));
  root.querySelector("#csvBtn").addEventListener("click", () => {
    downloadCSV("꿈땅새땅_월별생일명단.csv", ["월", "일", "이름", "구분", "학년"],
      birthdayList().map((b) => [b.month, b.day, b.name, b.kind, b.grade || ""]));
    toast("CSV 파일을 내려받았습니다.");
  });
}
