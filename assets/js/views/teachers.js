// ── 교사 / 간사 연락처 ─────────────────────────────────────
import { state, api, isLoggedIn, isAdmin } from "../data.js";
import { esc, dash, telLink, fmtBirth, modal, toast, confirmDialog, avatar } from "../ui.js";
import { bindDownload as bindXlsx } from "../xlsx.js";

const ROLES = ["교역자", "사모", "교사", "간사"];

export function html() {
  const rows = [...state.teachers].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const claimed = rows.filter((t) => t.user_id).length;

  return `
  <div class="page-head">
    <div>
      <h1>교사 · 간사 연락처</h1>
      <p>${rows.length}명 · ${claimed}명 계정 연결됨 · 가입은 <b>관리자 승인</b>으로 열립니다.</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-sm" id="xlsxBtn">📥 엑셀 받기</button>
      ${isAdmin() ? `<button class="btn btn-sm${state.pendingCount ? " btn-primary" : ""}" id="accounts">
                       👥 가입 승인 · 계정${state.pendingCount
                         ? ` <span class="badge orange" style="margin-left:2px">${state.pendingCount}</span>` : ""}</button>
                     <button class="btn btn-sm" id="signupCfg">🔐 가입 신청 설정</button>
                     <button class="btn btn-sm" id="notifyCfg">🔔 알림 설정</button>` : ""}
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
    <table class="data">
      <thead><tr>
        <th>#</th><th>이름</th><th>구분</th><th>생년월일</th><th>전화번호</th>
        <th>비고</th><th>계정</th>${isLoggedIn() ? "<th></th>" : ""}
      </tr></thead>
      <tbody>
        ${rows.map((t) => `
        <tr data-id="${t.id}">
          <td class="num">${t.seq ?? ""}</td>
          <td><b>${esc(t.name)}</b></td>
          <td><span class="badge ${t.role === "간사" ? "" : "blue"}">${esc(t.role)}</span></td>
          <td class="num">${t.birth ? esc(fmtBirth(t.birth, false))
            : t.birth_md ? esc(t.birth_md.replace("-", "월 ") + "일") : "—"}</td>
          <td>${isLoggedIn() ? telLink(t.phone)
            : '<span style="color:var(--text-muted)">로그인 후 표시</span>'}</td>
          <td class="wrap" style="color:var(--text-secondary)">${isLoggedIn() ? dash(t.note) : dash(null)}</td>
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

export function mount(root, rerender) {
  root.querySelector("#accounts")?.addEventListener("click", () => accountPanel(rerender));
  root.querySelector("#accounts2")?.addEventListener("click", () => accountPanel(rerender));
  root.querySelector("#signupCfg")?.addEventListener("click", () => signupSettings(rerender));
  root.querySelector("#notifyCfg")?.addEventListener("click", () => notifySettings());
  root.querySelector("#addBtn")?.addEventListener("click", () => editTeacher(null, rerender));
  root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () =>
    editTeacher(state.teachers.find((t) => t.id === b.dataset.edit), rerender)));
  bindXlsx(root.querySelector("#xlsxBtn"), async () => {
    const { exportTeachers } = await import("../xlsx.js");
    await exportTeachers({ masked: !isLoggedIn() });
  });

}

// ── 관리자: 가입 신청 알림 메일 ────────────────────────────
async function notifySettings() {
  let st = null;
  try { st = await api.notifyStatus(); }
  catch (e) { return toast(e.message, "err"); }

  // 아직 06_notify_email.sql 을 실행하지 않은 교적부
  if (!st) {
    return modal({
      title: "가입 신청 알림 메일", narrow: true,
      body: `
        <div class="form-note" style="margin:0">
          아직 <b>알림 기능이 설치되지 않았습니다.</b>
          <div style="margin-top:8px">
            저장소의 <b>supabase/06_notify_email.sql</b> 파일 맨 위 안내를 따라
            한 번만 설정하면, 가입 신청이 들어올 때 <b>메일로 바로 알려 드립니다.</b>
            (무료 · 10분 정도 걸립니다)
          </div>
        </div>`,
      footer: `<button class="btn" data-close>닫기</button>`,
    });
  }

  const box = document.createElement("div");
  const draw = () => {
    box.innerHTML = `
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
        <span>알림 메일 보내기</span></label>`;
  };
  draw();

  modal({
    title: "가입 신청 알림 메일", narrow: true, body: box,
    footer: `<button class="btn" data-test>시험 메일 보내기</button>
             <div style="flex:1"></div>
             <button class="btn" data-close>닫기</button>
             <button class="btn btn-primary" data-save>저장</button>`,
    onMount(b, close) {
      const emails = () => box.querySelector("#nEmails").value
        .split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

      b.querySelector("[data-save]").addEventListener("click", async () => {
        const list = emails();
        const bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
        if (bad.length) return toast(`메일 주소가 이상합니다: ${bad[0]}`, "err");
        try {
          await api.setNotifyEmails(list, box.querySelector("#nOn").checked);
          close();
          toast(list.length ? `${list.length}곳으로 알림이 갑니다.` : "알림 받을 주소를 비웠습니다.");
        } catch (e) { toast(e.message, "err"); }
      });

      b.querySelector("[data-test]").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const list = emails();
        if (!list.length) return toast("먼저 받을 주소를 적어 주세요.", "err");
        btn.disabled = true; btn.textContent = "보내는 중…";
        try {
          await api.setNotifyEmails(list, box.querySelector("#nOn").checked);
          const ok = await api.notifyTest();
          toast(ok ? "시험 메일을 보냈습니다. 1분 안에 도착합니다."
                   : "아직 메일 설정이 끝나지 않았습니다 (06_notify_email.sql 확인).",
                ok ? "" : "err");
        } catch (err) { toast(err.message, "err"); }
        finally { btn.disabled = false; btn.textContent = "시험 메일 보내기"; }
      });
    },
  });
}

// ── 관리자: 가입 승인 · 계정 · 관리자 권한 ──────────────────
async function accountPanel(after) {
  let rows = [], pool = [];
  try {
    rows = await api.listAccounts();
    pool = await api.unlinkedTeachers().catch(() => []);
  } catch (e) { return toast(e.message, "err"); }

  const box = document.createElement("div");

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

    box.innerHTML = `
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

  const chosenTeacher = (id) => box.querySelector(`[data-teacher="${id}"]`)?.value || null;

  const bind = () => {
    box.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", async () => {
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

    box.querySelectorAll("[data-teacher]").forEach((sel) => sel.addEventListener("change", async () => {
      const r = rows.find((x) => x.id === sel.dataset.teacher);
      if (!r.approved) return;                 // 대기 중인 건 «승인» 누를 때 함께 반영됩니다
      const tid = sel.value || null;
      act(() => api.setAccountTeacher(r.id, tid),
        tid ? `${r.name} 님의 명부 연결을 바꿨습니다.` : `${r.name} 님의 명부 연결을 풀었습니다.`);
    }));

    box.querySelectorAll("[data-promote]").forEach((b) => b.addEventListener("click", () => {
      const r = rows.find((x) => x.id === b.dataset.promote);
      act(() => api.setAdmin(r.id, true), `${r.name} 님을 관리자로 지정했습니다.`);
    }));
    box.querySelectorAll("[data-demote]").forEach((b) => b.addEventListener("click", async () => {
      const r = rows.find((x) => x.id === b.dataset.demote);
      if (r.is_me && !(await confirmDialog(
        "본인의 관리자 권한을 내립니다. 되돌리려면 다른 관리자가 다시 지정해 주어야 합니다. 계속할까요?",
        { okText: "권한 내리기" }))) return;
      act(() => api.setAdmin(r.id, false), `${r.name} 님의 관리자 권한을 내렸습니다.`);
    }));
    box.querySelectorAll("[data-revoke]").forEach((b) => b.addEventListener("click", async () => {
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
  modal({
    title: "가입 승인 · 계정 관리", body: box,
    footer: `<button class="btn" data-close>닫기</button>`,
  });
}

// ── 관리자: 가입 신청 받기 켬/끔 ───────────────────────────
async function signupSettings(after) {
  let cur = { is_open: true };
  try { cur = await api.signupRequirements(); } catch { /* 무시 */ }
  const form = document.createElement("form");
  form.id = "sgForm";
  form.innerHTML = `
    <div class="form-note" style="margin-top:0">
      가입은 <b>관리자 승인</b>으로 막습니다. 누가 신청하든 승인 전에는 아무것도 볼 수 없으니
      평소에는 켜 두셔도 됩니다.<br>
      모르는 신청이 자꾸 들어와 번거로울 때만 잠시 꺼 두세요.
    </div>
    <div class="field">
      <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" name="open" style="width:auto" ${cur.is_open ? "checked" : ""}>
        <span>가입 신청 받기</span></label>
      <span class="hint">끄면 아무도 새로 신청할 수 없습니다. 기존 계정은 그대로 쓰입니다.</span>
    </div>`;

  modal({
    title: "가입 신청 설정", narrow: true, body: form,
    footer: `<button class="btn" data-close>취소</button>
             <button class="btn btn-primary" form="sgForm" type="submit">저장</button>`,
    onMount(box, close) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          await api.setSignupOpen(fd.get("open") === "on");
          close(); after?.();
          toast(fd.get("open") === "on" ? "가입 신청을 받습니다." : "가입 신청을 닫았습니다.");
        } catch (err) { toast(err.message, "err"); }
      });
    },
  });
}

function editTeacher(t, after) {
  const isNew = !t?.id;
  t = t || {};
  const form = document.createElement("form");
  form.id = "tForm";
  form.innerHTML = `
    <div class="grid grid-2">
      <div class="field"><label>이름</label>
        <input type="text" name="name" required value="${esc(t.name)}"></div>
      <div class="field"><label>구분</label>
        <select name="role">${ROLES.map((r) =>
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
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(form).entries());
        const row = { ...fd };
        for (const k of Object.keys(row)) if (row[k] === "") row[k] = null;
        if (!isNew) { row.id = t.id; row.seq = t.seq; }
        else row.seq = Math.max(0, ...state.teachers.map((x) => x.seq || 0)) + 1;
        try { await api.saveTeacher(row); await api.refresh(); close(); after?.(); toast("저장했습니다."); }
        catch (err) { toast(err.message, "err"); }
      });
    },
  });
}
