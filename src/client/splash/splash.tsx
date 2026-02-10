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

  return (
    <div
      className="flex relative flex-col justify-center items-center min-h-screen gap-4"
      style={{ backgroundColor: '#1a1a2e', color: '#ffffff' }}
    >
      <div className="relative flex flex-col items-center">
        <img src="/loading.webp" alt="" width={300} height={300} />
        <img
          src="/title.png"
          alt="EchoWiki"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-50 object-contain z-1"
        />
      </div>

      {ready && (
        <>
          <p className="text-sm" style={{ color: '#677db7' }}>
            Hey {context.username ?? 'user'}
          </p>

          {imported && meta ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2 text-sm text-green-400">
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
              {meta.gameTitle && (
                <p className="text-xs" style={{ color: '#677db7' }}>
                  {meta.gameTitle}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#677db7' }}>
              No game assets imported yet
            </p>
          )}

          <button
            className="flex items-center justify-center text-white w-auto h-10 rounded-full cursor-pointer transition-all px-6 font-medium hover:scale-105 hover:font-bold hover:border-2 hover:border-white"
            style={{ backgroundColor: '#6a5cff' }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'app')}
          >
            {imported ? 'Browse Echoes' : 'Import Game Files'}
          </button>
        </>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
