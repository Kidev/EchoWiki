import '../index.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hasAssets, getMeta } from '../lib/idb';
import type { EchoMeta } from '../lib/idb';

export const Splash = () => {
  const [imported, setImported] = useState(false);
  const [meta, setMeta] = useState<EchoMeta | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const check = async () => {
      const has = await hasAssets();
      setImported(has);
      if (has) {
        const m = await getMeta();
        setMeta(m ?? null);
      }
      setReady(true);
    };
    void check();
  }, []);

  if (!ready) return null;

  return (
    <div className="flex relative flex-col justify-center items-center min-h-screen gap-4">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-bold text-center text-gray-900">EchoWiki</h1>
        <p className="text-sm text-gray-500">Hey {context.username ?? 'user'}</p>
      </div>

      {imported && meta ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span>{meta.assetCount.toLocaleString()} echoes loaded</span>
          </div>
          {meta.gameTitle && <p className="text-xs text-gray-400">{meta.gameTitle}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No game assets imported yet</p>
      )}

      <button
        className="flex items-center justify-center bg-[#d93900] text-white w-auto h-10 rounded-full cursor-pointer transition-colors px-6 font-medium"
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'app')}
      >
        {imported ? 'Browse Echoes' : 'Import Game Files'}
      </button>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
