# 변한신호 프론트 API 계약

React + Vite 프론트는 Supabase Auth로 로그인하고 [별도 백엔드](https://github.com/raaaaming/maker-thon-backend)의 API를 사용합니다. 이 문서는 프론트 전환 요청에서 제공한 계약을 정리합니다. 실제 백엔드 배포 주소는 아직 제공되지 않았습니다.

모든 아래 `/api` 요청은 `Authorization: Bearer <Supabase session.access_token>`이 필요합니다. 프론트는 요청 직전에 `supabase.auth.getSession()`으로 토큰을 조회합니다. 쿠키 세션, CSRF 토큰, `x-profile-id`, 사용자 지정 프로필 BroadcastChannel은 사용하지 않습니다. 실패 응답은 `{ "error": "한국어 메시지", "code": "..." }`이며 `401` / `AUTH_REQUIRED`는 로그인 화면으로 돌아갑니다.

날짜 필드는 기존과 같이 ISO 문자열을 사용하고 화면에서 한국 시각으로 표시합니다. API 결과는 공용 캐시에 저장하지 않습니다.

## 인증과 계정

가입·로그인·로그아웃은 각각 `supabase.auth.signUp`, `signInWithPassword`, `signOut`을 사용합니다. 로그인 복원은 `getSession()`과 `onAuthStateChange`로 처리하고 토큰 갱신은 SDK가 담당합니다. `/api/auth/*` 엔드포인트는 사용하지 않습니다.

| 메서드 / 경로 | 요청 | 응답 |
|---|---|---|
| `GET /api/me` | — | `{user:{id,email,name}, devices:[{id,name}], config:{aiEnabled,claimWindowSec}}` |
| `PATCH /api/me` | `{name}` | 사용자 정보 갱신 |
| `DELETE /api/account` | — | 계정 삭제 |

가입 시 세션이 생긴 뒤 이름을 `PATCH /api/me`로 저장합니다. 건강 기록 동의는 가입 화면에서만 검사하며 서버로 전송하지 않습니다. 이메일 확인 설정 때문에 세션이 생성되지 않았다면 메일 확인·로그인 후 진행합니다.

## 기기 연결과 사용 기록

| 메서드 / 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/devices/join` | `{device_id,code}` | `{devices}` |
| `GET /api/devices/:id/context` | — | 아래 문맥 객체 |
| `POST /api/sessions/:id/claim` | `{shape,shape_status,excretion_type}` | `{record}` |
| `GET /api/records` | — | `{records}` |
| `PATCH /api/records/:id` | `{shape,shape_status,excretion_type}` | 기록 갱신 |
| `DELETE /api/records/:id` | — | 기록 삭제 |

문맥 객체:

```text
{
  device,
  state: 'offline' | 'idle' | 'measuring',
  active_started_at,
  candidates: [{id, started_at, ended_at, sitting_sec}],
  expired_count,
  server_now
}
```

기록 귀속 요청의 `request_id`는 제거했습니다. `/api/devices/:id/checkins` 요청도 보내지 않습니다. NFC URL은 해당 기기의 문맥 조회 화면으로 이어지고, 사용 종료 시각을 확인한 사용자가 저장을 결정합니다. 허용 시간과 귀속 여부 검사는 백엔드가 담당합니다.

기존 필드 규칙을 유지합니다. `shape`는 1~7 또는 해당 없음/null, `shape_status`는 `selected` / `unknown` / `not_applicable`, `excretion_type`은 `stool` / `urine` / `both` / `unknown`입니다. 응답에 없는 `is_demo` 필드를 화면에서 참조하지 않습니다.

## 식사와 변화 보기

| 메서드 / 경로 | 요청 | 응답 |
|---|---|---|
| `GET /api/meals` | — | `{meals}` |
| `POST /api/meals` | `{foods,eaten_at,keep_photo,source,photo?}` | 저장 결과 |
| `PATCH /api/meals/:id` | `{foods,eaten_at}` | 수정 결과 |
| `DELETE /api/meals/:id` | — | 삭제 결과 |
| `POST /api/meals/analyze` | `{image}` | `{foods,description,source}` |
| `GET /api/insights` | — | 기존 변화 보기 응답 구조 |

음식 목록 등 필드명은 기존 계약과 같습니다. 분석 이미지는 압축 후 2MB 이하로 전송합니다. 사진 보관은 `keep_photo` 선택에 따릅니다. AI 키와 모델 설정은 별도 백엔드가 관리하며 프론트에 두지 않습니다.

## 이번 백엔드에 없는 기능

`csrfToken`, `profiles`, `plan`, `config.demoEnabled`, 기록·기기의 `is_demo` 응답 필드는 사용하지 않습니다. `/api/demo/*` 호출과 예시 버튼·배지를 제거했습니다. `/api/profiles/*`를 호출하는 `ProfilePicker` 코드는 보존하지만 앱 진입점은 비활성화합니다.

## 보드 통신 경계

프론트는 `/api/device/*`를 호출하지 않습니다. 장치용 토큰은 Supabase 사용자 토큰과 별개이며 프론트 환경변수에 넣지 않습니다. `device/`와 `firmware/`의 수집·전송 코드는 유지합니다. 이전 보드 이벤트 형식은 [기존 장치 프로토콜](device/LEGACY_SERVER_PROTOCOL.md)에 참고용으로 보존했으며, 새 백엔드와의 호환성은 하드웨어 팀이 별도로 확인해야 합니다.
