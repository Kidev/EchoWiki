export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  isDanger,
  onConfirm,
  onDismiss,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  isDanger?: boolean | undefined;
  onConfirm: () => void;
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
        <h3 className="font-semibold text-[var(--text)] mb-2">{title}</h3>
        <p className="text-sm text-[var(--text-muted)] mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onDismiss}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer"
          >
            Keep editing
          </button>
          <button
            onClick={onConfirm}
            className={`text-sm px-3 py-1.5 rounded text-white transition-opacity cursor-pointer ${
              isDanger === true
                ? "bg-red-500 hover:opacity-90"
                : "bg-[var(--accent)] hover:opacity-90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WikiSaveDialog({
  reason,
  onReasonChange,
  onConfirm,
  onDismiss,
  isSaving,
  error,
  voteOnSave,
  createVote,
  onCreateVoteChange,
}: {
  reason: string;
  onReasonChange: (r: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  isSaving: boolean;
  error: string | null;
  voteOnSave?: boolean | undefined;
  createVote?: boolean | undefined;
  onCreateVoteChange?: ((v: boolean) => void) | undefined;
}) {
  const isVoteMode = voteOnSave && createVote;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onDismiss}
    >
      <div
        className="bg-[var(--bg)] rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-[var(--text)] mb-1">
          {isVoteMode ? "Submit vote suggestion" : "Save changes"}
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {isVoteMode
            ? "Describe the changes you're proposing for the vote."
            : "Summarize your edit for the revision history."}
        </p>
        {voteOnSave && onCreateVoteChange && (
          <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!(createVote ?? true)}
              onChange={(e) => onCreateVoteChange(!e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text)]">Bypass public vote</span>
          </label>
        )}
        <input
          type="text"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={isVoteMode ? "Describe your changes…" : "Reason for edit…"}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isSaving && reason.trim()) onConfirm();
          }}
          className="w-full text-sm px-3 py-2 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] mb-3"
        />
        {error !== null && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onDismiss}
            disabled={isSaving}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSaving || !reason.trim()}
            className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
          >
            {isSaving
              ? isVoteMode
                ? "Submitting…"
                : "Saving…"
              : isVoteMode
                ? "Submit vote"
                : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WikiSuggestDialog({
  description,
  onDescriptionChange,
  onConfirm,
  onDismiss,
  isSaving,
  error,
}: {
  description: string;
  onDescriptionChange: (d: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  isSaving: boolean;
  error: string | null;
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
        <h3 className="font-semibold text-[var(--text)] mb-1">Submit suggestion</h3>
        <p className="text-sm text-[var(--text-muted)] mb-1">
          Describe your changes so moderators can understand what you&apos;re suggesting.
        </p>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          If updating an existing suggestion, describe <strong>all</strong> changes made, not just
          the latest.
        </p>
        <input
          type="text"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Description of changes (min. 10 chars)…"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isSaving && description.trim().length >= 10) onConfirm();
          }}
          className="w-full text-sm px-3 py-2 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] mb-1"
        />
        {description.trim().length > 0 && description.trim().length < 10 && (
          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            {10 - description.trim().length} more character
            {10 - description.trim().length !== 1 ? "s" : ""} needed
          </p>
        )}
        {error !== null && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onDismiss}
            disabled={isSaving}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSaving || description.trim().length < 10}
            className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
          >
            {isSaving ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WikiExistingSuggestionDialog({
  existingPage,
  onSee,
  onDelete,
  onCancel,
  isDeleting,
}: {
  existingPage: string;
  onSee: () => void;
  onDelete: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}) {
  const pageLabel = existingPage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="bg-[var(--bg)] rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-[var(--text)] mb-1">Already have a suggestion</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          You already have a pending suggestion on{" "}
          <span className="font-medium text-[var(--text)]">{pageLabel}</span>. You can only have one
          suggestion at a time.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onSee}
            className="text-sm px-3 py-2 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer text-left"
          >
            See current suggestion
          </button>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="text-sm px-3 py-2 rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 text-left"
          >
            {isDeleting ? "Deleting…" : "Delete current suggestion"}
          </button>
          <button
            onClick={onCancel}
            className="text-sm px-3 py-2 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer text-left"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
