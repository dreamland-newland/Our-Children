-- ============================================================
--  꿈땅새땅 청소년부 교적부 — 스키마
--  Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행하세요.
--  (01_schema.sql → 02_seed.sql 순서로 실행)
-- ============================================================

-- ── 확장 ────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── 공통 유틸: 전화번호에서 숫자만 추출 ──────────────────────
create or replace function public.phone_digits(p text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
$$;

-- 뒤 8자리로 비교(010 유무·하이픈 차이 흡수)
create or replace function public.phone_key(p text)
returns text language sql immutable as $$
  select right(public.phone_digits(p), 8);
$$;

-- ── 학생(교적) ──────────────────────────────────────────────
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  seq           int,
  name          text not null,
  gender        text check (gender in ('남', '여') or gender is null),
  grade         text,                       -- 비워두면 생년월일로 자동 계산 (아래 «학년» 설명 참고)
  school        text,
  birth         date,
  birth_year    int check (birth_year is null or birth_year between 1900 and 2100),
                                    -- 생년월일을 아직 모를 때 «연도만» 적어 두는 칸
  phone         text,
  mother_name   text,
  mother_phone  text,
  father_name   text,
  father_phone  text,
  siblings      text,
  address       text,
  note          text,
  photo_path    text,                             -- 프로필 사진 (비공개 스토리지 경로)
  is_promoted   boolean not null default false,   -- 하늘아이(초등부)에서 올라온 아이
  status        text not null default '재적'   -- 졸업은 나이로 자동 판정되므로 넣지 않아도 됩니다
                check (status in ('재적', '장기결석', '졸업', '전출')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists students_grade_idx on public.students (grade);

-- ── 셀편성 버전 ─────────────────────────────────────────────
--    편성을 새로 짤 때마다 버전을 하나 만듭니다.
--    created_at(등록일)으로 어느 시점 편성인지 알 수 있습니다.
create table if not exists public.cell_versions (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,                       -- 예: '2026-1학기'
  note        text,
  created_at  timestamptz not null default now(),  -- 등록일 = 버전 식별
  created_by  uuid references auth.users(id) on delete set null,
  created_by_name text,                                -- 등록한 교사 이름
  updated_at  timestamptz not null default now(),      -- 마지막으로 저장한 시각
  updated_by_name text                                 -- 마지막으로 저장한 교사 이름
);
create index if not exists cell_versions_created_idx on public.cell_versions (created_at desc);

-- ── 셀 ──────────────────────────────────────────────────────
create table if not exists public.cells (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.cell_versions(id) on delete cascade,
  name        text not null,
  leaders     text[] not null default '{}',
  kind        text not null default '셀' check (kind in ('셀', '장기결석', '기타')),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (version_id, name)
);
create index if not exists cells_version_idx on public.cells (version_id);

-- ── 셀 소속 (버전별로 달라집니다) ───────────────────────────
create table if not exists public.cell_members (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.cell_versions(id) on delete cascade,
  cell_id     uuid not null references public.cells(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (version_id, student_id)             -- 한 버전에서 한 셀만
);
create index if not exists cell_members_cell_idx    on public.cell_members (cell_id);
create index if not exists cell_members_student_idx on public.cell_members (student_id);

-- ── 교사 / 간사 명부 (회원가입 "나예요!" 인증의 원본) ─────────
create table if not exists public.teachers (
  id          uuid primary key default gen_random_uuid(),
  seq         int,
  name        text not null,
  role        text not null default '간사'
              check (role in ('교역자', '사모', '교사', '간사')),
  birth       date,                         -- 생년월일(연도까지 아는 경우)
  birth_md    text,                         -- 'MM-DD' — 연도 미상인 경우
  phone       text,
  note        text,
  user_id     uuid unique references auth.users(id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists teachers_phone_key_idx on public.teachers (public.phone_key(phone));

-- ── 가입한 교사진 프로필 ─────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  name        text not null,               -- 신청할 때 본인이 적은 이름
  phone       text not null,               -- 신청할 때 본인이 적은 휴대폰번호
  teacher_id  uuid unique references public.teachers(id) on delete set null,
  is_admin    boolean not null default false,
  approved    boolean not null default false,   -- ★ 관리자가 승인해야 교적부가 열립니다
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
-- 이미 쓰던 교적부를 올리는 경우(예전 버전에서 넘어올 때)를 위한 보강
alter table public.profiles add column if not exists approved    boolean not null default false;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid references auth.users(id) on delete set null;

-- ── 앱 설정 (가입 신청 받기 켬/끔) ──────────────────────────
--   가입 코드는 없앴습니다. 대신 «관리자 승인» 이 관문입니다.
--   signup_open 을 끄면 신청 자체를 받지 않습니다(스팸 신청을 막을 때).
create table if not exists public.app_settings (
  id                boolean primary key default true check (id),
  signup_open       boolean not null default true,
  updated_at        timestamptz not null default now()
);
alter table public.app_settings drop column if exists signup_code_hash;
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- ── updated_at 자동 갱신 ────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists students_touch on public.students;
create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();

drop trigger if exists teachers_touch on public.teachers;
create trigger teachers_touch before update on public.teachers
  for each row execute function public.touch_updated_at();

drop trigger if exists cell_versions_touch on public.cell_versions;
create trigger cell_versions_touch before update on public.cell_versions
  for each row execute function public.touch_updated_at();

-- 셀 소속을 넣을 때 version_id 를 셀에서 자동으로 맞춰 줍니다.
create or replace function public.sync_member_version()
returns trigger language plpgsql as $$
begin
  select version_id into new.version_id from public.cells where id = new.cell_id;
  if new.version_id is null then
    raise exception '존재하지 않는 셀입니다.';
  end if;
  return new;
end $$;
drop trigger if exists cell_members_sync on public.cell_members;
create trigger cell_members_sync before insert or update on public.cell_members
  for each row execute function public.sync_member_version();


-- ============================================================
--  회원가입 : "나예요!" 인증
-- ============================================================

-- 1단계 — 이름 + 휴대폰번호로 교사/간사 명부 조회 (선택 사항).
--        번호는 마스킹해서 반환하므로 명부 전체가 새어나가지 않습니다.
--        찾지 못해도 가입 신청은 할 수 있고, 연결은 관리자가 승인하면서 정합니다.
create or replace function public.find_teacher_candidates(p_name text, p_phone text)
returns table (
  id uuid, name text, role text, phone_masked text, note text, already_claimed boolean
)
language sql stable security definer set search_path = public as $$
  select t.id,
         t.name,
         t.role,
         case when t.phone is null or length(public.phone_digits(t.phone)) < 8 then '-'
              else regexp_replace(public.phone_digits(t.phone),
                                  '^(\d{3})(\d+)(\d{4})$', '\1-****-\3') end,
         t.note,
         (t.user_id is not null
          or exists (select 1 from public.profiles p where p.teacher_id = t.id))
  from public.teachers t
  where btrim(p_name) <> ''
    and length(public.phone_digits(p_phone)) >= 8
    and replace(btrim(t.name), ' ', '') = replace(btrim(p_name), ' ', '')
    and public.phone_key(t.phone) = public.phone_key(p_phone);
$$;
grant execute on function public.find_teacher_candidates(text, text) to anon, authenticated;

-- 2단계 — auth.users 가 생기면 «승인 대기» 프로필을 만듭니다.
--   · 교사 명부에 없는 분도 신청할 수 있습니다 (teacher_id 가 비어 있어도 됩니다).
--   · 이 시점에는 교사 명부를 건드리지 않습니다. 실제 연결은 관리자가 승인할 때 이뤄집니다.
--   · 맨 처음 가입한 한 사람만 자동으로 승인 + 관리자가 됩니다
--     (아무도 없으면 승인해 줄 사람도 없으니까요).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_teacher_id uuid := nullif(new.raw_user_meta_data->>'teacher_id', '')::uuid;
  v_username   text := btrim(coalesce(new.raw_user_meta_data->>'username', ''));
  v_name       text := btrim(coalesce(new.raw_user_meta_data->>'name', ''));
  v_phone      text := btrim(coalesce(new.raw_user_meta_data->>'phone', ''));
  v_t          public.teachers%rowtype;
  v_cfg        public.app_settings%rowtype;
  v_first      boolean;
begin
  select * into v_cfg from public.app_settings limit 1;
  if v_cfg.signup_open is false then
    raise exception '지금은 가입 신청을 받지 않습니다. 관리자에게 문의해 주세요.';
  end if;
  if v_name = '' or v_phone = '' then
    raise exception '이름과 휴대폰번호를 적어 주세요.';
  end if;

  -- «나예요!» 를 골랐다면 그 교사가 실제로 맞는지만 확인합니다.
  if v_teacher_id is not null then
    select * into v_t from public.teachers where id = v_teacher_id for update;
    if not found then
      raise exception '교사/간사 명부에서 찾을 수 없습니다.';
    end if;
    if v_t.user_id is not null then
      raise exception '이미 가입된 교사/간사입니다. 로그인해 주세요.';
    end if;
    if exists (select 1 from public.profiles p where p.teacher_id = v_teacher_id) then
      raise exception '이미 신청이 들어와 있는 교사/간사입니다. 관리자에게 문의해 주세요.';
    end if;
    if replace(v_t.name, ' ', '') <> replace(v_name, ' ', '')
       or public.phone_key(v_t.phone) <> public.phone_key(v_phone) then
      raise exception '이름 또는 휴대폰번호가 명부와 일치하지 않습니다.';
    end if;
  end if;

  -- 첫 번째 계정만 자동 승인 + 관리자
  select count(*) = 0 into v_first from public.profiles;

  insert into public.profiles
    (id, username, name, phone, teacher_id, is_admin, approved, approved_at)
  values
    (new.id, v_username, v_name, v_phone, v_teacher_id, v_first, v_first,
     case when v_first then now() end);

  -- 첫 관리자만 교사 명부에 바로 연결합니다.
  if v_first and v_teacher_id is not null then
    perform set_config('app.allow_teacher_link', '1', true);
    update public.teachers
       set user_id = new.id, claimed_at = now(), phone = coalesce(phone, v_phone)
     where id = v_teacher_id;
    perform set_config('app.allow_teacher_link', '', true);
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 가입 화면이 «지금 신청을 받는 중인가» 를 확인합니다.
drop function if exists public.signup_requirements();
create or replace function public.signup_requirements()
returns table (is_open boolean, needs_first_admin boolean)
language sql stable security definer set search_path = public as $$
  select (select signup_open from public.app_settings limit 1),
         (select count(*) = 0 from public.profiles);
$$;
grant execute on function public.signup_requirements() to anon, authenticated;

-- 관리자가 가입 신청 받기를 열고 닫기
create or replace function public.set_signup_open(p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 변경할 수 있습니다.'; end if;
  update public.app_settings set signup_open = coalesce(p_open, true), updated_at = now() where id;
end $$;
grant execute on function public.set_signup_open(boolean) to authenticated;

-- 예전 버전에서 넘어온 경우를 위해 가입 코드 함수는 없앱니다.
drop function if exists public.set_signup_code(text);

-- 아이디 중복 확인(가입 전)
create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(btrim(p_username)));
$$;
grant execute on function public.username_available(text) to anon, authenticated;


-- ============================================================
--  RLS — 조회는 누구나, 등록/수정/삭제는 로그인한 교사진만
--        (셀편성 버전 삭제만 관리자 전용)
-- ============================================================
alter table public.students      enable row level security;
alter table public.cells         enable row level security;
alter table public.cell_versions enable row level security;
alter table public.cell_members  enable row level security;
alter table public.teachers      enable row level security;
alter table public.profiles      enable row level security;
alter table public.app_settings  enable row level security;

-- ★ «승인된» 계정만 교사진으로 칩니다. 승인 전에는 로그인해도 아무 권한이 없습니다.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and approved);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and approved and is_admin);
$$;

-- 공개 조회 -------------------------------------------------
--   · 로그인하지 않은 방문자(auth.uid() 가 없음) → 볼 수 있습니다.
--     단 «어떤 열까지» 볼지는 아래 «접근 권한 (컬럼 단위)» 가 정합니다.
--   · 승인된 교사진 → 전부 볼 수 있습니다.
--   · ★ 로그인은 했지만 아직 승인 안 된 계정 → 한 줄도 나가지 않습니다.
--     (승인 전 계정이 로그인한 사용자용 전체 열 권한을 타고 들어오는 것을 막습니다.)
do $$
declare t text;
begin
  foreach t in array array['students', 'cells', 'cell_versions', 'cell_members', 'teachers'] loop
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format($f$create policy %I on public.%I for select
                      using (auth.uid() is null or public.is_staff())$f$,
                   t || '_public_read', t);
  end loop;
end $$;

-- 쓰기 : 로그인한 교사진 ------------------------------------
do $$
declare t text;
begin
  foreach t in array array['students', 'cells', 'cell_members', 'teachers'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format($f$create policy %I on public.%I for all
                      using (public.is_staff()) with check (public.is_staff())$f$,
                   t || '_staff_write', t);
  end loop;
end $$;

-- 셀편성 버전 : 만들기·수정은 교사진, 삭제는 관리자만 --------
drop policy if exists cell_versions_staff_insert on public.cell_versions;
drop policy if exists cell_versions_staff_update on public.cell_versions;
drop policy if exists cell_versions_admin_delete on public.cell_versions;
create policy cell_versions_staff_insert on public.cell_versions for insert
  with check (public.is_staff());
create policy cell_versions_staff_update on public.cell_versions for update
  using (public.is_staff()) with check (public.is_staff());
create policy cell_versions_admin_delete on public.cell_versions for delete
  using (public.is_admin());

-- 교사 레코드의 계정 연결(user_id / claimed_at)은 직접 못 바꾸게 잠금
create or replace function public.guard_teacher_link()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.allow_teacher_link', true), '') = '1' then
    return new;                              -- 회원가입 트리거가 연결하는 중
  end if;
  if new.user_id is distinct from old.user_id
     or new.claimed_at is distinct from old.claimed_at then
    if not public.is_admin() then
      raise exception '계정 연결 정보는 관리자만 변경할 수 있습니다.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists teachers_guard_link on public.teachers;
create trigger teachers_guard_link before update on public.teachers
  for each row execute function public.guard_teacher_link();

-- 프로필 ----------------------------------------------------
drop policy if exists profiles_self_read   on public.profiles;
drop policy if exists profiles_staff_read  on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_all   on public.profiles;
-- 본인 프로필은 승인 전에도 읽을 수 있습니다 (내가 승인 대기 중인지 알아야 하니까)
create policy profiles_self_read   on public.profiles for select using (id = auth.uid());
create policy profiles_staff_read  on public.profiles for select using (public.is_staff());
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all   on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- 앱 설정: 관리자만. 코드 해시가 새어나가지 않도록 anon 에게는 아무 권한도 주지 않습니다.
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- is_admin 은 관리자만 바꿀 수 있게
create or replace function public.guard_profile_admin()
returns trigger language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    raise exception '관리자 권한은 관리자만 변경할 수 있습니다.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_admin on public.profiles;
create trigger profiles_guard_admin before update on public.profiles
  for each row execute function public.guard_profile_admin();

-- ── 관리자 인수인계 ─────────────────────────────────────────
--   담당자가 바뀌어도 교적부가 잠기지 않도록,
--   관리자가 다른 교사진에게 권한을 넘기거나 나눠 가질 수 있습니다.

-- 가입한 교사진 목록 (교사 이름·구분까지 함께)
drop function if exists public.list_accounts();
create or replace function public.list_accounts()
returns table (
  id uuid, username text, name text, phone text, is_admin boolean, approved boolean,
  role text, teacher_id uuid, teacher_name text, created_at timestamptz,
  approved_at timestamptz, is_me boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.name,
         -- 신청자 번호는 관리자만 봅니다 (누군지 확인해야 승인할 수 있으니까)
         case when public.is_admin() then p.phone else null end,
         p.is_admin, p.approved,
         coalesce(t.role, '-'), p.teacher_id, t.name, p.created_at, p.approved_at,
         (p.id = auth.uid())
  from public.profiles p
  left join public.teachers t on t.id = p.teacher_id
  where public.is_staff()
  order by p.approved, p.is_admin desc, p.created_at;
$$;
grant execute on function public.list_accounts() to authenticated;

-- ── 가입 승인 ───────────────────────────────────────────────
--   관리자가 신청을 보고 «이 사람은 명부의 누구» 인지 골라 준 뒤 승인합니다.
--   교사 명부에 없는 분이면 p_teacher_id 를 비워 두면 됩니다
--   (계정은 열리고, 교사·간사 명단에는 나오지 않습니다).

-- 계정 ↔ 교사 명부 연결을 실제로 갈아 끼우는 내부 함수
create or replace function public.link_account_teacher(p_profile_id uuid, p_teacher_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old uuid; v_approved boolean;
begin
  select teacher_id, approved into v_old, v_approved
    from public.profiles where id = p_profile_id;
  if not found then raise exception '해당 계정을 찾을 수 없습니다.'; end if;

  if p_teacher_id is not null then
    if not exists (select 1 from public.teachers where id = p_teacher_id) then
      raise exception '교사/간사 명부에서 찾을 수 없습니다.';
    end if;
    if exists (select 1 from public.profiles
                where teacher_id = p_teacher_id and id <> p_profile_id) then
      raise exception '그 교사/간사는 이미 다른 계정과 연결돼 있습니다.';
    end if;
  end if;

  update public.profiles set teacher_id = p_teacher_id where id = p_profile_id;

  perform set_config('app.allow_teacher_link', '1', true);
  if v_old is not null and v_old is distinct from p_teacher_id then
    update public.teachers set user_id = null, claimed_at = null where id = v_old;
  end if;
  -- 승인된 계정만 명부에 «가입» 표시를 남깁니다
  if p_teacher_id is not null and v_approved then
    update public.teachers set user_id = p_profile_id, claimed_at = now()
     where id = p_teacher_id;
  end if;
  perform set_config('app.allow_teacher_link', '', true);
end $$;
revoke execute on function public.link_account_teacher(uuid, uuid) from public;

-- 승인하기 (연결할 교사를 함께 지정. 명부에 없으면 null)
create or replace function public.approve_account(p_profile_id uuid, p_teacher_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '가입 승인은 관리자만 할 수 있습니다.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception '해당 신청을 찾을 수 없습니다.';
  end if;
  update public.profiles
     set approved = true, approved_at = now(), approved_by = auth.uid()
   where id = p_profile_id;
  perform public.link_account_teacher(p_profile_id, p_teacher_id);
end $$;
grant execute on function public.approve_account(uuid, uuid) to authenticated;

-- 승인된 계정의 «명부 연결» 을 나중에 바꾸거나 풀기
create or replace function public.set_account_teacher(p_profile_id uuid, p_teacher_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '명부 연결은 관리자만 바꿀 수 있습니다.';
  end if;
  perform public.link_account_teacher(p_profile_id, p_teacher_id);
end $$;
grant execute on function public.set_account_teacher(uuid, uuid) to authenticated;

-- ── 문의처: 지금 관리자인 분들 ──────────────────────────────
--   «신청이 접수되었습니다» 화면에서 «문의는 이쪽으로» 라고 보여 줍니다.
--   ★ 아무 방문자에게나 열지 않습니다 — 실제로 계정을 만든 사람(승인 전 포함)만
--     부를 수 있게 authenticated 에만 권한을 주고, 안에서 한 번 더 확인합니다.
--     교사 명부에 연결된 관리자는 명부 번호를, 명부 밖 관리자는 신청할 때 적은 번호를 씁니다.
create or replace function public.admin_contacts()
returns table (name text, role text, phone text)
language sql stable security definer set search_path = public as $$
  select coalesce(t.name, p.name),
         coalesce(t.role, '관리자'),
         coalesce(t.phone, p.phone)
  from public.profiles p
  left join public.teachers t on t.id = p.teacher_id
  where p.is_admin and p.approved
    and exists (select 1 from public.profiles me where me.id = auth.uid())
  order by p.created_at;
$$;
grant execute on function public.admin_contacts() to authenticated;

-- 관리자가 연결할 교사를 고를 때 쓰는 목록 (아직 아무 계정과도 연결되지 않은 분들)
create or replace function public.unlinked_teachers()
returns table (id uuid, name text, role text, phone_masked text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.role,
         case when t.phone is null or length(public.phone_digits(t.phone)) < 8 then '-'
              else regexp_replace(public.phone_digits(t.phone),
                                  '^(\d{3})(\d+)(\d{4})$', '\1-****-\3') end
  from public.teachers t
  where public.is_admin()
    and t.user_id is null
    and not exists (select 1 from public.profiles p where p.teacher_id = t.id)
  order by t.seq;
$$;
grant execute on function public.unlinked_teachers() to authenticated;

-- 관리자 권한 주기 / 내리기
create or replace function public.set_admin(p_profile_id uuid, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_others int;
begin
  if not public.is_admin() then
    raise exception '관리자만 변경할 수 있습니다.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and approved) then
    raise exception '승인된 계정만 관리자로 지정할 수 있습니다.';
  end if;
  if p_is_admin is not true then
    select count(*) into v_others
      from public.profiles where is_admin and approved and id <> p_profile_id;
    if v_others = 0 then
      raise exception '마지막 관리자입니다. 다른 분을 먼저 관리자로 지정해 주세요.';
    end if;
  end if;
  update public.profiles set is_admin = coalesce(p_is_admin, false) where id = p_profile_id;
end $$;
grant execute on function public.set_admin(uuid, boolean) to authenticated;

-- 계정 해제 / 신청 거절 — 로그인 권한을 거둡니다.
--   · 교적 자료는 그대로 두고, 교사 명부의 «가입» 표시만 풀어
--     나중에 다시 가입하거나 다른 분이 그 자리를 쓸 수 있게 합니다.
--   · 로그인 계정 자체(아이디·비밀번호)도 지워서, 같은 아이디로 다시 신청할 수 있습니다.
--   · 아직 승인 안 된 신청을 거절할 때도 이 함수를 씁니다.
create or replace function public.revoke_account(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_teacher uuid; v_admin boolean; v_others int;
begin
  if not public.is_admin() then
    raise exception '관리자만 변경할 수 있습니다.';
  end if;
  select teacher_id, is_admin into v_teacher, v_admin
    from public.profiles where id = p_profile_id;
  if not found then
    raise exception '해당 계정을 찾을 수 없습니다.';
  end if;
  if v_admin then
    select count(*) into v_others
      from public.profiles where is_admin and approved and id <> p_profile_id;
    if v_others = 0 then
      raise exception '마지막 관리자입니다. 다른 분을 먼저 관리자로 지정해 주세요.';
    end if;
  end if;

  if v_teacher is not null then
    perform set_config('app.allow_teacher_link', '1', true);
    update public.teachers set user_id = null, claimed_at = null where id = v_teacher;
    perform set_config('app.allow_teacher_link', '', true);
  end if;

  -- 프로필은 auth.users 에 딸려 있어 아래 한 줄로 함께 지워집니다(on delete cascade)
  delete from public.profiles where id = p_profile_id;
  delete from auth.users     where id = p_profile_id;
end $$;
grant execute on function public.revoke_account(uuid) to authenticated;


-- ── 학년 ────────────────────────────────────────────────────
--   학년은 따로 저장하지 않고 «생년월일 + 올해가 몇 학년도인가» 로 계산합니다.
--   (3월 1일이 지나면 그 해가, 1·2월이면 전년도가 «학년도» 입니다.)
--     · 나이 12 → 예비중1, 13 → 중1 … 18 → 고3, 그보다 많으면 졸업
--     · 그래서 해가 바뀌면 아무 것도 하지 않아도 모두 한 학년씩 올라가고,
--       고3이던 아이들은 저절로 «졸업»(청년부) 이 되어 교적·셀편성에서 빠집니다.
--   students.grade 열은 «예외 고정» 용입니다 —
--   생년월일을 모르거나 유급·월반 등으로 계산과 다를 때만 값을 넣어 두세요.
--   비어 있으면 항상 자동 계산값을 씁니다.


-- ============================================================
--  접근 권한 (컬럼 단위)
-- ============================================================
grant usage on schema public to anon, authenticated;

-- 비로그인: 셀편성은 공개
grant select on public.cells, public.cell_versions, public.cell_members to anon;

-- ★ 학생 교적은 «누구 있는지»까지만 공개합니다.
--   휴대폰·집주소·보호자 연락처·특이사항·프로필 사진은 로그인해야 보입니다.
--   (전부 공개로 바꾸려면 supabase/03_public_all.sql 을 실행하세요.)
revoke select on public.students from anon;
grant  select (id, seq, name, gender, grade, school, birth, birth_year,
               is_promoted, status, created_at, updated_at)
  on public.students to anon;

-- ★ 교사 명부는 이름·구분·생일(월-일)까지만 공개합니다.
--   전화번호가 공개되면 그 번호로 "나예요!" 인증을 통과해
--   아무나 교사 계정을 만들 수 있게 되므로, 전화번호·생년·비고는
--   «전부 공개» 설정에서도 로그인해야만 보입니다.
revoke select on public.teachers from anon;
grant  select (id, seq, name, role, birth_md, user_id, claimed_at, created_at)
  on public.teachers to anon;

-- 로그인한 교사진: 전체 읽기 + 쓰기
grant select on public.students, public.cells, public.cell_versions,
                public.cell_members, public.teachers to authenticated;
grant insert, update, delete on public.students, public.cells, public.cell_versions,
                public.cell_members, public.teachers to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, update on public.app_settings to authenticated;

-- 트리거 전용 함수는 외부에서 부를 이유가 없으므로 실행 권한 회수
revoke execute on function public.touch_updated_at()      from public;
revoke execute on function public.sync_member_version()   from public;
revoke execute on function public.guard_teacher_link()    from public;
revoke execute on function public.guard_profile_admin()   from public;
revoke execute on function public.handle_new_user()       from public;
