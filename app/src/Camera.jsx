import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, isCancelled } from './api';
import { Sheet, Icon, Note, ErrorMessage, localInput, inputToISO } from './UI';

async function compressPhoto(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('25MB 이하의 사진을 골라주세요.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('사진을 열지 못했어요. JPG, PNG 또는 WebP 사진으로 다시 골라주세요.')); image.src = url; });
    const ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL('image/jpeg', .82);
    if (result.length > 2600000) result = canvas.toDataURL('image/jpeg', .58);
    if (result.length > 2700000) throw new Error('사진 용량을 줄이지 못했어요. 더 작은 사진을 골라주세요.');
    return result;
  } finally { URL.revokeObjectURL(url); }
}

export function FoodChips({ foods, setFoods, disabled = false }) {
  const inputId = useId();
  const [food, setFood] = useState('');
  const [message, setMessage] = useState('');
  const add = event => {
    event.preventDefault(); const name = food.trim();
    if (!name) return;
    if (foods.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { setMessage('이미 추가한 음식이에요.'); return; }
    if (foods.length >= 30) { setMessage('한 끼에 음식 30개까지 남길 수 있어요.'); return; }
    setFoods([...foods, { name, tags: [] }]); setFood(''); setMessage('');
  };
  return <div className="food-editor"><div className="section-heading compact"><h3>먹은 음식</h3><span>틀린 음식은 빼주세요</span></div><div className="food-chips">{foods.map((item, index) => <span className="food-chip" key={`${item.name}-${index}`}><span>{item.name}</span><button type="button" aria-label={`${item.name} 빼기`} onClick={() => setFoods(foods.filter((_, i) => i !== index))} disabled={disabled}><Icon name="close" size={15}/></button></span>)}{!foods.length && <p className="muted small">음식 이름을 하나 이상 추가해 주세요.</p>}</div><form className="inline-form" onSubmit={add}><label className="sr-only" htmlFor={inputId}>빠진 음식 이름</label><input id={inputId} placeholder="빠진 음식 직접 추가" maxLength={80} value={food} onChange={event => setFood(event.target.value)} disabled={disabled}/><button className="secondary-button" disabled={disabled || !food.trim()} type="submit"><Icon name="plus" size={18}/><span>추가</span></button></form>{message && <p className="small" role="status">{message}</p>}</div>;
}

export default function Camera({ onClose, onSaved, aiEnabled, embedded = false, active = true }) {
  const [photo, setPhoto] = useState(null); const [foods, setFoods] = useState([]);
  const [manualMode, setManualMode] = useState(false); const editing = Boolean(photo) || manualMode;
  const [description, setDescription] = useState(''); const [source, setSource] = useState('manual');
  const [error, setError] = useState(''); const [cameraError, setCameraError] = useState('');
  const [busy, setBusy] = useState(''); const busyRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false); const [cameraLoading, setCameraLoading] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [facing, setFacing] = useState('environment'); const [torchAvailable, setTorchAvailable] = useState(false); const [torch, setTorch] = useState(false);
  const [keepPhoto, setKeepPhoto] = useState(false); const [eatenAt, setEatenAt] = useState(localInput());
  const video = useRef(null); const stream = useRef(null); const album = useRef(null); const captureFile = useRef(null);
  const mounted = useRef(true); const controller = useRef(null);
  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  useEffect(() => { mounted.current = true; controller.current = new AbortController(); return () => { mounted.current = false; controller.current?.abort(); stopCamera(); }; }, [stopCamera]);
  useEffect(() => {
    const visibilityChanged = () => {
      const visible = document.visibilityState !== 'hidden';
      if (!visible) stopCamera();
      setPageVisible(visible);
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => document.removeEventListener('visibilitychange', visibilityChanged);
  }, [stopCamera]);
  useEffect(() => {
    if (!active || !pageVisible || editing) {
      stopCamera(); setCameraReady(false); setCameraLoading(false); setTorch(false); setTorchAvailable(false); return;
    }
    let cancelled = false;
    setEatenAt(localInput());
    setCameraLoading(true); setCameraError(''); setCameraReady(false); setTorch(false); setTorchAvailable(false);
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저에서는 카메라 화면을 열 수 없어요. 아래 촬영 또는 앨범 버튼을 이용해 주세요.');
        const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 } }, audio: false });
        if (cancelled || document.visibilityState === 'hidden') { next.getTracks().forEach(track => track.stop()); return; }
        stream.current = next;
        if (video.current) { video.current.srcObject = next; await video.current.play(); }
        if (cancelled) return;
        setCameraReady(true); setTorchAvailable(Boolean(next.getVideoTracks()[0]?.getCapabilities?.().torch));
      } catch (err) {
        if (!cancelled) { stopCamera(); setCameraError(err.name === 'NotAllowedError' ? '카메라 권한을 허용하거나 아래 촬영·앨범 버튼으로 사진을 골라주세요.' : err.name === 'NotFoundError' ? '연결된 카메라가 없어요. 앨범에서 사진을 골라주세요.' : err.message || '카메라를 열지 못했어요.'); }
      } finally { if (!cancelled) setCameraLoading(false); }
    }
    start(); return () => { cancelled = true; stopCamera(); };
  }, [active, pageVisible, facing, editing, stopCamera]);

  const pick = async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || busyRef.current) return;
    busyRef.current = true; setBusy('photo'); setError('');
    try { const image = await compressPhoto(file); if (mounted.current) { setPhoto(image); setManualMode(false); setFoods([]); setDescription(''); setSource('manual'); } }
    catch (err) { if (mounted.current) setError(err.message); }
    finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  };
  const shoot = () => {
    if (!active || busyRef.current) return;
    if (!cameraReady || !video.current?.videoWidth) { captureFile.current?.click(); return; }
    const canvas = document.createElement('canvas'); const ratio = Math.min(1, 1200 / Math.max(video.current.videoWidth, video.current.videoHeight));
    canvas.width = Math.round(video.current.videoWidth * ratio); canvas.height = Math.round(video.current.videoHeight * ratio);
    canvas.getContext('2d').drawImage(video.current, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg', .82)); setError('');
  };
  const toggleTorch = async () => {
    const currentStream = stream.current; const track = currentStream?.getVideoTracks()[0];
    if (!active || !track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch }] });
      if (mounted.current && stream.current === currentStream) setTorch(value => !value);
    } catch { if (mounted.current && stream.current === currentStream) setCameraError('이 카메라에서는 플래시를 켤 수 없어요.'); }
  };
  const analyze = async () => {
    if (busyRef.current || !photo) return;
    busyRef.current = true; setBusy('analyze'); setError('');
    try {
      const data = await api('/meals/analyze', { method: 'POST', body: { image: photo }, signal: controller.current.signal });
      if (mounted.current) { setFoods(data.foods); setDescription(data.description || '음식 이름과 양은 사진만으로 정확히 알기 어려워요. 이름표를 확인해 주세요.'); setSource('ai'); }
    } catch (err) { if (!isCancelled(err) && mounted.current) { setError(`${err.message} 아래에서 음식 이름을 직접 추가할 수 있어요.`); setSource('manual'); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  };
  const save = async () => {
    if (busyRef.current || !foods.length || !eatenAt) return;
    busyRef.current = true; setBusy('save'); setError('');
    try {
      const data = await api('/meals', { method: 'POST', body: { foods, eaten_at: inputToISO(eatenAt), photo: keepPhoto ? photo : null, keep_photo: keepPhoto, source }, signal: controller.current.signal });
      if (mounted.current) {
        setManualMode(false); setPhoto(null); setFoods([]); setDescription(''); setSource('manual'); setKeepPhoto(false); setEatenAt(localInput()); setError('');
        onSaved(data.meal);
      }
    } catch (err) { if (!isCancelled(err) && mounted.current) setError(err.message); }
    finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  };
  const retake = () => { setManualMode(false); setPhoto(null); setFoods([]); setDescription(''); setSource('manual'); setError(''); };

  const title = manualMode ? '먹은 음식을 남겨요' : photo ? source === 'ai' ? '이렇게 먹었나요?' : '사진으로 식사 기록' : '오늘의 한 끼를 담아요';
  const eyebrow = manualMode ? '음식 이름 직접 추가' : photo ? source === 'ai' ? 'AI 음식 인식 · 확인 후 저장' : '사진 확인' : '식사 사진 · 촬영 또는 앨범';
  const content = <div>
      {photo ? <div className="meal-photo-preview"><img src={photo} alt="선택한 식사 사진"/><div className="photo-labels">{foods.slice(0, 4).map((food, index) => <span key={index}>{food.name}</span>)}</div></div> : manualMode ? <Note>사진이 없어도 음식 이름을 추가해 기록할 수 있어요. AI 분석 없이 직접 확인한 기록으로 저장돼요.</Note> : <div className="camera-view"><video ref={video} autoPlay playsInline muted aria-label="식사 촬영 미리보기" className={facing === 'user' ? 'mirrored' : ''}/>{!cameraReady && <div className="camera-placeholder"><Icon name="camera" size={40}/><p>{cameraLoading ? '카메라를 준비하고 있어요' : '음식이 잘 보이도록 찍어주세요'}</p></div>}<span className="camera-frame" aria-hidden="true"/><span className="camera-caption">음식이 화면 안에 들어오게 해주세요</span></div>}
      <input className="sr-only" ref={album} type="file" accept="image/*" onChange={pick} tabIndex={-1} aria-label="앨범에서 식사 사진 선택"/>
      <input className="sr-only" ref={captureFile} type="file" accept="image/*" capture="environment" onChange={pick} tabIndex={-1} aria-label="휴대폰 카메라로 촬영"/>
      {!editing && <><div className="camera-actions"><button className="camera-tool" onClick={() => album.current?.click()} disabled={Boolean(busy)}><Icon name="album"/><span>앨범</span></button><button className="shutter" aria-label="식사 사진 촬영" onClick={shoot} disabled={Boolean(busy) || cameraLoading}><span/></button><button className="camera-tool" onClick={() => setFacing(value => value === 'environment' ? 'user' : 'environment')} disabled={!cameraReady || Boolean(busy)}><Icon name="flip"/><span>전환</span></button></div><div className="camera-subactions"><button className="text-button" onClick={toggleTorch} disabled={!torchAvailable || !cameraReady}><Icon name="flash" size={17}/>{torch ? '플래시 끄기' : torchAvailable ? '플래시 켜기' : '플래시 미지원'}</button>{embedded && <span className="small muted">좌우로 넘겨 다른 화면으로 이동</span>}</div>{cameraError && <Note>{cameraError}</Note>}<button className="text-button centered" onClick={() => { setManualMode(true); setFoods([]); setDescription(''); setSource('manual'); setError(''); }} disabled={Boolean(busy)}>사진 없이 음식 이름 추가하기</button></>}
      {editing && <><div className="preview-actions"><button type="button" className="text-button" onClick={retake} disabled={Boolean(busy)}>{manualMode ? '사진 찍기' : '다시 찍기'}</button><button type="button" className="text-button" onClick={() => album.current?.click()} disabled={Boolean(busy)}>{manualMode ? '앨범에서 고르기' : '다른 사진 고르기'}</button></div>{photo && source !== 'ai' && <div className="analysis-start"><button className="primary-button" onClick={analyze} disabled={Boolean(busy)}><Icon name="leaf"/>{busy === 'analyze' ? '사진 속 음식을 찾고 있어요…' : 'AI로 음식 알아보기'}</button><p className="small muted">버튼을 누르면 음식 인식을 위해 사진이 AI 서비스로 전송돼요.{!aiEnabled && ' 현재 AI 연결이 준비되지 않아 직접 추가할 수도 있어요.'}</p></div>}
        <ErrorMessage>{error}</ErrorMessage><FoodChips foods={foods} setFoods={setFoods} disabled={Boolean(busy)}/>
        {description && <div className="insight-card compact"><span className="eyebrow">배변과 연결해 보면</span><p>{description}</p><span className="small muted">AI가 추정한 내용이라 틀릴 수 있어요.</span></div>}
        <label className="field">먹은 시각 <span className="small muted">한국 시각</span><input type="datetime-local" value={eatenAt} onChange={event => setEatenAt(event.target.value)} required disabled={Boolean(busy)}/></label>
        {photo && <label className="check-label"><input type="checkbox" checked={keepPhoto} onChange={event => setKeepPhoto(event.target.checked)} disabled={Boolean(busy)}/><span>식사 기록에 원본 사진도 보관할게요<small>선택하지 않으면 음식 목록만 저장해요.</small></span></label>}
        <button className="primary-button" onClick={save} disabled={Boolean(busy) || !foods.length || !eatenAt}>{busy === 'save' ? '저장하고 있어요…' : '이대로 저장하기'}</button>
      </>}
      {!editing && <ErrorMessage>{error}</ErrorMessage>}
    </div>;
  return embedded
    ? <section className="camera-page"><div className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{content}</section>
    : <Sheet title={title} eyebrow={eyebrow} onClose={onClose} busy={Boolean(busy)} wide>{content}</Sheet>;
}

export function MealEditor({ meal, onClose, onSaved, onDelete }) {
  const [foods, setFoods] = useState(meal.foods); const [eatenAt, setEatenAt] = useState(localInput(meal.eaten_at));
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false); const controller = useRef(null);
  useEffect(() => { controller.current = new AbortController(); return () => controller.current.abort(); }, []);
  const submit = async deleting => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await api(`/meals/${encodeURIComponent(meal.id)}`, { method: deleting ? 'DELETE' : 'PATCH', body: deleting ? undefined : { foods, eaten_at: inputToISO(eatenAt) }, signal: controller.current.signal });
      if (deleting) onDelete(meal.id); else onSaved(result.meal);
    } catch (err) { if (!isCancelled(err)) setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <Sheet title="식사 기록 고치기" eyebrow={meal.source === 'ai' ? 'AI 음식 인식 후 저장한 기록' : '직접 확인한 음식 기록'} onClose={onClose} busy={busy}>
    {meal.photo && <div className="meal-photo-preview"><img src={meal.photo} alt="저장한 식사 사진"/></div>}
    <FoodChips foods={foods} setFoods={setFoods} disabled={busy}/><label className="field">먹은 시각 · 한국 시각<input type="datetime-local" value={eatenAt} onChange={event => setEatenAt(event.target.value)} required disabled={busy}/></label>
    <ErrorMessage>{error}</ErrorMessage><button className="primary-button" onClick={() => submit(false)} disabled={busy || !foods.length || !eatenAt}>{busy ? '처리 중…' : '변경 내용 저장하기'}</button>
    {confirmDelete ? <div className="delete-confirm"><p>이 식사 기록을 지울까요? 삭제한 기록은 되돌릴 수 없어요.</p><div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>취소</button><button className="danger-button" disabled={busy} onClick={() => submit(true)}>기록 삭제</button></div></div> : <button className="text-button danger centered" onClick={() => setConfirmDelete(true)}>식사 기록 삭제</button>}
  </Sheet>;
}
