import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Icon } from './UI';
import './BottomNav.css';

// One marker stays mounted while the page track moves underneath it. Updating
// this tiny element directly avoids re-rendering every mounted page per frame.
const BottomNav = forwardRef(function BottomNav({ items, activeId, onNavigate, followScroll = false, pageOffset = 0 }, ref) {
  const cursor = useRef(null);
  const firstPaint = useRef(true);
  const latest = useRef({ items, activeId, followScroll, pageOffset });
  latest.current = { items, activeId, followScroll, pageOffset };

  const position = (index, followsPage) => {
    const element = cursor.current;
    if (!element || !Number.isFinite(index)) return;
    const last = Math.max(0, latest.current.items.length - 1);
    const bounded = Math.min(last, Math.max(0, index));
    element.dataset.follow = followsPage ? 'true' : 'false';
    element.style.transform = `translate3d(${bounded * 100}%,0,0)`;
    // The camera is before Home and deliberately has no bottom navigation tab.
    element.style.opacity = String(Math.min(1, Math.max(0, index + 1)));
  };

  useImperativeHandle(ref, () => ({
    setPageProgress(pagePosition) {
      if (latest.current.followScroll) position(pagePosition - latest.current.pageOffset, true);
    },
  }), []);

  useLayoutEffect(() => {
    // With a pager attached, actual scroll progress owns the marker; switching
    // React's active label ahead of a smooth scroll must not teleport it.
    if (firstPaint.current || !followScroll) {
      position(items.findIndex(item => item.id === activeId), firstPaint.current);
    }
    firstPaint.current = false;
  }, [activeId, followScroll, items]);

  return <nav className="bottom-nav fluid-bottom-nav" aria-label="주 메뉴">
    <span className="bottom-nav-track" aria-hidden="true">
      <span className="bottom-nav-cursor" ref={cursor} style={{ width: `${100 / Math.max(1, items.length)}%` }}><span/></span>
    </span>
    {items.map(item => <button
      key={item.id}
      type="button"
      className={activeId === item.id ? 'active' : ''}
      aria-current={activeId === item.id ? 'page' : undefined}
      onClick={() => onNavigate(item.id)}
    ><Icon name={item.id}/><span>{item.label}</span></button>)}
  </nav>;
});

export default BottomNav;
