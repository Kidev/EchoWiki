import { useState, useCallback, useMemo } from "react";
import {
  getStem,
  getSubfolder,
  groupLabel,
  detectGroupsForFolder,
  getAssignedGroup,
} from "../assetUtils";

export function ColorPickerRow({
  label,
  value,
  defaultValue,
  onSelect,
}: {
  label: string;
  value: string;
  defaultValue?: string | undefined;
  onSelect: (color: string) => void;
}) {
  const handleHexChange = useCallback(
    (hex: string) => {
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        onSelect(hex);
      }
    },
    [onSelect],
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{label}</span>
        {defaultValue && (
          <button
            onClick={() => onSelect(defaultValue)}
            disabled={value.toLowerCase() === defaultValue.toLowerCase()}
            className="text-sm leading-none cursor-pointer transition-colors disabled:opacity-20 disabled:cursor-default text-[var(--text-muted)] hover:text-[var(--text)] disabled:hover:text-[var(--text-muted)]"
            title={`Reset to default (${defaultValue})`}
          >
            &#x21ba;
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onSelect(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer border border-gray-200 p-0.5 flex-shrink-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => handleHexChange(e.target.value)}
          maxLength={7}
          className="w-20 text-xs font-mono px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
          style={{
            backgroundColor: "var(--control-bg)",
            color: "var(--control-text)",
          }}
        />
      </div>
    </div>
  );
}

export function parseMappingText(text: string): Array<[string, string]> {
  const cleaned = text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const pairRegex = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  const results: Array<[string, string]> = [];
  let match;
  while ((match = pairRegex.exec(cleaned)) !== null) {
    results.push([match[1]!.toLowerCase(), match[2]!.toLowerCase()]);
  }
  return results;
}

export function MappingPanel({
  mappingText,
  paths,
  onSave,
}: {
  mappingText: string;
  paths: readonly string[];
  onSave: (newText: string) => Promise<void>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draftText, setDraftText] = useState(mappingText);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const parsedEntries = useMemo(() => parseMappingText(mappingText), [mappingText]);

  const stemToGroup = useMemo(() => {
    const origToMapped = new Map<string, string>(parsedEntries);
    const folderToPaths = new Map<string, string[]>();
    for (const p of paths) {
      const folder = getSubfolder(p);
      if (folder) {
        const existing = folderToPaths.get(folder);
        if (existing) existing.push(p);
        else folderToPaths.set(folder, [p]);
      }
    }
    const result = new Map<string, string>();
    for (const [, folderPs] of folderToPaths) {
      const groups = detectGroupsForFolder(folderPs, (p) => {
        const origStem = getStem(p).toLowerCase();
        return origToMapped.get(origStem) ?? origStem;
      });
      if (groups.length === 0) continue;
      for (const p of folderPs) {
        const origStem = getStem(p).toLowerCase();
        const effectiveStem = origToMapped.get(origStem) ?? origStem;
        const group = getAssignedGroup(effectiveStem, groups);
        if (group) result.set(origStem, group);
      }
    }
    return result;
  }, [paths, parsedEntries]);

  const handleOpen = useCallback(() => {
    setDraftText(mappingText);
    setSaveStatus(null);
    setModalOpen(true);
  }, [mappingText]);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    setSaveStatus(null);
  }, []);

  const handleApply = useCallback(async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      await onSave(draftText);
      setSaveStatus({ ok: true, message: "Saved" });
      setModalOpen(false);
    } catch (err) {
      setSaveStatus({ ok: false, message: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }, [draftText, onSave]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0"
        style={{ backgroundColor: "var(--thumb-bg)" }}
      >
        <span className="text-xs text-[var(--text-muted)]">
          {parsedEntries.length} mapping{parsedEntries.length !== 1 ? "s" : ""}
        </span>
        <button
          className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)] text-white cursor-pointer hover:opacity-80 transition-opacity"
          onClick={handleOpen}
        >
          Update Mapping
        </button>
      </div>

      {}
      <div className="flex-1 overflow-auto" style={{ scrollbarGutter: "stable both-edges" }}>
        {parsedEntries.length > 0 ? (
          <table className="w-full table-fixed text-[11px]">
            <thead>
              <tr style={{ backgroundColor: "var(--thumb-bg)" }}>
                <th className="text-left px-2 py-1.5 font-medium text-[var(--text-muted)] w-[38%]">
                  Original
                </th>
                <th className="text-left px-2 py-1.5 font-medium text-[var(--text-muted)] w-[38%]">
                  Mapped To
                </th>
                <th className="text-left px-2 py-1.5 font-medium text-[var(--text-muted)] w-[24%]">
                  Group
                </th>
              </tr>
            </thead>
            <tbody>
              {parsedEntries.map(([key, val], i) => {
                const group = stemToGroup.get(key);
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-2 py-1 font-mono text-[var(--text)] overflow-hidden">
                      <span className="block truncate">{key}</span>
                    </td>
                    <td className="px-2 py-1 font-mono text-[var(--text)] overflow-hidden">
                      <span className="block truncate">{val}</span>
                    </td>
                    <td className="px-2 py-1 text-[var(--text-muted)] overflow-hidden">
                      <span className="block truncate">{group ? groupLabel(group) : ""}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-3 py-6 text-xs text-center text-[var(--text-muted)]">
            No mappings yet. Click "Update Mapping" to add.
          </p>
        )}
      </div>

      {}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={handleCancel}
        >
          <div
            className="flex flex-col w-full max-w-lg rounded-xl shadow-2xl overflow-hidden"
            style={{ backgroundColor: "var(--bg)", maxHeight: "75vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <span className="text-sm font-medium text-[var(--text)]">Update Mapping</span>
              <button
                className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                onClick={handleCancel}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {}
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              spellCheck={false}
              autoFocus
              placeholder={`// Map original filenames to custom names\n"actor1": "hero_sprite"\n"dungeon_a1": "cave_tileset"`}
              className="flex-1 min-h-0 w-full text-sm font-mono px-3 py-2 focus:outline-none resize-none"
              style={{
                backgroundColor: "var(--control-bg)",
                color: "var(--text)",
                minHeight: "240px",
              }}
            />

            {}
            <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 flex-shrink-0">
              <span className="text-[10px] text-[var(--text-muted)] flex-1 leading-tight">
                Groups are computed locally from your asset filenames.
              </span>
              {saveStatus && (
                <span
                  className={`text-xs flex-shrink-0 ${saveStatus.ok ? "text-green-600" : "text-red-500"}`}
                >
                  {saveStatus.message}
                </span>
              )}
              <button
                onClick={handleCancel}
                className="text-xs px-3 py-1.5 rounded-full cursor-pointer text-[var(--text-muted)] flex-shrink-0"
                style={{ backgroundColor: "var(--thumb-bg)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleApply()}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded-full bg-[var(--accent)] text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {saving ? "Saving…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
