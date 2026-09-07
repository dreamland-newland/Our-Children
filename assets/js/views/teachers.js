// ── 교사 / 간사 연락처 ─────────────────────────────────────
import { state, api, isLoggedIn, isAdmin, teacherPhotoOf, roleLabels, roleOptionRank } from "../data.js";
import {
  esc, dash, telLink, fmtBirth, modal, toast, confirmDialog, avatar, byName, cropImage, blobToDataURL,
} from "../ui.js";
import { bindDownload as bindXlsx } from "../xlsx.js";

// 정렬 상태 — 칸 머리를 눌러 마음대로 바꿀 수 있습니다.
// 처음에는 «구분» 순서(직함 관리에서 정한 차례대로 — 담임이 맨 위)로 보여 줍니다.
const f = { sort: "role", dir: 1 };

const COLS = [
  { key: "seq",   label: "#" },
  { key: "name",  label: "이름" },
  { key: "role",  label: "구분" },
  { key: "birth", label: "생년월일" },
  { key: "phone", label: "전화번호", masked: true },
  { key: "note",  label: "비고",     masked: true },
  { key: "user",  label: "계정" },
];

function sortedRows() {
  const rows = [...state.teachers];
  const key = f.sort;
  rows.sort((a, b) => {
    let x, y;
    if (key === "role") {
      // 같은 직함끼리는 이름 순으로 (직함 차례는 «직함 관리» 에서 정한 그대로)
      const ra = roleOptionRank(a.role), rb = roleOptionRank(b.role);
      if (ra !== rb) return (ra - rb) * f.dir;
      return byName(a.name, b.name);
    }
    else if (key === "user") { x = a.user_id ? 1 : 0; y = b.user_id ? 1 : 0; }
    else if (key === "name") { return byName(a.name, b.name) * f.dir; }
    else { x = a[key]; y = b[key]; }
    if (x === null || x === undefined || x === "") return 1;
    if (y === null || y === undefined || y === "") return -1;
    return (typeof x === "number" ? x - y : byName(String(x), String(y))) * f.dir;
  });
  return rows;
}

export function html() {
  const rows = sortedRows();
  const claimed = rows.filter((t) => t.user_id).length;

  return `
  <div class="page-head">
    <div>
      <h1>교사 · 간사 연락처</h1>
      <p>${rows.length}명 · ${claimed}명 계정 연결됨 · 가입은 <b>관리자 승인</b>으로 열립니다.</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-sm" id="xlsxBtn">📥 엑셀 받기</button>
      ${isAdmin() ? `<button class="btn btn-sm${state.pendingCount ? " btn-primary" : ""}" id="adminSettings">
                       ⚙️ 관리자 설정${state.pendingCount
                         ? ` <span class="badge orange" style="margin-left:2px">${state.pendingCount}</span>` : ""}</button>` : ""}
      ${isLoggedIn() ? `<button class="btn btn-primary btn-sm" id="addBtn">＋ 교사·간사 등록</button>` : ""}
    </div>
  </div>

  ${isAdmin() && state.pendingCount ? `
  <div class="card card-pad" style="margin-bottom:16px;display:flex;gap:12px;align-items:center;
       flex-wrap:wrap;border-color:var(--warning)">
    <span class="badge orange">승인 대기 ${state.pendingCount}건</span>
    <span style="font-size:13.5px">가입을 신청한 분이 있습니다. 아는 분이 맞는지 확인하고 승인해 주세요.</span>
    <button class="btn btn-primary btn-sm" id="accounts2" style="margin-left:auto">확인하기</button>
  </div>` : ""}

  <div class="card table-wrap">
    <table class="data roster r-teachers">
      <thead><tr>${headRow()}</tr></thead>
      <tbody>
        ${rows.map((t, i) => `
        <tr class="clickable" data-id="${t.id}">
          <td class="num" title="교적 번호 ${t.seq ?? "-"}">${i + 1}</td>
          <td><span style="display:inline-flex;align-items:center;gap:8px">
              ${avatar(t.name, teacherPhotoOf(t.id), 26)}
              <b>${esc(t.name)}</b></span></td>
          <td><span class="badge ${t.role === "간사" ? "" : "blue"}">${esc(t.role)}</span></td>
          <td class="num">${t.birth ? esc(fmtBirth(t.birth, false))
            : t.birth_md ? esc(t.birth_md.replace("-", "월 ") + "일") : "—"}</td>
          ${isLoggedIn() ? `<td>${telLink(t.phone)}</td>
          <td class="wrap" style="color:var(--text-secondary)">${dash(t.note)}</td>` : ""}
          <td>${t.user_id ? '<span class="badge good">가입</span>' : '<span class="badge">미가입</span>'}</td>
          ${isLoggedIn() ? `<td>
            <button class="btn btn-ghost btn-sm" data-edit="${t.id}">편집</button></td>` : ""}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <div class="card card-pad" style="margin-top:16px;font-size:13px;color:var(--text-secondary)">
    새로 오신 교사·간사는 이 명단에 먼저 등록돼 있어야 회원가입이 가능합니다.
    로그인 후 <b>＋ 교사·간사 등록</b>으로 이름과 휴대폰번호를 추가해 주세요.
    ${!isLoggedIn() ? `<div style="margin-top:6px">
      전화번호는 계정 사칭을 막기 위해 <b>로그인해야</b> 보입니다.</div>` : ""}
  </div>`;
}

/** 표 머리 — 눌러서 정렬을 마음대로 바꿉니다 */
function headRow() {
  return COLS.filter((c) => !(c.masked && !isLoggedIn())).map((c) => {
    const sorted = f.sort === c.key;
    return `
    <th class="hcol">
      <button class="hsort${sorted ? " on" : ""}" data-sort="${c.key}"
        title="이 칸으로 정렬">${esc(c.label)}${sorted ? (f.dir > 0 ? " ↑" : " ↓") : ""}</button>
    </th>`;
  }).join("") + (isLoggedIn() ? "<th></th>" : "");
}

/** 이름을 누르면 뜨는 신상 — 학생 주소록과 같은 방식입니다 */
export function showTeacher(t, after) {
  if (!t) return;
  const canEdit = isLoggedIn();
  modal({
    title: `${t.name} · ${t.role || ""}`,
    body: `
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:18px">
        ${avatar(t.name, teacherPhotoOf(t.id), 76)}
        <div>
          <div style="font-size:19px;font-weight:680">${esc(t.name)}</div>
          <div style="font-size:13px;color:var(--text-secondary)">${esc(t.role || "")}</div>
          ${!isLoggedIn() && !teacherPhotoOf(t.id)
            ? '<div style="font-size:12px;color:var(--text-muted);margin-top:3px">🔒 사진은 로그인한 교사진에게만 보입니다</div>' : ""}
        </div>
      </div>
      <div class="detail-grid">
        <dt>이름</dt><dd><b>${esc(t.name)}</b></dd>
        <dt>구분</dt><dd><span class="badge ${t.role === "간사" ? "" : "blue"}">${esc(t.role)}</span></dd>
        <dt>생일</dt><dd>${t.birth ? esc(fmtBirth(t.birth))
          : t.birth_md ? esc(t.birth_md.replace("-", "월 ") + "일") +
              ' <span style="color:var(--text-muted);font-size:12px">(연도 미등록)</span>'
          : dash("")}</dd>
        <dt>연락처</dt><dd>${isLoggedIn() ? telLink(t.phone)
          : '<span style="color:var(--text-muted)">🔒 로그인 후 표시</span>'}</dd>
        <dt>계정</dt><dd>${t.user_id
          ? '<span class="badge good">가입</span> <span style="color:var(--text-muted);font-size:12px">이 명부 자리에 계정이 연결돼 있습니다</span>'
          : '<span class="badge">미가입</span> <span style="color:var(--text-muted);font-size:12px">아직 회원가입 전입니다</span>'}</dd>
      </div>
      <div class="section-label">비고</div>
      <div style="font-size:14px">${isLoggedIn()
        ? (t.note ? esc(t.note) : '<span style="color:var(--text-muted)">기록된 비고가 없습니다.</span>')
        : '<span style="color:var(--text-muted)">🔒 로그인 후 표시</span>'}</div>`,
    footer: canEdit
      ? `<button class="btn" data-close>닫기</button>
         <button class="btn btn-primary" data-edit>편집</button>`
      : `<button class="btn" data-close>닫기</button>`,
    onMount(box, close) {
      box.querySelector("[data-edit]")?.addEventListener("click", () => { close(); editTeacher(t, after); });
    },
  });
}

export function mount(root, rerender) {
  root.querySelector("#adminSettings")?.addEventListener("click", () => openAdminSettings(rerender));
  root.querySelector("#accounts2")?.addEventListener("click", () => openAdminSettings(rerender, "accounts"));
  root.querySelector("#addBtn")?.addEventListener("click", () => editTeacher(null, rerender));
  root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    editTeacher(state.teachers.find((t) => t.id === b.dataset.edit), rerender);
  }));
  // 줄(이름)을 누르면 신상이 열립니다 — 주소록과 같은 방식
  root.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("a,[data-edit]")) return;
    showTeacher(state.teachers.find((t) => t.id === tr.dataset.id), rerender);
  }));
  root.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.sort;
    if (f.sort === k) f.dir *= -1; else { f.sort = k; f.dir = 1; }
    rerender();
  }));
  bindXlsx(root.querySelector("#xlsxBtn"), async () => {
    const { exportTeachers } = await import("../xlsx.js");
    await exportTeachers({ masked: !isLoggedIn() });
  });

}

// ════════════════════════════════════════════════════════════
//  관리자 설정 — 가입 승인·계정 / 가입 신청 / 알림 / 직함 관리를
//  «설정» 한 곳에 모아 두고, 왼쪽 목록에서 골라 보는 방식으로 묶었습니다.
// ════════════════════════════════════════════════════════════
const SETTINGS_SECTIONS = [
  { key: "accounts", icon: "👥", label: "가입 승인 · 계정", desc: "새 신청 승인 · 관리자 지정 · 계정 해제",
    render: paneAccounts, badge: () => state.pendingCount || 0 },
  { key: "signup",   icon: "🔐", label: "가입 신청 설정",   desc: "신청을 받을지 말지", render: paneSignup },
  { key: "notify",   icon: "🔔", label: "알림 설정",        desc: "가입 신청 메일 받을 주소", render: paneNotify },
  { key: "roles",    icon: "🏷️", label: "직함 관리",        desc: "구분 추가 · 이름 변경 · 차례", render: paneRoles },
];

const isPhone = () => window.matchMedia("(max-width: 640px)").matches;

function openAdminSettings(after, initial = "accounts") {
  //  · PC   — 왼쪽 목록 + 오른쪽 내용 (맥 설정처럼)
  //  · 휴대폰 — 먼저 목록만 보여 주고, 하나를 누르면 그 화면으로 들어갑니다 (아이폰 설정처럼)
  const phone = isPhone();
  let sec = phone ? null : initial;

  const shell = document.createElement("div");
  shell.className = "settings-shell";
  const navEl = document.createElement("div");
  navEl.className = "settings-nav";
  const paneEl = document.createElement("div");
  paneEl.className = "settings-pane";

  const secOf = (k) => SETTINGS_SECTIONS.find((x) => x.key === k);

  /** PC 왼쪽 목록 */
  const drawNav = () => {
    navEl.innerHTML = SETTINGS_SECTIONS.map((s) => {
      const badge = s.badge?.();
      return `
      <button type="button" class="snav-item${sec === s.key ? " on" : ""}" data-sec="${s.key}">
        <span class="snav-ico">${s.icon}</span><span class="snav-label">${esc(s.label)}</span>
        ${badge ? `<span class="badge orange" style="margin-left:auto">${badge}</span>` : ""}
      </button>`;
    }).join("");
    navEl.querySelectorAll("[data-sec]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.sec === sec) return;
      sec = b.dataset.sec; drawNav(); drawPane();
    }));
  };

  /** 휴대폰 첫 화면 — 큼직한 목록 */
  const phoneListHtml = () => `
    <div class="sset-list">
      ${SETTINGS_SECTIONS.map((s) => {
        const badge = s.badge?.();
        return `
        <button type="button" class="sset-row" data-sec="${s.key}">
          <span class="sset-ico">${s.icon}</span>
          <span class="sset-text"><b>${esc(s.label)}</b><small>${esc(s.desc)}</small></span>
          ${badge ? `<span class="badge orange">${badge}</span>` : ""}
          <span class="sset-chev" aria-hidden="true">›</span>
        </button>`;
      }).join("")}
    </div>`;

  const drawPane = () => {
    paneEl.innerHTML = "";
    secOf(sec).render(paneEl, () => { if (!phone) drawNav(); after?.(); });
  };

  /** 창 전체를 다시 그립니다 (휴대폰에서 목록 ↔ 내용 오갈 때) */
  const draw = () => {
    shell.innerHTML = "";
    if (phone && sec === null) {
      shell.classList.add("sset-root");
      shell.innerHTML = phoneListHtml();
      shell.querySelectorAll("[data-sec]").forEach((b) => b.addEventListener("click", () => {
        sec = b.dataset.sec; draw();
      }));
      return;
    }
    shell.classList.remove("sset-root");
    if (phone) {
      const bar = document.createElement("div");
      bar.className = "sset-back";
      bar.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-back>‹ 설정</button>
                       <b>${esc(secOf(sec).label)}</b>`;
      bar.querySelector("[data-back]").addEventListener("click", () => { sec = null; draw(); });
      shell.append(bar, paneEl);
    } else {
      drawNav();
      shell.append(navEl, paneEl);
    }
    drawPane();
  };
  draw();

  modal({
    title: "관리자 설정", wide: true, body: shell,
    footer: `<button class="btn" data-close>닫기</button>`,
  });
}

// ── 직함 관리 (담임목사·교역자 등, 관리자가 늘리고 줄이고 이름 바꾸기) ──
function paneRoles(pane, after) {
  const draw = () => {
    const list = [...state.roleOptions].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const usedBy = (label) => state.teachers.filter((t) => t.role === label).length;
    pane.innerHTML = `
      <div class="form-note" style="margin-top:0">
        여기서 늘리고 줄이고 이름을 바꾼 직함이 <b>교사·간사 등록</b> 화면의 «구분» 목록에 그대로 나옵니다.
        ${!list.length ? `<div style="margin-top:6px;color:var(--critical)">
          아직 설치되지 않았을 수 있습니다 — <b>supabase/08_role_options.sql</b> 을 한 번 실행해 주세요.
          (실행 전에는 기존 다섯 가지 직함이 그대로 쓰입니다)</div>` : ""}
      </div>
      <div class="role-list">
        ${list.map((r, i) => `
        <div class="role-row">
          <div class="role-move">
            <button type="button" class="btn btn-ghost btn-sm" data-up="${r.id}" ${i === 0 ? "disabled" : ""}
              title="위로">▲</button>
            <button type="button" class="btn btn-ghost btn-sm" data-down="${r.id}" ${i === list.length - 1 ? "disabled" : ""}
              title="아래로">▼</button>
          </div>
          <b class="role-name">${esc(r.label)}</b>
          <span class="role-count">${usedBy(r.label)}명</span>
          <div class="role-acts">
            <button type="button" class="btn btn-sm" data-ren="${r.id}">이름 바꾸기</button>
            <button type="button" class="btn btn-sm btn-danger" data-del="${r.id}">삭제</button>
          </div>
        </div>`).join("") || `<div class="empty" style="padding:20px 0">직함이 없습니다.</div>`}
      </div>
      <div class="role-add">
        <input type="text" id="newRole" placeholder="새 직함 이름 (예: 청년교사)">
        <button type="button" class="btn btn-primary btn-sm" id="addRole">추가</button>
      </div>`;
    bind();
  };

  const act = async (fn) => {
    try { await fn(); draw(); after?.(); }
    catch (e) { toast(e.message, "err"); }
  };

  const renamePrompt = (id) => {
    const r = state.roleOptions.find((x) => x.id === id);
    const form = document.createElement("form");
    form.id = "renForm";
    form.innerHTML = `<div class="field"><label>새 이름</label>
      <input type="text" name="label" required value="${esc(r?.label || "")}"></div>`;
    modal({
      title: "직함 이름 바꾸기", narrow: true, body: form,
      footer: `<button class="btn" data-close>취소</button>
               <button class="btn btn-primary" form="renForm" type="submit">저장</button>`,
      onMount(box, close) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const v = new FormData(form).get("label").trim();
          try { await api.renameRoleOption(id, v); close(); draw(); after?.(); toast("직함 이름을 바꿨습니다."); }
          catch (err) { toast(err.message, "err"); }
        });
      },
    });
  };

  const bind = () => {
    pane.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () =>
      act(() => api.moveRoleOption(b.dataset.up, -1))));
    pane.querySelectorAll("[data-down]").forEach((b) => b.addEventListener("click", () =>
      act(() => api.moveRoleOption(b.dataset.down, 1))));
    pane.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      const r = state.roleOptions.find((x) => x.id === b.dataset.del);
      if (!(await confirmDialog(`«${r.label}» 직함을 지울까요?`))) return;
      act(() => api.deleteRoleOption(b.dataset.del));
    }));
    pane.querySelectorAll("[data-ren]").forEach((b) => b.addEventListener("click", () => renamePrompt(b.dataset.ren)));
    pane.querySelector("#addRole")?.addEventListener("click", () => {
      const el = pane.querySelector("#newRole");
      const v = el.value.trim();
      if (!v) return;
      el.value = "";
      act(() => api.addRoleOption(v));
    });
    pane.querySelector("#newRole")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); pane.querySelector("#addRole").click(); }
    });
  };

  draw();
}

// ── 가입 신청 알림 메일 ────────────────────────────────────
async function paneNotify(pane) {
  let st = null;
  try { st = await api.notifyStatus(); }
  catch (e) { pane.innerHTML = `<div class="form-note" style="margin-top:0">${esc(e.message)}</div>`; return; }

  // 아직 06_notify_email.sql 을 실행하지 않은 교적부
  if (!st) {
    pane.innerHTML = `
      <div class="form-note" style="margin-top:0">
        아직 <b>알림 기능이 설치되지 않았습니다.</b>
        <div style="margin-top:8px">
          저장소의 <b>supabase/06_notify_email.sql</b> 파일 맨 위 안내를 따라
          한 번만 설정하면, 가입 신청이 들어올 때 <b>메일로 바로 알려 드립니다.</b>
          (무료 · 10분 정도 걸립니다)
        </div>
      </div>`;
    return;
  }

  const draw = () => {
    pane.innerHTML = `
      ${st.ready ? "" : `<div class="form-note warn-note" style="margin:0 0 12px">
        <b>메일 보내는 곳이 아직 연결되지 않았습니다.</b>
        <b>supabase/06_notify_email.sql</b> 맨 아래 «설정 넣기» 를 마쳐 주세요.</div>`}
      <div class="form-note" style="margin:0 0 14px">
        가입 신청이 들어오면 아래 주소로 <b>바로 메일</b>이 갑니다.
        신청자의 이름·휴대폰번호·아이디가 담겨 있어, 아는 분인지 바로 확인하실 수 있습니다.
        ${st.from_email ? `<div style="margin-top:6px;color:var(--text-muted)">
          보내는 사람: ${esc(st.from_email)}</div>` : ""}
      </div>
      <div class="field">
        <label>알림 받을 메일 주소</label>
        <textarea id="nEmails" rows="3"
          placeholder="you@example.com&#10;다른분@example.com">${esc((st.to_emails || []).join("\n"))}</textarea>
        <span class="hint">한 줄에 하나씩. 여러 명이 함께 받을 수 있습니다.</span>
      </div>
      <label class="chk" style="margin-top:10px">
        <input type="checkbox" id="nOn"${st.enabled ? " checked" : ""}>
        <span>알림 메일 보내기</span></label>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button type="button" class="btn btn-sm" id="nTest">시험 메일 보내기</button>
        <button type="button" class="btn btn-primary btn-sm" id="nSave">저장</button>
      </div>`;

    const emails = () => pane.querySelector("#nEmails").value
      .split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

    pane.querySelector("#nSave").addEventListener("click", async () => {
      const list = emails();
      const bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      if (bad.length) return toast(`메일 주소가 이상합니다: ${bad[0]}`, "err");
      try {
        await api.setNotifyEmails(list, pane.querySelector("#nOn").checked);
        toast(list.length ? `${list.length}곳으로 알림이 갑니다.` : "알림 받을 주소를 비웠습니다.");
      } catch (e) { toast(e.message, "err"); }
    });

    pane.querySelector("#nTest").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const list = emails();
      if (!list.length) return toast("먼저 받을 주소를 적어 주세요.", "err");
      btn.disabled = true; btn.textContent = "보내는 중…";
      try {
        await api.setNotifyEmails(list, pane.querySelector("#nOn").checked);
        const ok = await api.notifyTest();
        toast(ok ? "시험 메일을 보냈습니다. 1분 안에 도착합니다."
                 : "아직 메일 설정이 끝나지 않았습니다 (06_notify_email.sql 확인).",
              ok ? "" : "err");
      } catch (err) { toast(err.message, "err"); }
      finally { btn.disabled = false; btn.textContent = "시험 메일 보내기"; }
    });
  };
  draw();
}

// ── 가입 승인 · 계정 · 관리자 권한 ──────────────────────────
async function paneAccounts(pane, after) {
  let rows = [], pool = [];
  try {
    rows = await api.listAccounts();
    pool = await api.unlinkedTeachers().catch(() => []);
  } catch (e) { pane.innerHTML = `<div class="form-note" style="margin-top:0">${esc(e.message)}</div>`; return; }

  /** 관리자가 «이 사람은 명부의 누구» 인지 고르는 칸 */
  const teacherSelect = (r) => {
    const opts = [...pool];
    // 이미 연결돼 있는 교사도 목록에 남겨 둡니다(그대로 두기 선택지)
    if (r.teacher_id && !opts.some((t) => t.id === r.teacher_id))
      opts.unshift({ id: r.teacher_id, name: r.teacher_name || "(연결됨)", role: "" });
    return `<select data-teacher="${r.id}" style="width:auto;max-width:190px;font-size:13px">
      <option value="">명부 연결 안 함</option>
      ${opts.map((t) => `<option value="${t.id}"${t.id === r.teacher_id ? " selected" : ""}
        >${esc(t.name)}${t.role ? ` (${esc(t.role)})` : ""}</option>`).join("")}
    </select>`;
  };

  const draw = () => {
    const admins = rows.filter((r) => r.is_admin && r.approved).length;
    const pending = rows.filter((r) => !r.approved);
    const live = rows.filter((r) => r.approved);

    pane.innerHTML = `
      ${pending.length ? `
      <div class="section-label" style="margin-top:0">
        승인 대기 <span class="badge orange">${pending.length}</span></div>
      <div class="form-note" style="margin-top:0">
        <b>아는 분이 맞는지 확인한 뒤 승인해 주세요.</b> 승인 전에는 로그인해도 아이들 연락처가 보이지 않습니다.
        명부에 있는 분이면 오른쪽에서 <b>본인 자리를 골라</b> 주세요.
      </div>
      <div style="border:1px solid var(--warning);border-radius:10px;overflow:hidden;margin-bottom:18px">
        ${pending.map((r) => `
        <div style="display:flex;align-items:center;gap:11px;padding:12px 14px;
                    border-bottom:1px solid var(--grid);flex-wrap:wrap">
          ${avatar(r.name, null, 34)}
          <div style="min-width:130px;flex:1">
            <div style="font-size:14px;font-weight:620">${esc(r.name)}
              ${r.teacher_name ? `<span class="badge blue" style="margin-left:4px"
                title="본인이 «나예요!» 로 고른 자리입니다">나예요! ${esc(r.teacher_name)}</span>` : ""}</div>
            <div style="font-size:12px;color:var(--text-muted)">
              @${esc(r.username)}${r.phone ? ` · ${esc(r.phone)}` : ""}
              ${r.created_at ? ` · ${String(r.created_at).slice(0, 10)} 신청` : ""}</div>
          </div>
          ${teacherSelect(r)}
          <div style="display:flex;gap:6px;flex:0 0 auto">
            <button class="btn btn-sm btn-primary" data-approve="${r.id}">승인</button>
            <button class="btn btn-sm btn-danger" data-revoke="${r.id}">거절</button>
          </div>
        </div>`).join("")}
      </div>` : `
      <div class="form-note" style="margin-top:0">승인을 기다리는 신청이 없습니다.</div>`}

      <div class="section-label">쓰고 있는 계정 ${live.length}개</div>
      <div class="form-note" style="margin-top:0">
        <b>관리자는 여러 명 둘 수 있습니다.</b> 담당이 바뀌면 새 담당자를 관리자로 지정한 뒤
        본인 권한을 내리시면 됩니다. 마지막 관리자는 내려올 수 없으니 교적부가 잠길 걱정은 없습니다.
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
        ${live.map((r) => `
        <div style="display:flex;align-items:center;gap:11px;padding:11px 14px;
                    border-bottom:1px solid var(--grid);flex-wrap:wrap">
          ${avatar(r.name, null, 34)}
          <div style="min-width:130px;flex:1">
            <div style="font-size:14px;font-weight:620">
              ${esc(r.name)} <span style="font-weight:400;color:var(--text-muted)">${esc(r.role)}</span>
              ${r.is_admin ? '<span class="badge blue" style="margin-left:4px">관리자</span>' : ""}
              ${r.is_me ? '<span class="badge" style="margin-left:2px">나</span>' : ""}
              ${!r.teacher_id ? '<span class="badge warn" style="margin-left:2px" title="교사·간사 명단에는 나오지 않습니다">명부 밖</span>' : ""}
            </div>
            <div style="font-size:12px;color:var(--text-muted)">
              @${esc(r.username)}${r.created_at ? ` · ${String(r.created_at).slice(0, 10)} 가입` : ""}</div>
          </div>
          ${teacherSelect(r)}
          <div style="display:flex;gap:6px;flex:0 0 auto">
            ${r.is_admin
              ? `<button class="btn btn-sm" data-demote="${r.id}"
                   ${admins <= 1 ? "disabled title='마지막 관리자입니다'" : ""}>관리자 내리기</button>`
              : `<button class="btn btn-sm btn-primary" data-promote="${r.id}">관리자로</button>`}
            <button class="btn btn-sm btn-danger" data-revoke="${r.id}">계정 해제</button>
          </div>
        </div>`).join("")}
      </div>
      <div class="hintbox" style="margin-top:10px;font-size:12px;color:var(--text-muted)">
        가운데 칸에서 <b>명부 연결</b>을 언제든 바꿀 수 있습니다. 연결된 분만 교사·간사 명단과
        생일명단에 나옵니다.<br>
        «계정 해제»·«거절» 은 로그인 권한만 거둡니다. 교적 자료는 그대로 남고,
        같은 아이디로 다시 신청할 수 있습니다.
      </div>`;
    bind();
  };

  const reload = async () => {
    rows = await api.listAccounts().catch(() => rows);
    pool = await api.unlinkedTeachers().catch(() => pool);
  };

  const act = async (fn, msg) => {
    try {
      await fn();
      await reload();
      await api.refresh();
      toast(msg);
      draw();
      after?.();
    } catch (e) { toast(e.message, "err"); await reload(); draw(); }
  };

  const chosenTeacher = (id) => pane.querySelector(`[data-teacher="${id}"]`)?.value || null;

  const bind = () => {
    pane.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", async () => {
      const r = rows.find((x) => x.id === b.dataset.approve);
      const tid = chosenTeacher(r.id);
      const tName = tid ? (pool.find((t) => t.id === tid)?.name || r.teacher_name) : null;
      if (!(await confirmDialog(
        `${r.name} 님의 가입을 승인할까요?` +
        (tName ? ` 교사·간사 명부의 «${tName}» 자리에 연결됩니다.`
               : " 명부에는 연결하지 않습니다 (교사·간사 명단에 나오지 않습니다)."),
        { danger: false, okText: "승인" }))) return;
      act(() => api.approveAccount(r.id, tid), `${r.name} 님의 가입을 승인했습니다.`);
    }));

    pane.querySelectorAll("[data-teacher]").forEach((sel) => sel.addEventListener("change", async () => {
      const r = rows.find((x) => x.id === sel.dataset.teacher);
      if (!r.approved) return;                 // 대기 중인 건 «승인» 누를 때 함께 반영됩니다
      const tid = sel.value || null;
      act(() => api.setAccountTeacher(r.id, tid),
        tid ? `${r.name} 님의 명부 연결을 바꿨습니다.` : `${r.name} 님의 명부 연결을 풀었습니다.`);
    }));

    pane.querySelectorAll("[data-promote]").forEach((b) => b.addEventListener("click", () => {
      const r = rows.find((x) => x.id === b.dataset.promote);
      act(() => api.setAdmin(r.id, true), `${r.name} 님을 관리자로 지정했습니다.`);
    }));
    pane.querySelectorAll("[data-demote]").forEach((b) => b.addEventListener("click", async () => {
      const r = rows.find((x) => x.id === b.dataset.demote);
      if (r.is_me && !(await confirmDialog(
        "본인의 관리자 권한을 내립니다. 되돌리려면 다른 관리자가 다시 지정해 주어야 합니다. 계속할까요?",
        { okText: "권한 내리기" }))) return;
      act(() => api.setAdmin(r.id, false), `${r.name} 님의 관리자 권한을 내렸습니다.`);
    }));
    pane.querySelectorAll("[data-revoke]").forEach((b) => b.addEventListener("click", async () => {
      const r = rows.find((x) => x.id === b.dataset.revoke);
      const word = r.approved ? "계정을 해제" : "신청을 거절";
      if (!(await confirmDialog(
        `${r.name} 님의 ${word}할까요? 더 이상 로그인할 수 없게 됩니다.` +
        (r.is_me ? " 본인 계정이라 바로 로그아웃됩니다." : ""),
        { okText: r.approved ? "계정 해제" : "거절" }))) return;
      act(() => api.revokeAccount(r.id),
        `${r.name} 님의 ${r.approved ? "계정을 해제했습니다." : "신청을 거절했습니다."}`);
    }));
  };

  draw();
}

// ── 가입 신청 받기 켬/끔 ────────────────────────────────────
async function paneSignup(pane) {
  let cur = { is_open: true };
  try { cur = await api.signupRequirements(); } catch { /* 무시 */ }
  pane.innerHTML = `
    <div class="form-note" style="margin-top:0">
      가입은 <b>관리자 승인</b>으로 막습니다. 누가 신청하든 승인 전에는 아무것도 볼 수 없으니
      평소에는 켜 두셔도 됩니다.<br>
      모르는 신청이 자꾸 들어와 번거로울 때만 잠시 꺼 두세요.
    </div>
    <label class="chk">
      <input type="checkbox" id="sgOpen" ${cur.is_open ? "checked" : ""}>
      <span>가입 신청 받기</span>
    </label>
    <div class="hint" style="margin-top:6px">끄면 아무도 새로 신청할 수 없습니다. 기존 계정은 그대로 쓰입니다.</div>`;

  pane.querySelector("#sgOpen").addEventListener("change", async (e) => {
    const checked = e.target.checked;
    try {
      await api.setSignupOpen(checked);
      toast(checked ? "가입 신청을 받습니다." : "가입 신청을 닫았습니다.");
    } catch (err) { toast(err.message, "err"); e.target.checked = !checked; }
  });
}

export function editTeacher(t, after) {
  const isNew = !t?.id;
  t = t || {};
  const form = document.createElement("form");
  form.id = "tForm";
  let pendingPhoto = null;      // 저장을 눌러야 실제로 올라갑니다
  let removePhoto = false;
  form.innerHTML = `
    ${isNew ? "" : `
    <div class="photo-edit" style="margin-bottom:18px">
      <label class="photo-drop" title="사진 바꾸기" id="photoBox">
        ${avatar(t.name, teacherPhotoOf(t.id), 76)}
        <input type="file" accept="image/*" id="photoFile" style="display:none">
      </label>
      <div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="pickPhoto">사진 올리기</button>
          ${teacherPhotoOf(t.id) ? `<button type="button" class="btn btn-sm" id="recropPhoto">✂️ 다시 자르기</button>
          <button type="button" class="btn btn-sm btn-danger" id="dropPhoto">사진 지우기</button>` : ""}
        </div>
        <div class="hintbox" style="margin-top:6px">
          ${teacherPhotoOf(t.id)
            ? `<b>다시 자르기</b>는 지금 올라가 있는 사진을 그대로 다시 열어 줍니다 —
               <b>파일을 새로 고르지 않아도</b> 위치와 크기만 고칠 수 있습니다.<br>`
            : "사진을 고르면 <b>위치와 크기를 맞추는 창</b>이 열립니다.<br>"}
          사진은 <b>로그인한 교사진에게만</b> 보입니다.
        </div>
      </div>
    </div>`}
    <div class="grid grid-2">
      <div class="field"><label>이름</label>
        <input type="text" name="name" required value="${esc(t.name)}"></div>
      <div class="field"><label>구분</label>
        <select name="role">${roleLabels().map((r) =>
          `<option value="${r}"${(t.role || "간사") === r ? " selected" : ""}>${r}</option>`).join("")}</select></div>
    </div>
    <div class="grid grid-2" style="margin-top:12px">
      <div class="field"><label>휴대폰번호</label>
        <input type="tel" name="phone" placeholder="010-0000-0000" value="${esc(t.phone)}">
        <span class="hint">회원가입 본인 확인에 쓰이므로 정확히 입력해 주세요.</span></div>
      <div class="field"><label>생년월일</label>
        <input type="date" name="birth" value="${esc(t.birth)}">
        <span class="hint">연도를 모르면 아래 칸에 월·일만 적어도 됩니다.</span></div>
    </div>
    <div class="grid grid-2" style="margin-top:12px">
      <div class="field"><label>생일(월-일)</label>
        <input type="text" name="birth_md" placeholder="예: 03-06" value="${esc(t.birth_md)}"></div>
      <div class="field"><label>비고</label>
        <input type="text" name="note" placeholder="알레르기 등" value="${esc(t.note)}"></div>
    </div>
    ${t.user_id ? `<div class="form-note" style="margin:16px 0 0">
      이미 계정이 연결된 분입니다. 이름·휴대폰번호를 바꿔도 기존 로그인에는 영향이 없습니다.</div>` : ""}`;

  modal({
    title: isNew ? "교사·간사 등록" : `${t.name} 편집`, narrow: true, body: form,
    footer: `${!isNew && !t.user_id ? '<button class="btn btn-danger" data-del>삭제</button><div style="flex:1"></div>' : ""}
             <button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="tForm" type="submit">저장</button>`,
    onMount(box, close) {
      box.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!(await confirmDialog(`${t.name} 님을 명단에서 삭제할까요?`))) return;
        try { await api.deleteTeacher(t.id); await api.refresh(); close(); after?.(); toast("삭제했습니다."); }
        catch (e) { toast(e.message, "err"); }
      });

      const fileEl = box.querySelector("#photoFile");
      const boxEl = box.querySelector("#photoBox");

      /** 자르기 창에서 나온 사진을 «저장 대기» 로 걸어 두고 미리보기를 바꿔 줍니다 */
      const showPending = async (blob) => {
        pendingPhoto = blob;
        removePhoto = false;
        boxEl.querySelector(".ava")?.replaceWith(
          Object.assign(document.createElement("span"), {
            className: "ava",
            style: "width:76px;height:76px",
            innerHTML: `<img src="${await blobToDataURL(blob)}" alt="">`,
          }));
        toast("저장을 누르면 반영됩니다.");
      };

      box.querySelector("#pickPhoto")?.addEventListener("click", () => fileEl.click());
      fileEl?.addEventListener("change", async () => {
        const f = fileEl.files?.[0];
        if (!f) return;
        try {
          const cropped = await cropImage(f);
          if (!cropped) { fileEl.value = ""; return; }
          await showPending(cropped);
        } catch (err) { toast(err.message, "err"); }
      });

      // 이미 올려 둔 사진을 새로 고르지 않고 다시 자르기
      box.querySelector("#recropPhoto")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const { recropStoredPhoto } = await import("../ui.js");
          const cropped = await recropStoredPhoto(pendingPhoto || teacherPhotoOf(t.id));
          if (cropped) await showPending(cropped);
        } catch (err) { toast(err.message, "err"); }
        finally { btn.disabled = false; }
      });
      box.querySelector("#dropPhoto")?.addEventListener("click", () => {
        removePhoto = true; pendingPhoto = null;
        boxEl.innerHTML = avatar(t.name, null, 76) + boxEl.querySelector("input").outerHTML;
        toast("저장을 누르면 사진이 지워집니다.");
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        const row = { ...fd };
        for (const k of Object.keys(row)) if (row[k] === "") row[k] = null;
        if (!isNew) { row.id = t.id; row.seq = t.seq; }
        else row.seq = Math.max(0, ...state.teachers.map((x) => x.seq || 0)) + 1;
        try {
          const saved = await api.saveTeacher(row);
          if (pendingPhoto) await api.uploadTeacherPhoto(saved?.id || t.id, pendingPhoto);
          else if (removePhoto) await api.removeTeacherPhoto(t.id);
          await api.refresh();
          close(); after?.();
          toast(isNew ? "등록했습니다." : "저장했습니다.");
        } catch (err) { toast(err.message, "err"); }
      });
    },
  });
}
