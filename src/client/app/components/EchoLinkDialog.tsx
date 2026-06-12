export function EchoLinkDialog({
  subredditName,
  input,
  error,
  onInputChange,
  onGo,
  onDismiss,
  currentPageLink,
  onCopyLink,
}: {
  subredditName: string;
  input: string;
  error: string | null;
  onInputChange: (v: string) => void;
  onGo: () => void;
  onDismiss: () => void;
  currentPageLink?: string | undefined;
  onCopyLink?: ((link: string) => void) | undefined;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onDismiss}
    >
      <div
        className="bg-[var(--bg)] rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-[var(--text)] mb-1">Open EchoLink</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Paste an{" "}
          <span className="font-mono text-xs">
            echolink://r/{subredditName}/...
          </span>{" "}
          to jump to a wiki page or tab, or an{" "}
          <span className="font-mono text-xs">echo://...</span> to open an
          asset.
        </p>
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={`echolink://r/${subredditName}/wiki/page`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") onGo();
            if (e.key === "Escape") onDismiss();
          }}
          className="w-full text-sm px-3 py-2 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] mb-3 font-mono"
        />
        {error !== null && <p className="text-xs text-red-500 mb-3">{error}</p>}
        {currentPageLink && (
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">
              This page
            </p>
            <button
              type="button"
              onClick={() => onCopyLink?.(currentPageLink)}
              title="Copy this page's EchoLink"
              className="group w-full flex items-center gap-2 text-left text-xs px-3 py-2 rounded border border-gray-300 bg-[var(--control-bg)] hover:border-[var(--accent)] transition-colors cursor-pointer"
            >
              <span className="font-mono text-[var(--control-text)] truncate flex-1">
                {currentPageLink}
              </span>
              <svg
                className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent)]"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
                <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onDismiss}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onGo}
            className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}
