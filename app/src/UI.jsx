import React, { useEffect, useId, useRef } from 'react';

const paths = {
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />,
  records: <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
  meals: <path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M20 21V3c-5 3-6 10 0 10"/>,
  report: <path d="M4 20h17M7 16v-5M12 16V5M17 16V9"/>,
  camera: <><path d="M8 6 10 3h4l2 3h4a2 2 0 0 1 2 2v11H2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12" r="4"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>, close: <path d="m6 6 12 12M6 18 18-12"/>,
  check: <path d="m5 12 4 4L19 6"/>, plus: <path d="M12 5v14M5 12h14"/>,
  nfc: <><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 5h4M10 18h4M3 8c-2 2-2 6 0 8M21 8c2 2 2 6 0 8"/></>,
  wifi: <><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  leaf: <path d="M20 3C7 2 2 8 5 15s16 6 15-12ZM4 21 15 10"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/></>,
  album: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
  flip: <path d="M3 8a9 9 0 0 1 15-3l3 3M21 3v5h-5M21 16A9 9 0 0 1 6 19l-3-3M3 21v-5h5"/>,
  flash: <path d="m13 2-8 12h6l-1 8 9-13h-7Z"/>,
  logout: <path d="M9 3H4v18h5M10 12h11m-5-5 5 5-5 5"/>,
  shield: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/></>,
  arrow: <path d="M19 12H5m6-6-6 6 6 6"/>,
};
export function Icon({ name, size = 22, ...props }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.info}</svg>; }
export function Logo() { return <span className="logo"><img src="/assets/logo_mark.svg" alt=""/><span><b>변</b>한신호</span></span>; }
export function Badge({ demo = false, children }) { return <span className={`badge ${demo ? 'demo-badge' : ''}`}>{demo && <span className="badge-dot"/>}{children || (demo ? '예시 데이터' : '')}</span>; }
export function Note({ children, warning = false }) { return <div className={`note ${warning ? 'warning' : ''}`}><Icon name="info" size={17}/><div>{children}</div></div>; }
export function MedicalNote() { return <p className="medical-note">생활 습관을 돌아보는 참고 기록이에요. 진단이 아니에요.</p>; }
export function ErrorMessage({ children, onRetry }) { if (!children) return null; return <div className="error-message" role="alert"><span>{children}</span>{onRetry && <button type="button" className="text-button" onClick={onRetry}>다시 시도</button>}</div>; }
export function Empty({ title, description, action, icon = 'records' }) { return <div className="empty"><span className="empty-icon"><Icon name={icon} size={28}/></span><h3>{title}</h3><p>{description}</p>{action}</div>; }

export function Sheet({ title, eyebrow, onClose, children, wide = false, busy = false }) {
  const titleId = useId(); const ref = useRef(null); const closeRef = useRef(onClose); const busyRef = useRef(busy);
  closeRef.current = onClose; busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement; const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; const root = ref.current;
    const appContent = document.querySelector('.app-content'); appContent?.setAttribute('inert', '');
    const focusables = () => [...root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(el => !el.hidden && el.getClientRects().length);
    (root.querySelector('[data-autofocus]') || root.querySelector('.sheet-close') || root).focus();
    const keydown = event => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const list = focusables();
        if (!list.length) { event.preventDefault(); root.focus(); }
        else if (event.shiftKey && (document.activeElement === list[0] || document.activeElement === root)) { event.preventDefault(); list.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === list.at(-1)) { event.preventDefault(); list[0].focus(); }
      }
    };
    root.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; appContent?.removeAttribute('inert'); root.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="sheet-overlay" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className={`sheet ${wide ? 'sheet-wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="sheet-handle"/><div className="sheet-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button sheet-close" aria-label="닫기" onClick={onClose} disabled={busy}><Icon name="close"/></button></div>{children}</section></div>;
}
export const SHAPES = ['작고 딱딱한 알갱이', '울퉁불퉁하게 뭉친 모양', '표면이 갈라진 긴 모양', '매끈하고 부드러운 모양', '작고 부드러운 덩어리', '풀어지고 묽은 모양', '덩어리 없이 물 같은 모양'];
export function ShapeArt({ value, size = 54 }) {
  const drawings = [
    <><circle cx="14" cy="13" r="5"/><circle cx="30" cy="11" r="5"/><circle cx="23" cy="26" r="5"/><circle cx="43" cy="23" r="5"/></>,
    <path d="M11 18c-3-6 4-11 9-7 1-7 10-8 12-2 6-6 14-1 12 5 9 1 8 10 2 12-2 8-11 7-13 2-4 6-12 3-12-2-6 5-13-1-10-8Z"/>,
    <><path d="M9 23C7 12 22 9 42 10c13 0 13 15 1 16-16-1-24 8-30 3-2-1-3-3-4-6Z"/><path d="m22 13 2 6-4 6m15-13-3 7 4 6" fill="none" stroke="#e3d3bc"/></>,
    <><path d="M9 22C8 11 23 9 43 10c12 0 12 15 0 16-15-1-23 8-30 3-2-1-4-4-4-7Z"/><path d="M17 17c5-3 12-3 20-3" fill="none" stroke="#d5c1a5"/></>,
    <path d="M8 12c3-6 13-5 14 1s-2 12-9 10-8-6-5-11Zm27-3c4-5 15-1 14 6s-11 6-15 2-3-5 1-8ZM23 25c5-6 13-4 14 1s-6 8-12 7-6-5-2-8Z"/>,
    <path d="m7 19 6-5-1-6 9 2 4-5 5 7 8-5 4 8 10 3-5 8-9-1-3 6-7-5-8 5-2-7-9 2Z"/>,
    <path d="M7 15c5-4 10 4 15 0s10-4 15 0 10 4 15 0M7 23c5-4 10 4 15 0s10-4 15 0 10 4 15 0" fill="none" strokeWidth="3"/>,
  ];
  return <svg width={size} height={size * 2 / 3} viewBox="0 0 60 40" fill="#ad926f" stroke="#a58663" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawings[value - 1] || <text x="30" y="28" textAnchor="middle" stroke="none" fontSize="25">?</text>}</svg>;
}
export const time = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '미측정';
export const day = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value)) : '';
export const dateKey = value => value ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '';
export const duration = seconds => seconds == null ? '미측정' : seconds < 60 ? `${Math.round(seconds)}초` : `${Math.floor(seconds / 60)}분${seconds % 60 >= 1 ? ` ${Math.floor(seconds % 60)}초` : ''}`;
export const relative = (value, now = Date.now()) => { const sec = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000)); return sec < 60 ? '방금 전' : `${Math.floor(sec / 60)}분 전`; };
export const localInput = value => { const date = new Date(value || Date.now()); return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 16); };
export const inputToISO = value => new Date(`${value}:00+09:00`).toISOString();
export const shapeLabel = record => record.excretion_type === 'urine' ? '소변만 기록' : record.shape ? `${record.shape}형 · ${SHAPES[record.shape - 1]}` : '모양을 모르겠어요';
export const colorLabel = color => ({ brown: '갈색', dark_brown: '진한 갈색', yellow: '노란빛', green: '초록빛', black: '검은색', red: '붉은빛', pale: '회백색', gray_white: '회백색', gray: '회백색', white: '회백색', clear: '맑음', pale_yellow: '옅은 노랑', dark_yellow: '진한 노랑' }[color] || color || '미측정');
