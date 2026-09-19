import React, { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { subscribeStatus } from './api/lightStream';
import SceneGrid from './components/switcher/SceneGrid';
import Editor from './components/editor/Editor';
import BrightnessSlider from './components/switcher/BrightnessSlider';
import FrameRate from './components/switcher/FrameRate';
import PowerMeter from './components/switcher/PowerMeter';
import SettingsPage from './components/settings/SettingsPage';
import ErrorBoundary from './components/ErrorBoundary';
import WriteError from './components/WriteError';

function parseHash() {
  if (/^#\/settings/.test(window.location.hash)) return { view: 'settings' };
  // Scene ids are 8-char hex for new scenes, but some older scenes carry
  // shortid ids, which can include _ and - (e.g. HJ_f5ckwf).
  const m = window.location.hash.match(/^#\/edit\/([\w-]+)/);
  return m ? { view: 'editor', sceneId: m[1] } : { view: 'switcher' };
}

// Inline rather than an icon dependency, and an SVG rather than U+2699:
// the gear codepoint renders as a colour emoji on iOS and macOS, which this
// runs on from the Home Screen.
function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round"
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"
      />
      <path
        fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round"
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </svg>
  );
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
  const [wsConnected, setWsConnected] = useState(false);
  const loaded = useStore((s) => s.loaded);
  const initError = useStore((s) => s.initError);
  const init = useStore((s) => s.init);

  // The WebSocket reconnecting is the best signal there is that the server is
  // back — it lives in the same process — so a failed first load retries on
  // it rather than waiting for someone to find the button. Guarded by the
  // store's state, not this closure's: the socket reconnects for its own
  // reasons long after the load has succeeded.
  useEffect(() => {
    init();
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    const unsub = subscribeStatus((connected) => {
      setWsConnected(connected);
      if (connected && useStore.getState().initError) init();
    });
    return () => {
      window.removeEventListener('hashchange', onHash);
      unsub();
    };
  }, [init]);

  function openEditor(sceneId) {
    window.location.hash = `#/edit/${sceneId}`;
  }

  function goHome() {
    window.location.hash = '';
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-brand">
          <button type="button" className="app-title" onClick={goHome} aria-label="Back to scenes">
            Lightpanel
          </button>
          <span
            className={`ws-dot${wsConnected ? ' ws-dot--on' : ''}`}
            title={wsConnected ? 'Live preview connected' : 'Live preview disconnected'}
          />
        </div>
        {loaded && (
          <div className="app-header-readouts">
            <PowerMeter />
            <FrameRate />
          </div>
        )}
        {loaded && <BrightnessSlider />}
        {loaded && (
          <button
            type="button"
            className={`settings-link${route.view === 'settings' ? ' settings-link--on' : ''}`}
            onClick={() => { window.location.hash = '#/settings'; }}
            aria-label="Settings"
            aria-current={route.view === 'settings' ? 'page' : undefined}
            title="Settings"
          >
            <CogIcon />
          </button>
        )}
      </header>
      {loaded && <WriteError />}
      {!loaded ? (
        initError ? (
          <div className="app-failure" role="alert">
            <p className="app-failure-title">Can't reach the light panel.</p>
            <p className="app-failure-detail">
              {initError}. This retries by itself when the panel's live preview reconnects.
            </p>
            <button type="button" className="btn" onClick={() => init()}>Try again</button>
          </div>
        ) : (
          <div className="app-loading">Connecting…</div>
        )
      ) : (
        <ErrorBoundary resetKey={`${route.view}/${route.sceneId || ''}`} onHome={goHome}>
          {route.view === 'editor' ? (
            <Editor sceneId={route.sceneId} onClose={goHome} />
          ) : route.view === 'settings' ? (
            <SettingsPage onClose={goHome} />
          ) : (
            <SceneGrid onEdit={openEditor} />
          )}
        </ErrorBoundary>
      )}
    </div>
  );
}
