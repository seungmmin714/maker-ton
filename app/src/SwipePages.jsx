import React, { Children, useEffect, useLayoutEffect, useRef } from 'react';
import './SwipePages.css';

const SETTLE_DELAY = 140;
const interactive = 'input,textarea,select,button,a,summary,[contenteditable="true"],[role="slider"]';

// Let the browser handle gesture direction, momentum and snapping. Keeping each
// pane mounted also preserves its vertical position and any unfinished form.
export default function SwipePages({ items, activeId, onNavigate, disabled = false, children }) {
  const viewport = useRef(null);
  const latest = useRef({ items, activeId, onNavigate, disabled });
  latest.current = { items, activeId, onNavigate, disabled };
  const target = useRef(null);
  const timer = useRef(null);
  const touching = useRef(false);
  const initialized = useRef(false);
  const lastNotified = useRef(activeId);
  const widths = useRef(0);
  const pages = Children.toArray(children);
  const activeIndex = Math.max(0, items.findIndex(item => item.id === activeId));
  const itemIds = items.map(item => item.id).join('|');

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    lastNotified.current = activeId;
    clearTimeout(timer.current);
    const left = activeIndex * element.clientWidth;
    const immediate = !initialized.current || disabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    initialized.current = true;
    target.current = Math.abs(element.scrollLeft - left) > 1 ? activeId : null;
    element.scrollTo({ left, behavior: immediate ? 'instant' : 'smooth' });

    // A keyboard tab click retains focus on the tab. Only relocate focus when
    // it would otherwise remain inside a pane that just became inert.
    const focusedPane = document.activeElement?.closest('[data-swipe-page]');
    if (focusedPane && element.contains(focusedPane) && focusedPane.dataset.swipePage !== activeId) {
      element.children[activeIndex]?.focus({ preventScroll: true });
    }
  }, [activeId, activeIndex, itemIds, disabled]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let resizeFrame;
    const currentIndex = () => Math.max(0, latest.current.items.findIndex(item => item.id === latest.current.activeId));
    const align = () => {
      const width = element.clientWidth;
      if (!width || width === widths.current) return;
      widths.current = width;
      clearTimeout(timer.current);
      target.current = null;
      touching.current = false;
      element.scrollTo({ left: currentIndex() * width, behavior: 'instant' });
    };
    const schedule = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(settle, SETTLE_DELAY);
    };
    const settle = () => {
      if (touching.current) return;
      const { items: currentItems, activeId: currentId, disabled: locked, onNavigate: navigate } = latest.current;
      const width = element.clientWidth;
      if (!width) return;
      if (locked) {
        target.current = null;
        element.scrollTo({ left: currentIndex() * width, behavior: 'instant' });
        return;
      }
      // Ignore all intermediate pages while a tab click animates to its target.
      if (target.current !== null) {
        const destination = currentItems.findIndex(item => item.id === target.current);
        if (destination >= 0 && Math.abs(element.scrollLeft - destination * width) > 2) return;
        target.current = null;
        return;
      }
      const index = Math.min(currentItems.length - 1, Math.max(0, Math.round(element.scrollLeft / width)));
      const id = currentItems[index]?.id;
      if (id && id !== currentId && id !== lastNotified.current) {
        lastNotified.current = id;
        navigate(id);
      }
    };
    const scroll = event => {
      if (event.target === element) schedule();
    };
    const start = () => {
      if (latest.current.disabled) return;
      touching.current = true;
      target.current = null;
      clearTimeout(timer.current);
    };
    const end = () => {
      touching.current = false;
      schedule();
    };
    const wheel = event => {
      if (!latest.current.disabled && Math.abs(event.deltaX) > Math.abs(event.deltaY)) target.current = null;
    };
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(align);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element);
    align();
    element.addEventListener('scroll', scroll, { passive: true });
    element.addEventListener('scrollend', settle, { passive: true });
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchend', end, { passive: true });
    element.addEventListener('touchcancel', end, { passive: true });
    element.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    return () => {
      clearTimeout(timer.current);
      cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('scrollend', settle);
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end);
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const keyDown = event => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey || event.target.closest(interactive)) return;
    const next = event.key === 'ArrowRight' ? activeIndex + 1 : event.key === 'ArrowLeft' ? activeIndex - 1 : null;
    if (next === null || !items[next]) return;
    event.preventDefault();
    onNavigate(items[next].id);
  };

  return <div className="swipe-pages" ref={viewport} data-disabled={disabled || undefined} onKeyDown={keyDown}>
    {items.map((item, index) => <section
      key={item.id}
      className="swipe-page"
      data-swipe-page={item.id}
      aria-label={item.label}
      aria-hidden={item.id !== activeId || undefined}
      inert={item.id !== activeId ? '' : undefined}
      tabIndex={item.id === activeId ? 0 : -1}
    ><div className="main-content">{pages[index]}</div></section>)}
  </div>;
}
