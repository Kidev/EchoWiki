export function EchoLinkDialog({
  subredditName,
  input,
  error,
  onInputChange,
  onGo,
  onDismiss,
}: {
  subredditName: string;
  input: string;
  error: string | null;
  onInputChange: (v: string) => void;
  onGo: () => void;
  onDismiss: () => void;
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
          Paste an <span className="font-mono text-xs">echolink://r/{subredditName}/…</span> to jump
          to a wiki page or tab, or an <span className="font-mono text-xs">echo://…</span> to open
          an asset.
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
