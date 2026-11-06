import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <main style={{ maxWidth: 440, padding: 32, margin: '10vh auto', color: '#263b38', fontFamily: 'system-ui' }}>
        <h1>화면을 다시 불러올게요.</h1>
        <p>저장한 기록은 서버에 그대로 있어요. 다시 열어 주세요.</p>
        <button onClick={() => window.location.reload()} style={{ minHeight: 48, padding: '0 20px' }}>다시 열기</button>
      </main>
    );
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);

// Only the public application shell is cached; never cache API or health records.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
