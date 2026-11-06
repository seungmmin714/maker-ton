# 변한신호 프론트 API 계약

React + Vite 프론트는 Supabase Auth로 로그인하고 [별도 백엔드](https://github.com/raaaaming/maker-thon-backend)의 API를 사용합니다. 이 문서는 프론트 전환 요청에서 제공한 계약을 정리합니다. 실제 백엔드 배포 주소는 https://maker-thon-backend-steel.vercel.app/ 입니다.

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
| `POST /api/insights/analyze` | `{}` | 개인별 배변·식사 AI 분석 (아래 계약) |

음식 목록 등 필드명은 기존 계약과 같습니다. 분석 이미지는 압축 후 2MB 이하로 전송합니다. 사진 보관은 `keep_photo` 선택에 따릅니다. AI 키와 모델 설정은 별도 백엔드가 관리하며 프론트에 두지 않습니다.

### 개인 맞춤형 배변 AI 분석

홈 또는 변화 보기의 분석 버튼을 눌렀을 때만 요청합니다. 서버는 인증된 사용자의 최근 7일 기록과 그 이전 21일을 한국 날짜 기준으로 집계합니다. 최근 7일에 서로 다른 3일 이상의 배변 기록이 필요합니다. 이 조건은 분석에 필요한 제품 기준이며 의학적 판정 기준이 아닙니다.

```text
{
  source: 'ai' | 'rules',
  status: 'complete' | 'insufficient_data' | 'unavailable',
  generated_at, period: {start, end},
  coverage: {bowel_records, bowel_days, meal_records, shape_records, sensor_records},
  summary,
  observations: [{title, description, evidence_ids: []}],
  next_steps: [{title, description, evidence_ids: []}],
  evidence: [{id, label, value}],
  limitations: []
}
```

`source: 'ai'`와 `status: 'complete'`가 모두 확인된 경우에만 AI 분석으로 표시합니다. 기록 부족·AI 설정 누락·제공자 오류는 근거가 있는 기록 요약으로 표시합니다. 기존 `GET /api/insights`의 통계·차트는 그대로 유지합니다. 새 엔드포인트가 배포되지 않은 경우 연결 안내를 표시합니다.

이름·이메일·사진·원본 기록 ID·자유 입력 음식명은 AI에 보내지 않습니다. 모양 분포, 유효한 센서 시간, 식사 태그 집계 등 제한된 요약을 Anthropic API에 보냅니다. AI 출력의 근거 ID를 서버에서 검증합니다. 프론트 결과는 메모리에서만 보관하며 로그아웃·계정 변경·기록 갱신·한국 날짜 변경 시 폐기합니다. 서버 캐시 및 호출 제한은 인스턴스별 best-effort이며 영구 분석 이력을 저장하지 않습니다.

## 이번 백엔드에 없는 기능

`csrfToken`, `profiles`, `plan`, `config.demoEnabled`, 기록·기기의 `is_demo` 응답 필드는 사용하지 않습니다. `/api/demo/*` 호출과 예시 버튼·배지를 제거했습니다. `/api/profiles/*`를 호출하는 `ProfilePicker` 코드는 보존하지만 앱 진입점은 비활성화합니다.

## 보드 통신 경계

프론트는 `/api/device/*`를 호출하지 않습니다. 장치용 토큰은 Supabase 사용자 토큰과 별개이며 프론트 환경변수에 넣지 않습니다. `device/`와 `firmware/`의 수집·전송 코드는 유지합니다. 이전 보드 통신 프로토콜은 로컬에 참고용으로 보존했으며, 새 백엔드와의 호환성은 하드웨어 팀이 별도로 확인해야 합니다.
