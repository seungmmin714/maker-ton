# 변한신호

변기 시트의 측정 기록을 휴대폰 계정에 연결하는 메이커톤 웹 앱입니다. React + Vite 프론트는 Vercel에서 제공하고, 인증은 Supabase Auth, 기록 API는 [별도 백엔드](https://github.com/raaaaming/maker-thon-backend)가 담당합니다.

## 로컬 실행

Node.js 24.x를 사용합니다.

```sh
npm install --include=dev
npm run setup
npm run configure:backend -- https://maker-thon-backend-steel.vercel.app
npm run dev
```

`npm run setup`은 없는 경우에만 `.env.example`을 `.env`로 복사합니다. `configure:backend`는 로컬 `.env`의 `BACKEND_URL`과 `vercel.json`의 `/api` rewrite를 함께 설정합니다. URL에 `/api` 경로나 인증정보를 넣지 않습니다. 로컬 백엔드는 `http://127.0.0.1:포트`도 허용합니다.

현재 백엔드 주소는 `https://maker-thon-backend-steel.vercel.app`입니다. 주소가 바뀌면 `configure:backend`로 개발 프록시와 배포 rewrite를 함께 갱신합니다.

`.env`에는 다음 프론트 설정이 필요합니다. 공개용 publishable key만 사용하며 `sb_secret_...`, service-role key, DB 비밀번호, AI API 키는 프론트에 넣지 않습니다.

```dotenv
VITE_SUPABASE_URL=https://aaoafikysgvmvicjnoig.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_nlcxbUvqdfP1Nedl4CXa2g_lL3Vy8Pc
BACKEND_URL=https://maker-thon-backend-steel.vercel.app
```

Vite의 웹 루트는 `app/`이지만 환경변수 파일은 이 저장소 루트에서 읽습니다. 브라우저는 같은 도메인의 `/api`를 호출하며 개발 서버와 Vercel rewrite가 백엔드로 전달합니다. `BACKEND_URL`은 브라우저 공개 환경변수가 아닙니다.

## 로그인과 기록

- 이메일 가입·로그인·로그아웃은 Supabase Auth를 사용합니다. 세션 복원과 토큰 갱신은 Supabase SDK가 처리합니다.
- 가입 직후 세션이 생성되면 이름을 `PATCH /api/me`로 저장합니다. 건강 기록 동의 체크는 화면에서 검사합니다.
- 각 API 요청 직전에 최신 세션을 조회해 `Authorization: Bearer ...`를 붙입니다.
- 기록과 기기 목록은 별도 백엔드의 `/api/me`, `/api/records`, `/api/meals`, `/api/insights`에서 조회합니다.
- 이전 백엔드 계정·쿠키·기록을 Supabase 계정으로 자동 이전하지 않습니다. 새 환경에서 사용할 계정을 가입해야 합니다.

NFC 태그에는 `https://프론트주소/nfc/toilet-01`처럼 앱 URL만 기록합니다. 같은 브라우저에 저장된 로그인 계정으로 사용 종료 시각을 확인하고 ‘내 기록으로 저장’을 누릅니다. 서버가 허용한 시간 안의 측정 후보만 연결할 수 있습니다. 기기 연결에는 백엔드 관리자가 제공하는 기기 ID와 연결 코드를 사용합니다.

## 화면 구성과 비활성 기능

홈·배변 기록·식사 기록·변화 보기의 네 탭과 좌우 스와이프를 유지합니다. 카메라는 홈 왼쪽 페이지이며 식사 기록의 촬영 버튼으로도 진입합니다.

새 백엔드에 없는 예시 생성 버튼·예시 배지와 프로필 선택·추가·연결 진입점은 비활성화했습니다. `ProfilePicker` 소스는 보존하되 앱에서 실행하지 않습니다. 과금·실제 결제 기능은 없습니다.

## 검증과 배포

```sh
npm test
npm run build
```

[Vercel 배포 안내](DEPLOY_VERCEL.md)를 따릅니다. 프론트 빌드는 `npm run build`만 실행하며 DB 접속이나 옛 Node API 서버를 실행하지 않습니다. 기기 관련 코드는 `device/`, `firmware/`에 남아 있지만 새 백엔드와의 통신 설정은 하드웨어 팀이 별도로 확인해야 합니다.

`.env`, 로컬 DB, 실제 기록과 사진은 Git 및 배포 압축 파일에서 제외합니다. 실제 iPhone·Android의 NFC, 카메라 권한과 로그인 유지 여부는 배포 후 확인합니다.
