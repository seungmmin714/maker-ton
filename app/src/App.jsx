import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, clearSession, isCancelled } from './api';
import { Badge, Empty, ErrorMessage, Icon, Logo, MedicalNote, Note, Sheet, SHAPES, ShapeArt, colorLabel, dateKey, day, duration, relative, shapeLabel, time } from './UI';
import Camera, { MealEditor } from './Camera';
import SwipePages from './SwipePages';

const NAV = [{ id: 'home', label: '홈' }, { id: 'records', label: '배변 기록' }, { id: 'meals', label: '식사 기록' }, { id: 'report', label: '변화 보기' }, { id: 'camera', label: '카메라' }];
const route = () => {
  const params = new URLSearchParams(location.search);
  let device = params.get('device') || '';
  if (!device && location.pathname.startsWith('/nfc/')) {
    try { device = decodeURIComponent(location.pathname.slice(5)); } catch { device = ''; }
  }
  const view = location.pathname === '/checkin' || location.pathname.startsWith('/nfc/') ? 'checkin' : ['records', 'meals', 'report', 'camera'].includes(params.get('view')) ? params.get('view') : 'home';
  return { view, device };
};
const claimWindowLabel = seconds => seconds % 60 === 0 ? `${seconds / 60}분` : `${seconds}초`;
const requestId = () => crypto.randomUUID?.() || `claim-${Date.now()}-${Array.from(crypto.getRandomValues(new Uint32Array(3))).join('-')}`;
const sevenDaysAgo = () => { const date = new Date(); date.setUTCDate(date.getUTCDate() - 6); return dateKey(date); };
const withinWeek = value => dateKey(value) >= sevenDaysAgo();

function Auth({ onSuccess, restoredError, onRestore, isNfc }) {
  const [register, setRegister] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const active = useRef(false);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [consent, setConsent] = useState(false);
  const controller = useRef(null); useEffect(() => { controller.current = new AbortController(); return () => controller.current.abort(); }, []);
  const submit = async event => {
    event.preventDefault(); if (active.current) return; active.current = true; setBusy(true); setError('');
    try { const data = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: register ? { name: name.trim(), email: email.trim(), password, consent } : { email: email.trim(), password }, signal: controller.current.signal }); setPassword(''); onSuccess(data); }
    catch (err) { if (!isCancelled(err)) setError(err.message); }
    finally { active.current = false; setBusy(false); }
  };
  return <div className="auth-page"><header><Logo/><span className="eyebrow">작은 기록, 나를 알아가는 신호</span></header><div className="auth-hero"><div><span className="eyebrow">나의 매일을 편안하게</span><h1>몸이 보내는 신호를<br/>가볍게 기록해요.</h1><p>화장실에서의 시간과 오늘의 한 끼.<br/>나만 볼 수 있는 기록으로 모아보세요.</p></div><img src="/assets/character_waiting.svg" alt=""/></div>{isNfc && <Note>로그인하면 방금 연 변기의 연결 화면으로 이어져요. 같은 브라우저에서는 다음 방문에도 로그인이 유지돼요.</Note>}<ErrorMessage onRetry={onRestore}>{restoredError}</ErrorMessage><div className="auth-tabs" aria-label="계정 메뉴"><button className={!register ? 'active' : ''} aria-pressed={!register} disabled={busy} onClick={() => { setRegister(false); setError(''); }}>로그인</button><button className={register ? 'active' : ''} aria-pressed={register} disabled={busy} onClick={() => { setRegister(true); setError(''); }}>처음 시작하기</button></div><form onSubmit={submit} className="auth-form">{register && <label className="field">이름<input autoComplete="name" placeholder="어떻게 불러드릴까요?" value={name} onChange={event => setName(event.target.value)} maxLength={30} required disabled={busy}/></label>}<label className="field">이메일<input type="email" inputMode="email" autoComplete="email" placeholder="hello@example.com" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required disabled={busy}/></label><label className="field">비밀번호<input type="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '8자 이상 입력해 주세요' : '비밀번호를 입력해 주세요'} minLength={register ? 8 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy}/></label>{register && <label className="check-label consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required disabled={busy}/><span>민감한 건강 기록의 수집·이용에 동의해요 <b>(필수)</b><small>배변 시각·모양·색·사용 시간과 식사 기록을 내 계정에 보관하고 생활 습관 제안에 사용해요. 가족과 같은 변기를 써도 기록은 본인만 볼 수 있으며, 기록과 계정은 언제든 삭제할 수 있어요.</small></span></label>}<ErrorMessage>{error}</ErrorMessage><button className="primary-button" type="submit" disabled={busy || (register && !consent)}>{busy ? '연결하고 있어요…' : register ? '내 기록 시작하기' : '로그인하기'}<Icon name="chevron" size={18}/></button></form><p className="privacy-line"><Icon name="shield" size={15}/>비밀번호는 이 휴대폰에 따로 저장하지 않아요.</p><footer className="auth-footer">변한신호 · 팀 물뚱뚱이<br/>나를 돌보는 작은 습관</footer></div>;
}

function RecordCard({ record, onOpen }) {
  return <button className="record-card" onClick={() => onOpen(record)}><span className="record-art"><ShapeArt value={record.shape}/></span><span className="record-text"><span className="record-time">{time(record.ended_at)}{record.is_demo && <Badge demo/>}</span><strong>{record.excretion_type === 'urine' ? '소변만 기록했어요' : record.shape ? SHAPES[record.shape - 1] : '모양 없이 기록했어요'}</strong><span className="record-meta">{record.shape ? `${record.shape}형 · ` : ''}{record.excretion_type === 'urine' ? colorLabel(record.urine_color) : colorLabel(record.stool_color)} · {duration(record.sitting_sec)}</span></span><Icon name="chevron" size={17}/></button>;
}

function CandidateCard({ candidate, now, onSelect, onDismiss }) {
  return <div className="candidate-card"><div className="candidate-top"><span><Icon name="clock" size={18}/>{relative(candidate.ended_at, now)}</span>{candidate.is_demo && <Badge demo/>}</div><h3>{time(candidate.ended_at)} 사용 종료</h3><p>{day(candidate.ended_at)} · 사용 시간 {duration(candidate.sitting_sec)}</p><button className="primary-button" onClick={() => onSelect(candidate)}>이 시각 확인하고 모양 선택<Icon name="chevron" size={17}/></button><button className="text-button centered" onClick={() => onDismiss(candidate.id)}>내 기록이 아니에요</button></div>;
}

function ShapePicker({ record, claiming, now, userName, windowSec, onClose, onSaved }) {
  const [type, setType] = useState(claiming ? 'stool' : record.excretion_type);
  const [shape, setShape] = useState(claiming ? undefined : record.shape);
  const [busy, setBusy] = useState(false); const active = useRef(false); const token = useRef(requestId());
  const [error, setError] = useState(''); const [unavailable, setUnavailable] = useState(false); const controller = useRef(null);
  useEffect(() => { controller.current = new AbortController(); return () => controller.current.abort(); }, []);
  const canSave = !busy && !unavailable && (type === 'urine' || type === 'unknown' || shape !== undefined);
  const save = async () => {
    if (!canSave || active.current) return; active.current = true; setBusy(true); setError('');
    const body = { shape: type === 'urine' || type === 'unknown' ? null : shape, excretion_type: type, shape_status: type === 'urine' ? 'not_applicable' : type === 'unknown' || shape === null ? 'unknown' : 'selected' };
    if (claiming) body.request_id = token.current;
    try {
      const data = await api(claiming ? `/sessions/${encodeURIComponent(record.id)}/claim` : `/records/${encodeURIComponent(record.id)}`, { method: claiming ? 'POST' : 'PATCH', body, signal: controller.current.signal }); onSaved(data.record);
    } catch (err) { if (!isCancelled(err)) { setError(err.message); if ([403, 404, 409, 410].includes(err.status)) setUnavailable(true); } }
    finally { active.current = false; setBusy(false); }
  };
  return <Sheet title="변 모양이 어땠나요?" eyebrow={claiming ? '시각 확인 · 모양 기록' : '내가 고른 정보 수정'} onClose={onClose} busy={busy}><div className="time-confirmation"><div><Icon name="clock" size={18}/><strong>{time(record.ended_at)} 사용 종료</strong>{record.is_demo && <Badge demo/>}</div><p>{day(record.ended_at)} · {relative(record.ended_at, now)} · 사용 시간 {duration(record.sitting_sec)}</p>{claiming && <span className="small">이 기록을 <b>{userName}님</b>의 계정에 저장해요.</span>}</div><p className="sheet-description">가장 비슷한 그림을 하나 골라주세요.<br/>정확하지 않아도 괜찮아요.</p><fieldset className="type-fieldset"><legend>무엇을 기록할까요?</legend><div className="type-options">{[['stool', '대변'], ['both', '둘 다'], ['urine', '소변만'], ['unknown', '잘 모름']].map(([id, label]) => <label key={id} className={type === id ? 'selected' : ''}><input type="radio" name="excretion-type" value={id} checked={type === id} onChange={() => setType(id)} disabled={busy || unavailable}/>{label}</label>)}</div></fieldset>{(type === 'stool' || type === 'both') && <fieldset className="shape-fieldset"><legend className="sr-only">변 모양</legend>{SHAPES.map((label, index) => <label className={`shape-option ${shape === index + 1 ? 'selected' : ''}`} key={label}><input type="radio" name="shape" value={index + 1} checked={shape === index + 1} onChange={() => setShape(index + 1)} disabled={busy || unavailable}/><ShapeArt value={index + 1}/><span>{label}<small>{index + 1}형</small></span><span className="radio-mark"/></label>)}<label className={`shape-option unknown-shape ${shape === null ? 'selected' : ''}`}><input type="radio" name="shape" checked={shape === null} onChange={() => setShape(null)} disabled={busy || unavailable}/><span>잘 모르겠어요 · 모양 없이 기록</span><span className="radio-mark"/></label></fieldset>}{type === 'urine' && <Note>소변만 기록하면 변 모양은 선택하지 않아도 돼요. 배변 횟수에는 포함되지 않아요.</Note>}{type === 'unknown' && <Note>확실하지 않은 정보는 비워둘게요.</Note>}<ErrorMessage>{error}</ErrorMessage>{unavailable ? <button className="secondary-button full" onClick={onClose}>시각 목록 다시 확인하기</button> : <button className="primary-button" disabled={!canSave} onClick={save}>{busy ? '안전하게 저장하고 있어요…' : claiming ? '내 기록으로 저장' : '변경 내용 저장하기'}</button>}{claiming && <p className="small muted centered-text">종료 후 {claimWindowLabel(windowSec)}이 지나면 저장할 수 없어요.<br/>시각이 다른 사람의 기록은 저장하지 마세요.</p>}</Sheet>;
}

function RecordDetail({ record, onClose, onEdit, onDeleted }) {
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const active = useRef(false); const [error, setError] = useState(''); const controller = useRef(null);
  useEffect(() => { controller.current = new AbortController(); return () => controller.current.abort(); }, []);
  const remove = async () => {
    if (active.current) return; active.current = true; setBusy(true); setError('');
    try { await api(`/records/${encodeURIComponent(record.id)}`, { method: 'DELETE', signal: controller.current.signal }); onDeleted(record.id); }
    catch (err) { if (!isCancelled(err)) setError(err.message); }
    finally { active.current = false; setBusy(false); }
  };
  const editable = record.ended_at && Date.now() - new Date(record.ended_at).getTime() < 86400000;
  const colorStatus = { measured: '센서 측정 · 참고', classified: '센서 추정 · 참고', unclassified: '색 분류 미완료', uncertain: '측정이 불확실해요', unmeasured: '색 미측정', failed: '색 측정 실패', mixed: '변·소변 색 구분 어려움' }[record.color_status] || '색 미측정';
  const timeSource = record.is_demo ? '예시 데이터' : { sensor: '거리 센서 측정', manual_control: '버튼으로 잰 시간', unknown: '미측정' }[record.time_source] || '측정 출처 미확인';
  return <Sheet title="그날의 기록" eyebrow={`${day(record.ended_at)} · ${time(record.ended_at)}`} onClose={onClose} busy={busy}><div className="record-detail-hero"><ShapeArt value={record.shape} size={94}/><h3>{shapeLabel(record)}</h3><p>직접 선택한 모양</p>{record.is_demo && <Badge demo/>}</div><dl className="detail-list"><div><dt>사용 종료</dt><dd>{time(record.ended_at)}</dd></div><div><dt>앉아 있던 시간</dt><dd>{duration(record.sitting_sec)}<small>{record.sitting_sec == null ? '시작·종료를 확인하지 못했어요' : timeSource}</small></dd></div><div><dt>색 측정 상태</dt><dd>{colorStatus}</dd></div><div><dt>변 색</dt><dd>{colorLabel(record.stool_color)}<small>{record.stool_color ? record.is_demo ? '예시 데이터' : '분광 센서 추정 · 참고' : '확인 가능한 측정값이 없어요'}</small></dd></div><div><dt>소변 색</dt><dd>{colorLabel(record.urine_color)}<small>{record.urine_color ? record.is_demo ? '예시 데이터' : '분광 센서 추정 · 참고' : '확인 가능한 측정값이 없어요'}</small></dd></div></dl>{!record.stool_color && !record.urine_color && <Note>측정이 없거나 변과 소변의 색을 구분하기 어려우면 색을 비워둬요.</Note>}<MedicalNote/><ErrorMessage>{error}</ErrorMessage><button className="primary-button" onClick={() => onEdit(record)} disabled={!editable || busy}>모양·배변 종류 수정하기</button>{!editable && <p className="small muted centered-text">사용 종료 후 24시간이 지난 기록은 수정할 수 없어요.</p>}{confirm ? <div className="delete-confirm"><p>이 기록을 지울까요? 삭제한 기록은 되돌릴 수 없어요.</p><div className="button-row"><button className="secondary-button" onClick={() => setConfirm(false)} disabled={busy}>취소</button><button className="danger-button" onClick={remove} disabled={busy}>{busy ? '삭제 중…' : '기록 삭제'}</button></div></div> : <button className="text-button centered danger" onClick={() => setConfirm(true)}>이 기록 삭제</button>}</Sheet>;
}

function Guide({ onClose, windowSec }) {
  return <Sheet title="편안하게, 이렇게 써보세요" eyebrow="변한신호 사용 방법" onClose={onClose}><div className="guide-hero"><img src="/assets/character_waiting.svg" alt=""/><p>매일 조금씩<br/><strong>내 몸과 가까워지는 시간</strong></p></div><ol className="guide-steps"><li><span>1</span><div><h3>변기의 NFC 태그에 휴대폰을 대요</h3><p>사용 전이나 후, 편할 때 대주세요. 아이폰은 나타난 알림을 누르면 열려요. 처음 한 번 로그인하면 같은 브라우저에서 유지돼요.</p></div></li><li><span>2</span><div><h3>내가 사용한 시각을 확인해요</h3><p>종료 시각과 사용 시간을 보여드려요. 종료 후 {claimWindowLabel(windowSec)} 이내의 기록 중 본인 것을 골라주세요. 측정 중이면 끝날 때까지 기다려요.</p></div></li><li><span>3</span><div><h3>그림을 고르고 내 기록으로 저장</h3><p>변 모양을 모르거나 소변만 봤어도 괜찮아요. 저장할 때만 내 계정과 연결돼요.</p></div></li><li><span>4</span><div><h3>한 끼를 찍고 변화를 돌아봐요</h3><p>화면을 좌우로 넘기거나 아래 카메라 탭을 눌러 한 끼를 남겨요. 음식 이름을 확인하고, 기록이 모이면 변화 보기에서 함께 돌아보세요.</p></div></li></ol><Note>변기에는 카메라가 없어요. 앱의 카메라는 식사 사진을 찍을 때만 사용해요. 같은 변기를 이용해도 다른 사람의 기록은 보이지 않아요.</Note><MedicalNote/></Sheet>;
}

function Connection({ devices, selected, onSelect, context, contextError, config, onJoined, onDemo, onClose }) {
  const [deviceId, setDeviceId] = useState(selected && !devices.some(device => device.id === selected) ? selected : 'toilet-01'); const [code, setCode] = useState('');
  const [busy, setBusy] = useState(''); const active = useRef(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(false);
  const controller = useRef(null); useEffect(() => { controller.current = new AbortController(); return () => controller.current.abort(); }, []);
  const join = async event => {
    event.preventDefault(); if (active.current) return; active.current = true; setBusy('join'); setError('');
    try { const data = await api('/devices/join', { method: 'POST', body: { device_id: deviceId.trim(), code: code.trim() }, signal: controller.current.signal }); onJoined(data.devices, deviceId.trim()); setCode(''); }
    catch (err) { if (!isCancelled(err)) setError(err.message); }
    finally { active.current = false; setBusy(''); }
  };
  const demo = async kind => {
    if (active.current) return; active.current = true; setBusy(kind); setError('');
    try { await api(kind === 'seed' ? '/demo/seed' : '/demo/session', { method: 'POST', body: kind === 'seed' ? undefined : { kind }, signal: controller.current.signal }); onDemo(kind); }
    catch (err) { if (!isCancelled(err)) setError(err.message); }
    finally { active.current = false; setBusy(''); }
  };
  const link = `${location.origin}/checkin?device=${encodeURIComponent(selected || deviceId)}`;
  return <Sheet title="연결 상태" eyebrow="내 휴대폰과 변기" onClose={onClose} busy={Boolean(busy)}><div className="connection-status"><span className={`status-orb ${context?.state === 'offline' || contextError ? 'offline' : ''}`}><Icon name="wifi" size={28}/></span><div><h3>{contextError ? '연결을 확인해 주세요' : !selected ? '연결할 기기를 등록해 주세요' : !context ? '기기 상태 확인 중' : context.state === 'offline' ? '기기 응답을 기다려요' : context.state === 'measuring' ? '측정 중이에요' : '앱과 연결되어 있어요'}</h3><p>{context?.device?.name || selected || '등록된 기기 없음'}</p></div></div><ErrorMessage>{contextError}</ErrorMessage>{devices.length > 0 && <label className="field">현재 사용할 변기<select value={devices.some(device => device.id === selected) ? selected : ''} onChange={event => { onSelect(event.target.value); setCopied(false); }} disabled={Boolean(busy)}>{!devices.some(device => device.id === selected) && <option value="" disabled>기기를 선택해 주세요</option>}{devices.map(device => <option key={device.id} value={device.id}>{device.name}{device.is_demo ? ' · 예시 기기' : ''}</option>)}</select></label>}<div className="info-box"><h3>같은 태그, 각자의 기록</h3><p>태그에는 변기 주소만 들어가요. 저장된 로그인 계정으로 열리고, 사용 시각을 확인해 저장할 때 내 기록이 돼요.</p><label className="field small">NFC 태그에 넣을 주소<input value={link} readOnly aria-label="NFC 태그 URL" onFocus={event => event.target.select()}/></label><button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); setError('위 주소를 길게 눌러 복사해 주세요.'); } }}>{copied ? '주소를 복사했어요' : '주소 복사하기'}</button></div><details className="join-details"><summary>실제 변기 연결하기</summary><p className="small muted">기기 관리자가 설정한 기기 ID와 연결 코드를 입력해 주세요.</p><form onSubmit={join}><label className="field">기기 ID<input value={deviceId} onChange={event => setDeviceId(event.target.value)} required maxLength={100} disabled={Boolean(busy)}/></label><label className="field">연결 코드<input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} required maxLength={150} disabled={Boolean(busy)}/></label><button className="secondary-button full" disabled={Boolean(busy)}>{busy === 'join' ? '연결 중…' : '이 변기 연결하기'}</button></form></details><Note>거리 센서 수령·설치와 동작 확인 후 실제 측정이 가능해요. 별도 LED·버저 대신 앱에서 상태를 확인해요.</Note>{config.demoEnabled && <details className="demo-panel"><summary><Badge demo/> 시연용 예시 제어</summary><p>아래 버튼은 실제 센서 측정과 구분되는 예시 기록을 만들어요. 예시 변기는 시연 계정들이 함께 사용해요.</p><div className="demo-buttons">{[['recent', '2분 전 사용 완료'], ['expired', '11분 전 · 시간 초과'], ['multiple', '최근 기록 2개'], ['measuring', '예시 측정 시작'], ['finish', '예시 측정 종료'], ['seed', '내 계정에 7일 예시 추가']].map(([kind, label]) => <button type="button" className="secondary-button" key={kind} onClick={() => demo(kind)} disabled={Boolean(busy)}>{busy === kind ? '준비 중…' : label}</button>)}</div></details>}<ErrorMessage>{error}</ErrorMessage></Sheet>;
}

function Profile({ user, onClose, onGuide, onConnection, onLogout, onDelete }) {
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const active = useRef(false); const [error, setError] = useState('');
  const perform = async deleting => {
    if (active.current) return; active.current = true; setBusy(true); setError('');
    try { await (deleting ? onDelete() : onLogout()); }
    catch (err) { if (!isCancelled(err)) setError(err.message); }
    finally { active.current = false; setBusy(false); }
  };
  return <Sheet title="나의 공간" onClose={onClose} busy={busy}><div className="profile-summary"><span className="avatar large">{user.name.slice(0, 1)}</span><h3>{user.name}님</h3><p>{user.email}</p><Badge>나만 보는 개인 기록</Badge></div><div className="menu-list"><button onClick={onGuide} disabled={busy}><Icon name="info"/>사용 방법<Icon name="chevron"/></button><button onClick={onConnection} disabled={busy}><Icon name="wifi"/>연결 상태<Icon name="chevron"/></button><button onClick={() => perform(false)} disabled={busy}><Icon name="logout"/>{busy ? '처리 중…' : '로그아웃'}<Icon name="chevron"/></button></div><Note>이 브라우저의 로그인은 다시 방문해도 유지돼요. 여러 사람이 같은 휴대폰을 쓸 때는 로그아웃 후 각자 로그인해 주세요.</Note><ErrorMessage>{error}</ErrorMessage>{confirm ? <div className="delete-confirm"><h3>계정과 모든 기록을 삭제할까요?</h3><p>배변·식사·사진 기록이 함께 삭제돼요. 삭제 후에는 복구할 수 없어요.</p><div className="button-row"><button className="secondary-button" onClick={() => setConfirm(false)} disabled={busy}>취소</button><button className="danger-button" onClick={() => perform(true)} disabled={busy}>계정 영구 삭제</button></div></div> : <button className="text-button danger centered" onClick={() => setConfirm(true)} disabled={busy}>계정 및 모든 기록 삭제</button>}<p className="brand-footer">변한신호 · v0.1<br/>GIST 메이커톤 · 팀 물뚱뚱이</p></Sheet>;
}

export default function App() {
  const initial = useRef(route()); const [view, setView] = useState(initial.current.view); const [session, setSession] = useState(null);
  const [boot, setBoot] = useState(true); const [bootError, setBootError] = useState(''); const [restore, setRestore] = useState(0);
  const [selected, setSelected] = useState(initial.current.device); const [sheet, setSheet] = useState(null);
  const [records, setRecords] = useState([]); const [meals, setMeals] = useState([]); const [insights, setInsights] = useState(null);
  const [dataLoading, setDataLoading] = useState(false); const [dataError, setDataError] = useState(''); const [revision, setRevision] = useState(0);
  const [context, setContext] = useState(null); const [contextError, setContextError] = useState(''); const [contextLoading, setContextLoading] = useState(false); const [contextRevision, setContextRevision] = useState(0);
  const [excluded, setExcluded] = useState([]); const [filter, setFilter] = useState('week'); const [mealFilter, setMealFilter] = useState('today');
  const [online, setOnline] = useState(navigator.onLine); const [clock, setClock] = useState(Date.now()); const [toast, setToast] = useState('');
  const accountGeneration = useRef(0);
  const user = session?.user; const config = session?.config || {}; const windowSec = config.claimWindowSec || 600; const devices = session?.devices || [];
  const notify = useCallback(message => setToast(message), []);
  const refresh = useCallback(() => { setRevision(value => value + 1); setContextRevision(value => value + 1); }, []);
  const reset = useCallback(message => {
    accountGeneration.current += 1; clearSession(); setSession(null); setRecords([]); setMeals([]); setInsights(null); setSheet(null); setContext(null); setContextError(''); setDataError(''); setExcluded([]); setSelected(route().device); setToast(message || '');
  }, []);
  const authenticated = useCallback(data => {
    accountGeneration.current += 1; setSession(data); setBootError(''); setSelected(current => current || data.devices?.[0]?.id || ''); setSheet(null); setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setBoot(true); setBootError('');
    api('/auth/me', { signal: controller.signal }).then(authenticated).catch(error => { if (!isCancelled(error) && error.status !== 401) setBootError(error.message); }).finally(() => { if (!controller.signal.aborted) setBoot(false); });
    return () => controller.abort();
  }, [restore, authenticated]);
  useEffect(() => { const onExpired = () => reset('로그인이 만료됐어요. 다시 로그인해 주세요.'); window.addEventListener('auth-expired', onExpired); return () => window.removeEventListener('auth-expired', onExpired); }, [reset]);
  useEffect(() => { const on = () => { setOnline(true); refresh(); }; const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const pop = () => { const next = route(); setView(next.view); if (next.device) setSelected(next.device); setSheet(null); setExcluded([]); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!user) return;
    const generation = accountGeneration.current; const controller = new AbortController(); setDataLoading(true); setDataError('');
    Promise.allSettled([api('/records', { signal: controller.signal }), api('/meals', { signal: controller.signal }), api('/insights', { signal: controller.signal })]).then(results => {
      if (generation !== accountGeneration.current || controller.signal.aborted) return;
      if (results[0].status === 'fulfilled') setRecords(results[0].value.records);
      if (results[1].status === 'fulfilled') setMeals(results[1].value.meals);
      if (results[2].status === 'fulfilled') setInsights(results[2].value);
      const failed = results.find(result => result.status === 'rejected' && !isCancelled(result.reason)); if (failed) setDataError(failed.reason.message); setDataLoading(false);
    }); return () => controller.abort();
  }, [user?.id, revision]);
  useEffect(() => {
    setContext(null); setContextError(''); if (!user || !selected) { setContextLoading(false); return; }
    const controller = new AbortController(); let inFlight = false; const generation = accountGeneration.current;
    const read = async () => {
      if (inFlight || document.visibilityState === 'hidden') return; inFlight = true; setContextLoading(true);
      try { const data = await api(`/devices/${encodeURIComponent(selected)}/context`, { signal: controller.signal }); if (generation === accountGeneration.current && !controller.signal.aborted) { setContext({ ...data, received_at: Date.now() }); setContextError(''); } }
      catch (error) { if (!isCancelled(error) && generation === accountGeneration.current) setContextError(error.message); }
      finally { inFlight = false; if (!controller.signal.aborted) setContextLoading(false); }
    };
    const visible = () => { if (document.visibilityState === 'visible') read(); };
    read(); const timer = setInterval(read, 5000); document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [user?.id, selected, contextRevision]);
  useEffect(() => {
    if (!user || view !== 'checkin' || !selected) return;
    const controller = new AbortController(); api(`/devices/${encodeURIComponent(selected)}/checkins`, { method: 'POST', signal: controller.signal }).catch(error => { if (!isCancelled(error)) setContextError(error.message); }); return () => controller.abort();
  }, [user?.id, view, selected]);

  const navigate = (next, device = selected) => {
    setSheet(null); setView(next); setExcluded([]);
    const url = next === 'checkin' ? `/checkin${device ? `?device=${encodeURIComponent(device)}` : ''}` : next === 'home' ? '/' : `/?view=${next}`;
    if (location.pathname + location.search !== url) history.pushState({}, '', url);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const checkin = () => { if (!selected) setSheet({ type: 'connection' }); else { navigate('checkin'); setContextRevision(value => value + 1); } };
  const openCamera = () => navigate('camera');
  const closeSheet = () => { const wasShape = sheet?.type === 'shape'; setSheet(null); if (wasShape) setContextRevision(value => value + 1); };
  const now = context?.server_now ? new Date(context.server_now).getTime() + Math.max(0, clock - context.received_at) : clock;
  const candidates = (context?.candidates || []).filter(item => !excluded.includes(item.id));
  const selectedDevice = devices.find(device => device.id === selected);
  const recentOwned = records.find(record => record.device_id === selected && now - new Date(record.ended_at).getTime() >= 0 && now - new Date(record.ended_at).getTime() <= windowSec * 1000);
  const status = contextError || !online ? 'error' : !selected ? 'none' : !context ? 'loading' : context.state;
  const today = dateKey(new Date());
  const weekRecords = records.filter(record => withinWeek(record.ended_at));
  const visibleRecords = records.filter(record => filter === 'today' ? dateKey(record.ended_at) === today : withinWeek(record.ended_at));
  const visibleMeals = meals.filter(meal => mealFilter === 'today' ? dateKey(meal.eaten_at) === today : withinWeek(meal.eaten_at));
  const recordDates = [...new Set(visibleRecords.map(record => dateKey(record.ended_at)))];
  const mealDates = [...new Set(visibleMeals.map(meal => dateKey(meal.eaten_at)))];
  const savedRecord = record => { setRecords(current => [record, ...current.filter(item => item.id !== record.id)].sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at))); setSheet({ type: 'done', record }); refresh(); };
  const savedMeal = meal => { setMeals(current => [meal, ...current.filter(item => item.id !== meal.id)].sort((a, b) => new Date(b.eaten_at) - new Date(a.eaten_at))); setSheet({ type: 'mealDone', meal }); refresh(); };
  const demo = kind => { refresh(); if (kind === 'seed') { navigate('report'); notify('내 계정에 7일 예시 기록을 추가했어요.'); } else { setSelected('demo-toilet'); navigate('checkin', 'demo-toilet'); notify('시연용 예시 상태를 만들었어요.'); } };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); reset('로그아웃했어요.'); };
  const deleteAccount = async () => { await api('/account', { method: 'DELETE' }); reset('계정과 모든 개인 기록을 삭제했어요.'); };
  const currentNav = view === 'checkin' ? 'home' : view;

  if (boot) return <div className="app-shell"><div className="boot-screen"><Logo/><img src="/assets/character_waiting.svg" alt=""/><p role="status">내 계정으로 연결하고 있어요<span className="loading-dots">…</span></p></div></div>;
  if (!user) return <div className="app-shell"><Auth onSuccess={authenticated} restoredError={bootError} onRestore={() => setRestore(value => value + 1)} isNfc={view === 'checkin'}/>{toast && <div className="toast" role="status">{toast}</div>}</div>;
  return <div className="app-shell"><div className={`app-content${view !== 'checkin' ? ' paged' : ''}`}><header className="app-header"><button className="logo-button" aria-label="변한신호 홈" onClick={() => navigate('home')}><Logo/></button><div className="header-right">{selectedDevice?.is_demo && <button className="badge-button" onClick={() => setSheet({ type: 'connection' })}><Badge demo/></button>}<button className="avatar" aria-label={`${user.name}님 프로필`} onClick={() => setSheet({ type: 'profile' })}>{user.name.slice(0, 1)}</button></div></header>{!online && <div className="offline-banner" role="status"><Icon name="wifi" size={17}/>인터넷 연결이 끊겼어요. 마지막으로 받은 기록이에요.</div>}<main className={view === 'checkin' ? 'main-content' : 'pages-main'} id="main-content">
    <ErrorMessage onRetry={refresh}>{dataError}</ErrorMessage>
    {view === 'checkin' ? <>
      <button className="back-button" onClick={() => navigate('home')}><Icon name="arrow" size={18}/>홈으로</button><div className="page-heading"><p className="eyebrow">{user.name}님의 계정으로 연결</p><h1>사용 시각을 확인해 주세요</h1><p>본인이 사용한 기록을 골라 저장해요.</p></div>
      <div className="device-line"><span><Icon name="wifi" size={16}/>{context?.device?.name || selectedDevice?.name || selected || '기기를 연결해 주세요'}</span><button className="text-button" onClick={() => setSheet({ type: 'connection' })}>변경</button></div>
      <ErrorMessage onRetry={() => setContextRevision(value => value + 1)}>{contextError}</ErrorMessage>
      {recentOwned && <section className="recent-owned"><div className="section-heading"><h2><Icon name="check" size={17}/> 이미 내 기록에 저장됐어요</h2></div><RecordCard record={recentOwned} onOpen={record => setSheet({ type: 'record', record })}/><p className="small muted">같은 태그를 다시 열어도 저장된 기록은 중복으로 만들지 않아요.</p></section>}
      {candidates.length > 0 ? <><p className="candidate-intro">{candidates.length > 1 ? '가까운 시각의 기록이 여러 개 있어요. 본인이 사용한 시각을 골라주세요.' : '이 시각에 사용하셨나요? 시각을 확인한 뒤 저장해 주세요.'}</p><div className="candidate-list">{candidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} now={now} onSelect={record => setSheet({ type: 'shape', record, claiming: true })} onDismiss={id => setExcluded(current => [...current, id])}/>)}</div></> : <div className="waiting-card"><img src="/assets/character_waiting.svg" alt=""/><span className="status-pill"><span className={`status-dot ${status === 'offline' || status === 'error' ? 'dim' : ''}`}/>{status === 'measuring' ? '센서 측정 중' : status === 'offline' || status === 'error' ? '연결 확인 필요' : status === 'loading' ? '기록 확인 중' : '측정 대기'}</span><h2>{status === 'measuring' ? '편안하게 다녀오세요' : status === 'none' ? '먼저 변기를 연결해 주세요' : status === 'offline' || status === 'error' ? '기록을 확인하고 있어요' : !context && contextLoading ? '최근 기록을 찾고 있어요' : context?.expired_count > 0 ? '연결 가능한 시간이 지났어요' : `${user.name}님, 연결됐어요`}</h2><p>{status === 'measuring' ? '측정이 끝나면 사용 종료 시각을 보여드려요. 마지막 이석 후 종료 확인까지 잠시 기다려 주세요.' : status === 'offline' || status === 'error' ? '기기 통신이나 측정 종료 전송이 아직 확인되지 않았어요. 연결되면 다시 확인할게요.' : status === 'none' ? '연결 상태에서 기기 ID와 연결 코드를 입력해 주세요.' : context?.expired_count > 0 ? `사용 종료 후 ${claimWindowLabel(windowSec)}이 지난 기록은 후보에서 제외해요. 새 측정이 끝나면 시각을 확인할 수 있어요.` : '최근 연결 가능한 기록이 없어요. 측정을 기다릴게요.'}</p>{status === 'none' ? <button className="primary-button" onClick={() => setSheet({ type: 'connection' })}>기기 연결하기</button> : <button className="secondary-button" onClick={() => setContextRevision(value => value + 1)} disabled={contextLoading}>{contextLoading ? '확인 중…' : '다시 확인하기'}</button>}</div>}
      {status === 'measuring' && context?.active_started_at && now - new Date(context.active_started_at).getTime() > 600000 && <Note warning>관측된 측정 구간이 10분을 넘었어요. 오래 앉아 있지 않도록 잠시 몸을 쉬어주세요.</Note>}
      <Note>연결만으로 기록이 저장되지는 않아요. 사용 시각과 모양을 확인한 뒤 <b>내 기록으로 저장</b>을 누르면 {user.name}님의 기록이 돼요.</Note><p className="small muted centered-text">종료 후 {claimWindowLabel(windowSec)} 이내의 기록만 연결할 수 있어요.<br/>다른 사람에게 저장된 기록은 보이지 않아요.</p>
      <div className="bottom-space"/>
    </> : <SwipePages items={NAV} activeId={view} onNavigate={navigate} disabled={Boolean(sheet)}>
      <React.Fragment key="home">
      <div className="greeting"><p>{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</p><h1>{user.name}님, 안녕하세요</h1></div>
      <section className="home-hero"><div className="hero-status"><span className={`status-dot ${status === 'offline' || status === 'error' ? 'dim' : ''}`}/>{status === 'measuring' ? '측정 중' : status === 'idle' ? '연결됨 · 대기 중' : status === 'none' ? '기기 연결 필요' : status === 'loading' ? '연결 확인 중' : '기기 상태 확인 필요'}</div><div className="hero-copy"><h2>{candidates.length ? <>사용 시각을 확인하고<br/>내 기록을 남겨주세요.</> : status === 'measuring' ? <>편안하게 다녀오세요.<br/>변화를 살펴보고 있어요.</> : <>오늘도 몸이 보내는<br/>작은 신호에 귀 기울여요.</>}</h2><p>{candidates.length ? '모양 하나를 고르면 기록이 완성돼요.' : status === 'measuring' ? '측정이 끝나면 사용 시각을 알려드릴게요.' : '변기의 NFC 태그에 휴대폰을 대주세요.'}</p></div><img className="hero-character" src="/assets/character_waiting.svg" alt=""/><div className="hero-steps"><span className="complete"><i><Icon name="check" size={11}/></i>계정 연결</span><span className={status === 'measuring' || candidates.length ? 'complete' : ''}><i>2</i>센서 측정</span><span><i>3</i>모양 기록</span></div><button className="primary-button" onClick={checkin}><Icon name={candidates.length ? 'records' : 'nfc'} size={19}/>{candidates.length ? '사용 시각 확인하기' : '변기 연결 확인하기'}<Icon name="chevron" size={16}/></button><p className="hero-footnote">사용 전에도, 사용 후에도 같은 NFC 태그</p></section>
      <button className="meal-shortcut" onClick={openCamera}><span className="shortcut-icon"><Icon name="camera" size={25}/></span><span><strong>오늘 뭐 드셨나요?</strong><small>사진 한 장으로 식사 기록하기</small></span><Icon name="chevron" size={18}/></button><p className="swipe-hint">좌우로 넘겨 기록과 카메라를 만나보세요</p>
      <section className="insight-card"><span className="eyebrow"><Icon name="leaf" size={16}/>기록 기반 제안</span><h2>{insights?.items?.[0]?.title || '기록이 모이면 알려드릴게요'}</h2><p>{insights?.items?.[0]?.description || '배변과 식사 기록을 조금씩 남겨주세요. 나만의 흐름을 함께 돌아볼 수 있어요.'}</p><button className="text-button" onClick={() => navigate('report')}>내 변화 살펴보기<Icon name="chevron" size={15}/></button></section>
      <section className="section-block"><div className="section-heading"><h2>차곡차곡, 이번 주</h2><span>최근 7일</span></div><div className="week-strip">{Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setUTCDate(date.getUTCDate() - 6 + index); const key = dateKey(date); const has = weekRecords.some(record => dateKey(record.ended_at) === key); return <div key={key} className={key === today ? 'today' : ''}><span>{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(date)}</span><span className={`day-circle ${has ? 'has-record' : ''}`} aria-label={`${day(date)} ${has ? '기록 있음' : '기록 없음'}`}>{has ? <Icon name="check" size={17}/> : Number(key.slice(-2))}</span></div>; })}</div><p className="small muted">기록이 없는 날은 배변이 없었다는 뜻이 아니에요.</p></section>
<MedicalNote/><div className="home-footer"><button className="text-button" onClick={() => setSheet({ type: 'guide' })}>사용 방법</button><span>·</span><button className="text-button" onClick={() => setSheet({ type: 'connection' })}>연결 상태</button></div>
      </React.Fragment>
      <><div className="page-heading"><p className="eyebrow">하루하루 남겨둔 나의 신호</p><div className="title-row"><h1>배변 기록</h1><button className="small-add" onClick={checkin}><Icon name="plus" size={17}/>새 기록</button></div><p>작은 변화도 놓치지 않도록.</p></div><div className="filter-row"><button className={filter === 'week' ? 'filter active' : 'filter'} onClick={() => setFilter('week')} aria-pressed={filter === 'week'}>최근 7일</button><button className={filter === 'today' ? 'filter active' : 'filter'} onClick={() => setFilter('today')} aria-pressed={filter === 'today'}>오늘</button><span>{visibleRecords.length}개 기록</span></div>{!visibleRecords.length ? <Empty title={dataLoading ? '기록을 불러오고 있어요' : '아직 기록이 없어요'} description="변기의 NFC 태그를 열고 사용 시각을 확인해 보세요." action={<button className="secondary-button" onClick={checkin}>내 기록 연결하기</button>}/> : recordDates.map(date => <section className="dated-group" key={date}><h2>{date === today ? '오늘' : day(visibleRecords.find(record => dateKey(record.ended_at) === date).ended_at)}</h2>{visibleRecords.filter(record => dateKey(record.ended_at) === date).map(record => <RecordCard key={record.id} record={record} onOpen={item => setSheet({ type: 'record', record: item })}/>)}</section>)}<MedicalNote/></>
      <><div className="page-heading"><p className="eyebrow">한 끼가 쌓여 내 몸의 힌트로</p><h1>식사 기록</h1><p>오늘 먹은 음식을 사진으로 남겨보세요.</p></div><button className="primary-button" onClick={openCamera}><Icon name="camera" size={20}/>식사 사진 찍기</button><div className="filter-row"><button className={mealFilter === 'today' ? 'filter active' : 'filter'} aria-pressed={mealFilter === 'today'} onClick={() => setMealFilter('today')}>오늘</button><button className={mealFilter === 'week' ? 'filter active' : 'filter'} aria-pressed={mealFilter === 'week'} onClick={() => setMealFilter('week')}>최근 7일</button><span>{visibleMeals.length}끼 기록</span></div>{!visibleMeals.length ? <Empty title={dataLoading ? '식사를 불러오고 있어요' : '오늘의 첫 한 끼를 남겨요'} description="사진을 찍거나 앨범에서 골라주세요. 음식 이름은 확인하고 고칠 수 있어요." icon="meals" action={<button className="secondary-button" onClick={openCamera}>사진으로 기록하기</button>}/> : mealDates.map(date => <section className="dated-group" key={date}><h2>{date === today ? '오늘' : day(visibleMeals.find(meal => dateKey(meal.eaten_at) === date).eaten_at)}</h2>{visibleMeals.filter(meal => dateKey(meal.eaten_at) === date).map(meal => <button className="meal-card" key={meal.id} onClick={() => setSheet({ type: 'meal', meal })}>{meal.photo ? <img src={meal.photo} alt="저장한 식사 사진"/> : <span className="meal-placeholder"><Icon name="meals" size={30}/><span>음식 목록으로 기록</span></span>}<div className="meal-card-content"><div className="record-time">{time(meal.eaten_at)}{meal.is_demo && <Badge demo/>}<Icon name="chevron" size={17}/></div><div className="saved-foods">{meal.foods.map((food, index) => <span key={index}>{food.name}</span>)}</div><p>{meal.source === 'ai' ? 'AI가 찾고, 내가 확인한 음식' : '내가 직접 확인한 음식'} · 눌러서 수정</p></div></button>)}</section>)}<MedicalNote/></>
      <Report insights={insights} records={records} meals={meals} loading={dataLoading}/>
      <Camera embedded active={view === 'camera' && !sheet} onSaved={savedMeal} aiEnabled={config.aiEnabled}/>
    </SwipePages>}
  </main><nav className="bottom-nav" aria-label="주 메뉴">{NAV.map(item => <button key={item.id} className={currentNav === item.id ? 'active' : ''} aria-current={currentNav === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.id}/><span>{item.label}</span>{currentNav === item.id && <i/>}</button>)}</nav></div>
  {toast && <div className="toast" role="status"><Icon name="check" size={18}/>{toast}</div>}
  {sheet?.type === 'shape' && <ShapePicker key={`shape-${sheet.record.id}`} record={sheet.record} claiming={sheet.claiming} now={now} userName={user.name} windowSec={windowSec} onClose={closeSheet} onSaved={savedRecord}/>}
  {sheet?.type === 'record' && <RecordDetail key={sheet.record.id} record={sheet.record} onClose={closeSheet} onEdit={record => setSheet({ type: 'shape', record, claiming: false })} onDeleted={id => { setRecords(current => current.filter(record => record.id !== id)); setSheet(null); refresh(); notify('배변 기록을 삭제했어요.'); }}/>}
  {sheet?.type === 'meal' && <MealEditor key={sheet.meal.id} meal={sheet.meal} onClose={closeSheet} onSaved={savedMeal} onDelete={id => { setMeals(current => current.filter(meal => meal.id !== id)); setSheet(null); refresh(); notify('식사 기록을 삭제했어요.'); }}/>}
  {sheet?.type === 'guide' && <Guide windowSec={windowSec} onClose={closeSheet}/>}
  {sheet?.type === 'connection' && <Connection devices={devices} selected={selected} onSelect={id => { setSelected(id); setExcluded([]); if (view === 'checkin') history.replaceState({}, '', `/checkin?device=${encodeURIComponent(id)}`); }} context={context} contextError={contextError} config={config} onJoined={(nextDevices, id) => { setSession(current => ({ ...current, devices: nextDevices })); setSelected(id); setContextRevision(value => value + 1); if (view === 'checkin') history.replaceState({}, '', `/checkin?device=${encodeURIComponent(id)}`); notify('기기를 연결했어요.'); }} onDemo={demo} onClose={closeSheet}/>}
  {sheet?.type === 'profile' && <Profile user={user} onClose={closeSheet} onGuide={() => setSheet({ type: 'guide' })} onConnection={() => setSheet({ type: 'connection' })} onLogout={logout} onDelete={deleteAccount}/>}
  {sheet?.type === 'done' && <Sheet title="내 기록에 잘 남겼어요" eyebrow="기록 완료" onClose={closeSheet}><div className="success-hero"><img src="/assets/character_done.svg" alt=""/><h3>작은 기록 하나, 오늘도 차곡차곡.</h3><p>{time(sheet.record.ended_at)} 사용 종료 · {duration(sheet.record.sitting_sec)}</p>{sheet.record.is_demo && <Badge demo/>}</div><button className="primary-button" onClick={() => setSheet({ type: 'record', record: sheet.record })}>내 기록 확인하기</button><button className="text-button centered" onClick={checkin}>새 기록 연결하기</button><MedicalNote/></Sheet>}
  {sheet?.type === 'mealDone' && <Sheet title="오늘의 한 끼를 남겼어요" eyebrow="식사 기록 완료" onClose={closeSheet}><div className="success-hero"><span className="success-mark"><Icon name="check" size={34}/></span><h3>먹은 음식도 몸의 힌트가 돼요.</h3><p>{sheet.meal.foods.map(food => food.name).join(' · ')}</p>{sheet.meal.is_demo && <Badge demo/>}</div><button className="primary-button" onClick={() => { setMealFilter(dateKey(sheet.meal.eaten_at) === today ? 'today' : 'week'); navigate('meals'); }}>식사 기록 보기</button><button className="text-button centered" onClick={() => navigate('home')}>홈으로 돌아가기</button><MedicalNote/></Sheet>}
  </div>;
}

function Report({ insights, records, meals, loading }) {
  const week = records.filter(record => withinWeek(record.ended_at));
  const timingSource = { sensor: '거리 센서 측정', demo: '예시 시간', manual_control: '버튼으로 잰 시간' }[insights?.average_time_source] || '유효한 시간';
  const hasDemo = week.some(record => record.is_demo) || meals.some(meal => withinWeek(meal.eaten_at) && meal.is_demo);
  const chart = insights?.chart || [];
  const max = Math.max(3, ...chart.map(item => item.count || 0));
  return <><div className="page-heading"><p className="eyebrow">나의 흐름을 천천히 알아가요</p><h1>변화 보기</h1><p>최근 7일의 배변과 식사 기록이에요.</p></div>{hasDemo && <div className="report-demo"><Badge demo/><span>이 요약에 시연용 예시 기록이 포함되어 있어요.</span></div>}<section className="summary-card"><div className="section-heading"><h2>이번 주, 이렇게 남겼어요</h2><Icon name="report" size={21}/></div><div className="summary-grid"><div><strong>{insights?.days ?? '—'}<small>일</small></strong><span>기록한 날</span></div><div><strong>{insights?.record_count ?? '—'}<small>회</small></strong><span>배변 기록</span></div><div><strong className="duration-stat">{insights ? duration(insights.average_sitting_sec) : '—'}</strong><span>평균 사용 시간</span></div></div><p className="small muted">식사 {insights?.meal_count ?? 0}끼 · 소변만인 기록은 배변 횟수에서 제외해요.</p><p className="small muted">{timingSource} {insights?.average_sample_count ?? 0}개 기준. 미측정 시간은 0으로 계산하지 않아요.</p></section>
    {(insights?.alerts || []).map(alert => <section className="alert-card" key={alert.id}><span className="eyebrow"><Icon name="info" size={17}/>확인이 필요한 신호</span><h2>{alert.title}</h2><p>{alert.description}</p><p className="small">센서 추정 색을 실제 증상으로 확정하지 않아요. 실제 색과 몸 상태를 확인해 주세요.</p></section>)}
    <section className="section-block"><div className="section-heading"><h2>기록에서 발견한 작은 힌트</h2></div><p className="section-description">기록 기반 제안 · 최근 7일의 기록을 바탕으로 계산해요.</p>{insights?.items?.length ? insights.items.slice(0, 3).map((item, index) => <article className={`insight-card report-insight ${index % 2 ? 'cream' : ''}`} key={index}><div className="insight-number">0{index + 1}</div><h3>{item.title}</h3><p>{item.description}</p>{item.basis && <div className="insight-basis">기록 근거 · {typeof item.basis === 'string' ? item.basis : JSON.stringify(item.basis)}</div>}</article>) : <Empty icon="leaf" title={loading ? '기록을 함께 살펴보고 있어요' : '기록이 더 모이면 알려드릴게요'} description="서로 다른 날짜에 기록을 남겨보세요. 충분한 기록이 모이면 생활 습관을 돌아볼 수 있어요."/>}</section>
    <section className="chart-card"><div className="section-heading"><h2>날짜별 배변 기록</h2><span>최근 7일</span></div>{chart.length ? <><div className="bar-chart" role="img" aria-label={chart.map(item => `${item.date} ${item.count ? `${item.count}회 기록` : '기록 없음'}`).join(', ')}>{chart.map(item => <div className="bar-column" key={item.date}><div className="bar-track"><span className="bar-value">{item.count || '—'}</span><span className={`bar ${item.count ? '' : 'no-data'}`} style={{ height: item.count ? `${Math.max(12, item.count / max * 110)}px` : '3px' }}/></div><span className="bar-date">{String(item.date).slice(5).replace('-', '/')}</span></div>)}</div><p className="small muted">— 기록 없음 · 배변을 하지 않았다는 뜻은 아니에요.</p></> : <p className="muted">{loading ? '그래프를 불러오고 있어요…' : '아직 날짜별 기록이 없어요.'}</p>}</section><MedicalNote/></>;
}
