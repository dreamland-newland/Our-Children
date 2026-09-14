-- ============================================================
--  09. 비밀번호 찾기 (아이디·비밀번호를 잊었을 때)
--  ------------------------------------------------------------
--  이 교적부는 «아이디@도메인» 이라는 가짜 메일 주소로 계정을 만듭니다.
--  진짜 메일함이 없으니 «비밀번호 재설정 메일» 을 보낼 수가 없습니다.
--  그래서 가입할 때와 똑같이 «이름 + 휴대폰번호» 로 본인을 확인하고,
--  그 자리에서 아이디를 알려 주고 새 비밀번호를 걸어 주는 방식으로 만들었습니다.
--
--  ★ Supabase 대시보드 › SQL Editor 에 이 파일을 통째로 붙여 넣고 «Run» 하세요.
--    (01_schema.sql 을 이미 실행한 뒤여야 합니다.)
--
--  안전장치
--   · 이름과 휴대폰번호가 «둘 다» 맞아야 합니다 (휴대폰번호는 로그인해야 보이는 정보입니다).
--   · 같은 이름으로 30분에 8번 넘게 틀리면 잠시 막습니다 (번호 찍어 맞히기 방지).
--   · 승인 전인 계정, 휴대폰번호가 명부에 없는 계정은 이 길로 바꿀 수 없습니다.
--   · 바꾼 기록은 password_reset_log 에 남습니다 (관리자만 볼 수 있습니다).
-- ============================================================

-- 비밀번호를 새로 거는 데 쓰는 암호 함수 (Supabase 는 extensions 스키마에 들어 있습니다)
create extension if not exists pgcrypto with schema extensions;


-- ── 시도 기록 ────────────────────────────────────────────────
create table if not exists public.password_reset_log (
  id         bigserial primary key,
  name_key   text not null,               -- 공백을 뺀 이름 (찍어 맞히기 막는 열쇠)
  username   text,                        -- 성공했을 때만 남습니다
  ok         boolean not null default false,
  at         timestamptz not null default now()
);
create index if not exists password_reset_log_at_idx on public.password_reset_log (name_key, at desc);

alter table public.password_reset_log enable row level security;
drop policy if exists password_reset_log_admin_read on public.password_reset_log;
create policy password_reset_log_admin_read on public.password_reset_log
  for select to authenticated using (public.is_admin());


-- ── 도우미 — 최근 30분 실패 횟수 ─────────────────────────────
create or replace function public.reset_too_many(p_name_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) >= 8
    from public.password_reset_log
   where name_key = p_name_key and not ok and at > now() - interval '30 minutes';
$$;


-- ── 1단계 — 이름+휴대폰으로 «내 계정» 찾기 ───────────────────
--   찾은 계정의 아이디를 알려 줍니다. 아이디까지 잊은 분을 위한 것입니다.
--   한 사람이 계정을 여러 개 만들어 두었다면 여러 줄이 나옵니다.
drop function if exists public.find_my_accounts(text, text);
create or replace function public.find_my_accounts(p_name text, p_phone text)
returns table (username text, name text, role text, approved boolean, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_key text := replace(btrim(coalesce(p_name, '')), ' ', '');
        v_n    int;
begin
  if v_key = '' or length(public.phone_digits(p_phone)) < 10 then
    raise exception '이름과 휴대폰번호를 정확히 적어 주세요.';
  end if;
  if public.reset_too_many(v_key) then
    raise exception '잠시 후 다시 시도해 주세요. (너무 여러 번 시도했습니다)';
  end if;

  select count(*) into v_n
    from public.profiles p
    left join public.teachers t on t.id = p.teacher_id
   where replace(p.name, ' ', '') = v_key
     and (public.phone_key(p.phone) = public.phone_key(p_phone)
          or public.phone_key(t.phone) = public.phone_key(p_phone));

  -- 못 찾았으면 «틀린 시도» 로 기록해 둡니다 (번호를 찍어 맞히지 못하게)
  if v_n = 0 then
    insert into public.password_reset_log (name_key, ok) values (v_key, false);
    return;
  end if;

  return query
    select p.username, p.name, coalesce(t.role, '명부 밖'), p.approved, p.created_at
      from public.profiles p
      left join public.teachers t on t.id = p.teacher_id
     where replace(p.name, ' ', '') = v_key
       and (public.phone_key(p.phone) = public.phone_key(p_phone)
            or public.phone_key(t.phone) = public.phone_key(p_phone))
     order by p.created_at;
end $$;
grant execute on function public.find_my_accounts(text, text) to anon, authenticated;


-- ── 2단계 — 새 비밀번호 걸기 ─────────────────────────────────
drop function if exists public.reset_my_password(text, text, text, text);
create or replace function public.reset_my_password(
  p_name text, p_phone text, p_username text, p_new_password text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text := replace(btrim(coalesce(p_name, '')), ' ', '');
  v_id  uuid;
  v_ok  boolean;
begin
  if length(coalesce(p_new_password, '')) < 6 then
    raise exception '비밀번호는 6자 이상이어야 합니다.';
  end if;
  if public.reset_too_many(v_key) then
    raise exception '잠시 후 다시 시도해 주세요. (너무 여러 번 시도했습니다)';
  end if;

  select p.id, p.approved into v_id, v_ok
    from public.profiles p
    left join public.teachers t on t.id = p.teacher_id
   where lower(p.username) = lower(btrim(coalesce(p_username, '')))
     and replace(p.name, ' ', '') = v_key
     and (public.phone_key(p.phone) = public.phone_key(p_phone)
          or public.phone_key(t.phone) = public.phone_key(p_phone));

  if v_id is null then
    insert into public.password_reset_log (name_key, ok) values (v_key, false);
    raise exception '이름·휴대폰번호·아이디가 맞지 않습니다. 관리자에게 문의해 주세요.';
  end if;
  if not v_ok then
    raise exception '아직 승인 전인 계정입니다. 관리자(간사)에게 문의해 주세요.';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at         = now()
   where id = v_id;

  -- 예전에 로그인해 둔 기기들은 모두 로그아웃시킵니다 (남이 열어 뒀을 수도 있으니)
  begin
    delete from auth.sessions where user_id = v_id;
  exception when others then null;          -- 버전에 따라 없을 수 있습니다
  end;

  insert into public.password_reset_log (name_key, username, ok)
  values (v_key, lower(btrim(p_username)), true);
end $$;
grant execute on function public.reset_my_password(text, text, text, text) to anon, authenticated;


-- ── 덤 — 한 휴대폰번호로 계정이 여러 개 생기지 않게 ──────────
--   가입할 때 «같은 번호로 이미 신청/가입된 계정» 이 있으면 막고,
--   «비밀번호 찾기» 를 쓰시라고 알려 줍니다.
create or replace function public.guard_duplicate_phone()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_other text;
begin
  select p.username into v_other
    from public.profiles p
   where p.id <> new.id
     and public.phone_key(p.phone) = public.phone_key(new.phone)
   limit 1;
  if v_other is not null then
    raise exception '이 휴대폰번호로 이미 만든 계정이 있습니다 (아이디 %). 로그인 화면의 «아이디·비밀번호를 잊으셨나요?» 를 눌러 주세요.', v_other;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_phone on public.profiles;
create trigger profiles_guard_phone before insert on public.profiles
  for each row execute function public.guard_duplicate_phone();
