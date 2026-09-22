-- ============================================================
--  꿈땅새땅 청소년부 출석부
--  Supabase SQL Editor 에 이 파일 전체를 붙여넣고 «Run» 한 번만 누르면 됩니다.
--  (몇 번을 다시 실행해도 안전합니다 — 있는 건 건드리지 않습니다)
--
--  이 파일이 만드는 것
--   · attend_events  «모임» 한 번  (주일예배 · 수련회 · 행사)
--   · attend_marks   그 모임에 누가 왔는지 + 결석자 심방 기록
--   · attend_quotes  당겨서 새로고침할 때 뜨는 말씀·응원 문구 (관리자가 관리)
-- ============================================================

-- ── ① 모임 ──────────────────────────────────────────────────
--   날짜 하나에 여러 모임이 있을 수 있습니다.
--   (주일 오전예배 + 그날 오후 체육대회 → 두 줄)
create table if not exists public.attend_events (
  id          uuid primary key default gen_random_uuid(),
  held_on     date not null,
  kind        text not null default '주일예배',
  title       text not null default '',               -- 수련회·행사 이름 (주일예배는 비워 둡니다)
  note        text,
  created_at  timestamptz not null default now(),
  created_by_name text,
  updated_at  timestamptz not null default now(),
  updated_by_name text
);

-- 같은 날 · 같은 종류 · 같은 이름이 두 번 만들어지지 않게 (출석당번 두 분이 동시에 눌러도 안전)
--   ★ 이름 칸을 «비어 있음(null)» 이 아니라 «빈 글자('')» 로 두는 이유:
--     null 끼리는 서로 다른 값으로 쳐서 중복 방지가 걸리지 않기 때문입니다.
alter table public.attend_events alter column title set default '';
update public.attend_events set title = '' where title is null;
alter table public.attend_events alter column title set not null;
create unique index if not exists attend_events_uniq
  on public.attend_events (held_on, kind, title);
create index if not exists attend_events_date_idx on public.attend_events (held_on desc);

drop trigger if exists attend_events_touch on public.attend_events;
create trigger attend_events_touch before update on public.attend_events
  for each row execute function public.touch_updated_at();

-- ── ② 출석 표시 ─────────────────────────────────────────────
--   ★ 줄이 «없으면» 결석입니다. 기본값이 «전부 안 옴» 이라 그게 자연스럽습니다.
--     · present = true   → 왔습니다
--     · present = false  → 안 왔고, 심방 기록을 남겨 둔 아이
create table if not exists public.attend_marks (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.attend_events(id) on delete cascade,
  student_id  uuid not null references public.students(id)      on delete cascade,
  present     boolean not null default true,
  memo        text,                                   -- 결석자 심방 — 사유·통화 내용
  memo_by     text,
  memo_at     timestamptz,
  marked_by_name text,
  marked_at   timestamptz not null default now(),
  unique (event_id, student_id)
);
create index if not exists attend_marks_event_idx on public.attend_marks (event_id);

-- ── ③ 당겨서 새로고침할 때 뜨는 문구 ────────────────────────
--   말씀을 그대로 옮겨 적는 대신, 교회에서 쓰실 문구를 직접 넣어 두시는 방식입니다.
--   (성경 번역문은 저작권이 있어서 프로그램 안에 박아 두지 않았습니다.
--    개역개정·새번역 등을 적어 넣는 건 교회 내부 사용이라 괜찮습니다.)
create table if not exists public.attend_quotes (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- 처음 한 번만, 비어 있으면 응원 문구 몇 개를 넣어 둡니다 (관리자가 지우고 바꾸시면 됩니다)
insert into public.attend_quotes (text, sort_order)
select v.t, v.o from (values
  ('오늘도 한 명 한 명 이름을 불러 주셔서 고맙습니다.', 1),
  ('빠진 아이 한 명이 오늘의 기도 제목입니다.',          2),
  ('출석은 숫자가 아니라 얼굴입니다.',                  3),
  ('수고하셨어요. 오늘도 잘 하고 계십니다.',            4)
) as v(t, o)
where not exists (select 1 from public.attend_quotes);

-- ============================================================
--  RLS — 출석부는 «로그인한 교사진» 만 봅니다 (비로그인 공개 없음)
-- ============================================================
alter table public.attend_events enable row level security;
alter table public.attend_marks  enable row level security;
alter table public.attend_quotes enable row level security;

drop policy if exists attend_events_staff on public.attend_events;
create policy attend_events_staff on public.attend_events for all
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists attend_marks_staff on public.attend_marks;
create policy attend_marks_staff on public.attend_marks for all
  using (public.is_staff()) with check (public.is_staff());

-- 문구는 교사진이 읽고, 관리자만 고칩니다
drop policy if exists attend_quotes_read  on public.attend_quotes;
drop policy if exists attend_quotes_admin on public.attend_quotes;
create policy attend_quotes_read  on public.attend_quotes for select
  using (public.is_staff());
create policy attend_quotes_admin on public.attend_quotes for all
  using (public.is_admin()) with check (public.is_admin());

-- ── 접근 권한 ───────────────────────────────────────────────
grant select, insert, update, delete
  on public.attend_events, public.attend_marks, public.attend_quotes
  to authenticated;
-- 비로그인(anon)에게는 아무 권한도 주지 않습니다.

-- ============================================================
--  실시간 맞추기 — 출석당번이 두 분일 때
--  한 분이 누른 표시가 다른 분 화면에 «바로» 나타나게 합니다.
--  (안 켜져도 출석부는 잘 돌아갑니다 — 1분마다 자동으로 맞추고,
--   아래로 당기면 즉시 맞춰집니다. 이건 그걸 더 빠르게 해 주는 것입니다.)
-- ============================================================
alter table public.attend_marks  replica identity full;
alter table public.attend_events replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.attend_marks;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.attend_events;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ============================================================
--  다 됐습니다. 사이트를 새로고침하면 위 채널에 «출석부» 가 생깁니다.
-- ============================================================
