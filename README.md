# 창업입지 AI

지도 기반 창업 입지 탐색 워크스페이스. **실제 API 조회와 가상 추천 데모를 분리**합니다.

## 실행

Node.js 24 이상이 필요합니다.

```bash
npm install
npm start
# http://localhost:3000
npm run build
npm test
npx playwright install chromium
npx playwright test
```

`npm run build`는 독립 실행 가능한 `index.html` 및 `public/preview.html`을 생성합니다. 모듈 스코프를 분리해 중복 변수 선언 오류를 방지합니다. GitHub Pages는 **정적 데모만 제공**하며 인증키 입력, 실제 API 호출을 수행하지 않습니다.

## 서버 API 설정

`.env.example`을 `.env`로 복사해 발급받은 키를 입력하세요. `.env`와 `.runtime/`은 Git에서 제외됩니다. 키를 채팅이나 공개 저장소에 올리지 마세요.

| 설정 | 용도 |
|---|---|
| `DATA_GO_KR_SERVICE_KEY` | 소상공인 상가정보 활용 승인된 서비스키 |
| `NTS_SERVICE_KEY` | 국세청 승인 서비스키 (미설정 시 공공데이터 키 사용) |
| `KOSIS_API_KEY` | KOSIS OpenAPI 키 |
| `KAKAO_REST_API_KEY` | Kakao Local REST API 키 |
| `ADMIN_API_TOKEN` | 24자 이상 관리자 인증 토큰 |
| `KOSIS_SURVIVAL_QUERY` | 기업생멸 통계표 조회 조건 JSON |
| `KOSIS_REGION_QUERY` | 인구·가구 등 지역 통계표 조회 조건 JSON |

KOSIS [통계자료 URL 생성 도구](https://kosis.kr/openapi/devGuide/devGuide_0201List.do)에서 표와 분류를 선택한 뒤 `orgId`, `tblId`, `objL1`~`objL8`, `itmId`, `prdSe`, 시점 조건을 JSON으로 설정합니다. 예시 형식(실제 코드로 교체 필요):

```json
{"orgId":"기관ID","tblId":"통계표ID","objL1":"분류코드","itmId":"항목코드","prdSe":"Y","newEstPrdCnt":"1"}
```

공공데이터포털 홈페이지 자체는 데이터 API가 아닙니다. 기존 코드의 검증되지 않은 행정안전부 엔드포인트 대신 지역통계는 KOSIS의 사용자가 지정한 표로 조회합니다. 통계표별 지역·업종 세분성은 실제 응답 확인 후 확정해야 합니다.

## API

- `GET /api/health`, `/api/meta`, `/api/external/catalog`: 서버, 선택 목록, 연결 상태
- `POST /api/external/semas`: `cx`, `cy`, `radius`(최대 2000m), `pageNo`, `numOfRows`; 또는 `divId`, `key` 지역코드 조회
- `POST /api/external/kakao`: `action` = `keyword` / `address` / `region`, `query` 또는 `x`, `y`
- `POST /api/external/kosis`, `/api/external/region`: 통계표 조건 JSON (서버 기본 조건과 병합)
- `POST /api/external/kosis/list`: 통계목록 조회
- `POST /api/nts/verify`: 단일 `bizNo` 또는 최대 100개 `numbers`; `action=validate`와 `businesses`로 진위 확인
- `POST /api/external/keys`: 허용된 키만 서버 메모리에 반영 (서버 재시작 시 초기화)
- `GET /api/admin/logs`: 실제 요청 이력, 건수, 성공/실패 코드
- `POST /api/recommend`: `mode=DEMO`일 때만 가상 결과 반환. 실제 추천은 비교 가능한 통계·점포 DB 적재 전까지 미제공

키 변경·국세청 조회·로그 열람은 `Authorization: Bearer ADMIN_API_TOKEN`으로 보호합니다. 원문 키·업체번호·제공기관 오류 메시지는 로그에 남기지 않습니다. 관리자 토큰은 브라우저 저장소에 저장하지 않습니다.

## 데이터 정확성 및 범위

- 기존 28개 업종·17개 시도·일부 시군구/읍면동 목록은 선택 도우미입니다. 공식 최신 행정구역 전체 또는 검증된 업종 코드 매핑으로 간주하지 않습니다.
- 추천 데모는 기존 가상 엔진을 명시적으로 격리한 기능입니다. 점수·인구·경쟁점포·생존율·임대료·좌표는 실제 분석 결과가 아닙니다.
- 실점포 검색은 현재 전체 업종을 조회하며 제공기관의 원본 업종명을 표시합니다. 넓은 UI 업종을 임의로 공식 소분류 코드와 동일시하지 않습니다.
- API 미설정·실패 시 가상의 점포·생존율·사업자 상태를 반환하지 않습니다.
- 실제 성공 응답만 5분 캐시합니다. 장애 시 24시간 이내의 실제 이전 응답이 있으면 `STALE`과 수집 시각을 제공합니다. 국세청 개인정보와 카카오 장소 응답은 캐시하지 않습니다.
- `db/schema.sql`은 설계 자료입니다. PostgreSQL 연결·전국 적재·자동 수집 스케줄러는 아직 운영되지 않습니다. 호출 로그의 `records_upserted`는 0으로 표시합니다.

## 배포

### 새 워크스페이스와 회원·관리자 기능

- `#auth`: 가입·로그인, `#account`: 조건 저장·불러오기·삭제, `#admin`: 관리자 콘솔, `#guide`: 이용 가이드.
- 회원 계정은 SQLite(`.runtime/accounts.sqlite`, `ACCOUNTS_DB`로 경로 지정)에 저장합니다. Node.js 24 이상과 쓰기 가능한 영속 디스크가 필요합니다. 여러 서버 인스턴스가 파일 하나를 공유하는 구성은 지원하지 않습니다.
- 비밀번호는 무작위 salt와 scrypt로 해시 처리합니다. 7일 로그인 세션은 HttpOnly·SameSite 쿠키로 전달되며 로그아웃 시 서버에서 폐기합니다. `NODE_ENV=production`에서 Secure 쿠키를 사용하므로 HTTPS가 필요합니다.
- 로그인·가입은 IP당 15분에 15회로 제한합니다. 일반 회원은 관리자 권한을 얻지 않습니다. 이메일 소유 인증·비밀번호 재설정 메일·회원 자가 삭제는 아직 제공하지 않습니다.
- 운영 전 개인정보 처리방침, 보관·삭제 정책, 문의 창구를 운영자가 확정해야 합니다. 가입 화면에는 현재 저장 항목과 이용 목적을 표시합니다.
- 관리자 화면에 `ADMIN_API_TOKEN`으로 로그인하면 회원 현황, API 키·KOSIS 기본 표 설정, 사업자 상태 확인, 호출 이력을 사용할 수 있습니다. 토큰과 키는 브라우저 저장소에 보관하지 않습니다. 화면의 설정 변경은 서버 메모리에만 적용되므로 영구 설정은 환경변수를 사용하세요.
- ‘전체 API 연결 검사’는 실제 제공기관 요청을 수행합니다. 국세청은 입력된 사업자번호가 있을 때만 검사합니다. 인증키가 없는 기관은 연결 성공으로 표시하지 않습니다.
- 실데이터 탐색의 선택적 공식 소분류 코드 필드로 제공기관 업종 필터를 적용할 수 있습니다. 상단 창업 업종 목록과 공식 분류는 자동 매핑하지 않습니다.

회원 API: `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me`. 저장 조건: `GET/POST /api/account/searches`, `POST /api/account/searches/delete`. 관리자: `GET /api/admin/overview`, `POST /api/admin/check` (Bearer 인증).

### Firebase 정적 데모

`firebase.json`은 `dist/firebase`의 **정적 데모만** 배포합니다. 회원 API·실제 데이터 서버는 이 설정으로 배포되지 않습니다.

```bash
npx firebase-tools login
npx firebase-tools use --add
npm run deploy:firebase
```

현재 공유 사이트와 동일하게 정적 배포에서는 회원 정보 입력·관리자 토큰 입력을 비활성화하고 서버가 필요한 이유를 표시합니다. 서버 전체를 HTTPS Node.js 호스팅에 배포해야 가입과 실데이터 조회가 가능합니다.

공유 정적 페이지는 `npm run build` 후 생성물을 배포합니다. 실서비스는 동일 출처 Node.js 호스팅에 전체 프로젝트를 배포하고 환경변수를 설정해야 합니다. 컨테이너/호스팅에서는 `HOST=0.0.0.0`, 호스팅이 제공하는 `PORT`를 사용하고 HTTPS 프록시 뒤에 배치하세요.

검증은 모의 제공기관 응답 기반 단위·HTTP 테스트와 Playwright 브라우저 테스트를 구분합니다. 발급된 키가 없는 환경에서는 기관 실서버 연결 성공을 주장하지 않습니다.
