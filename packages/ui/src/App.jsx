import React, { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { subscribeStatus } from './api/lightStream';
import SceneGrid from './components/switcher/SceneGrid';
import Editor from './components/editor/Editor';

function parseHash() {
  // Scene ids are 8-char hex for new scenes, but migrated presets keep
  // their old shortid ids, which can include _ and - (e.g. HJ_f5ckwf).
  const m = window.location.hash.match(/^#\/edit\/([\w-]+)/);
  return m ? { view: 'editor', sceneId: m[1] } : { view: 'switcher' };
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
  const [wsConnected, setWsConnected] = useState(false);
  const loaded = useStore((s) => s.loaded);
  const init = useStore((s) => s.init);

  useEffect(() => {
    init();
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    const unsub = subscribeStatus(setWsConnected);
    return () => {
      window.removeEventListener('hashchange', onHash);
      unsub();
    };
  }, [init]);

  function openEditor(sceneId) {
    window.location.hash = `#/edit/${sceneId}`;
  }

  function closeEditor() {
    window.location.hash = '';
  }

  return (
    <div className="app">
      <header className="app-header">
        <button className="app-title" onClick={closeEditor} aria-label="Back to scenes">
          Lightpanel
        </button>
        <span
          className={`ws-dot${wsConnected ? ' ws-dot--on' : ''}`}
          title={wsConnected ? 'Live preview connected' : 'Live preview disconnected'}
        />
      </header>
      {!loaded ? (
        <div className="app-loading">Connecting…</div>
      ) : route.view === 'editor' ? (
        <Editor sceneId={route.sceneId} onClose={closeEditor} />
      ) : (
        <SceneGrid onEdit={openEditor} />
      )}
    </div>
  );
}
