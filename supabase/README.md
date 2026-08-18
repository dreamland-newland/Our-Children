# supabase

| 파일 | 실행 순서 | 내용 |
|---|---|---|
| `01_schema.sql` | 1 | 표 · 권한(RLS) · 회원가입 로직 |
| `02_seed.REAL.sql` | 2 | **실제 데이터** — 별도로 받은 파일. 저장소에 올리지 마세요 (`.gitignore` 처리됨) |
| `02_seed.sample.sql` | (선택) | 가명 예시 데이터. 연습용 |
| `04_photos.sql` | (선택) | 학생 프로필 사진용 비공개 저장소 |
| `03_public_all.sql` | (선택·비권장) | 연락처·주소까지 전부 공개로 전환 |

`02_seed.REAL.sql` 은 Supabase 대시보드 **SQL Editor** 에 붙여넣어 실행만 하세요.
실행하고 나면 데이터는 Supabase 안에만 있고, 깃허브 저장소에는 남지 않습니다.
