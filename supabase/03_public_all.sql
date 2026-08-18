-- ============================================================
--  [선택] 전부 공개 모드로 바꾸기
--
--  기본값은 «가림»입니다 — 비로그인 방문자에게는
--    · 학생: 이름 · 성별 · 학년 · 학교 · 생년월일 · 셀 · 상태 만 보이고
--    · 교사: 이름 · 구분 · 생일(월-일) 만 보입니다.
--
--  이 파일을 실행하면 학생의 휴대폰 · 집주소 · 보호자 연락처 · 특이사항까지
--  로그인 없이 누구나 볼 수 있게 됩니다.
--
--  ※ 미성년자의 집주소와 보호자 연락처가 인터넷에 그대로 공개됩니다.
--    정말 필요한 경우에만 사용하세요.
--
--  ※ 함께 하세요 ─ assets/js/config.js 에서
--       export const PUBLIC_SCOPE = "all";
--
--  ※ 학생 프로필 사진과 교사 전화번호는 이 파일로도 공개되지 않습니다.
--    번호가 공개되면 그 번호로 «나예요!» 를 통과해 남의 자리를 차지한 채
--    승인을 기다릴 수 있으므로, 사칭 방지를 위해 항상 로그인 후에만 보입니다.
-- ============================================================

begin;
revoke select on public.students from anon;
-- photo_path 는 제외합니다 — 아이들 얼굴 사진은 이 설정에서도 로그인해야 보입니다.
grant  select (id, seq, name, gender, grade, school, birth, birth_year, phone,
               mother_name, mother_phone, father_name, father_phone,
               siblings, address, note, is_promoted, status, created_at, updated_at)
  on public.students to anon;
commit;


-- ============================================================
--  다시 가리기 (기본값으로 되돌리기)
-- ============================================================
-- begin;
-- revoke select on public.students from anon;
-- grant  select (id, seq, name, gender, grade, school, birth, birth_year,
--                is_promoted, status, created_at, updated_at)
--   on public.students to anon;
-- commit;
-- 그리고 config.js 의 PUBLIC_SCOPE 를 "basic" 으로 되돌리세요.
