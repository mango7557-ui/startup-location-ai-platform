# 창업입지 AI

공공데이터 기반 상권 탐색, 카드매출 통계, 회원별 검색 조건 저장을 제공하는 Node.js 서비스입니다. 제공기관에서 받은 실제 응답만 표시하며, 조회 실패를 가상의 매출·점포·추천 점수로 대체하지 않습니다.

## 실행

Node.js 24를 사용합니다. 실제 서버 실행에 추가 npm 패키지는 필요하지 않습니다.

```powershell
Copy-Item .env.example .env
# .env에 발급받은 키를 설정한 후
npm start
```

`.env.example`의 기본 주소는 `http://localhost:3013`입니다. `.env`와 `.runtime/`은 Git에서 제외됩니다. 소스 폴더 전체를 공개 웹 루트로 지정하지 마세요. HTTP 서버는 `public/`만 제공합니다.

## 화면

| 주소 | 기능 |
| --- | --- |
| `/` | 지도와 주소 검색, 업종별 실제 점포 조회 |
| `/#sales` | KOSIS 카드승인·소상공인 매출·결제수단 통계, 서울 상권 추정매출, 관리자 업로드 매출 |
| `/#sources` | 기관별 키 설정과 실제 응답 성공 여부 구분 |
| `/#auth`, `/#account` | 가입·로그인, 검색 조건 저장·불러오기·삭제 |
| `/#admin` | 관리자 인증, 연결 검사, 설정, 회원 현황, 매출 CSV, 호출 이력 |

카카오 지도 SDK를 사용할 수 없어도 주소 검색과 다른 화면은 계속 사용할 수 있습니다. 넓은 업종에 대한 공식 소분류 자동 선택은 선택 도우미이며, 필요한 경우 사용자가 세부 업종 코드를 조정합니다. 선택용 지역 목록은 공식 최신 행정구역 전체를 보장하지 않습니다.

## 데이터 연결

| 환경변수 | 용도 |
| --- | --- |
| `DATA_GO_KR_SERVICE_KEY` | [상가·상권정보(15012005)](https://www.data.go.kr/data/15012005/openapi.do) 활용 승인된 키 |
| `NTS_SERVICE_KEY` | 국세청 사업자 상태·진위 확인용 키 |
| `KOSIS_API_KEY` | KOSIS 통계 조회 |
| `KAKAO_REST_API_KEY` | 카카오 장소·주소 조회 및 로그인 앱 ID |
| `KAKAO_JAVASCRIPT_KEY` | 브라우저용 지도 SDK 키 |
| `KAKAO_CLIENT_SECRET` | 카카오 로그인에 설정된 클라이언트 시크릿 |
| `SEOUL_DATA_API_KEY` | 선택: 서울 열린데이터광장 상권 추정매출 |
| `ADMIN_API_TOKEN` | 24자 이상 관리자 토큰 |
| `KOSIS_SURVIVAL_QUERY`, `KOSIS_REGION_QUERY` | 기업생멸·지역 통계표 기본 조건 JSON |

키 발급과 해당 API의 활용 승인은 별개입니다. 승인되지 않은 API는 오류 원인을 표시합니다. 카카오 지도 웹 도메인과 로그인 Redirect URI는 카카오 개발자 콘솔에서 실제 접속 주소에 맞게 등록해야 합니다. 로그인 콜백은 `/api/auth/kakao/callback`입니다.

카카오 로그인은 이메일 주소가 같다는 이유로 기존 비밀번호 계정에 자동 연결하지 않습니다. 검증되지 않은 이메일도 신뢰하지 않습니다.

KOSIS 사용자 지정 조건은 [공식 URL 생성 도구](https://kosis.kr/openapi/devGuide/devGuide_0201List.do)에서 확인합니다. 통계표마다 항목·지역·업종·단위와 시점이 다르므로 서로 다른 분류를 동일 지표로 간주하지 않습니다. 비교 근거가 적재되지 않은 추천 점수는 생성하지 않습니다.

## 영속 데이터와 운영

회원·세션·저장 조건은 `.runtime/accounts.sqlite`, 관리자 매출은 `.runtime/card_sales.sqlite`에 보관합니다. 각각 `ACCOUNTS_DB`, `CARD_SALES_DB`로 경로를 지정할 수 있습니다. 동일 SQLite 파일을 여러 서버 인스턴스가 공유하는 구성은 지원하지 않습니다. 실행 중 백업은 SQLite backup API를 사용해야 WAL에 기록된 변경을 포함할 수 있습니다.

HTTPS 서비스는 `NODE_ENV=production`을 사용합니다. 로컬 Cloudflare Tunnel 등 프록시 뒤에 있을 때만 `TRUST_PROXY=loopback`을 설정합니다. 고정 도메인이 있으면 `PUBLIC_BASE_URL=https://주소`를 지정합니다. 카카오 Redirect URI와 회원 쿠키에도 실제 공개 주소가 적용됩니다.

Windows 설치·업데이트와 복구 절차는 [deploy/windows/README.txt](deploy/windows/README.txt)를 참고하세요. 배포 패키지는 `dist/windows/`에 생성합니다. `--include-config`, `--include-data` 옵션을 사용한 패키지에는 비공개 설정과 데이터가 포함되므로 공개 저장소나 웹 루트에 올리지 마세요. 기존 서버 업데이트는 현재 회원 DB와 `.env`를 보존해야 합니다.

Cloudflare Quick Tunnel은 도메인 연결 전의 임시 공유용입니다. 재시작하면 주소가 바뀌고 가용성이 보장되지 않습니다. 고정 운영 주소에는 사용자 도메인과 정식 터널 또는 HTTPS 프록시가 필요합니다. [공식 제한](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

회원 비밀번호는 scrypt로 해시하며 세션은 HttpOnly·SameSite 쿠키로 관리합니다. 관리자 토큰과 서버 인증키는 브라우저 저장소에 보관하지 않습니다. 이메일 소유 인증, 비밀번호 재설정 메일, 회원 자가 삭제는 현재 지원하지 않습니다. 정식 회원 모집 전 운영자가 개인정보 처리방침·보관 기간·문의 창구를 확정해야 합니다.

관리자 화면에서 변경한 API 키와 통계표 조건은 프로세스 메모리에 적용됩니다. 재시작 뒤 유지하려면 서버 `.env`를 갱신해야 합니다.

## API와 검증

읽기 API: `GET /api/health`, `/api/meta`, `/api/external/catalog`, `/api/card-sales/datasets`, `/api/auth/me`.

데이터 조회는 JSON POST 요청을 사용합니다: `/api/external/semas`, `/api/external/kakao`, `/api/external/kosis`, `/api/external/region`, `/api/card-sales/kosis`, `/api/card-sales/seoul`. 브라우저 주소 표시줄에서 직접 GET으로 호출하면 조회되지 않습니다.

`/api/admin/*`, `/api/external/keys`, `/api/nts/verify`는 관리자 Bearer 토큰이 필요합니다. `/api/account/searches`는 로그인한 사용자 자신의 데이터만 제공합니다.

```powershell
npm ci
npm test
npx playwright install chromium
npm run test:ui
npm run build
```

자동 테스트의 모의 제공기관 응답과 실제 API 연결 검증은 구분합니다. 기관 실서버 연결은 해당 키·권한·네트워크가 있는 환경에서 별도로 확인합니다.

`npm run build`는 소스 검토·화면 미리보기용 정적 HTML을 생성합니다. GitHub Pages/Firebase 정적 배포에는 회원 DB와 API 서버가 없으므로 가입·관리자·실제 조회가 비활성화됩니다. 실서비스는 전체 Node.js 서버를 배포합니다.
