import React, { useEffect, useRef, useState } from 'react';
import { api, isCancelled } from './api';
import { ErrorMessage, Icon, Note, Sheet } from './UI';
import './ProfilePicker.css';

function Lock({ size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>;
}

function ProfileAvatar({ profile }) {
  const tone = [...profile.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
  return <span className={`picker-avatar picker-tone-${tone}`} aria-hidden="true"><span>{Array.from(profile.name)[0] || '?'}</span><i/><i/></span>;
}

export default function ProfilePicker({ user, profiles = [], onClose, onAuthenticated, onManage }) {
  const [roster, setRoster] = useState(() => profiles.length ? profiles : [{ id: user.id, name: user.name, is_current: true }]);
  const [screen, setScreen] = useState('grid');
  const [target, setTarget] = useState(null);
  const [addMode, setAddMode] = useState('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [rosterError, setRosterError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const controller = useRef(null);
  const firstField = useRef(null);

  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true); setRosterError('');
    api('/profiles', { signal: request.signal }).then(data => {
      if (!request.signal.aborted) setRoster(data.profiles);
    }).catch(err => {
      if (!isCancelled(err)) setRosterError(err.message);
    }).finally(() => {
      if (!request.signal.aborted) setLoading(false);
    });
    return () => request.abort();
  }, [revision]);

  useEffect(() => {
    if (screen !== 'grid') firstField.current?.focus();
  }, [screen, addMode]);

  const resetForm = () => {
    setPassword(''); setName(''); setEmail(''); setConsent(false); setError('');
  };
  const back = () => {
    if (active.current) return;
    resetForm(); setTarget(null); setScreen('grid');
  };
  const close = () => {
    if (active.current) return;
    setPassword(''); onClose();
  };
  const select = profile => {
    if (active.current) return;
    if (profile.id === user.id) { close(); return; }
    resetForm(); setTarget(profile); setScreen('unlock');
  };
  const add = () => {
    resetForm(); setTarget(null); setAddMode('register'); setScreen('add');
  };
  const submit = async event => {
    event.preventDefault();
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    const path = screen === 'unlock' ? '/profiles/switch' : `/profiles/${addMode}`;
    const body = screen === 'unlock'
      ? { profile_id: target.id, password }
      : addMode === 'register'
        ? { name: name.trim(), email: email.trim(), password, consent }
        : { email: email.trim(), password };
    try {
      const data = await api(path, { method: 'POST', body, signal: controller.current.signal });
      setPassword(''); onAuthenticated(data);
    } catch (err) {
      if (!isCancelled(err)) {
        setPassword(''); setError(err.message);
      }
    } finally {
      active.current = false;
      if (!controller.current.signal.aborted) setBusy(false);
    }
  };

  const title = screen === 'grid' ? '누구의 기록을 열까요?' : screen === 'unlock' ? '비밀번호를 확인해 주세요' : '함께 쓸 프로필 추가';
  return <Sheet title={title} eyebrow="함께 써도, 기록은 각자" onClose={close} busy={busy} wide>
    <div className="profile-picker">
      {screen === 'grid' ? <>
        <p className="picker-intro">프로필을 고르면 나만의 기록으로 이어져요.<br/>다른 프로필은 해당 계정의 비밀번호가 필요해요. 현재 프로필은 이 브라우저에서 로그인이 유지돼요.</p>
        <ErrorMessage onRetry={() => setRevision(value => value + 1)}>{rosterError}</ErrorMessage>
        {loading && <p className="picker-loading" role="status">프로필을 확인하고 있어요…</p>}
        <div className="profile-grid" aria-label="사용할 프로필">
          {roster.map(profile => <button type="button" className={`profile-tile${profile.id === user.id ? ' is-current' : ''}`} key={profile.id} onClick={() => select(profile)} aria-label={profile.id === user.id ? `${profile.name}님, 현재 프로필 계속 사용` : `${profile.name}님 프로필, 비밀번호로 열기`}>
            <ProfileAvatar profile={profile}/>
            <strong>{profile.name}</strong>
            <span className="profile-tile-state">{profile.id === user.id ? <><Icon name="check" size={15}/>현재 사용 중</> : <><Lock/>비밀번호로 열기</>}</span>
          </button>)}
          <button type="button" className="profile-tile profile-add-tile" onClick={add}>
            <span className="picker-add-avatar"><Icon name="plus" size={36}/></span>
            <strong>프로필 추가</strong>
            <span className="profile-tile-state">무료로 추가</span>
          </button>
        </div>
        <p className="picker-free"><span>모든 프로필 무료</span>함께 쓰는 사람을 무료로 추가할 수 있어요.</p>
        {onManage && <button type="button" className="secondary-button full picker-manage" onClick={onManage}><Icon name="shield" size={18}/>나의 공간<Icon name="chevron" size={16}/></button>}
        <p className="picker-privacy"><Lock/>프로필 이름만 함께 보여요. 건강 기록은 본인만 열 수 있어요.</p>
      </> : <>
        <button type="button" className="text-button picker-back" onClick={back} disabled={busy}><Icon name="arrow" size={17}/>프로필 목록으로</button>
        {screen === 'unlock' ? <div className="picker-unlock-person"><ProfileAvatar profile={target}/><h3>{target.name}님</h3><p>이 계정의 비밀번호로 기록을 열어주세요.</p></div> : <>
          <p className="picker-intro">사용할 분이 직접 이름과 비밀번호를 입력해 주세요. 함께 쓰는 변기에 연결되며 기록은 각자 보관해요.</p>
          <div className="picker-add-tabs" aria-label="프로필 추가 방법">
            <button type="button" className={addMode === 'register' ? 'active' : ''} aria-pressed={addMode === 'register'} onClick={() => { resetForm(); setAddMode('register'); }} disabled={busy}>새 프로필 만들기</button>
            <button type="button" className={addMode === 'link' ? 'active' : ''} aria-pressed={addMode === 'link'} onClick={() => { resetForm(); setAddMode('link'); }} disabled={busy}>기존 계정 연결</button>
          </div>
        </>}
        <form className="picker-form" onSubmit={submit}>
          {screen === 'add' && <>
            {addMode === 'register' && <label className="field">이름<input ref={firstField} autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="프로필에 보여줄 이름" maxLength={30} required disabled={busy}/></label>}
            <label className="field">이메일<input ref={addMode === 'link' ? firstField : undefined} type="email" inputMode="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder="hello@example.com" maxLength={254} required disabled={busy}/></label>
          </>}
          <label className="field">{screen === 'unlock' ? `${target.name}님의 비밀번호` : '비밀번호'}<input ref={screen === 'unlock' ? firstField : undefined} type="password" autoComplete={screen === 'add' && addMode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={screen === 'add' && addMode === 'register' ? '8자 이상 입력해 주세요' : '이 계정의 비밀번호를 입력해 주세요'} minLength={screen === 'add' && addMode === 'register' ? 8 : undefined} maxLength={128} required disabled={busy}/></label>
          {screen === 'add' && addMode === 'register' && <label className="check-label consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required disabled={busy}/><span>내 건강 기록의 수집·이용에 동의해요 <b>(필수)</b><small>배변 시각·모양·색·사용 시간과 식사 기록을 내 계정에 보관하고 생활 습관 제안에 사용해요. 가족과 같은 변기를 써도 기록은 본인만 볼 수 있으며, 기록과 계정은 언제든 삭제할 수 있어요. 동의는 이 프로필을 사용할 본인이 해주세요.</small></span></label>}
          {screen === 'add' && addMode === 'link' && <Note>연결할 계정의 주인이 직접 로그인해 주세요. 연결 후에는 이 목록에 이름이 함께 표시돼요.</Note>}
          <ErrorMessage>{error}</ErrorMessage>
          <button type="submit" className="primary-button" disabled={busy || (screen === 'add' && addMode === 'register' && !consent)}>{busy ? '비밀번호를 확인하고 있어요…' : screen === 'unlock' ? '이 프로필로 들어가기' : addMode === 'register' ? '추가하고 이 프로필로 시작' : '연결하고 이 프로필로 시작'}<Icon name="chevron" size={17}/></button>
        </form>
        {screen === 'add' && <p className="picker-no-charge">프로필 추가는 무료예요.</p>}
        <p className="picker-privacy"><Lock/>비밀번호는 이 브라우저에 따로 저장하지 않아요. 다른 프로필로 바꿀 때마다 확인해요.</p>
      </>}
    </div>
  </Sheet>;
}
