-- ============================================================
--  출석부 — «처음 온 아이» (친구 따라온 아이 · 교회 체험 온 아이)
--  Supabase SQL Editor 에 붙여넣고 «Run» 한 번.
--  (몇 번을 다시 실행해도 안전합니다)
--
--  ★ 먼저 supabase/10_attendance.sql 을 실행해 두셔야 합니다.
--
--  이 아이들은 «교적부(students)» 에는 넣지 않습니다.
--  출석부에만 따로 적어 두고, 4주 넘게 나오면
--  개요 화면에서 «교적부에 등록할까요?» 하고 물어봅니다.
-- ============================================================

create table if not exists public.attend_guests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  gender      text check (gender in ('남', '여') or gender is null),
  grade       text,                                  -- 중1 · 고2 … (모르면 비워 둡니다)
  school      text,
  phone       text,
  guardian    text,                                  -- 보호자 연락처
  invited_by  text,                                  -- 누구 친구로 왔는지
  note        text,
  first_on    date not null default current_date,    -- 처음 온 날
  created_at  timestamptz not null default now(),
  created_by_name text,
  updated_at  timestamptz not null default now(),
  updated_by_name text,
  -- 교적부로 옮겼으면 그 아이의 id
  enrolled_student_id uuid references public.students(id) on delete set null,
  -- «지금은 등록하지 않기» 를 고른 경우 (다시 묻지 않습니다)
  dismissed   boolean not null default false
);
create index if not exists attend_guests_name_idx on public.attend_guests (name);

drop trigger if exists attend_guests_touch on public.attend_guests;
create trigger attend_guests_touch before update on public.attend_guests
  for each row execute function public.touch_updated_at();

-- ── 출석 표시에 «손님» 칸을 하나 붙입니다 ───────────────────
--    한 줄은 «교적부 아이» 이거나 «처음 온 아이» 둘 중 하나입니다.
alter table public.attend_marks alter column student_id drop not null;
alter table public.attend_marks
  add column if not exists guest_id uuid references public.attend_guests(id) on delete cascade;

alter table public.attend_marks drop constraint if exists attend_marks_who;
alter table public.attend_marks
  add constraint attend_marks_who check (num_nonnulls(student_id, guest_id) = 1);

-- 같은 모임에 같은 손님이 두 줄 생기지 않게
create unique index if not exists attend_marks_guest_uniq
  on public.attend_marks (event_id, guest_id) where guest_id is not null;

-- ============================================================
--  «누가 출석을 찍었나» 는 남기지 않습니다
--  ------------------------------------------------------------
--  누가 눌렀는지가 중요한 기록이 아니라서, 사람 이름은 적지 않습니다.
--  (예전에 잠깐 넣어 두었던 장치가 있으면 여기서 함께 지웁니다.)
-- ============================================================
drop trigger if exists attend_marks_touch_event on public.attend_marks;
drop function if exists public.attend_touch_event();

update public.attend_events
   set created_by_name = null, updated_by_name = null
 where created_by_name is not null or updated_by_name is not null;

--  출석을 누른 사람 이름만 지웁니다.
--  «심방을 적은 사람»(memo_by)은 뒤에 누가 전화했는지 알아야 해서 그대로 둡니다.
update public.attend_marks
   set marked_by_name = null
 where marked_by_name is not null;

-- ============================================================
--  모임마다 «어느 셀편성으로 묶어 볼지» 를 기억합니다
--  ------------------------------------------------------------
--  출석 기록 자체는 아이 한 명 한 명에 붙어 있어서, 셀을 새로 짜도
--  사라지거나 섞이지 않습니다. 다만 «화면에서 어떻게 묶어 보여 줄지» 는
--  그때그때 셀편성을 따라가므로, 지난 주 출석부를 열면 지금 셀로 묶여 보였습니다.
--  이제 모임을 만들 때 그날 쓰던 편성을 적어 두고 그대로 보여 줍니다.
--  (알파 행사처럼 임시 편성을 만들었다면, 그 모임만 임시 편성으로 볼 수 있습니다)
-- ============================================================
alter table public.attend_events
  add column if not exists version_id uuid references public.cell_versions(id) on delete set null;

-- ── RLS — 출석부와 똑같이, 로그인한 교사진만 ────────────────
alter table public.attend_guests enable row level security;
drop policy if exists attend_guests_staff on public.attend_guests;
create policy attend_guests_staff on public.attend_guests for all
  using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.attend_guests to authenticated;

-- ── 실시간 맞추기 ───────────────────────────────────────────
alter table public.attend_guests replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.attend_guests;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ============================================================
--  다 됐습니다. 출석부 맨 아래에 «＋ 처음 온 아이» 가 생깁니다.
-- ============================================================
