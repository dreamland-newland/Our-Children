// ============================================================
//  데이터 계층
//  · Supabase 가 설정돼 있으면 → 실제 서버 (supabaseAdapter)
//  · 비어 있으면            → 데모 모드 (demoAdapter, 이 브라우저에만 저장)
//  두 어댑터는 같은 인터페이스를 가지므로 화면 코드는 동일합니다.
// ============================================================

import {
  SUPABASE_URL, SUPABASE_ANON_KEY, ID_EMAIL_DOMAIN, PUBLIC_SCOPE, SCHOOL_YEAR_START_MONTH,
} from "./config.js";
import { digits, loadScript, toast } from "./ui.js";

export const state = {
  mode: "demo",          // 'supabase' | 'demo'
  ready: false,
  students: [],
  teachers: [],
  versions: [],          // 셀편성 버전 (최신순)
  cells: [],             // 모든 버전의 셀
  members: [],           // { version_id, cell_id, student_id, role }
  versionId: null,       // 화면에서 보고 있는 버전
  profile: null,         // 승인된 로그인 사용자
  pending: null,         // 승인 대기 중인 신청 (로그인은 안 된 상태)
  pendingCount: 0,       // 관리자가 처리해야 할 가입 신청 수
  roleOptions: [],       // 교사·간사 직함 목록 [{id,label,sort_order}] (관리자가 추가/삭제/수정)
};

// 교회에 아직 직함 목록이 없을 때(맨 처음) 채워 두는 기본값
export const DEFAULT_ROLE_OPTIONS = ["담임목사", "교역자", "사모", "교사", "간사"];
/** 지금 쓰는 직함 이름 목록 (순서대로) — 목록이 아직 없으면 기본값 */
export const roleLabels = () =>
  state.roleOptions.length ? state.roleOptions.map((r) => r.label) : DEFAULT_ROLE_OPTIONS;
/** 직함 이름 → 표시 순서 (모르는 직함은 맨 뒤) */
export const roleOptionRank = (label) => {
  const i = roleLabels().indexOf(label);
  return i < 0 ? 99 : i;
};

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
// ════════════════════════════════════════════════════════════
//  학년 — 생년월일에서 자동으로 계산합니다
//  · 학년 칸을 비워두면 자동, 직접 적으면 적은 값이 그대로 쓰입니다
//  · 고3을 지나면 «졸업(청년부)» 이 되어 교적에서 자연스럽게 빠집니다
// ════════════════════════════════════════════════════════════
const AGE_GRADE = { 12: "예비중1", 13: "중1", 14: "중2", 15: "중3", 16: "고1", 17: "고2", 18: "고3" };

/** 오늘이 몇 학년도인가 (3월 시작 기준) */
export function schoolYear(d = new Date()) {
  return d.getMonth() + 1 >= SCHOOL_YEAR_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
}

/** 생년월일(또는 연도만) → 올해 학년 (초등 이하는 null, 고3 넘으면 '졸업') */
export function autoGrade(birth, sy = schoolYear()) {
  if (!birth) return null;
  const by = Number(String(birth).slice(0, 4));
  if (!by) return null;
  const n = sy - by;
  if (n < 12) return null;
  return AGE_GRADE[n] || "졸업";
}

/** 태어난 해 — 생년월일이 있으면 거기서, 없으면 «출생연도» 칸에서 */
export const birthYearOf = (s) =>
  (s?.birth ? Number(String(s.birth).slice(0, 4)) : Number(s?.birth_year)) || null;

/** 학년 — 직접 적어둔 값이 있으면 그 값, 없으면 태어난 해에서 계산 */
export const gradeOf = (s) => (s?.grade || autoGrade(birthYearOf(s)));
/** 학년이 자동으로 정해진 아이인가 */
export const isAutoGrade = (s) => !s?.grade && !!autoGrade(birthYearOf(s));
/** «2026학년도 기준 중3» 처럼 풀어 쓴 학년 (1~2월에 헷갈리지 않도록) */
export const gradeWithYear = (s, sy = schoolYear()) => {
  const g = s?.grade || autoGrade(birthYearOf(s), sy);
  return g ? `${sy}학년도 기준 ${g}` : null;
};
/** 청소년부를 마쳤는가 (청년부로 올라감) */
export const isGraduated = (s) => gradeOf(s) === "졸업";
/** 상태 — 졸업은 나이에서 자동, 장기결석·전출은 직접 지정 */
export const statusOf = (s) => {
  if (s?.status === "장기결석" || s?.status === "전출") return s.status;
  return isGraduated(s) ? "졸업" : "재적";
};
/** 지금 청소년부에 있는 아이인가 (졸업·전출 제외) */
export const isActive = (s) => { const st = statusOf(s); return st === "재적" || st === "장기결석"; };

/** 학생 id → 볼 수 있는 사진 주소 (비로그인이면 비어 있음) */
export const photoUrls = new Map();
export const photoOf = (studentId) => photoUrls.get(studentId) || null;
export const PHOTO_BUCKET = "student-photos";
/** 교사·간사 id → 볼 수 있는 사진 주소 (학생과 같은 방식, 버킷만 따로) */
export const teacherPhotoUrls = new Map();
export const teacherPhotoOf = (teacherId) => teacherPhotoUrls.get(teacherId) || null;
export const TEACHER_PHOTO_BUCKET = "teacher-photos";
/** 프라이버시 모드에서 비로그인 방문자에게 학생 민감정보를 가리는 중인가 */
export const isMasked = () => PUBLIC_SCOPE === "basic" && !isLoggedIn();
export const isLoggedIn = () => !!state.profile;
export const isAdmin = () => !!state.profile?.is_admin;

const phoneKey = (p) => digits(p).slice(-8);
const nameKey = (n) => String(n || "").replace(/\s/g, "").trim();
const maskPhone = (p) => {
  const d = digits(p);
  return d.length >= 8 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : "-";
};

// 프라이버시 모드일 때 비로그인 방문자가 읽을 수 있는 컬럼
const PUBLIC_STUDENT_COLS =
  "id,seq,name,gender,grade,school,birth,birth_year,is_promoted,status,created_at,updated_at";
const PUBLIC_TEACHER_COLS = "id,seq,name,role,birth_md,user_id,claimed_at,created_at";

// ════════════════════════════════════════════════════════════
//  Supabase 어댑터
// ════════════════════════════════════════════════════════════
let sb = null;

const supabaseAdapter = {
  async init() {
    // supabase-js 도 저장소에 포함돼 있습니다(assets/vendor/supabase.js).
    if (!window.supabase?.createClient) await loadScript("./assets/vendor/supabase.js");
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await sb.auth.getSession();
    if (data?.session) await this.loadProfile();
  },

  /** 승인된 계정만 «로그인» 으로 칩니다. 승인 전이면 세션을 정리하고 대기 상태로 둡니다. */
  async loadProfile() {
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) { state.profile = null; return; }
    const { data } = await sb.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
    if (!data) {                                   // 해제된 계정
      state.profile = null; state.pending = null;
      await sb.auth.signOut();
      return;
    }
    if (!data.approved) {                          // 아직 승인 전
      state.profile = null;
      // 로그아웃하기 «전에» 문의처(관리자 연락처)를 받아 둡니다 — 계정이 있어야 볼 수 있습니다
      let admins = [];
      try {
        const r = await sb.rpc("admin_contacts");
        admins = r.data || [];
      } catch { /* 없어도 안내는 뜹니다 */ }
      state.pending = { username: data.username, name: data.name,
                        created_at: data.created_at, admins };
      await sb.auth.signOut();                     // 서버도 막지만, 세션부터 정리합니다
      return;
    }
    state.pending = null;
    state.profile = data;
  },

  async refresh() {
    const limited = PUBLIC_SCOPE === "basic" && !isLoggedIn();
    const [v, c, m, t, s] = await Promise.all([
      sb.from("cell_versions").select("*").order("created_at", { ascending: false }),
      sb.from("cells").select("*").order("sort_order"),
      sb.from("cell_members").select("id,version_id,cell_id,student_id,role")
        // 05_cell_seat.sql 을 아직 실행하지 않았어도 화면이 열리도록
        .then((r) => (r.error && /role/.test(r.error.message || "")
          ? sb.from("cell_members").select("id,version_id,cell_id,student_id") : r)),
      // 교사 전화번호는 «전부 공개» 설정에서도 로그인해야 받아옵니다(계정 사칭 방지)
      sb.from("teachers").select(isLoggedIn() ? "*" : PUBLIC_TEACHER_COLS).order("seq"),
      sb.from("students").select(limited ? PUBLIC_STUDENT_COLS : "*").order("seq"),
    ]);
    for (const r of [v, c, m, t, s]) if (r.error) throw new Error(r.error.message);
    state.versions = v.data; state.cells = c.data; state.members = m.data;
    state.teachers = t.data; state.students = s.data;
    ensureVersion();
    await this.loadPhotoUrls();
    await this.loadTeacherPhotoUrls();
    await this.loadPendingCount();
    await this.loadRoleOptions();
  },

  /** 직함 목록 — supabase/08_role_options.sql 을 실행하지 않은 교적부에서도 화면이 열리도록 */
  async loadRoleOptions() {
    const { data, error } = await sb.from("role_options").select("*").order("sort_order");
    if (error) { state.roleOptions = []; return; }     // 아직 설치 전 — 기본값으로 동작
    state.roleOptions = data || [];
  },
  async addRoleOption(label) {
    const l = String(label || "").trim();
    if (!l) throw new Error("직함 이름을 적어 주세요.");
    if (roleLabels().includes(l)) throw new Error("이미 있는 직함입니다.");
    const nextOrder = Math.max(0, ...state.roleOptions.map((r) => r.sort_order || 0)) + 1;
    const { error } = await sb.from("role_options").insert({ label: l, sort_order: nextOrder });
    if (error) throw new Error(translate(error.message));
    await this.loadRoleOptions();
  },
  async renameRoleOption(id, newLabel) {
    const l = String(newLabel || "").trim();
    if (!l) throw new Error("직함 이름을 적어 주세요.");
    const cur = state.roleOptions.find((r) => r.id === id);
    if (!cur) throw new Error("직함을 찾을 수 없습니다.");
    if (cur.label === l) return;
    if (roleLabels().includes(l)) throw new Error("이미 있는 직함입니다.");
    const { error } = await sb.from("role_options").update({ label: l }).eq("id", id);
    if (error) throw new Error(translate(error.message));
    // 이 직함을 쓰고 있던 분들도 새 이름으로 함께 바꿉니다
    const { error: e2 } = await sb.from("teachers").update({ role: l }).eq("role", cur.label);
    if (e2) throw new Error(translate(e2.message));
    await this.loadRoleOptions();
    await this.refresh();
  },
  async deleteRoleOption(id) {
    const cur = state.roleOptions.find((r) => r.id === id);
    if (!cur) return;
    if (state.teachers.some((t) => t.role === cur.label))
      throw new Error("이 직함을 쓰고 있는 분이 있어 지울 수 없습니다. 먼저 다른 직함으로 바꿔 주세요.");
    const { error } = await sb.from("role_options").delete().eq("id", id);
    if (error) throw new Error(translate(error.message));
    await this.loadRoleOptions();
  },
  async moveRoleOption(id, dir) {
    const list = [...state.roleOptions];
    const i = list.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i].sort_order, list[j].sort_order] = [list[j].sort_order, list[i].sort_order];
    const r1 = await sb.from("role_options").update({ sort_order: list[i].sort_order }).eq("id", list[i].id);
    const r2 = await sb.from("role_options").update({ sort_order: list[j].sort_order }).eq("id", list[j].id);
    if (r1.error || r2.error) throw new Error(translate((r1.error || r2.error).message));
    await this.loadRoleOptions();
  },

  /** 관리자에게 «처리할 가입 신청» 개수를 보여주기 위한 값 */
  async loadPendingCount() {
    state.pendingCount = 0;
    if (!isAdmin()) return;
    const { count } = await sb.from("profiles")
      .select("id", { count: "exact", head: true }).eq("approved", false);
    state.pendingCount = count || 0;
  },

  /** 비공개 버킷이라 로그인한 교사진에게만 잠깐 유효한 링크를 발급합니다. */
  async loadPhotoUrls() {
    photoUrls.clear();
    if (!isLoggedIn()) return;                       // 비로그인은 사진을 볼 수 없습니다
    const rows = state.students.filter((s) => s.photo_path);
    if (!rows.length) return;
    const { data, error } = await sb.storage.from(PHOTO_BUCKET)
      .createSignedUrls(rows.map((s) => s.photo_path), 60 * 60);
    if (error) return;
    data.forEach((d, i) => { if (d.signedUrl) photoUrls.set(rows[i].id, d.signedUrl); });
  },

  async uploadPhoto(studentId, blob) {
    const path = `${studentId}/${Date.now()}.jpg`;
    const up = await sb.storage.from(PHOTO_BUCKET)
      .upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(translate(up.error.message));
    const old = state.students.find((s) => s.id === studentId)?.photo_path;
    const { error } = await sb.from("students").update({ photo_path: path }).eq("id", studentId);
    if (error) throw new Error(translate(error.message));
    if (old && old !== path) await sb.storage.from(PHOTO_BUCKET).remove([old]);
    return path;
  },

  async removePhoto(studentId) {
    const old = state.students.find((s) => s.id === studentId)?.photo_path;
    const { error } = await sb.from("students").update({ photo_path: null }).eq("id", studentId);
    if (error) throw new Error(translate(error.message));
    if (old) await sb.storage.from(PHOTO_BUCKET).remove([old]);
  },

  /** 비공개 버킷이라 로그인한 교사진에게만 잠깐 유효한 링크를 발급합니다. (교사·간사) */
  async loadTeacherPhotoUrls() {
    teacherPhotoUrls.clear();
    if (!isLoggedIn()) return;
    const rows = state.teachers.filter((t) => t.photo_path);
    if (!rows.length) return;
    const { data, error } = await sb.storage.from(TEACHER_PHOTO_BUCKET)
      .createSignedUrls(rows.map((t) => t.photo_path), 60 * 60);
    if (error) return;
    data.forEach((d, i) => { if (d.signedUrl) teacherPhotoUrls.set(rows[i].id, d.signedUrl); });
  },

  async uploadTeacherPhoto(teacherId, blob) {
    const path = `${teacherId}/${Date.now()}.jpg`;
    const up = await sb.storage.from(TEACHER_PHOTO_BUCKET)
      .upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(translate(up.error.message));
    const old = state.teachers.find((t) => t.id === teacherId)?.photo_path;
    const { error } = await sb.from("teachers").update({ photo_path: path }).eq("id", teacherId);
    if (error) throw new Error(translate(error.message));
    if (old && old !== path) await sb.storage.from(TEACHER_PHOTO_BUCKET).remove([old]);
    return path;
  },

  async removeTeacherPhoto(teacherId) {
    const old = state.teachers.find((t) => t.id === teacherId)?.photo_path;
    const { error } = await sb.from("teachers").update({ photo_path: null }).eq("id", teacherId);
    if (error) throw new Error(translate(error.message));
    if (old) await sb.storage.from(TEACHER_PHOTO_BUCKET).remove([old]);
  },

  async listAccounts() {
    const { data, error } = await sb.rpc("list_accounts");
    if (error) throw new Error(translate(error.message));
    return data || [];
  },
  async setAdmin(profileId, isAdmin) {
    const { error } = await sb.rpc("set_admin", { p_profile_id: profileId, p_is_admin: isAdmin });
    if (error) throw new Error(translate(error.message));
    if (profileId === state.profile?.id) await this.loadProfile();
  },
  async revokeAccount(profileId) {
    const { error } = await sb.rpc("revoke_account", { p_profile_id: profileId });
    if (error) throw new Error(translate(error.message));
    if (profileId === state.profile?.id) { await this.signOut(); }
  },

  async signupRequirements() {
    const { data, error } = await sb.rpc("signup_requirements");
    if (error) return { is_open: true, needs_first_admin: false };
    return data?.[0] || { is_open: true, needs_first_admin: false };
  },
  async setSignupOpen(open) {
    const { error } = await sb.rpc("set_signup_open", { p_open: !!open });
    if (error) throw new Error(translate(error.message));
  },

  // ── 가입 알림 메일 (06_notify_email.sql 을 실행한 교적부에서만) ──
  async notifyStatus() {
    const { data, error } = await sb.rpc("notify_status");
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) return null;   // 아직 설정 전
      throw new Error(translate(error.message));
    }
    return data?.[0] || null;
  },
  async setNotifyEmails(emails, enabled) {
    const { error } = await sb.rpc("set_notify_emails", { p_emails: emails, p_enabled: !!enabled });
    if (error) throw new Error(translate(error.message));
  },
  async notifyTest() {
    const { data, error } = await sb.rpc("notify_test");
    if (error) throw new Error(translate(error.message));
    return data === true;
  },

  async findTeacherCandidates(name, phone) {
    const { data, error } = await sb.rpc("find_teacher_candidates", { p_name: name, p_phone: phone });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async usernameAvailable(username) {
    const { data, error } = await sb.rpc("username_available", { p_username: username });
    return error ? true : data;
  },

  /** 가입 «신청». 첫 계정만 바로 열리고, 나머지는 관리자 승인을 기다립니다. */
  async signUp({ username, password, name, phone, teacherId }) {
    const { error } = await sb.auth.signUp({
      email: `${username.toLowerCase()}@${ID_EMAIL_DOMAIN}`,
      password,
      options: { data: { username, name, phone, teacher_id: teacherId || null } },
    });
    if (error) throw new Error(translate(error.message));
    state.pending = { username, name, admins: [] };
    await this.loadProfile();          // 승인됐으면 profile, 아니면 pending(+문의처) 이 채워집니다
    return { approved: !!state.profile };
  },

  async signIn(username, password) {
    const { error } = await sb.auth.signInWithPassword({
      email: `${username.toLowerCase()}@${ID_EMAIL_DOMAIN}`, password,
    });
    if (error) throw new Error(translate(error.message));
    await this.loadProfile();
    if (!state.profile) throw new Error(state.pending
      ? "아직 승인 대기 중입니다. 관리자(간사)에게 문의해 주세요."
      : "사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.");
  },

  async approveAccount(profileId, teacherId) {
    const { error } = await sb.rpc("approve_account",
      { p_profile_id: profileId, p_teacher_id: teacherId || null });
    if (error) throw new Error(translate(error.message));
  },
  async setAccountTeacher(profileId, teacherId) {
    const { error } = await sb.rpc("set_account_teacher",
      { p_profile_id: profileId, p_teacher_id: teacherId || null });
    if (error) throw new Error(translate(error.message));
  },
  async unlinkedTeachers() {
    const { data, error } = await sb.rpc("unlinked_teachers");
    if (error) throw new Error(translate(error.message));
    return data || [];
  },

  async signOut() { await sb.auth.signOut(); state.profile = null; state.pending = null; },

  async save(table, row) {
    const { data, error } = await sb.from(table).upsert(row).select().single();
    if (error) throw new Error(translate(error.message));
    return data;
  },
  async saveMany(table, rows) {
    if (!rows.length) return [];
    let { data, error } = await sb.from(table).upsert(rows).select();
    // 05_cell_seat.sql 을 아직 실행하지 않은 교적부에서도 저장은 되도록 («자리» 만 빠집니다)
    if (error && /role/.test(error.message || "") && table === "cell_members") {
      const plain = rows.map(({ role, ...r }) => r);
      ({ data, error } = await sb.from(table).upsert(plain).select());
      if (!error) toast("셀리더·셀헬퍼는 supabase/05_cell_seat.sql 을 한 번 실행해야 저장됩니다.", "err");
    }
    if (error) throw new Error(translate(error.message));
    return data;
  },
  async remove(table, id) {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw new Error(translate(error.message));
  },

  async setMembership(studentId, cellId, versionId, role = null) {
    await sb.from("cell_members").delete()
      .eq("student_id", studentId).eq("version_id", versionId);
    if (!cellId) return;
    const { error } = await sb.from("cell_members")
      .insert({ student_id: studentId, cell_id: cellId, version_id: versionId, role: role || null });
    if (error) throw new Error(translate(error.message));
  },
};

function translate(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "아이디 또는 비밀번호가 올바르지 않습니다.";
  if (m.includes("already registered")) return "이미 사용 중인 아이디입니다.";
  if (m.includes("password should be")) return "비밀번호는 6자 이상이어야 합니다.";
  if (m.includes("email address") && m.includes("invalid"))
    return "아이디 형식이 올바르지 않습니다. 영문·숫자만 사용해 주세요.";
  if (m.includes("row-level security")) return "권한이 없습니다. 로그인 상태와 관리자 권한을 확인해 주세요.";
  return msg;
}

// ════════════════════════════════════════════════════════════
//  데모 어댑터 (localStorage)
// ════════════════════════════════════════════════════════════
const DEMO_KEY = "kkumttang.demo.v3";   // 데이터 구조가 바뀌면 올립니다 (오래된 브라우저 캐시 무시)
let demo = null;

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }));

const demoAdapter = {
  async init() {
    const saved = localStorage.getItem(DEMO_KEY);
    if (saved) { try { demo = JSON.parse(saved); } catch { demo = null; } }
    if (!demo) {
      const res = await fetch("./assets/data/demo.json");
      demo = { ...(await res.json()), accounts: [], session: null };
      this.persist();
    }
    demo.settings ||= { open: true };
    delete demo.settings.code_hash;                 // 예전 데모 데이터 정리
    if (!demo.roleOptions?.length)
      demo.roleOptions = DEFAULT_ROLE_OPTIONS.map((label, i) => ({ id: uid(), label, sort_order: i + 1 }));
    if (demo.session) {
      const acc = demo.accounts.find((a) => a.username === demo.session);
      state.profile = acc && acc.approved !== false ? publicProfile(acc) : null;
      if (!state.profile) demo.session = null;
    }
  },
  persist() { localStorage.setItem(DEMO_KEY, JSON.stringify(demo)); },

  async refresh() {
    state.versions = [...demo.cell_versions].sort((a, b) => b.created_at.localeCompare(a.created_at));
    state.cells = [...demo.cells].sort((a, b) => a.sort_order - b.sort_order);
    state.members = [...demo.cell_members];
    state.teachers = [...demo.teachers]
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))
      .map((t) => (isLoggedIn() ? t : { ...t, phone: null, birth: null, note: null }));
    state.students = [...demo.students]
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))
      .map((s) => (isMasked() ? { ...s, phone: null, mother_name: null, mother_phone: null,
                                  father_name: null, father_phone: null, siblings: null,
                                  address: null, note: null } : s));
    ensureVersion();
    photoUrls.clear();
    teacherPhotoUrls.clear();
    demo.photos ||= {};
    demo.teacherPhotos ||= {};
    if (isLoggedIn()) {                               // 사진은 로그인해야 보입니다
      for (const [sid, url] of Object.entries(demo.photos)) photoUrls.set(sid, url);
      for (const [tid, url] of Object.entries(demo.teacherPhotos)) teacherPhotoUrls.set(tid, url);
    }
    state.pendingCount = isAdmin()
      ? demo.accounts.filter((a) => a.approved === false).length : 0;
    state.roleOptions = [...demo.roleOptions].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  },

  /** demo.roleOptions 를 고친 뒤에는 늘 이걸 불러서 state.roleOptions 도 같이 맞춰 둡니다
   *  (그렇지 않으면 화면에 반영되지 않습니다 — state 는 refresh() 때 한 번 복사해 둔 배열이라
   *   demo.roleOptions 에 새로 밀어 넣거나 통째로 바꾼 내용은 저절로 따라가지 않습니다) */
  _syncRoleOptions() {
    state.roleOptions = [...demo.roleOptions].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  },
  async addRoleOption(label) {
    if (!state.profile?.is_admin) throw new Error("직함 관리는 관리자만 할 수 있습니다.");
    const l = String(label || "").trim();
    if (!l) throw new Error("직함 이름을 적어 주세요.");
    if (roleLabels().includes(l)) throw new Error("이미 있는 직함입니다.");
    const nextOrder = Math.max(0, ...demo.roleOptions.map((r) => r.sort_order || 0)) + 1;
    demo.roleOptions.push({ id: uid(), label: l, sort_order: nextOrder });
    this.persist();
    this._syncRoleOptions();
  },
  async renameRoleOption(id, newLabel) {
    if (!state.profile?.is_admin) throw new Error("직함 관리는 관리자만 할 수 있습니다.");
    const l = String(newLabel || "").trim();
    if (!l) throw new Error("직함 이름을 적어 주세요.");
    const cur = demo.roleOptions.find((r) => r.id === id);
    if (!cur) throw new Error("직함을 찾을 수 없습니다.");
    if (cur.label === l) return;
    if (roleLabels().includes(l)) throw new Error("이미 있는 직함입니다.");
    const old = cur.label;
    cur.label = l;
    for (const t of demo.teachers) if (t.role === old) t.role = l;
    this.persist();
    this._syncRoleOptions();
    await this.refresh();
  },
  async deleteRoleOption(id) {
    if (!state.profile?.is_admin) throw new Error("직함 관리는 관리자만 할 수 있습니다.");
    const cur = demo.roleOptions.find((r) => r.id === id);
    if (!cur) return;
    if (demo.teachers.some((t) => t.role === cur.label))
      throw new Error("이 직함을 쓰고 있는 분이 있어 지울 수 없습니다. 먼저 다른 직함으로 바꿔 주세요.");
    demo.roleOptions = demo.roleOptions.filter((r) => r.id !== id);
    this.persist();
    this._syncRoleOptions();
  },
  async moveRoleOption(id, dir) {
    if (!state.profile?.is_admin) throw new Error("직함 관리는 관리자만 할 수 있습니다.");
    const list = [...demo.roleOptions].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const i = list.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i].sort_order, list[j].sort_order] = [list[j].sort_order, list[i].sort_order];
    this.persist();
    this._syncRoleOptions();
  },

  async uploadPhoto(studentId, blob) {
    if (!state.profile) throw new Error("로그인이 필요합니다.");
    const { blobToDataURL } = await import("./ui.js");
    demo.photos ||= {};
    demo.photos[studentId] = await blobToDataURL(blob);
    const st = demo.students.find((s) => s.id === studentId);
    if (st) st.photo_path = `demo/${studentId}`;
    try { this.persist(); }
    catch { delete demo.photos[studentId]; throw new Error("브라우저 저장 공간이 가득 찼습니다. 데모 모드에서는 사진을 몇 장만 넣을 수 있어요."); }
    return st?.photo_path;
  },

  async removePhoto(studentId) {
    if (!state.profile) throw new Error("로그인이 필요합니다.");
    demo.photos ||= {};
    delete demo.photos[studentId];
    const st = demo.students.find((s) => s.id === studentId);
    if (st) st.photo_path = null;
    this.persist();
  },

  async uploadTeacherPhoto(teacherId, blob) {
    if (!state.profile) throw new Error("로그인이 필요합니다.");
    const { blobToDataURL } = await import("./ui.js");
    demo.teacherPhotos ||= {};
    demo.teacherPhotos[teacherId] = await blobToDataURL(blob);
    const t = demo.teachers.find((x) => x.id === teacherId);
    if (t) t.photo_path = `demo/${teacherId}`;
    try { this.persist(); }
    catch { delete demo.teacherPhotos[teacherId]; throw new Error("브라우저 저장 공간이 가득 찼습니다. 데모 모드에서는 사진을 몇 장만 넣을 수 있어요."); }
    return t?.photo_path;
  },

  async removeTeacherPhoto(teacherId) {
    if (!state.profile) throw new Error("로그인이 필요합니다.");
    demo.teacherPhotos ||= {};
    delete demo.teacherPhotos[teacherId];
    const t = demo.teachers.find((x) => x.id === teacherId);
    if (t) t.photo_path = null;
    this.persist();
  },

  async findTeacherCandidates(name, phone) {
    if (!nameKey(name) || phoneKey(phone).length < 8) return [];
    return demo.teachers
      .filter((t) => nameKey(t.name) === nameKey(name) && phoneKey(t.phone) === phoneKey(phone))
      .map((t) => ({ id: t.id, name: t.name, role: t.role, note: t.note,
                     phone_masked: maskPhone(t.phone), already_claimed: !!t.user_id }));
  },

  async usernameAvailable(u) {
    return !demo.accounts.some((a) => a.username.toLowerCase() === u.toLowerCase());
  },

  async listAccounts() {
    if (!state.profile) throw new Error("로그인이 필요합니다.");
    const admin = !!state.profile.is_admin;
    return demo.accounts.map((a) => {
      const t = demo.teachers.find((x) => x.id === a.teacher_id);
      return {
        id: a.id, username: a.username, name: a.name,
        phone: admin ? a.phone : null,
        is_admin: !!a.is_admin, approved: a.approved !== false,
        role: t?.role || "-", teacher_id: a.teacher_id || null, teacher_name: t?.name || null,
        created_at: a.created_at || null, approved_at: a.approved_at || null,
        is_me: a.id === state.profile.id,
      };
    }).sort((x, y) => (x.approved - y.approved) || (y.is_admin - x.is_admin));
  },

  /** 문의처 — 지금 관리자인 분들의 이름·번호 */
  _adminContacts() {
    return demo.accounts.filter((a) => a.is_admin && a.approved !== false).map((a) => {
      const t = demo.teachers.find((x) => x.id === a.teacher_id);
      return { name: t?.name || a.name, role: t?.role || "관리자", phone: t?.phone || a.phone };
    });
  },

  async unlinkedTeachers() {
    if (!state.profile?.is_admin) throw new Error("관리자만 볼 수 있습니다.");
    return demo.teachers
      .filter((t) => !t.user_id && !demo.accounts.some((a) => a.teacher_id === t.id))
      .map((t) => ({ id: t.id, name: t.name, role: t.role, phone_masked: maskPhone(t.phone) }));
  },

  /** 계정 ↔ 교사 명부 연결 갈아 끼우기 (승인된 계정만 명부에 «가입» 표시) */
  _link(acc, teacherId) {
    if (teacherId) {
      const t = demo.teachers.find((x) => x.id === teacherId);
      if (!t) throw new Error("교사/간사 명부에서 찾을 수 없습니다.");
      if (demo.accounts.some((a) => a.teacher_id === teacherId && a.id !== acc.id))
        throw new Error("그 교사/간사는 이미 다른 계정과 연결돼 있습니다.");
    }
    const old = demo.teachers.find((x) => x.id === acc.teacher_id);
    if (old && old.id !== teacherId) { old.user_id = null; old.claimed_at = null; }
    acc.teacher_id = teacherId || null;
    const nu = teacherId ? demo.teachers.find((x) => x.id === teacherId) : null;
    if (nu && acc.approved !== false) { nu.user_id = acc.id; nu.claimed_at = new Date().toISOString(); }
  },

  async approveAccount(profileId, teacherId) {
    if (!state.profile?.is_admin) throw new Error("가입 승인은 관리자만 할 수 있습니다.");
    const acc = demo.accounts.find((a) => a.id === profileId);
    if (!acc) throw new Error("해당 신청을 찾을 수 없습니다.");
    acc.approved = true; acc.approved_at = new Date().toISOString();
    this._link(acc, teacherId);
    this.persist();
  },

  async setAccountTeacher(profileId, teacherId) {
    if (!state.profile?.is_admin) throw new Error("명부 연결은 관리자만 바꿀 수 있습니다.");
    const acc = demo.accounts.find((a) => a.id === profileId);
    if (!acc) throw new Error("해당 계정을 찾을 수 없습니다.");
    this._link(acc, teacherId);
    this.persist();
  },
  async setAdmin(profileId, isAdmin) {
    if (!state.profile?.is_admin) throw new Error("관리자만 변경할 수 있습니다.");
    const acc = demo.accounts.find((a) => a.id === profileId);
    if (!acc) throw new Error("해당 계정을 찾을 수 없습니다.");
    if (acc.approved === false) throw new Error("승인된 계정만 관리자로 지정할 수 있습니다.");
    if (!isAdmin && !demo.accounts.some((a) => a.is_admin && a.approved !== false && a.id !== profileId))
      throw new Error("마지막 관리자입니다. 다른 분을 먼저 관리자로 지정해 주세요.");
    acc.is_admin = !!isAdmin;
    if (acc.id === state.profile.id) state.profile = publicProfile(acc);
    this.persist();
  },
  async revokeAccount(profileId) {
    if (!state.profile?.is_admin) throw new Error("관리자만 변경할 수 있습니다.");
    const acc = demo.accounts.find((a) => a.id === profileId);
    if (!acc) throw new Error("해당 계정을 찾을 수 없습니다.");
    if (acc.is_admin && !demo.accounts.some((a) => a.is_admin && a.approved !== false && a.id !== profileId))
      throw new Error("마지막 관리자입니다. 다른 분을 먼저 관리자로 지정해 주세요.");
    demo.accounts = demo.accounts.filter((a) => a.id !== profileId);
    const t = demo.teachers.find((x) => x.id === acc.teacher_id);
    if (t) { t.user_id = null; t.claimed_at = null; }
    if (acc.id === state.profile.id) { demo.session = null; state.profile = null; }
    this.persist();
  },

  async signupRequirements() {
    demo.settings ||= { open: true };
    return { is_open: demo.settings.open !== false, needs_first_admin: demo.accounts.length === 0 };
  },
  async setSignupOpen(open) {
    if (!state.profile?.is_admin) throw new Error("관리자만 변경할 수 있습니다.");
    demo.settings ||= { open: true };
    demo.settings.open = !!open;
    this.persist();
  },

  // 데모 모드에는 메일 보낼 서버가 없습니다 (설정 전으로 보여 줍니다)
  async notifyStatus() { return null; },
  async setNotifyEmails() { throw new Error("데모 모드에서는 알림을 설정할 수 없습니다."); },
  async notifyTest() { throw new Error("데모 모드에서는 메일을 보낼 수 없습니다."); },

  /** 가입 «신청». 맨 처음 한 사람만 바로 열리고, 나머지는 관리자 승인을 기다립니다. */
  async signUp({ username, password, name, phone, teacherId }) {
    demo.settings ||= { open: true };
    if (demo.settings.open === false)
      throw new Error("지금은 가입 신청을 받지 않습니다. 관리자에게 문의해 주세요.");
    if (!nameKey(name) || !phoneKey(phone)) throw new Error("이름과 휴대폰번호를 적어 주세요.");
    if (!(await this.usernameAvailable(username))) throw new Error("이미 사용 중인 아이디입니다.");

    if (teacherId) {                       // «나예요!» 를 고른 경우에만 대조합니다
      const t = demo.teachers.find((x) => x.id === teacherId);
      if (!t) throw new Error("교사/간사 명부에서 찾을 수 없습니다.");
      if (t.user_id) throw new Error("이미 가입된 교사/간사입니다. 로그인해 주세요.");
      if (demo.accounts.some((a) => a.teacher_id === teacherId))
        throw new Error("이미 신청이 들어와 있는 교사/간사입니다. 관리자에게 문의해 주세요.");
      if (nameKey(t.name) !== nameKey(name) || phoneKey(t.phone) !== phoneKey(phone))
        throw new Error("이름 또는 휴대폰번호가 명부와 일치하지 않습니다.");
    }

    const first = demo.accounts.length === 0;
    const acc = { id: uid(), username, pw: await sha256(password), name, phone,
                  teacher_id: teacherId || null, is_admin: first, approved: first,
                  approved_at: first ? new Date().toISOString() : null,
                  created_at: new Date().toISOString() };
    demo.accounts.push(acc);
    if (first && teacherId) {
      const t = demo.teachers.find((x) => x.id === teacherId);
      if (t) { t.user_id = acc.id; t.claimed_at = new Date().toISOString(); }
    }
    if (first) { demo.session = username; state.profile = publicProfile(acc); state.pending = null; }
    else {
      demo.session = null; state.profile = null;
      state.pending = { username, name, admins: this._adminContacts() };
    }
    this.persist();
    return { approved: first };
  },

  async signIn(username, password) {
    const acc = demo.accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
    if (!acc || acc.pw !== (await sha256(password)))
      throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    if (acc.approved === false) {
      state.pending = { username: acc.username, name: acc.name,
                        created_at: acc.created_at, admins: this._adminContacts() };
      throw new Error("아직 승인 대기 중입니다. 관리자(간사)에게 문의해 주세요.");
    }
    demo.session = acc.username;
    state.pending = null;
    state.profile = publicProfile(acc);
    this.persist();
  },

  async signOut() { demo.session = null; state.profile = null; state.pending = null; this.persist(); },

  async save(table, row) {
    if (!state.profile) throw new Error("로그인이 필요합니다.");
    const arr = (demo[table] ||= []);
    const out = { ...row };
    if (out.id) {
      const i = arr.findIndex((r) => r.id === out.id);
      if (i >= 0) arr[i] = { ...arr[i], ...out }; else arr.push(out);
    } else {
      out.id = uid();
      if (table === "students" && !out.seq)
        out.seq = Math.max(0, ...arr.map((r) => r.seq || 0)) + 1;
      if (table === "cell_versions" && !out.created_at) out.created_at = new Date().toISOString();
      arr.push(out);
    }
    this.persist();
    return out;
  },
  async saveMany(table, rows) {
    const out = [];
    for (const r of rows) out.push(await this.save(table, r));
    return out;
  },

  async remove(table, id) {
    if (!state.profile) throw new Error("로그인이 필요합니다.");
    if (table === "cell_versions" && !state.profile.is_admin)
      throw new Error("셀편성 버전 삭제는 관리자만 가능합니다.");
    demo[table] = demo[table].filter((r) => r.id !== id);
    if (table === "cell_versions") {
      const gone = demo.cells.filter((c) => c.version_id === id).map((c) => c.id);
      demo.cells = demo.cells.filter((c) => c.version_id !== id);
      demo.cell_members = demo.cell_members.filter((m) => m.version_id !== id && !gone.includes(m.cell_id));
    }
    if (table === "cells") demo.cell_members = demo.cell_members.filter((m) => m.cell_id !== id);
    if (table === "students") demo.cell_members = demo.cell_members.filter((m) => m.student_id !== id);
    this.persist();
  },

  async setMembership(studentId, cellId, versionId, role = null) {
    if (!state.profile) throw new Error("로그인이 필요합니다.");
    demo.cell_members = demo.cell_members.filter(
      (m) => !(m.student_id === studentId && m.version_id === versionId));
    if (cellId) demo.cell_members.push({ id: uid(), version_id: versionId, cell_id: cellId,
                                        student_id: studentId, role: role || null });
    this.persist();
  },

  reset() { localStorage.removeItem(DEMO_KEY); },
};

const publicProfile = (a) => ({
  id: a.id, username: a.username, name: a.name, phone: a.phone,
  teacher_id: a.teacher_id, is_admin: a.is_admin, approved: a.approved !== false,
});

// ════════════════════════════════════════════════════════════
//  공개 API
// ════════════════════════════════════════════════════════════
let adapter = demoAdapter;

function ensureVersion() {
  if (!state.versions.length) { state.versionId = null; return; }
  if (!state.versions.some((v) => v.id === state.versionId))
    state.versionId = state.versions[0].id;          // 가장 최근 등록 버전
}

export async function initData() {
  if (isConfigured()) { state.mode = "supabase"; adapter = supabaseAdapter; }
  else { state.mode = "demo"; adapter = demoAdapter; }
  await adapter.init();
  await adapter.refresh();
  state.ready = true;
}

export const api = {
  refresh: () => adapter.refresh(),
  findTeacherCandidates: (n, p) => adapter.findTeacherCandidates(n, p),
  usernameAvailable: (u) => adapter.usernameAvailable(u),
  signUp: (o) => adapter.signUp(o),
  listAccounts: () => adapter.listAccounts(),
  setAdmin: (id, v) => adapter.setAdmin(id, v),
  revokeAccount: (id) => adapter.revokeAccount(id),
  signupRequirements: () => adapter.signupRequirements(),
  setSignupOpen: (b) => adapter.setSignupOpen(b),
  notifyStatus: () => adapter.notifyStatus(),
  setNotifyEmails: (list, on) => adapter.setNotifyEmails(list, on),
  notifyTest: () => adapter.notifyTest(),
  approveAccount: (id, tid) => adapter.approveAccount(id, tid),
  setAccountTeacher: (id, tid) => adapter.setAccountTeacher(id, tid),
  unlinkedTeachers: () => adapter.unlinkedTeachers(),
  signIn: (u, p) => adapter.signIn(u, p),
  signOut: () => adapter.signOut(),

  uploadPhoto: (id, blob) => adapter.uploadPhoto(id, blob),
  removePhoto: (id) => adapter.removePhoto(id),
  saveStudent: (r) => adapter.save("students", r),
  saveStudents: (rows) => adapter.saveMany("students", rows),
  deleteStudent: (id) => adapter.remove("students", id),

  uploadTeacherPhoto: (id, blob) => adapter.uploadTeacherPhoto(id, blob),
  removeTeacherPhoto: (id) => adapter.removeTeacherPhoto(id),
  saveTeacher: (r) => adapter.save("teachers", r),
  saveTeachers: (rows) => adapter.saveMany("teachers", rows),
  deleteTeacher: (id) => adapter.remove("teachers", id),

  saveVersion: (r) => adapter.save("cell_versions", r),
  deleteVersion: (id) => adapter.remove("cell_versions", id),

  saveCell: (r) => adapter.save("cells", r),
  saveCells: (rows) => adapter.saveMany("cells", rows),
  deleteCell: (id) => adapter.remove("cells", id),

  setMembership: (sid, cid, vid = state.versionId, role = null) =>
    adapter.setMembership(sid, cid, vid, role),
  saveMembers: (rows) => adapter.saveMany("cell_members", rows),

  resetDemo: () => demoAdapter.reset(),

  addRoleOption: (label) => adapter.addRoleOption(label),
  renameRoleOption: (id, label) => adapter.renameRoleOption(id, label),
  deleteRoleOption: (id) => adapter.deleteRoleOption(id),
  moveRoleOption: (id, dir) => adapter.moveRoleOption(id, dir),
};

// ── 파생 데이터 ──────────────────────────────────────────
export const currentVersion = () => state.versions.find((v) => v.id === state.versionId) || null;
export const versionCells = (vid = state.versionId) =>
  state.cells.filter((c) => c.version_id === vid).sort((a, b) => a.sort_order - b.sort_order);
export const activeCells = (vid = state.versionId) =>
  versionCells(vid).filter((c) => c.kind === "셀");
export const cellById = (id) => state.cells.find((c) => c.id === id) || null;

/** 선택된 버전에서 학생이 속한 셀 id */
export function cellIdOf(studentId, vid = state.versionId) {
  return state.members.find((m) => m.student_id === studentId && m.version_id === vid)?.cell_id || null;
}
export function cellNameOf(studentId, vid = state.versionId) {
  const c = cellById(cellIdOf(studentId, vid));
  return c ? c.name : null;
}
export const cellMembers = (cellId) =>
  state.members.filter((m) => m.cell_id === cellId)
    .map((m) => state.students.find((s) => s.id === m.student_id))
    .filter(Boolean);

/** 셀 안에서 맡은 자리 — "셀리더" · "셀헬퍼" · null (편성 버전마다 다릅니다) */
export function cellRoleOf(studentId, vid = state.versionId) {
  return state.members.find((m) => m.student_id === studentId && m.version_id === vid)?.role || null;
}
/** 리더 → 헬퍼 → 나머지 순서 (그다음은 넘겨받은 순서를 그대로 지킵니다) */
export const ROLE_RANK = { 셀리더: 0, 셀헬퍼: 1 };
export const roleRank = (role) => (role in ROLE_RANK ? ROLE_RANK[role] : 2);

export function versionLabel(v) {
  if (!v) return "";
  const d = new Date(v.created_at);
  const ymd = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  return `${v.label} · ${ymd} 등록`;
}

/** 생일 목록: 학생 + 교사진을 월/일 기준으로 합친 배열 */
export function birthdayList() {
  const out = [];
  for (const s of state.students) {
    if (!s.birth || !isActive(s)) continue;
    const [, m, d] = s.birth.split("-").map(Number);
    out.push({ month: m, day: d, name: s.name, kind: "학생", grade: gradeOf(s), ref: s });
  }
  for (const t of state.teachers) {
    const src = t.birth || (t.birth_md ? `0000-${t.birth_md}` : null);
    if (!src) continue;
    const [, m, d] = src.split("-").map(Number);
    out.push({ month: m, day: d, name: t.name, kind: t.role, ref: t });
  }
  return out.sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, "ko"));
}
