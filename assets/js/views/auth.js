// ── 로그인 / 회원가입 ("나예요!" 본인 확인) ─────────────────
import { api, state } from "../data.js";
import { esc, toast, digits, telLink } from "../ui.js";

// ════════════════════════════════════════════════════════════
//  로그인
// ════════════════════════════════════════════════════════════
export const login = {
  html() {
    return `
    <div class="auth-page">
      <div class="card card-pad">
        <h1>로그인</h1>
        <p class="lead">교사·간사 계정으로 로그인하면 명단을 등록·수정할 수 있습니다.</p>
        <div id="err"></div>
        <form id="loginForm" class="stack" style="gap:14px">
          <div class="field"><label>아이디</label>
            <input type="text" name="username" autocomplete="username" required autocapitalize="none" spellcheck="false"></div>
          <div class="field"><label>비밀번호</label>
            <input type="password" name="password" autocomplete="current-password" required></div>
          <button class="btn btn-primary btn-block" type="submit">로그인</button>
        </form>
        <p style="text-align:center;margin:14px 0 0;font-size:13px">
          <a href="#/forgot" style="color:var(--text-secondary)">아이디·비밀번호를 잊으셨나요?</a>
        </p>
        <p style="text-align:center;margin:10px 0 0;font-size:13px;color:var(--text-secondary)">
          아직 계정이 없으신가요? <a href="#/signup" style="color:var(--series-1);font-weight:600">회원가입</a>
        </p>
      </div>
    </div>`;
  },
  mount(root, rerender) {
    const form = root.querySelector("#loginForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button");
      btn.disabled = true; btn.textContent = "확인 중…";
      const fd = Object.fromEntries(new FormData(form).entries());
      try {
        await api.signIn(fd.username.trim(), fd.password);
        await api.refresh();
        toast(`${state.profile?.name || ""} 님, 환영합니다.`);
        location.hash = "#/students";
        import("../pwa.js").then((m) => m.nudgeInstallPrompt()).catch(() => {});
      } catch (err) {
        showErr(root, err.message, state.pending?.admins);
        btn.disabled = false; btn.textContent = "로그인";
      }
    });
  },
};

// ════════════════════════════════════════════════════════════
//  회원가입
// ════════════════════════════════════════════════════════════
let step = 1;
let picked = null;      // 선택한 교사/간사
let matches = [];       // 이름+번호로 찾은 후보들
let entered = { name: "", phone: "" };
let req = { is_open: true, needs_first_admin: false };
let done = null;        // 신청 완료 후 보여줄 안내

/** «문의는 이쪽으로» — 지금 관리자인 분들 */
function contactBox(admins, lead = "궁금한 점은 관리자에게 문의해 주세요.") {
  const list = (admins || []).filter((a) => a && a.name);
  if (!list.length) return "";
  return `
  <div class="contact-box">
    <div class="contact-head">📞 ${esc(lead)}</div>
    ${list.map((a) => `
      <div class="contact-row">
        <b>${esc(a.name)}</b>
        <span class="badge ${a.role === "간사" ? "" : "blue"}">${esc(a.role || "관리자")}</span>
        <span style="margin-left:auto">${a.phone ? telLink(a.phone)
          : '<span style="color:var(--text-muted);font-size:12.5px">번호 미등록</span>'}</span>
      </div>`).join("")}
  </div>`;
}

export const signup = {
  html() {
    return `
    <div class="auth-page">
      <div class="card card-pad">
        <h1>교사·간사 회원가입</h1>
        <p class="lead">${done ? "신청이 접수되었습니다."
          : "가입을 신청하면 <b>관리자(간사)</b>가 확인한 뒤 열어 드립니다."}</p>
        ${done ? "" : `<div class="steps">
          ${[1, 2, 3].map((n) => `<span class="step${step >= n ? " on" : ""}"></span>`).join("")}
        </div>`}
        <div id="err"></div>
        <div id="stepBody">${body()}</div>
        <p style="text-align:center;margin:18px 0 0;font-size:13px;color:var(--text-secondary)">
          이미 계정이 있으신가요? <a href="#/login" style="color:var(--series-1);font-weight:600">로그인</a>
        </p>
      </div>
    </div>`;
  },
  async mount(root, rerender) {
    wire(root, rerender);
    if (done) return;
    try {
      req = await api.signupRequirements();
      if (!req.is_open) {
        root.querySelector("#stepBody").innerHTML =
          `<div class="form-note" style="margin:0">지금은 가입 신청을 받지 않습니다.
           간사님이나 관리자에게 문의해 주세요.</div>`;
      }
    } catch { /* 조회 실패해도 가입 자체는 진행 가능 */ }
  },
};

function body() {
  if (done) {
    return `
    <div class="form-note" style="margin:0 0 14px">
      <b>${esc(done.name)}</b> 님, 신청이 접수되었습니다.
      아이디는 <b>${esc(done.username)}</b> 입니다.
    </div>
    <div class="stack" style="gap:10px;font-size:13.5px;color:var(--text-secondary)">
      <div>· 관리자(간사)가 확인하고 열어 드리면 그때부터 로그인할 수 있습니다.</div>
      <div>· 그전까지는 로그인해도 <b>연락처·보호자 정보는 보이지 않습니다.</b></div>
    </div>
    ${contactBox(done.admins, "승인이 급하시면 여기로 연락해 주세요")}
    <a class="btn btn-primary btn-block" href="#/" style="margin-top:16px">교적부 둘러보기</a>
    <a class="btn btn-ghost btn-block" href="#/login" style="margin-top:8px">로그인 화면으로</a>`;
  }

  if (step === 1) {
    return `
    <div class="form-note">
      이름과 휴대폰번호를 적어 주세요. 교사·간사 명부에 있으면 본인을 골라 연결할 수 있고,
      <b>명부에 없어도 신청할 수 있습니다.</b>
    </div>
    <form id="findForm" class="stack" style="gap:14px">
      <div class="field"><label>이름</label>
        <input type="text" name="name" required placeholder="예: 홍길동" value="${esc(entered.name)}"></div>
      <div class="field"><label>휴대폰번호</label>
        <input type="tel" name="phone" required inputmode="numeric"
               placeholder="010-0000-0000" value="${esc(entered.phone)}">
        <span class="hint">관리자가 누구인지 확인할 때 씁니다.</span></div>
      <button class="btn btn-primary btn-block" type="submit">다음</button>
    </form>`;
  }

  if (step === 2) {
    return `
    <p style="font-size:13.5px;color:var(--text-secondary);margin:0 0 12px">
      명부에서 본인을 찾았습니다. <b>나예요!</b>를 누르면 계정이 그 자리에 연결됩니다.
    </p>
    <div id="matches"></div>
    <button class="btn btn-block" id="skipBtn" style="margin-top:10px">
      건너뛰기 — 관리자가 연결해 주세요</button>
    <button class="btn btn-ghost btn-block" id="backBtn" style="margin-top:8px">← 다시 입력하기</button>`;
  }

  return `
  <div class="form-note">
    ${picked
      ? `<b>${esc(picked.name)}</b> ${esc(picked.role)} 님으로 확인되었습니다.`
      : `<b>${esc(entered.name)}</b> 님으로 신청합니다.
         명부 연결은 <b>관리자가 승인하면서</b> 정해 줍니다.`}
    이제 사용할 아이디와 비밀번호를 정해 주세요.
  </div>
  <form id="createForm" class="stack" style="gap:14px">
    <div class="field"><label>아이디</label>
      <input type="text" name="username" required minlength="4" maxlength="20"
             pattern="[A-Za-z0-9_]+" autocapitalize="none" spellcheck="false"
             autocomplete="username" placeholder="영문·숫자 4~20자">
      <span class="hint">영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다.</span></div>
    <div class="field"><label>비밀번호</label>
      <input type="password" name="password" required minlength="6" autocomplete="new-password"
             placeholder="6자 이상"></div>
    <div class="field"><label>비밀번호 확인</label>
      <input type="password" name="password2" required minlength="6" autocomplete="new-password"></div>
    <button class="btn btn-primary btn-block" type="submit">
      ${req.needs_first_admin ? "가입 완료" : "가입 신청하기"}</button>
    <button class="btn btn-ghost btn-block" id="backBtn" type="button">← 뒤로</button>
  </form>`;
}

function wire(root, rerender) {
  const redraw = () => {
    root.querySelector("#stepBody").innerHTML = body();
    root.querySelectorAll(".steps .step").forEach((el, i) => el.classList.toggle("on", step >= i + 1));
    root.querySelector("#err").innerHTML = "";
    wire(root, rerender);
  };

  // 1단계 — 명단 조회 (못 찾아도 계속 진행합니다)
  const find = root.querySelector("#findForm");
  find?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(find).entries());
    entered = { name: fd.name.trim(), phone: fd.phone.trim() };
    if (digits(entered.phone).length < 10) return showErr(root, "휴대폰번호를 정확히 입력해 주세요.");
    const btn = find.querySelector("button"); btn.disabled = true; btn.textContent = "찾는 중…";
    try {
      matches = await api.findTeacherCandidates(entered.name, entered.phone);
    } catch { matches = []; }
    picked = null;
    step = matches.length ? 2 : 3;      // 명부에 없으면 바로 계정 만들기로
    redraw();
  });

  // 2단계 — 후보 목록 그리기
  if (step === 2) renderMatches(root, matches, redraw);

  root.querySelector("#skipBtn")?.addEventListener("click", () => {
    picked = null; step = 3; redraw();
  });
  root.querySelector("#backBtn")?.addEventListener("click", () => {
    step = step === 3 && matches.length ? 2 : 1; redraw();
  });

  // 3단계 — 계정 만들기
  const create = root.querySelector("#createForm");
  create?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(create).entries());
    const username = fd.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{4,20}$/.test(username))
      return showErr(root, "아이디는 영문 소문자·숫자·밑줄 4~20자로 만들어 주세요.");
    if (fd.password !== fd.password2) return showErr(root, "비밀번호가 서로 다릅니다.");
    const btn = create.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "보내는 중…";
    try {
      if (!(await api.usernameAvailable(username))) throw new Error("이미 사용 중인 아이디입니다.");
      const r = await api.signUp({
        username, password: fd.password,
        name: entered.name, phone: entered.phone, teacherId: picked?.id || null,
      });
      await api.refresh();
      if (r?.approved) {                       // 맨 처음 가입한 관리자
        resetSignup();
        toast("가입이 완료되었습니다. 환영합니다!");
        location.hash = "#/students";
      } else {
        done = { username, name: entered.name, admins: state.pending?.admins || [] };
        rerender();
        toast("가입 신청을 보냈습니다. 관리자 승인을 기다려 주세요.");
      }
    } catch (err) {
      showErr(root, err.message);
      btn.disabled = false; btn.textContent = label;
    }
  });
}

function renderMatches(root, list, redraw) {
  const box = root.querySelector("#matches");
  if (!box) return;
  box.innerHTML = list.map((t, i) => `
    <div class="match-card">
      <div class="avatar">${esc(t.name.slice(-2))}</div>
      <div class="who">
        <b>${esc(t.name)}</b> <span class="badge ${t.role === "간사" ? "" : "blue"}">${esc(t.role)}</span>
        <div>${esc(t.phone_masked)}${t.note ? " · " + esc(t.note) : ""}</div>
      </div>
      ${t.already_claimed
        ? `<span class="badge good">신청됨</span>`
        : `<button class="btn btn-primary btn-sm" data-pick="${i}">나예요!</button>`}
    </div>`).join("");

  if (list.every((t) => t.already_claimed))
    box.insertAdjacentHTML("beforeend",
      `<div class="form-note" style="margin-top:10px">이미 신청이 들어와 있는 자리입니다.
       <a href="#/login" style="color:var(--series-1)">로그인</a>하거나 관리자에게 문의해 주세요.</div>`);

  box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    picked = list[Number(b.dataset.pick)];
    step = 3; redraw();
  }));
}

function showErr(root, msg, admins) {
  const el = root.querySelector("#err");
  if (el) el.innerHTML = `<div class="form-error">${esc(msg)}</div>`
    + (admins?.length ? contactBox(admins, "문의는 여기로 해주세요") : "");
  else toast(msg, "err");
}

export function resetSignup() {
  step = 1; picked = null; matches = []; entered = { name: "", phone: "" }; done = null;
}
export const signupReq = () => req;


// ════════════════════════════════════════════════════════════
//  아이디·비밀번호 찾기
//  ------------------------------------------------------------
//  이 교적부는 진짜 메일 주소를 쓰지 않아 «재설정 메일» 을 보낼 수가 없습니다.
//  그래서 가입할 때와 똑같이 «이름 + 휴대폰번호» 로 본인을 확인하고,
//  그 자리에서 아이디를 알려 준 뒤 새 비밀번호를 정하게 합니다.
// ════════════════════════════════════════════════════════════
let fStep = 1;                       // 1 본인확인 · 2 내 계정 고르기 · 3 새 비밀번호 · 4 완료
let fEntered = { name: "", phone: "" };
let fFound = [];
let fPicked = null;

export function resetForgot() {
  fStep = 1; fEntered = { name: "", phone: "" }; fFound = []; fPicked = null;
}

export const forgot = {
  html() {
    return `
    <div class="auth-page">
      <div class="card card-pad">
        <h1>아이디·비밀번호 찾기</h1>
        <p class="lead">${fStep === 4
          ? "새 비밀번호로 바꿨습니다."
          : "가입할 때 적으신 <b>이름과 휴대폰번호</b>로 본인을 확인합니다."}</p>
        ${fStep === 4 ? "" : `<div class="steps">
          ${[1, 2, 3].map((n) => `<span class="step${fStep >= n ? " on" : ""}"></span>`).join("")}
        </div>`}
        <div id="err"></div>
        <div id="stepBody">${fBody()}</div>
        <p style="text-align:center;margin:18px 0 0;font-size:13px;color:var(--text-secondary)">
          <a href="#/login" style="color:var(--series-1);font-weight:600">로그인 화면으로</a>
        </p>
      </div>
    </div>`;
  },
  mount(root, rerender) { fWire(root, rerender); },
};

function fBody() {
  if (fStep === 1) {
    return `
    <div class="form-note">
      휴대폰번호는 <b>로그인해야 보이는 정보</b>라서, 이름과 번호가 모두 맞아야 넘어갑니다.
      번호가 바뀌셨다면 관리자(간사)에게 부탁해 주세요.
    </div>
    <form id="fFind" class="stack" style="gap:14px">
      <div class="field"><label>이름</label>
        <input type="text" name="name" required placeholder="예: 홍길동" value="${esc(fEntered.name)}"></div>
      <div class="field"><label>휴대폰번호</label>
        <input type="tel" name="phone" required inputmode="numeric"
               placeholder="010-0000-0000" value="${esc(fEntered.phone)}"></div>
      <button class="btn btn-primary btn-block" type="submit">다음</button>
    </form>`;
  }

  if (fStep === 2) {
    return `
    <p style="font-size:13.5px;color:var(--text-secondary);margin:0 0 12px">
      ${fFound.length > 1
        ? "이 이름·번호로 만든 계정이 <b>여러 개</b> 있습니다. 쓰시던 것을 골라 주세요."
        : "계정을 찾았습니다. <b>아이디</b>를 확인하시고 다음으로 넘어가세요."}
    </p>
    <div id="fList">${fFound.map((a, i) => `
      <div class="match-card">
        <div class="avatar">${esc(String(a.name || "?").slice(-2))}</div>
        <div class="who">
          <b>@${esc(a.username)}</b>
          <span class="badge ${a.role === "간사" ? "" : "blue"}">${esc(a.role || "")}</span>
          <div>${esc(a.name)}${a.created_at ? ` · ${String(a.created_at).slice(0, 10)} 가입` : ""}</div>
        </div>
        ${a.approved === false
          ? `<span class="badge warn">승인 전</span>`
          : `<button class="btn btn-primary btn-sm" data-fpick="${i}">이걸로</button>`}
      </div>`).join("")}</div>
    ${fFound.every((a) => a.approved === false) ? `
      <div class="form-note" style="margin-top:10px">아직 관리자가 승인하지 않은 신청입니다.
        승인되면 그때 비밀번호를 정하실 수 있습니다.</div>` : ""}
    <button class="btn btn-ghost btn-block" id="fBack" style="margin-top:10px">← 다시 입력하기</button>`;
  }

  if (fStep === 3) {
    return `
    <div class="form-note">
      아이디는 <b>${esc(fPicked?.username || "")}</b> 입니다. 새 비밀번호를 정해 주세요.
      <br>바꾸고 나면 <b>다른 기기에서는 모두 로그아웃</b>됩니다.
    </div>
    <form id="fSet" class="stack" style="gap:14px">
      <input type="text" name="username" autocomplete="username" value="${esc(fPicked?.username || "")}"
             readonly style="display:none">
      <div class="field"><label>새 비밀번호</label>
        <input type="password" name="password" required minlength="6"
               autocomplete="new-password" placeholder="6자 이상"></div>
      <div class="field"><label>새 비밀번호 확인</label>
        <input type="password" name="password2" required minlength="6" autocomplete="new-password"></div>
      <button class="btn btn-primary btn-block" type="submit">비밀번호 바꾸기</button>
      <button class="btn btn-ghost btn-block" id="fBack" type="button">← 뒤로</button>
    </form>`;
  }

  return `
  <div class="form-note" style="margin:0 0 14px">
    <b>${esc(fPicked?.username || "")}</b> 의 비밀번호를 바꿨습니다. 이제 로그인해 주세요.
  </div>
  <a class="btn btn-primary btn-block" href="#/login">로그인하러 가기</a>`;
}

function fWire(root, rerender) {
  const redraw = () => {
    root.querySelector("#stepBody").innerHTML = fBody();
    root.querySelectorAll(".steps .step").forEach((el, i) => el.classList.toggle("on", fStep >= i + 1));
    root.querySelector("#err").innerHTML = "";
    fWire(root, rerender);
  };

  const find = root.querySelector("#fFind");
  find?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(find).entries());
    fEntered = { name: fd.name.trim(), phone: fd.phone.trim() };
    if (digits(fEntered.phone).length < 10) return showErr(root, "휴대폰번호를 정확히 입력해 주세요.");
    const btn = find.querySelector("button");
    btn.disabled = true; btn.textContent = "찾는 중…";
    try {
      fFound = await api.findMyAccounts(fEntered.name, fEntered.phone);
    } catch (err) {
      btn.disabled = false; btn.textContent = "다음";
      return showErr(root, err.message);
    }
    if (!fFound.length) {
      btn.disabled = false; btn.textContent = "다음";
      return showErr(root,
        "이름과 휴대폰번호가 맞는 계정을 찾지 못했습니다. 가입할 때 적은 번호가 맞는지 확인해 주세요. "
        + "번호가 바뀌셨다면 관리자(간사)에게 부탁하시면 바로 고쳐 드릴 수 있습니다.");
    }
    // 고를 것이 하나뿐이고 승인된 계정이면 바로 비밀번호 정하기로
    const usable = fFound.filter((a) => a.approved !== false);
    if (usable.length === 1) { fPicked = usable[0]; fStep = 3; } else fStep = 2;
    redraw();
  });

  root.querySelectorAll("[data-fpick]").forEach((b) => b.addEventListener("click", () => {
    fPicked = fFound[Number(b.dataset.fpick)]; fStep = 3; redraw();
  }));

  root.querySelector("#fBack")?.addEventListener("click", () => {
    fStep = fStep === 3 && fFound.length > 1 ? 2 : 1; redraw();
  });

  const set = root.querySelector("#fSet");
  set?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(set).entries());
    if (fd.password !== fd.password2) return showErr(root, "비밀번호가 서로 다릅니다.");
    const btn = set.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "바꾸는 중…";
    try {
      await api.resetPassword({
        name: fEntered.name, phone: fEntered.phone,
        username: fPicked.username, password: fd.password,
      });
      fStep = 4; rerender();
      toast("비밀번호를 바꿨습니다. 새 비밀번호로 로그인해 주세요.");
    } catch (err) {
      showErr(root, err.message);
      btn.disabled = false; btn.textContent = "비밀번호 바꾸기";
    }
  });
}
