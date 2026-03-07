import {
  type CSSProperties,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AdvancedContributorRequest,
  AdvancedContributorResponse,
  CardSize,
  CollabInfoResponse,
  ColorTheme,
  EngineType,
  ErrorResponse,
  FlairTemplateInfo,
  FontFamily,
  GameConfig,
  HomeBackground,
  HomeLogo,
  MappingResponse,
  StyleConfig,
  StyleResponse,
  SubredditAppearance,
  SuggestionFlairRequest,
  WikiBanRequest,
  WikiFontSize,
} from "../../../shared/types/api";
import { darkenHex } from "../appTypes";
import { ColorPickerRow, MappingPanel, parseMappingText } from "./MappingPanel";
import { SegmentedControl } from "./AssetBrowser";

type SettingsTab = "general" | "game" | "style" | "theme" | "mapping" | "collaborative" | "voting";

function CollaborativePanel({
  config,
  onConfigChanged,
}: {
  config: GameConfig;
  onConfigChanged: (config: GameConfig) => void;
}) {
  const collaborativeMode = config.collaborativeMode;
  const [isTogglingMode, setIsTogglingMode] = useState(false);

  const [minKarmaField, setMinKarmaField] = useState(String(config.minKarma));
  const [minAgeDaysField, setMinAgeDaysField] = useState(String(config.minAccountAgeDays));
  const [editCooldownField, setEditCooldownField] = useState(
    String(config.suggestionEditCooldownMinutes),
  );
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);
  const thresholdsDirty =
    minKarmaField !== String(config.minKarma) ||
    minAgeDaysField !== String(config.minAccountAgeDays) ||
    editCooldownField !== String(config.suggestionEditCooldownMinutes);

  const [flairTemplateId, setFlairTemplateId] = useState<string | null>(null);
  const [flairTemplates, setFlairTemplates] = useState<FlairTemplateInfo[]>([]);
  const [isSavingFlair, setIsSavingFlair] = useState(false);

  const [advCountField, setAdvCountField] = useState("0");
  const [advFlairTemplateId, setAdvFlairTemplateId] = useState<string | null>(null);
  const [savedAdvCount, setSavedAdvCount] = useState("0");
  const [savedAdvFlairTemplateId, setSavedAdvFlairTemplateId] = useState<string | null>(null);
  const [isSavingAdv, setIsSavingAdv] = useState(false);

  const [banned, setBanned] = useState<string[]>([]);
  const [banInput, setBanInput] = useState("");
  const [isBanning, setIsBanning] = useState(false);
  const [banError, setBanError] = useState<string | null>(null);

  const [loadingInfo, setLoadingInfo] = useState(false);

  const loadCollabInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const res = await fetch("/api/wiki/collab-info");
      if (res.ok) {
        const data: CollabInfoResponse = await res.json();
        setBanned(data.banned);
        setFlairTemplateId(data.flairTemplateId);
        setFlairTemplates(data.flairTemplates);
        setAdvCountField(String(data.advancedContributorCount));
        setAdvFlairTemplateId(data.advancedContributorFlairTemplateId);
        setSavedAdvCount(String(data.advancedContributorCount));
        setSavedAdvFlairTemplateId(data.advancedContributorFlairTemplateId);
      }
    } catch {
    } finally {
      setLoadingInfo(false);
    }
  }, []);

  useEffect(() => {
    void loadCollabInfo();
  }, [loadCollabInfo]);

  const handleToggleMode = useCallback(async () => {
    setIsTogglingMode(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collaborativeMode: !collaborativeMode }),
      });
      if (res.ok) {
        onConfigChanged({ ...config, collaborativeMode: !collaborativeMode });
      }
    } catch {
    } finally {
      setIsTogglingMode(false);
    }
  }, [collaborativeMode, config, onConfigChanged]);

  const handleSaveThresholds = useCallback(async () => {
    const minKarma = Math.max(0, parseInt(minKarmaField, 10) || 0);
    const minAccountAgeDays = Math.max(0, parseInt(minAgeDaysField, 10) || 0);
    const suggestionEditCooldownMinutes = Math.max(0, parseInt(editCooldownField, 10) || 0);
    setIsSavingThresholds(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minKarma, minAccountAgeDays, suggestionEditCooldownMinutes }),
      });
      if (res.ok) {
        setMinKarmaField(String(minKarma));
        setMinAgeDaysField(String(minAccountAgeDays));
        setEditCooldownField(String(suggestionEditCooldownMinutes));
        onConfigChanged({ ...config, minKarma, minAccountAgeDays, suggestionEditCooldownMinutes });
      }
    } catch {
    } finally {
      setIsSavingThresholds(false);
    }
  }, [minKarmaField, minAgeDaysField, editCooldownField, config, onConfigChanged]);

  const handleFlairChange = useCallback(async (templateId: string | null) => {
    setIsSavingFlair(true);
    try {
      const body: SuggestionFlairRequest = { flairTemplateId: templateId };
      const res = await fetch("/api/wiki/suggestion-flair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setFlairTemplateId(templateId);
      }
    } catch {
    } finally {
      setIsSavingFlair(false);
    }
  }, []);

  const handleSaveAdvanced = useCallback(async () => {
    const count = Math.max(0, parseInt(advCountField, 10) || 0);
    setIsSavingAdv(true);
    try {
      const body: AdvancedContributorRequest = {
        count,
        flairTemplateId: advFlairTemplateId,
      };
      const res = await fetch("/api/wiki/advanced-contributor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data: AdvancedContributorResponse = await res.json();
        setAdvCountField(String(data.count));
        setAdvFlairTemplateId(data.flairTemplateId);
        setSavedAdvCount(String(data.count));
        setSavedAdvFlairTemplateId(data.flairTemplateId);
      }
    } catch {
    } finally {
      setIsSavingAdv(false);
    }
  }, [advCountField, advFlairTemplateId]);

  const handleBan = useCallback(async () => {
    const username = banInput.trim().replace(/^u\//, "");
    if (!username) return;
    setBanError(null);
    setIsBanning(true);
    try {
      const body: WikiBanRequest = { username };
      const res = await fetch("/api/wiki/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setBanned((prev) => (prev.includes(username) ? prev : [...prev, username]));
        setBanInput("");
      } else {
        const err = (await res.json()) as ErrorResponse;
        setBanError(err.message ?? "Failed to ban user");
      }
    } catch {
      setBanError("Network error");
    } finally {
      setIsBanning(false);
    }
  }, [banInput]);

  const handleUnban = useCallback(async (username: string) => {
    try {
      const body: WikiBanRequest = { username };
      await fetch("/api/wiki/ban", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setBanned((prev) => prev.filter((u) => u !== username));
    } catch {}
  }, []);

  const inputCls =
    "text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)] disabled:opacity-50";
  const inputStyle = { backgroundColor: "var(--control-bg)", color: "var(--control-text)" };

  return (
    <div className="flex flex-col gap-3 max-w-lg">
      {}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium">Collaborative editing</span>
          <span className="text-[10px] text-[var(--text-muted)]">
            Community members suggest changes; mods approve before they go live
          </span>
        </div>
        <button
          onClick={() => void handleToggleMode()}
          disabled={isTogglingMode}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
            collaborativeMode ? "bg-[var(--accent)]" : "bg-gray-300"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              collaborativeMode ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {collaborativeMode && (
        <>
          <div className="border-t border-gray-100" />

          {}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Eligibility
            </span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] w-20 shrink-0">Min. karma</label>
              <input
                type="number"
                min="0"
                value={minKarmaField}
                onChange={(e) => setMinKarmaField(e.target.value)}
                placeholder="0"
                className={`${inputCls} w-20`}
                style={inputStyle}
              />
              <label className="text-xs text-[var(--text-muted)] w-24 shrink-0 ml-2">
                Min. age (days)
              </label>
              <input
                type="number"
                min="0"
                value={minAgeDaysField}
                onChange={(e) => setMinAgeDaysField(e.target.value)}
                placeholder="0"
                className={`${inputCls} w-20`}
                style={inputStyle}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] w-20 shrink-0">
                Edit cooldown
              </label>
              <input
                type="number"
                min="0"
                value={editCooldownField}
                onChange={(e) => setEditCooldownField(e.target.value)}
                placeholder="0"
                className={`${inputCls} w-20`}
                style={inputStyle}
              />
              <span className="text-xs text-[var(--text-muted)] shrink-0">min between edits</span>
              <button
                onClick={() => void handleSaveThresholds()}
                disabled={!thresholdsDirty || isSavingThresholds}
                className="ml-auto text-xs px-2.5 py-1 rounded-full bg-[var(--accent)] text-white cursor-pointer disabled:opacity-30 shrink-0"
              >
                {isSavingThresholds ? "Saving…" : "Apply"}
              </button>
            </div>
          </div>

          {}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Contributor flair
            </span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] w-20 shrink-0">On accept</label>
              <select
                value={flairTemplateId ?? ""}
                onChange={(e) => void handleFlairChange(e.target.value || null)}
                disabled={isSavingFlair || loadingInfo}
                className={`${inputCls} flex-1`}
                style={inputStyle}
              >
                <option value="">No flair</option>
                {flairTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.text || "(no label)"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Advanced contributor flair
            </span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] w-20 shrink-0">After</label>
              <input
                type="number"
                min="0"
                value={advCountField}
                onChange={(e) => setAdvCountField(e.target.value)}
                placeholder="0"
                className={`${inputCls} w-16`}
                style={inputStyle}
              />
              <span className="text-xs text-[var(--text-muted)] shrink-0">accepted</span>
              <select
                value={advFlairTemplateId ?? ""}
                onChange={(e) => setAdvFlairTemplateId(e.target.value || null)}
                disabled={loadingInfo}
                className={`${inputCls} flex-1`}
                style={inputStyle}
              >
                <option value="">No flair</option>
                {flairTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.text || "(no label)"}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleSaveAdvanced()}
                disabled={
                  (advCountField === savedAdvCount &&
                    advFlairTemplateId === savedAdvFlairTemplateId) ||
                  isSavingAdv
                }
                className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)] text-white cursor-pointer disabled:opacity-30 shrink-0"
              >
                {isSavingAdv ? "Saving…" : "Apply"}
              </button>
            </div>
          </div>

          {}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Banned editors{banned.length > 0 ? ` (${banned.length})` : ""}
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={banInput}
                onChange={(e) => {
                  setBanInput(e.target.value);
                  setBanError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleBan();
                }}
                placeholder="username"
                className={`${inputCls} flex-1`}
                style={inputStyle}
              />
              <button
                onClick={() => void handleBan()}
                disabled={isBanning || !banInput.trim()}
                className="text-xs px-3 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-40 shrink-0"
              >
                {isBanning ? "Banning…" : "Ban"}
              </button>
            </div>
            {banError && <span className="text-xs text-red-500">{banError}</span>}
            {banned.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {banned.map((u) => (
                  <div
                    key={u}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border border-gray-200"
                    style={{ backgroundColor: "var(--control-bg)" }}
                  >
                    <span className="text-[var(--text)]">u/{u}</span>
                    <button
                      onClick={() => void handleUnban(u)}
                      className="text-[var(--text-muted)] hover:text-red-500 transition-colors cursor-pointer leading-none"
                      title="Unban"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function VotingSettingsPanel({
  config,
  onConfigChanged,
  onDirtyChange,
  saveRef,
}: {
  config: GameConfig;
  onConfigChanged: (config: GameConfig) => void;
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: MutableRefObject<(() => Promise<void>) | null>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [votingEnabled, setVotingEnabled] = useState(config.votingEnabled);
  const [acceptThreshold, setAcceptThreshold] = useState(String(config.votingAcceptThreshold));
  const [rejectThreshold, setRejectThreshold] = useState(String(config.votingRejectThreshold));
  const [percentThreshold, setPercentThreshold] = useState(String(config.votingPercentThreshold));
  const [durationDays, setDurationDays] = useState(String(config.votingDurationDays));
  const [minVoters, setMinVoters] = useState(String(config.votingMinVotersForTiming));
  const [allowVoteChange, setAllowVoteChange] = useState(config.votingAllowVoteChange);
  const [changeCooldown, setChangeCooldown] = useState(String(config.votingChangeCooldownMinutes));
  const [showVoterNames, setShowVoterNames] = useState(config.votingShowVoterNames);
  const [voterMinKarma, setVoterMinKarma] = useState(String(config.votingVoterMinKarma));
  const [voterMinAge, setVoterMinAge] = useState(String(config.votingVoterMinAccountAgeDays));
  const [maxEdits, setMaxEdits] = useState(String(config.votingMaxSuggestionEdits));
  const [postTitle, setPostTitle] = useState(config.votingPostTitle);
  const [flairTemplateId, setFlairTemplateId] = useState<string | null>(
    config.votingFlairTemplateId,
  );
  const [linkFlairTemplates, setLinkFlairTemplates] = useState<FlairTemplateInfo[]>([]);

  useEffect(() => {
    void fetch("/api/wiki/collab-info")
      .then((r) => r.json())
      .then((d: CollabInfoResponse) => {
        setLinkFlairTemplates(d.linkFlairTemplates ?? []);
      })
      .catch(() => {});
  }, []);

  const votingDirty = useMemo(
    () =>
      votingEnabled !== config.votingEnabled ||
      acceptThreshold !== String(config.votingAcceptThreshold) ||
      rejectThreshold !== String(config.votingRejectThreshold) ||
      percentThreshold !== String(config.votingPercentThreshold) ||
      durationDays !== String(config.votingDurationDays) ||
      minVoters !== String(config.votingMinVotersForTiming) ||
      allowVoteChange !== config.votingAllowVoteChange ||
      changeCooldown !== String(config.votingChangeCooldownMinutes) ||
      showVoterNames !== config.votingShowVoterNames ||
      voterMinKarma !== String(config.votingVoterMinKarma) ||
      voterMinAge !== String(config.votingVoterMinAccountAgeDays) ||
      maxEdits !== String(config.votingMaxSuggestionEdits) ||
      postTitle !== config.votingPostTitle ||
      flairTemplateId !== config.votingFlairTemplateId,
    [
      votingEnabled,
      acceptThreshold,
      rejectThreshold,
      percentThreshold,
      durationDays,
      minVoters,
      allowVoteChange,
      changeCooldown,
      showVoterNames,
      voterMinKarma,
      voterMinAge,
      maxEdits,
      postTitle,
      flairTemplateId,
      config,
    ],
  );

  useEffect(() => {
    onDirtyChange?.(votingDirty);
  }, [votingDirty, onDirtyChange]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          votingEnabled,
          votingAcceptThreshold: Math.max(0, parseInt(acceptThreshold, 10) || 0),
          votingRejectThreshold: Math.max(0, parseInt(rejectThreshold, 10) || 0),
          votingPercentThreshold: Math.min(100, Math.max(0, parseInt(percentThreshold, 10) || 0)),
          votingDurationDays: Math.max(0, parseInt(durationDays, 10) || 0),
          votingMinVotersForTiming: Math.max(0, parseInt(minVoters, 10) || 0),
          votingAllowVoteChange: allowVoteChange,
          votingChangeCooldownMinutes: Math.max(0, parseInt(changeCooldown, 10) || 0),
          votingShowVoterNames: showVoterNames,
          votingVoterMinKarma: Math.max(0, parseInt(voterMinKarma, 10) || 0),
          votingVoterMinAccountAgeDays: Math.max(0, parseInt(voterMinAge, 10) || 0),
          votingMaxSuggestionEdits: Math.max(0, parseInt(maxEdits, 10) || 0),
          votingFlairTemplateId: flairTemplateId,
          votingPostTitle: postTitle.trim() || config.votingPostTitle,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { config: GameConfig };
        onConfigChanged(data.config);
      }
    } catch {
    } finally {
      setIsSaving(false);
    }
  }, [
    votingEnabled,
    acceptThreshold,
    rejectThreshold,
    percentThreshold,
    durationDays,
    minVoters,
    allowVoteChange,
    changeCooldown,
    showVoterNames,
    voterMinKarma,
    voterMinAge,
    maxEdits,
    postTitle,
    flairTemplateId,
    config.votingPostTitle,
    onConfigChanged,
  ]);

  useEffect(() => {
    if (saveRef) saveRef.current = handleSave;
  }, [saveRef, handleSave]);

  const inp =
    "w-full text-xs px-2 py-1 rounded border border-gray-200 focus:outline-none focus:border-[var(--accent)]";
  const numInp =
    "w-14 text-xs px-1.5 py-1 rounded border border-gray-200 focus:outline-none focus:border-[var(--accent)] text-center tabular-nums";
  const inpSt = { backgroundColor: "var(--control-bg)", color: "var(--control-text)" };
  const secHdr = "text-[10px] font-semibold uppercase tracking-wide mb-2";
  const secHdrSt = { color: "var(--text-muted)" };
  const Toggle = ({ val, set }: { val: boolean; set: (v: boolean) => void }) => (
    <button
      onClick={() => set(!val)}
      className={`relative shrink-0 w-8 h-4 rounded-full transition-colors cursor-pointer ${val ? "bg-[var(--accent)]" : "bg-gray-300"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${val ? "translate-x-4" : "translate-x-0"}`}
      />
    </button>
  );

  const divSt: CSSProperties = { borderColor: "var(--thumb-bg)" };

  return (
    <div className="text-xs" style={{ maxWidth: 680 }}>
      {}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b" style={divSt}>
        <div className="flex items-center gap-2">
          <span className="font-semibold">Public Voting</span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            each suggestion spawns a vote post
          </span>
          {!config.collaborativeMode && (
            <span className="text-amber-600 text-[10px]">: requires collaborative mode</span>
          )}
        </div>
        <Toggle val={votingEnabled} set={setVotingEnabled} />
      </div>

      {}
      <div className="flex border-b" style={divSt}>
        {}
        <div className="flex-1 px-3 py-2 border-r" style={divSt}>
          <p className={secHdr} style={secHdrSt}>
            Voter Eligibility
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5">
              <span className="w-10 shrink-0">Karma</span>
              <input
                type="number"
                min="0"
                value={voterMinKarma}
                onChange={(e) => setVoterMinKarma(e.target.value)}
                placeholder="0"
                className={numInp}
                style={inpSt}
              />
              <span style={{ color: "var(--text-muted)" }}>0=none</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="w-10 shrink-0">Age</span>
              <input
                type="number"
                min="0"
                value={voterMinAge}
                onChange={(e) => setVoterMinAge(e.target.value)}
                placeholder="0"
                className={numInp}
                style={inpSt}
              />
              <span style={{ color: "var(--text-muted)" }}>days, 0=none</span>
            </label>
          </div>
        </div>

        {}
        <div className="flex-1 px-3 py-2 border-r" style={divSt}>
          <p className={secHdr} style={secHdrSt}>
            Instant Thresholds <span className="font-normal normal-case">0=off</span>
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5">
              <span className="w-12 shrink-0">Accept</span>
              <input
                type="number"
                min="0"
                value={acceptThreshold}
                onChange={(e) => setAcceptThreshold(e.target.value)}
                className={numInp}
                style={inpSt}
              />
              <span>✓</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="w-12 shrink-0">Reject</span>
              <input
                type="number"
                min="0"
                value={rejectThreshold}
                onChange={(e) => setRejectThreshold(e.target.value)}
                className={numInp}
                style={inpSt}
              />
              <span>✗</span>
            </label>
          </div>
        </div>

        {}
        <div className="flex-1 px-3 py-2">
          <p className={secHdr} style={secHdrSt}>
            Timed Voting <span className="font-normal normal-case">0=off</span>
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                className={numInp}
                style={inpSt}
              />
              <span style={{ color: "var(--text-muted)" }}>days duration</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                value={minVoters}
                onChange={(e) => setMinVoters(e.target.value)}
                className={numInp}
                style={inpSt}
              />
              <span style={{ color: "var(--text-muted)" }}>min voters</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span>≥</span>
              <input
                type="number"
                min="0"
                max="100"
                value={percentThreshold}
                onChange={(e) => setPercentThreshold(e.target.value)}
                className={numInp}
                style={inpSt}
              />
              <span style={{ color: "var(--text-muted)" }}>% to accept · 0=majority</span>
            </label>
          </div>
        </div>
      </div>

      {}
      <div className="flex border-b" style={divSt}>
        {}
        <div className="flex-1 px-3 py-2 border-r" style={divSt}>
          <p className={secHdr} style={secHdrSt}>
            Vote Changes
          </p>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span>Allow changes</span>
              <Toggle val={allowVoteChange} set={setAllowVoteChange} />
            </div>
            {allowVoteChange && (
              <label className="flex items-center gap-1.5">
                <span className="shrink-0">Cooldown</span>
                <input
                  type="number"
                  min="0"
                  value={changeCooldown}
                  onChange={(e) => setChangeCooldown(e.target.value)}
                  className={numInp}
                  style={inpSt}
                />
                <span style={{ color: "var(--text-muted)" }}>min · 0=immed.</span>
              </label>
            )}
          </div>
        </div>

        {}
        <div className="flex-1 px-3 py-2 border-r" style={divSt}>
          <p className={secHdr} style={secHdrSt}>
            Display
          </p>
          <div className="flex items-center justify-between gap-2">
            <span>Show voter names</span>
            <Toggle val={showVoterNames} set={setShowVoterNames} />
          </div>
        </div>

        {}
        <div className="flex-1 px-3 py-2">
          <p className={secHdr} style={secHdrSt}>
            Suggestion Limits
          </p>
          <label className="flex items-center gap-1.5">
            <span className="shrink-0">Max updates</span>
            <input
              type="number"
              min="0"
              value={maxEdits}
              onChange={(e) => setMaxEdits(e.target.value)}
              className={numInp}
              style={inpSt}
            />
            <span style={{ color: "var(--text-muted)" }}>0=∞</span>
          </label>
        </div>
      </div>

      {}
      <div className="flex gap-3 px-3 py-2 border-b" style={divSt}>
        <div className="shrink-0" style={{ width: 160 }}>
          <label className="block mb-1" style={{ color: "var(--text-muted)" }}>
            Vote Post Flair
          </label>
          <select
            value={flairTemplateId ?? ""}
            onChange={(e) => setFlairTemplateId(e.target.value || null)}
            className={inp}
            style={inpSt}
          >
            <option value="">No flair</option>
            {linkFlairTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.text}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-0">
          <label className="block mb-1" style={{ color: "var(--text-muted)" }}>
            Vote Post Title{" "}
            <span className="text-[10px]">
              · <code>%user%</code> <code>%page%</code> <code>%pathPage%</code>{" "}
              <code>%shortPathPage%</code>
            </span>
          </label>
          <input
            type="text"
            value={postTitle}
            onChange={(e) => setPostTitle(e.target.value)}
            placeholder={config.votingPostTitle}
            className={inp}
            style={inpSt}
          />
        </div>
      </div>

      {}
      <div className="px-3 py-2">
        <button
          onClick={() => void handleSave()}
          disabled={!votingDirty || isSaving}
          className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white cursor-pointer disabled:opacity-30 hover:opacity-90 transition-opacity"
        >
          {isSaving ? "Saving…" : "Apply"}
        </button>
      </div>
    </div>
  );
}

export function SettingsView({
  mappingText,
  style,
  config,
  appearance,
  subredditName,
  paths,
  onMappingSaved,
  onStyleChanged,
  onConfigChanged,
}: {
  mappingText: string;
  style: StyleConfig;
  config: GameConfig;
  appearance: SubredditAppearance;
  subredditName: string;
  paths: readonly string[];
  onMappingSaved: (text: string, mapping: Record<string, string> | null) => void;
  onStyleChanged: (style: StyleConfig) => void;
  onConfigChanged: (config: GameConfig) => void;
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [editingMode, setEditingMode] = useState<"light" | "dark">("light");
  const [gameTitle, setGameTitle] = useState(config.gameName);
  const [wikiTitleField, setWikiTitleField] = useState(config.wikiTitle);
  const [wikiDescriptionField, setWikiDescriptionField] = useState(config.wikiDescription);
  const [homeBackground, setHomeBackground] = useState<HomeBackground>(config.homeBackground);
  const [homeLogo, setHomeLogo] = useState<HomeLogo>(config.homeLogo);
  const [engineField, setEngineField] = useState<EngineType>(config.engine);
  const [encryptionKeyField, setEncryptionKeyField] = useState(config.encryptionKey);
  const [savingConfig, setSavingConfig] = useState(false);
  const [votingPanelDirty, setVotingPanelDirty] = useState(false);
  const votingSaveRef = useRef<(() => Promise<void>) | null>(null);

  const isTcoaalDetected = useMemo(() => {
    const t = gameTitle.toLowerCase();
    return t.includes("coffin") && t.includes("andy") && t.includes("leyley");
  }, [gameTitle]);

  useEffect(() => {
    if (isTcoaalDetected) {
      setEngineField("tcoaal");
      setEncryptionKeyField("");
    }
  }, [isTcoaalDetected]);

  const editingColors = editingMode === "light" ? style.light : style.dark;

  const configDirty =
    gameTitle !== config.gameName ||
    wikiTitleField !== config.wikiTitle ||
    wikiDescriptionField !== config.wikiDescription ||
    homeBackground !== config.homeBackground ||
    homeLogo !== config.homeLogo ||
    engineField !== config.engine ||
    encryptionKeyField !== config.encryptionKey;

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameName: gameTitle,
          wikiTitle: wikiTitleField,
          wikiDescription: wikiDescriptionField,
          homeBackground,
          homeLogo,
          engine: engineField,
          encryptionKey: encryptionKeyField,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { config: GameConfig };
        onConfigChanged(data.config);
      }
    } catch {
    } finally {
      setSavingConfig(false);
    }
  }, [
    gameTitle,
    wikiTitleField,
    wikiDescriptionField,
    homeBackground,
    homeLogo,
    engineField,
    encryptionKeyField,
    onConfigChanged,
  ]);

  const handleSaveMappingCallback = useCallback(
    async (newText: string) => {
      const entries = parseMappingText(newText);
      const res = await fetch("/api/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: newText,
          entries: entries.length > 0 ? entries : undefined,
        }),
      });
      if (res.ok) {
        const data: MappingResponse = await res.json();
        onMappingSaved(data.text, data.mapping);
      } else {
        const err = (await res.json()) as { message?: string };
        throw new Error(err.message ?? "Save failed");
      }
    },
    [onMappingSaved],
  );

  const saveStyle = useCallback(
    async (update: Record<string, string>) => {
      try {
        const res = await fetch("/api/style", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
        if (res.ok) {
          const data: StyleResponse = await res.json();
          onStyleChanged(data.style);
        }
      } catch {}
    },
    [onStyleChanged],
  );

  const saveColor = useCallback(
    (field: string, value: string) => {
      void saveStyle({ mode: editingMode, [field]: value });
    },
    [saveStyle, editingMode],
  );

  const anyDirty = configDirty || votingPanelDirty;

  const handleSaveAll = useCallback(async () => {
    if (configDirty) void handleSaveConfig();
    if (votingPanelDirty) void votingSaveRef.current?.();
  }, [configDirty, handleSaveConfig, votingPanelDirty]);

  const defaultColors = useMemo(() => {
    const accent = appearance.keyColor ?? "#d93900";
    const bg = appearance.bgColor ?? "#ffffff";
    const highlight = appearance.highlightColor ?? darkenHex(bg, 0.05);
    const light: ColorTheme = {
      accentColor: accent,
      linkColor: accent,
      bgColor: bg,
      textColor: "#f3f3f3",
      textMuted: "#919191",
      thumbBgColor: highlight,
      controlBgColor: highlight,
      controlTextColor: "#f3f3f3",
    };
    const darkAccent = appearance.keyColor ?? "#ff6b3d";
    const dark: ColorTheme = {
      accentColor: darkAccent,
      linkColor: darkAccent,
      bgColor: appearance.bgColor ?? "#1a1a1b",
      textColor: "#f3f3f3",
      textMuted: "#919191",
      thumbBgColor: appearance.highlightColor ?? "#343536",
      controlBgColor: appearance.highlightColor ?? "#343536",
      controlTextColor: "#f3f3f3",
    };
    return { light, dark };
  }, [appearance]);

  const editingDefaults = editingMode === "light" ? defaultColors.light : defaultColors.dark;

  const SETTINGS_TABS: readonly { value: SettingsTab; label: string }[] = [
    { value: "general", label: "General" },
    { value: "game", label: "Game" },
    { value: "style", label: "Style" },
    { value: "theme", label: "Theme" },
    { value: "mapping", label: "Mapping" },
    { value: "collaborative", label: "Collaborative" },
    { value: "voting", label: "Voting" },
  ] as const;

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <div className="flex gap-1">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.value}
              className={`text-xs px-[10px] py-[4px] rounded-full transition-colors cursor-pointer ${
                settingsTab === tab.value
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)]"
              }`}
              style={settingsTab !== tab.value ? { backgroundColor: "transparent" } : undefined}
              onMouseEnter={(e) => {
                if (settingsTab !== tab.value)
                  e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
              }}
              onMouseLeave={(e) => {
                if (settingsTab !== tab.value)
                  e.currentTarget.style.backgroundColor = "transparent";
              }}
              onClick={() => setSettingsTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void handleSaveAll()}
          disabled={!anyDirty || savingConfig}
          className="text-xs px-[10px] py-[4px] rounded-full bg-[var(--accent)] text-white transition-colors cursor-pointer disabled:opacity-30"
        >
          {savingConfig ? "Saving..." : "Save"}
        </button>
      </div>

      <div
        className={`flex-1 ${settingsTab === "mapping" ? "overflow-hidden flex flex-col" : "overflow-auto px-4 py-4"}`}
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        {settingsTab === "general" && (
          <div className="flex flex-col gap-4 max-w-lg">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Wiki Title</span>
              <input
                type="text"
                value={wikiTitleField}
                onChange={(e) => setWikiTitleField(e.target.value)}
                placeholder={`WIKI r/${subredditName}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                style={{
                  backgroundColor: "var(--control-bg)",
                  color: "var(--control-text)",
                }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Displayed on the home screen below the logo. Leave empty for default.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Wiki Description</span>
              <input
                type="text"
                value={wikiDescriptionField}
                onChange={(e) => setWikiDescriptionField(e.target.value)}
                placeholder="A short description shown on the home screen"
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                style={{
                  backgroundColor: "var(--control-bg)",
                  color: "var(--control-text)",
                }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Displayed on the home screen below the title.
              </span>
            </div>
          </div>
        )}

        {settingsTab === "game" && (
          <div className="flex flex-col gap-4 max-w-lg">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Game Title</span>
              <input
                type="text"
                value={gameTitle}
                onChange={(e) => setGameTitle(e.target.value)}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                style={{
                  backgroundColor: "var(--control-bg)",
                  color: "var(--control-text)",
                }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Shown to users on import. Warns if imported game doesn't match.
              </span>
            </div>

            {gameTitle.length > 0 && (
              <>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium">Engine</span>
                  <select
                    value={engineField}
                    onChange={(e) => setEngineField(e.target.value as EngineType)}
                    disabled={isTcoaalDetected}
                    className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)] disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--control-bg)",
                      color: "var(--control-text)",
                    }}
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="rm2k3">RPG Maker 2003</option>
                    <option value="rmxp">RPG Maker XP</option>
                    <option value="rmvx">RPG Maker VX</option>
                    <option value="rmvxace">RPG Maker VX Ace</option>
                    <option value="rmmv">RPG Maker MV</option>
                    <option value="rmmv-encrypted">RPG Maker MV (Encrypted)</option>
                    <option value="rmmz">RPG Maker MZ</option>
                    <option value="rmmz-encrypted">RPG Maker MZ (Encrypted)</option>
                    <option value="tcoaal">TCOAAL</option>
                  </select>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {isTcoaalDetected
                      ? "Auto-detected from game title."
                      : "Override the engine auto-detection. Leave on Auto-detect if unsure."}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium">Encryption Key</span>
                  <input
                    type="text"
                    value={encryptionKeyField}
                    onChange={(e) => setEncryptionKeyField(e.target.value)}
                    disabled={isTcoaalDetected}
                    placeholder="Leave empty for auto-detection"
                    className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)] disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--control-bg)",
                      color: "var(--control-text)",
                    }}
                  />
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {isTcoaalDetected
                      ? "TCOAAL does not use a user-provided key."
                      : "Override the encryption key used for decryption. Leave empty if unsure."}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {settingsTab === "style" && (
          <div className="flex flex-col gap-4 max-w-lg">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Home Background</span>
              <SegmentedControl
                value={homeBackground}
                options={[
                  { value: "ripple" as HomeBackground, label: "Ripple" },
                  ...(appearance.bannerUrl
                    ? [
                        { value: "banner" as HomeBackground, label: "Banner" },
                        { value: "both" as HomeBackground, label: "Both" },
                      ]
                    : []),
                  { value: "none" as HomeBackground, label: "None" },
                ]}
                onChange={setHomeBackground}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Background effect on the home/import screen.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Home Logo</span>
              <SegmentedControl
                value={homeLogo}
                options={[
                  { value: "echowiki" as HomeLogo, label: "EchoWiki" },
                  ...(appearance.iconUrl
                    ? [{ value: "subreddit" as HomeLogo, label: "Subreddit" }]
                    : []),
                ]}
                onChange={setHomeLogo}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Logo displayed on the home/import screen.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Font</span>
              <SegmentedControl
                value={style.fontFamily}
                options={[
                  { value: "system" as FontFamily, label: "System" },
                  { value: "serif" as FontFamily, label: "Serif" },
                  { value: "mono" as FontFamily, label: "Mono" },
                  { value: "subreddit" as FontFamily, label: "Subreddit" },
                ]}
                onChange={(v) => void saveStyle({ fontFamily: v })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Card Size</span>
              <SegmentedControl
                value={style.cardSize}
                options={[
                  { value: "compact" as CardSize, label: "Compact" },
                  { value: "normal" as CardSize, label: "Normal" },
                  { value: "large" as CardSize, label: "Large" },
                ]}
                onChange={(v) => void saveStyle({ cardSize: v })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Wiki Font Size</span>
              <SegmentedControl
                value={style.wikiFontSize}
                options={[
                  { value: "small" as WikiFontSize, label: "Small" },
                  { value: "normal" as WikiFontSize, label: "Normal" },
                  { value: "large" as WikiFontSize, label: "Large" },
                ]}
                onChange={(v) => void saveStyle({ wikiFontSize: v })}
              />
            </div>
          </div>
        )}

        {settingsTab === "theme" && (
          <div className="flex flex-col gap-4">
            <SegmentedControl
              value={editingMode}
              options={[
                { value: "light" as const, label: "Light" },
                { value: "dark" as const, label: "Dark" },
              ]}
              onChange={setEditingMode}
            />

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div className="flex flex-col gap-4">
                <ColorPickerRow
                  key={`accent-${editingMode}`}
                  label="Accent"
                  value={editingColors.accentColor}
                  defaultValue={editingDefaults.accentColor}
                  onSelect={(c) => saveColor("accentColor", c)}
                />
                <ColorPickerRow
                  key={`link-${editingMode}`}
                  label="Links"
                  value={editingColors.linkColor}
                  defaultValue={editingDefaults.linkColor}
                  onSelect={(c) => saveColor("linkColor", c)}
                />
                <ColorPickerRow
                  key={`text-${editingMode}`}
                  label="Text"
                  value={editingColors.textColor}
                  defaultValue={editingDefaults.textColor}
                  onSelect={(c) => saveColor("textColor", c)}
                />
                <ColorPickerRow
                  key={`muted-${editingMode}`}
                  label="Muted Text"
                  value={editingColors.textMuted}
                  defaultValue={editingDefaults.textMuted}
                  onSelect={(c) => saveColor("textMuted", c)}
                />
              </div>
              <div className="flex flex-col gap-4">
                <ColorPickerRow
                  key={`bg-${editingMode}`}
                  label="Background"
                  value={editingColors.bgColor}
                  defaultValue={editingDefaults.bgColor}
                  onSelect={(c) => saveColor("bgColor", c)}
                />
                <ColorPickerRow
                  key={`thumb-${editingMode}`}
                  label="Thumbnail Bg"
                  value={editingColors.thumbBgColor}
                  defaultValue={editingDefaults.thumbBgColor}
                  onSelect={(c) => saveColor("thumbBgColor", c)}
                />
                <ColorPickerRow
                  key={`control-bg-${editingMode}`}
                  label="Control Bg"
                  value={editingColors.controlBgColor}
                  defaultValue={editingDefaults.controlBgColor}
                  onSelect={(c) => saveColor("controlBgColor", c)}
                />
                <ColorPickerRow
                  key={`control-text-${editingMode}`}
                  label="Control Text"
                  value={editingColors.controlTextColor}
                  defaultValue={editingDefaults.controlTextColor}
                  onSelect={(c) => saveColor("controlTextColor", c)}
                />
              </div>
            </div>
          </div>
        )}

        {settingsTab === "mapping" && (
          <MappingPanel
            mappingText={mappingText}
            paths={paths}
            onSave={handleSaveMappingCallback}
          />
        )}

        {settingsTab === "collaborative" && (
          <CollaborativePanel config={config} onConfigChanged={onConfigChanged} />
        )}

        {settingsTab === "voting" && (
          <VotingSettingsPanel
            config={config}
            onConfigChanged={onConfigChanged}
            onDirtyChange={setVotingPanelDirty}
            saveRef={votingSaveRef}
          />
        )}
      </div>
    </>
  );
}
