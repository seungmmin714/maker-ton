# Vercel 프론트 배포

배포 루트는 `maker-ton` 폴더입니다. Vercel은 Vite의 `app/`을 `dist/`로 빌드하고 `/api` 요청을 [별도 백엔드](https://github.com/raaaaming/maker-thon-backend)로 전달합니다. 이 프로젝트에서 Node API 함수나 원격 DB 검증을 실행하지 않습니다.

## 배포 전 필수 설정

1. 실제 백엔드 배포 주소를 받은 뒤 실행합니다.

   ```sh
   npm run configure:backend -- https://maker-thon-backend-steel.vercel.app
   ```

   이 명령은 `vercel.json`의 external rewrite와 로컬 `.env`의 개발 프록시 주소를 함께 갱신합니다. `backend-url-required.invalid`가 남아 있으면 API가 연결되지 않습니다. 변경된 `vercel.json`은 저장소에 포함하고 `.env`는 포함하지 않습니다.

2. Supabase Dashboard의 Authentication 설정에서 시연용으로 **Confirm email**을 끄고, URL Configuration의 **Site URL**에 실제 프론트 주소(현재 운영 주소는 `https://maker-ton.vercel.app`)를 등록합니다. 이메일 확인을 유지하면 가입 후 메일 확인을 완료해야 세션이 생성됩니다.

3. Vercel 프론트 프로젝트의 필요한 배포 환경(Production/Preview)에 아래 두 환경변수를 등록하고 재배포합니다.

   | 변수 | 값 |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://aaoafikysgvmvicjnoig.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.example`의 `sb_publishable_...` 공개 키 |

   `VITE_` 변수는 빌드 결과에 포함됩니다. Supabase secret/service-role key나 DB·AI·기기 토큰을 이 접두사로 등록하지 않습니다. API에 필요한 서버 전용 비밀값은 별도 백엔드에서 관리합니다. 기존 Vercel DB와 데이터는 이 코드 변경으로 삭제되지 않습니다.

## Vercel 구성

- Framework: Vite
- Install Command: `npm install --include=dev`
- Build Command: `npm run build`
- Output Directory: `dist`
- Node.js: 24.x
- `/api/:path*` → `https://maker-thon-backend-steel.vercel.app/api/:path*`
- `/checkin`, `/nfc/:device` → `/index.html`

CSP의 `connect-src`에 위 Supabase 프로젝트 주소가 포함되어 있습니다. API 호출은 같은 프론트 도메인의 `/api`를 사용하므로 브라우저에서 백엔드 CORS를 설정할 필요가 없습니다.

소스 압축이 필요하면 `python3 scripts/package-vercel.py`를 실행합니다. ZIP에는 앱과 프론트 빌드 설정만 들어갑니다. `.env`, 옛 API/서버, DB·기기 파일은 제외합니다. 압축 파일 생성은 실제 배포가 아닙니다.

## 배포 후 확인

- 가입·로그인 후 이름 표시, 새로고침 시 로그인 유지, 로그아웃 후 로그인 화면 복귀.
- 기기 연결과 NFC URL에서 최근 사용 후보 확인·기록 저장.
- 배변·식사 기록의 조회·수정·삭제, 식사 사진 분석과 변화 보기.
- 다른 계정으로 로그인했을 때 이전 계정의 기록과 사진 초안이 남지 않음.
- 잘못된 Bearer 토큰으로 `/api/me` 호출 시 `401` / `AUTH_REQUIRED`; 앱에서는 로그인 화면으로 복귀.

옛 백엔드의 계정·세션·기록은 새 Supabase 환경으로 자동 이전하지 않습니다. 새로운 시연 계정과 데이터는 별도 백엔드 환경에서 준비해야 합니다. 실제 백엔드 URL과 계정이 연결되기 전까지 운영 연결 확인이 완료된 것은 아닙니다.
