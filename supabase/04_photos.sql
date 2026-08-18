-- ============================================================
--  학생 프로필 사진 (선택 기능)
--  01_schema.sql 실행 후, 사진 기능을 쓰려면 이 파일도 실행하세요.
--
--  · 사진은 «비공개» 버킷에 저장됩니다. 주소를 알아도 그냥은 열리지 않고,
--    로그인한 교사진에게만 잠깐 유효한 서명 링크가 발급됩니다.
--  · 비로그인 방문자에게는 사진 대신 이름 첫 글자 동그라미가 보입니다.
--  · 아이들 얼굴 사진이라 «전부 공개» 설정에서도 항상 로그인해야 보입니다.
-- ============================================================

-- 버킷 만들기 (이미 있으면 비공개로 고정)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-photos', 'student-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- 읽기·쓰기 모두 로그인한 교사진만
drop policy if exists "student_photos_read"   on storage.objects;
drop policy if exists "student_photos_insert" on storage.objects;
drop policy if exists "student_photos_update" on storage.objects;
drop policy if exists "student_photos_delete" on storage.objects;

create policy "student_photos_read" on storage.objects for select
  using (bucket_id = 'student-photos' and public.is_staff());

create policy "student_photos_insert" on storage.objects for insert
  with check (bucket_id = 'student-photos' and public.is_staff());

create policy "student_photos_update" on storage.objects for update
  using (bucket_id = 'student-photos' and public.is_staff())
  with check (bucket_id = 'student-photos' and public.is_staff());

create policy "student_photos_delete" on storage.objects for delete
  using (bucket_id = 'student-photos' and public.is_staff());

-- 확인
-- select id, public, file_size_limit from storage.buckets where id = 'student-photos';
