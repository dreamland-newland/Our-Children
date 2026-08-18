// ============================================================
//  설정 파일 — 여기 두 줄만 채우면 됩니다.
//
//  Supabase 대시보드에서
//    · Project URL   → SUPABASE_URL
//      (Settings → API, 또는 프로젝트 첫 화면의 "Connect")
//    · 공개용 API 키 → SUPABASE_ANON_KEY
//      (Settings → API Keys 에 있는 «Publishable key», sb_publishable_… 로 시작)
//      예전 프로젝트라 이 항목이 없으면 «Legacy API Keys» 탭의 anon 키를 쓰세요.
//      둘 다 같은 «비로그인 권한» 이라 동작은 똑같습니다.
//  를 복사해 넣으세요.
//
//  ※ 이 키는 공개용이라 깃허브에 올려도 됩니다.
//    (실제 권한은 서버의 RLS 정책이 결정합니다.)
//    service_role / secret 키는 절대 여기에 넣지 마세요.
//
//  비워두면 "데모 모드"로 동작합니다 —
//  가짜 샘플 데이터를 그대로 둘러볼 수 있고, 변경사항은 이 브라우저에만 저장됩니다.
// ============================================================

export const SUPABASE_URL      = "https://bdmstuzsuzfvkrbtnydc.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_Vo_TjiC-87LEJDCol_T-Sg_OgC8Ktc5";

// ── 그 외 설정 ────────────────────────────────────────────
export const GROUP_NAME = "꿈땅새땅";

// 비로그인 방문자에게 보여줄 범위
//   "basic" — 이름·성별·학년·학교·생일·셀 까지만 (기본값, 권장)
//             휴대폰·집주소·보호자 연락처·특이사항은 로그인해야 보입니다.
//   "all"   — 전부 공개. 미성년자 집주소와 보호자 번호가 인터넷에 노출됩니다.
//             ※ "all" 로 바꿀 때는 supabase/03_public_all.sql 도 함께 실행하세요.
export const PUBLIC_SCOPE = "basic";

// 아이디 로그인을 위해 내부적으로 붙이는 가짜 이메일 도메인.
// (교사진은 아이디만 입력하고, 앱이 아이디@도메인 으로 변환해 로그인합니다.)
export const ID_EMAIL_DOMAIN = "kkumttang.local";

// 학년 표시 순서
export const GRADES = ["예비중1", "중1", "중2", "중3", "고1", "고2", "고3"];

// 학년은 생년월일에서 자동으로 계산합니다.
// 새 학년이 시작되는 달 — 3월이면 3월 1일부터 한 학년씩 올라갑니다.
// 교회 사정에 따라 1월부터 올리고 싶으면 1 로 바꾸세요.
export const SCHOOL_YEAR_START_MONTH = 3;

// 새 셀편성 버전을 만들 때 기본으로 채워지는 이름
export const DEFAULT_TERM_LABEL = "2026-2학기";
