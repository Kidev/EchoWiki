import {
  Fragment,
  lazy,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getWebViewMode,
  requestExpandedMode,
  exitExpandedMode,
  showToast,
} from "@devvit/web/client";
import type {
  ColorTheme,
  EquipFlairRequest,
  EquipFlairResponse,
  FlairTemplateInfo,
  GameConfig,
  InitResponse,
  MappingResponse,
  MyFlairsResponse,
  StyleConfig,
  StyleResponse,
  SubredditAppearance,
  VotingInitResponse,
  WikiPagesResponse,
  WikiResponse,
} from "../../shared/types/api";
import { hasAssets, getMeta, wipeAll, listAssetPaths, applyMapping } from "../lib/idb";
import { importGameFiles } from "../lib/decrypt/index";
import type { ImportProgress } from "../lib/decrypt/index";
import {
  revokeAllBlobUrls,
  setReverseMapping,
  preloadPaths,
  planPreload,
  areCached,
} from "../lib/echo";
import { parseEditions } from "../lib/editions";
import type { Edition } from "../lib/editions";
import type { EchoMeta } from "../lib/idb";
import {
  AppState,
  AppMode,
  ActiveTab,
  FilterType,
  PAGE_SIZE,
  INIT_PRELOAD_COUNT,
  DEFAULT_STYLE,
  DEFAULT_APPEARANCE,
  getFontFamily,
  darkenHex,
  hexToRgba,
} from "./appTypes";
import {
  isImagePath,
  isAudioPath,
  getFileName,
  getStem,
  getSubfolder,
  naturalSortKey,
  getAssignedGroup,
  detectGroupsForFolder,
} from "./assetUtils";
import { extractEchoPathsFromMarkdown } from "./echoRender";
import { EchoLinkDialog } from "./components/EchoLinkDialog";
import { parseEchoLink } from "./components/WikiMarkdownContent";
import { WikiView } from "./components/WikiView";
import { AssetCard, FilterTabs, SubFilterTabs } from "./components/AssetBrowser";
const AssetPreview = lazy(() =>
  import("./components/AssetPreview").then((m) => ({ default: m.AssetPreview })),
);
const VotingView = lazy(() => import("./components/VotingView"));
const SubmissionsPanel = lazy(() => import("./components/SubmissionsPanel"));
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((m) => ({ default: m.SettingsView })),
);

export const App = () => {
  const [appMode, setAppMode] = useState<AppMode>("main");
  const [votingData, setVotingData] = useState<VotingInitResponse | null>(null);
  const [appState, setAppState] = useState<AppState>("loading");
  const [activeTab, setActiveTab] = useState<ActiveTab>("wiki");
  const [subredditName, setSubredditName] = useState("");
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [modLevel, setModLevel] = useState<"config" | "wiki" | null>(null);
  const isMod = modLevel !== null;
  const isAllMod = modLevel === "config";
  const [canSuggest, setCanSuggest] = useState(false);
  const [username, setUsername] = useState("");
  const [postId, setPostId] = useState("");
  const [suggestionToLoad, setSuggestionToLoad] = useState<string | null>(null);
  const [meta, setMeta] = useState<EchoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [paths, setPaths] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterType>("images");
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [mappingText, setMappingText] = useState('"original_filename": "mapped_filename"');
  const [pathToMapped, setPathToMapped] = useState<Map<string, string>>(new Map());

  const [gameMismatch, setGameMismatch] = useState<{
    expected: string;
    detected: string;
  } | null>(null);
  const [mappingUpdateInfo, setMappingUpdateInfo] = useState<string | null>(null);
  const mappingRef = useRef<Record<string, string> | null>(null);
  const [style, setStyle] = useState<StyleConfig>({ ...DEFAULT_STYLE });
  const [appearance, setAppearance] = useState<SubredditAppearance>({ ...DEFAULT_APPEARANCE });
  const [initResolved, setInitResolved] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isReturningUser, setIsReturningUser] = useState<boolean | null>(null);
  const [isGameIndependent, setIsGameIndependent] = useState(false);
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const [readyToTransition, setReadyToTransition] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [isDark, setIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    mappingRef.current = mapping;
  }, [mapping]);

  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewInitialEditions, setPreviewInitialEditions] = useState<Edition[] | null>(null);

  const [wikiCurrentPage, setWikiCurrentPage] = useState("index");
  const [wikiPages, setWikiPages] = useState<string[]>([]);
  const [wikiTargetAnchor, setWikiTargetAnchor] = useState<string | null>(null);
  const [pendingEditPage, setPendingEditPage] = useState<string | null>(null);
  const [showEchoLinkDialog, setShowEchoLinkDialog] = useState(false);
  const [echoLinkInput, setEchoLinkInput] = useState("");
  const [echoLinkError, setEchoLinkError] = useState<string | null>(null);
  const [earnedFlairs, setEarnedFlairs] = useState<FlairTemplateInfo[]>([]);
  const [equippedFlairId, setEquippedFlairId] = useState<string | null>(null);
  const [showFlairDropdown, setShowFlairDropdown] = useState(false);
  const flairDropdownRef = useRef<HTMLDivElement>(null);
  const [assetsGridReady, setAssetsGridReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showBreadcrumb, setShowBreadcrumb] = useState(false);
  const [openBreadcrumbDropdown, setOpenBreadcrumbDropdown] = useState<number | null>(null);
  const breadcrumbBarRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const breadcrumbHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelBreadcrumbHide = useCallback(() => {
    if (breadcrumbHideTimerRef.current) {
      clearTimeout(breadcrumbHideTimerRef.current);
      breadcrumbHideTimerRef.current = null;
    }
  }, []);

  const scheduleBreadcrumbHide = useCallback(() => {
    if (breadcrumbHideTimerRef.current) clearTimeout(breadcrumbHideTimerRef.current);
    breadcrumbHideTimerRef.current = setTimeout(() => {
      breadcrumbHideTimerRef.current = null;
      setShowBreadcrumb(false);
      setOpenBreadcrumbDropdown(null);
    }, 1000);
  }, []);

  useEffect(
    () => () => {
      if (breadcrumbHideTimerRef.current) clearTimeout(breadcrumbHideTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleAppLeave = () => {
      if (breadcrumbHideTimerRef.current) {
        clearTimeout(breadcrumbHideTimerRef.current);
        breadcrumbHideTimerRef.current = null;
      }
      setShowBreadcrumb(false);
      setOpenBreadcrumbDropdown(null);
    };
    document.documentElement.addEventListener("mouseleave", handleAppLeave);
    return () => document.documentElement.removeEventListener("mouseleave", handleAppLeave);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/wiki/pages");
        if (res.ok) {
          const data: WikiPagesResponse = await res.json();
          setWikiPages(data.pages);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!canSuggest) return;
    void (async () => {
      try {
        const res = await fetch("/api/wiki/my-flairs");
        if (res.ok) {
          const data: MyFlairsResponse = await res.json();
          setEarnedFlairs(data.earned);
          setEquippedFlairId(data.equipped);
        }
      } catch {}
    })();
  }, [canSuggest]);

  useEffect(() => {
    if (!showFlairDropdown) return;
    const handler = (e: MouseEvent) => {
      if (flairDropdownRef.current && !flairDropdownRef.current.contains(e.target as Node)) {
        setShowFlairDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFlairDropdown]);

  const handleEquipFlair = useCallback(async (flairTemplateId: string | null) => {
    try {
      const body: EquipFlairRequest = { flairTemplateId };
      const res = await fetch("/api/wiki/equip-flair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data: EquipFlairResponse = await res.json();
        setEquippedFlairId(data.flairTemplateId);
        showToast(data.flairTemplateId ? "Flair equipped!" : "Flair removed");
      }
    } catch {}
    setShowFlairDropdown(false);
  }, []);

  useEffect(() => {
    if (openBreadcrumbDropdown === null) return;
    const handler = () => setOpenBreadcrumbDropdown(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openBreadcrumbDropdown]);

  const wikiBreadcrumbs = useMemo(() => {
    const parts = wikiCurrentPage.split("/");
    return parts.map((part, i) => {
      const pagePath = parts.slice(0, i + 1).join("/");
      const prefix = i > 0 ? parts.slice(0, i).join("/") + "/" : "";
      const siblings = wikiPages
        .filter((p) => {
          if (!p.startsWith(prefix)) return false;
          const rest = p.slice(prefix.length);
          return !rest.includes("/") && rest !== part;
        })
        .sort();
      return {
        label: part.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        page: pagePath,
        siblings,
      };
    });
  }, [wikiCurrentPage, wikiPages]);

  const handleBreadcrumbBarLeave = useCallback(
    (e: ReactMouseEvent) => {
      const topBar = topBarRef.current;
      const related = e.relatedTarget;
      if (topBar && related instanceof Node && topBar.contains(related)) {
        cancelBreadcrumbHide();
        return;
      }
      scheduleBreadcrumbHide();
    },
    [cancelBreadcrumbHide, scheduleBreadcrumbHide],
  );

  const colors: ColorTheme = isDark ? style.dark : style.light;

  const wikiTitle = useMemo(() => {
    if (config?.wikiTitle) return config.wikiTitle;
    if (subredditName) return `WIKI r/${subredditName}`;
    return "";
  }, [config?.wikiTitle, subredditName]);

  const cssVars = useMemo(
    () =>
      ({
        "--accent": colors.accentColor,
        "--accent-hover": darkenHex(colors.accentColor, 0.05),
        "--accent-ring": hexToRgba(colors.accentColor, 0.2),
        "--link-color": colors.linkColor,
        "--bg": colors.bgColor,
        "--text": colors.textColor,
        "--text-muted": colors.textMuted,
        "--thumb-bg": colors.thumbBgColor,
        "--control-bg": colors.controlBgColor,
        "--control-text": colors.controlTextColor,
      }) as CSSProperties,
    [
      colors.accentColor,
      colors.linkColor,
      colors.bgColor,
      colors.textColor,
      colors.textMuted,
      colors.thumbBgColor,
      colors.controlBgColor,
      colors.controlTextColor,
    ],
  );

  useEffect(() => {
    if (displayedProgress >= loadingProgress) return;
    const id = requestAnimationFrame(() => {
      setDisplayedProgress((prev) => {
        const diff = loadingProgress - prev;
        if (diff <= 0) return prev;
        const step = readyToTransition ? diff : Math.max(0.5, Math.min(diff * 0.15, 4));
        return Math.min(prev + step, loadingProgress);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [displayedProgress, loadingProgress, readyToTransition]);

  useEffect(() => {
    if (!readyToTransition || displayedProgress < 100) return;
    const id = setTimeout(() => {
      setReadyToTransition(false);
      setAppState("ready");
    }, 200);
    return () => clearTimeout(id);
  }, [readyToTransition, displayedProgress]);

  useEffect(() => {
    const init = async () => {
      const hasAssetsPromise = hasAssets();
      const stylePromise = fetch("/api/style").catch(() => null);
      let initConfig: GameConfig | null = null;

      try {
        const res = await fetch("/api/init");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as InitResponse | VotingInitResponse;
        if (data.type === "voting-init") {
          const vd = data as VotingInitResponse;
          setAppMode("voting");
          setVotingData(vd);
          setConfig(vd.config);
          setAppearance(vd.appearance);
          // Also apply the saved style if available
          try {
            const styleRes = await stylePromise;
            if (styleRes?.ok) {
              const styleData: StyleResponse = await styleRes.json();
              setStyle(styleData.style);
            }
          } catch {}
          setInitResolved(true);

          const contentEchoPaths = [
            ...extractEchoPathsFromMarkdown(vd.currentContent),
            ...extractEchoPathsFromMarkdown(vd.suggestion.content),
          ];
          const contentNeedsAssets = contentEchoPaths.length > 0;
          const imported = await hasAssetsPromise;
          if (contentNeedsAssets && !imported) {
            setAppState("no-assets");
            return;
          }

          if (imported) {
            try {
              const mappingRes = await fetch("/api/mapping").catch(() => null);
              if (mappingRes?.ok) {
                const mappingData: MappingResponse = await mappingRes.json();
                if (mappingData.mapping) {
                  const pathToMappedResult = await applyMapping(mappingData.mapping);
                  setPathToMapped(pathToMappedResult);
                  setReverseMapping(pathToMappedResult);
                }
              }
            } catch {}
            const uniqueEchoPaths = [...new Set(contentEchoPaths)];
            if (uniqueEchoPaths.length > 0) {
              setLoadingProgress(5);
              await preloadPaths(uniqueEchoPaths, (loaded) => {
                setLoadingProgress(5 + Math.round((loaded / uniqueEchoPaths.length) * 90));
              });
              setLoadingProgress(100);
              setReadyToTransition(true);
              return;
            }
          }
          setAppState("ready");
          return;
        }
        const initData = data as InitResponse;
        setSubredditName(initData.subredditName);
        setConfig(initData.config);
        setModLevel(initData.modLevel);
        setCanSuggest(initData.canSuggest);
        setUsername(initData.username);
        setPostId(initData.postId);
        try {
          const savedPage = localStorage.getItem(`echowiki:page:${initData.postId}`);
          if (savedPage) setWikiCurrentPage(savedPage);
        } catch {}
        setAppearance(initData.appearance);
        initConfig = initData.config;
      } catch (e) {
        if (e instanceof TypeError) {
          setInitResolved(true);
          setAppState("server-unavailable");
          return;
        }
      }

      try {
        const styleRes = await stylePromise;
        if (styleRes?.ok) {
          const data: StyleResponse = await styleRes.json();
          setStyle(data.style);
        }
      } catch {}

      const imported = await hasAssetsPromise;

      if (initConfig !== null && !initConfig.gameName) {
        setIsGameIndependent(true);
        setIsReturningUser(true);
        setInitResolved(true);
        setAppState("ready");
        return;
      }

      setIsReturningUser(imported);
      setInitResolved(true);

      if (imported) {
        setLoadingProgress(5);

        const mappingPromise = fetch("/api/mapping").catch(() => null);
        const wikiIndexPromise = fetch("/api/wiki?page=index").catch(() => null);

        const m = await getMeta();
        setMeta(m ?? null);
        const allPaths = await listAssetPaths();
        setPaths(allPaths);
        setLoadingProgress(12);

        let pathToMappedInit = new Map<string, string>();
        try {
          const mappingRes = await mappingPromise;
          if (mappingRes?.ok) {
            const data: MappingResponse = await mappingRes.json();
            setMapping(data.mapping);
            setMappingText(data.text);
            if (data.mapping) {
              const result = await applyMapping(data.mapping);
              pathToMappedInit = result;
              setPathToMapped(result);
              setReverseMapping(result);
            }
          }
        } catch {}
        setLoadingProgress(22);

        try {
          const wikiIndexRes = await wikiIndexPromise;
          if (wikiIndexRes?.ok) {
            const data: WikiResponse = await wikiIndexRes.json();
            if (data.content) {
              const echoPaths = extractEchoPathsFromMarkdown(data.content);
              const wikiN = planPreload(echoPaths);
              setLoadingProgress(25);
              if (wikiN > 0) {
                await preloadPaths(echoPaths, (loaded) => {
                  setLoadingProgress(25 + Math.round((loaded / wikiN) * 15));
                });
              }
            }
          }
        } catch {}
        setLoadingProgress(40);

        const sortedImages = allPaths
          .filter(isImagePath)
          .sort((a, b) =>
            naturalSortKey(a, pathToMappedInit).localeCompare(
              naturalSortKey(b, pathToMappedInit),
              undefined,
              { numeric: true, sensitivity: "base" },
            ),
          );
        const firstPage = sortedImages.slice(0, INIT_PRELOAD_COUNT);
        const assetsN = planPreload(firstPage);
        if (assetsN > 0) {
          await preloadPaths(firstPage, (loaded) => {
            setLoadingProgress(40 + Math.round((loaded / assetsN) * 58));
          });
        }
        setLoadingProgress(100);

        if (
          initConfig?.gameName &&
          m?.gameTitle &&
          initConfig.gameName.toLowerCase() !== m.gameTitle.toLowerCase()
        ) {
          setGameMismatch({ expected: initConfig.gameName, detected: m.gameTitle });
          setActiveTab("assets");
        }

        setReadyToTransition(true);
      } else {
        setAppState("no-assets");
      }
    };
    void init();
  }, []);

  const currentFolderGroups = useMemo(() => {
    if (!subFilter) return [];
    const folderPaths = paths.filter(
      (p) =>
        (filter === "images" ? isImagePath(p) : isAudioPath(p)) && getSubfolder(p) === subFilter,
    );
    return detectGroupsForFolder(folderPaths, (p) => getStem(pathToMapped.get(p) ?? p));
  }, [paths, filter, subFilter, pathToMapped]);

  const filteredPaths = useMemo(() => {
    let result = filter === "images" ? paths.filter(isImagePath) : paths.filter(isAudioPath);
    if (subFilter) {
      result = result.filter((p) => getSubfolder(p) === subFilter);
    }
    if (groupFilter) {
      const gf = groupFilter;
      result = result.filter((p) => {
        const stem = getStem(pathToMapped.get(p) ?? p).toLowerCase();
        return getAssignedGroup(stem, currentFolderGroups) === gf;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) => {
        if (p.includes(q)) return true;
        const mp = pathToMapped.get(p);
        if (mp && mp.includes(q)) return true;
        return false;
      });
    }
    return [...result].sort((a, b) =>
      naturalSortKey(a, pathToMapped).localeCompare(naturalSortKey(b, pathToMapped), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [paths, filter, subFilter, groupFilter, currentFolderGroups, search, pathToMapped]);

  const subcategories = useMemo(() => {
    const categoryPaths =
      filter === "images" ? paths.filter(isImagePath) : paths.filter(isAudioPath);

    const folderCounts = new Map<string, number>();
    for (const p of categoryPaths) {
      const folder = getSubfolder(p);
      if (folder) {
        folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
      }
    }
    return [...folderCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map(([name, count]) => ({ name, count }));
  }, [paths, filter]);

  useEffect(() => {
    setGroupFilter(null);
  }, [subFilter]);

  useEffect(() => {
    if (activeTab !== "assets") setGroupFilter(null);
  }, [activeTab]);

  const visiblePaths = filteredPaths.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPaths.length;

  useEffect(() => {
    if (subcategories.length > 0 && !subcategories.some((s) => s.name === subFilter)) {
      setSubFilter(subcategories[0]!.name);
    }
  }, [subcategories, subFilter]);

  useEffect(() => {
    if (appState !== "ready" || activeTab !== "assets") return;
    const imagePaths = visiblePaths.filter(isImagePath);
    if (imagePaths.length === 0 || areCached(imagePaths)) {
      setAssetsGridReady(true);
      return;
    }
    setAssetsGridReady(false);
    void preloadPaths(imagePaths).then(() => setAssetsGridReady(true));
  }, [appState, activeTab, visiblePaths]);

  const foldersWithGroups = useMemo(() => {
    const result = new Set<string>();
    for (const s of subcategories) {
      const folderPaths = paths.filter(
        (p) =>
          (filter === "images" ? isImagePath(p) : isAudioPath(p)) && getSubfolder(p) === s.name,
      );
      if (detectGroupsForFolder(folderPaths, (p) => getStem(pathToMapped.get(p) ?? p)).length > 0) {
        result.add(s.name);
      }
    }
    return result;
  }, [subcategories, paths, filter, pathToMapped]);

  const counts = useMemo(
    () => ({
      images: paths.filter(isImagePath).length,
      audio: paths.filter(isAudioPath).length,
    }),
    [paths],
  );

  const gridClass =
    style.cardSize === "compact"
      ? "grid-cols-[repeat(auto-fill,minmax(64px,1fr))]"
      : style.cardSize === "large"
        ? "grid-cols-[repeat(auto-fill,minmax(120px,1fr))]"
        : "grid-cols-[repeat(auto-fill,minmax(80px,1fr))]";

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;

      const files = Array.from(fileList);
      setAppState("importing");
      setError(null);
      setLoadingProgress(3);

      const controller = new AbortController();
      abortRef.current = controller;

      const mappingPromise = fetch("/api/mapping").catch(() => null);

      const wikiIndexPromise = fetch("/api/wiki?page=index").catch(() => null);

      const applyMappingFromPromise = async () => {
        try {
          const mappingRes = await mappingPromise;
          if (mappingRes?.ok) {
            const data: MappingResponse = await mappingRes.json();
            setMapping(data.mapping);
            setMappingText(data.text);
            if (data.mapping) {
              const result = await applyMapping(data.mapping);
              setPathToMapped(result);
              setReverseMapping(result);
            }
          }
        } catch {}
      };

      try {
        const progressRef: { current: ImportProgress | null } = {
          current: null,
        };
        await importGameFiles({
          files,
          engineOverride: config?.engine,
          keyOverride: config?.encryptionKey || undefined,
          onProgress: (p) => {
            progressRef.current = p;

            if (p.phase === "decrypting" && p.processed > 0) {
              const pct = Math.round(45 * (1 - Math.pow(0.92, p.processed / 20)));
              setLoadingProgress((prev) => Math.max(prev, pct));
            }

            if (p.phase === "storing" && p.total > 0) {
              const pct = 45 + Math.round((p.processed / p.total) * 45);
              setLoadingProgress((prev) => Math.max(prev, pct));
            }
          },
          signal: controller.signal,
        });
        setLoadingProgress(93);
        const m = await getMeta();
        setMeta(m ?? null);
        const allPaths = await listAssetPaths();
        setPaths(allPaths);
        setFilter("images");
        setSubFilter(null);
        setSearch("");
        setVisibleCount(PAGE_SIZE);

        await applyMappingFromPromise();

        try {
          const wikiIndexRes = await wikiIndexPromise;
          if (wikiIndexRes?.ok) {
            const data: WikiResponse = await wikiIndexRes.json();
            if (data.content) {
              const echoPaths = extractEchoPathsFromMarkdown(data.content);
              const wikiN = planPreload(echoPaths);
              if (wikiN > 0) {
                await preloadPaths(echoPaths, (loaded) => {
                  setLoadingProgress(93 + Math.round((loaded / wikiN) * 5));
                });
              }
            }
          }
        } catch {}
        setLoadingProgress(100);

        if (
          config?.gameName &&
          progressRef.current?.gameTitle &&
          config.gameName.toLowerCase() !== progressRef.current.gameTitle.toLowerCase()
        ) {
          setGameMismatch({
            expected: config.gameName,
            detected: progressRef.current.gameTitle,
          });
          setActiveTab("assets");
        }

        setAppState("ready");
      } catch (err) {
        if (err instanceof Error && err.message === "Import cancelled") {
          const still = await hasAssets();
          if (still) {
            const allPaths = await listAssetPaths();
            setPaths(allPaths);
            await applyMappingFromPromise();
            setAppState("ready");
          } else {
            setLoadingProgress(0);
            setDisplayedProgress(0);
            setReadyToTransition(false);
            setIsReturningUser(false);
            setAppState("no-assets");
          }
        } else {
          setError(err instanceof Error ? err.message : "Import failed");
          const still = await hasAssets();
          if (still) {
            const allPaths = await listAssetPaths();
            setPaths(allPaths);
            await applyMappingFromPromise();
            setAppState("ready");
          } else {
            setLoadingProgress(0);
            setDisplayedProgress(0);
            setReadyToTransition(false);
            setIsReturningUser(false);
            setAppState("no-assets");
          }
        }
      } finally {
        abortRef.current = null;
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [config],
  );

  const handleCopied = useCallback((_path: string) => {
    showToast("Copied echo link");
  }, []);

  const handleCopyEchoLink = useCallback((link: string) => {
    const container = document.querySelector("[data-wiki-scroll]") as HTMLElement | null;
    const savedTop = container?.scrollTop ?? 0;
    if (container && savedTop > 0) {
      requestAnimationFrame(() => {
        if (container.scrollTop === 0) container.scrollTop = savedTop;
      });
    }
    void navigator.clipboard.writeText(link).then(() => {
      if (container && container.scrollTop === 0 && savedTop > 0) container.scrollTop = savedTop;
      showToast("Copied echo link");
    });
  }, []);

  const handleAnchorConsumed = useCallback(() => setWikiTargetAnchor(null), []);

  const handleInlineEditRequest = useCallback(
    (e: MouseEvent) => {
      try {
        localStorage.setItem(`echowiki:editPage:${postId}`, wikiCurrentPage);
      } catch {}
      void requestExpandedMode(e, "app");
    },
    [postId, wikiCurrentPage],
  );

  const handleNavigateToSuggestion = useCallback((page: string, suggestionContent: string) => {
    setWikiCurrentPage(page);
    setSuggestionToLoad(suggestionContent);
    setActiveTab("wiki");
  }, []);

  const handleSuggestionLoaded = useCallback(() => {
    setSuggestionToLoad(null);
  }, []);

  const handleWipe = useCallback(async () => {
    revokeAllBlobUrls();
    await wipeAll();
    setMeta(null);
    setPaths([]);
    setFilter("images");
    setSubFilter(null);
    setSearch("");
    setPreviewInitialEditions(null);
    setVisibleCount(PAGE_SIZE);
    setMapping(null);
    setPathToMapped(new Map());
    setReverseMapping(null);
    setPreviewPath(null);
    setActiveTab("wiki");
    setGameMismatch(null);
    setLoadingProgress(0);
    setDisplayedProgress(0);
    setReadyToTransition(false);
    setIsReturningUser(false);
    setAppState("no-assets");
  }, []);

  const handleConfigChanged = useCallback(
    async (newConfig: GameConfig) => {
      const gameNameChanged = config?.gameName !== newConfig.gameName;
      setConfig(newConfig);

      if (!newConfig.collaborativeMode && activeTab === "submissions") {
        setActiveTab("wiki");
      }
      if (gameNameChanged) {
        await handleWipe();
        if (!newConfig.gameName) {
          setIsGameIndependent(true);
          setIsReturningUser(true);
          setAppState("ready");
        } else {
          setIsGameIndependent(false);
        }
      }
    },
    [config?.gameName, handleWipe, activeTab],
  );

  const handleMappingSaved = useCallback(
    (newText: string, newMapping: Record<string, string> | null) => {
      const oldMapping = mappingRef.current;

      setMappingText(newText);
      setMapping(newMapping);
      if (newMapping) {
        void applyMapping(newMapping).then((result) => {
          setPathToMapped(result);
          setReverseMapping(result);
        });
      } else {
        setPathToMapped(new Map());
        setReverseMapping(null);
      }

      const lostNames = new Map<string, string>();
      if (oldMapping) {
        for (const [originalKey, oldMappedValue] of Object.entries(oldMapping)) {
          if (newMapping?.[originalKey] !== oldMappedValue) {
            lostNames.set(oldMappedValue, originalKey);
          }
        }
      }

      if (lostNames.size > 0) {
        void (async () => {
          try {
            const pagesRes = await fetch("/api/wiki/pages");
            if (!pagesRes.ok) return;
            const pagesData: WikiPagesResponse = await pagesRes.json();
            let totalReplacements = 0;
            const updatedPages: string[] = [];

            for (const page of pagesData.pages) {
              const wikiRes = await fetch(`/api/wiki?page=${encodeURIComponent(page)}`);
              if (!wikiRes.ok) continue;
              const wikiData: WikiResponse = await wikiRes.json();
              if (!wikiData.content) continue;

              let content = wikiData.content;
              let changed = false;
              for (const [lostName, originalKey] of lostNames) {
                const escaped = lostName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const re = new RegExp(
                  `(echo://[^\\s)"]*?)${escaped}(\\.[a-zA-Z0-9]+(?:\\?[^\\s)"]*)?)`,
                  "gi",
                );
                const newContent = content.replace(re, `$1${originalKey}$2`);
                if (newContent !== content) {
                  const matches = content.match(re);
                  totalReplacements += matches?.length ?? 0;
                  content = newContent;
                  changed = true;
                }
              }

              if (changed) {
                const updateRes = await fetch("/api/wiki/update", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    page,
                    content,
                    reason: "EchoWiki: auto-replace stale mapped names",
                  }),
                });
                if (updateRes.ok) {
                  updatedPages.push(page);
                }
              }
            }

            if (updatedPages.length > 0) {
              setMappingUpdateInfo(
                `Updated ${totalReplacements} echo link${totalReplacements !== 1 ? "s" : ""} in ${updatedPages.join(", ")}`,
              );
            }
          } catch {}
        })();
      }
    },
    [],
  );

  const handleEchoLinkGo = useCallback(() => {
    let trimmed = echoLinkInput.trim();

    const mdMatch = /^!\[.*?\]\(((?:echo|echolink):\/\/[^)]+)\)$/.exec(trimmed);
    if (mdMatch?.[1]) trimmed = mdMatch[1];

    if (trimmed.startsWith("echo://")) {
      const echoPath = trimmed.slice("echo://".length).toLowerCase();
      const { basePath: rawBase, editions } = parseEditions(echoPath);
      let basePath = rawBase;
      if (!paths.includes(basePath)) {
        const inputFileName = getFileName(basePath).toLowerCase();
        let resolved: string | null = null;
        for (const [origPath, mappedName] of pathToMapped.entries()) {
          if (getFileName(mappedName).toLowerCase() === inputFileName) {
            resolved = origPath;
            break;
          }
        }
        if (!resolved) {
          setEchoLinkError("Asset not found in the loaded game files.");
          return;
        }
        basePath = resolved;
      }
      const newFilter: FilterType = isImagePath(basePath) ? "images" : "audio";
      const subfolder = getSubfolder(basePath);
      setShowEchoLinkDialog(false);
      setEchoLinkError(null);
      setActiveTab("assets");
      setFilter(newFilter);
      setSubFilter(subfolder);
      setSearch("");
      setVisibleCount(PAGE_SIZE);
      setPreviewInitialEditions(editions.length > 0 ? editions : null);
      setPreviewPath(basePath);
      return;
    }

    const target = parseEchoLink(trimmed, subredditName, wikiPages);
    if (!target) {
      setEchoLinkError(
        trimmed.startsWith("echolink://")
          ? "Page not found or wrong subreddit."
          : "Enter a valid echolink:// or echo:// URL.",
      );
      return;
    }
    setShowEchoLinkDialog(false);
    setEchoLinkError(null);
    if (target.type === "assets") {
      setActiveTab("assets");
    } else {
      setActiveTab("wiki");
      setWikiCurrentPage(target.page);
      setWikiTargetAnchor(target.anchor);
    }
  }, [echoLinkInput, subredditName, wikiPages, paths, pathToMapped]);

  const handleStyleChanged = useCallback((newStyle: StyleConfig) => {
    setStyle(newStyle);
  }, []);

  const isInline = getWebViewMode() === "inline";

  useEffect(() => {
    if (!isInline || appState !== "ready" || isGameIndependent) return;
    const onFocus = () => {
      void hasAssets().then((still) => {
        if (!still) {
          revokeAllBlobUrls();
          setMeta(null);
          setPaths([]);
          setActiveTab("wiki");
          setGameMismatch(null);
          setLoadingProgress(0);
          setDisplayedProgress(0);
          setReadyToTransition(false);
          setIsReturningUser(false);
          setAppState("no-assets");
        }
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isInline, appState, isGameIndependent]);

  useEffect(() => {
    if (!postId) return;
    try {
      localStorage.setItem(`echowiki:page:${postId}`, wikiCurrentPage);
    } catch {}
  }, [postId, wikiCurrentPage]);

  useEffect(() => {
    if (!isInline || !postId || appState !== "ready") return;
    const onFocus = () => {
      try {
        const saved = localStorage.getItem(`echowiki:page:${postId}`);
        if (saved) setWikiCurrentPage(saved);
      } catch {}
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isInline, postId, appState]);

  useEffect(() => {
    if (isInline || !postId || appState !== "ready") return;
    try {
      const pending = localStorage.getItem(`echowiki:editPage:${postId}`);
      if (pending) {
        localStorage.removeItem(`echowiki:editPage:${postId}`);
        setWikiCurrentPage(pending);
        setPendingEditPage(pending);
        setActiveTab("wiki");
      }
    } catch {}
  }, [isInline, postId, appState]);

  return (
    <div
      className="flex flex-col h-screen"
      style={{
        ...cssVars,
        backgroundColor: "var(--bg)",
        color: "var(--text)",
        fontFamily: getFontFamily(
          appState === "ready" || initResolved ? style.fontFamily : "system",
          appearance.font,
        ),
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e)}
      />

      {showEchoLinkDialog && (
        <EchoLinkDialog
          subredditName={subredditName}
          input={echoLinkInput}
          error={echoLinkError}
          onInputChange={(v) => {
            setEchoLinkInput(v);
            setEchoLinkError(null);
          }}
          onGo={handleEchoLinkGo}
          onDismiss={() => setShowEchoLinkDialog(false)}
        />
      )}

      {previewPath && (
        <AssetPreview
          path={previewPath}
          mappedPath={pathToMapped.get(previewPath)}
          onClose={() => {
            setPreviewPath(null);
            setPreviewInitialEditions(null);
          }}
          onCopied={handleCopied}
          initialEditions={previewInitialEditions ?? undefined}
        />
      )}

      {appState !== "ready" && (
        <div className="flex-1 relative flex flex-col items-center overflow-hidden">
          {}
          <div
            className="absolute inset-0 pointer-events-none bg-crossfade bg-cover bg-center"
            style={{
              backgroundImage: "url(/default-splash.png)",
              opacity: initResolved ? 0 : 1,
              zIndex: 0,
            }}
          />

          {}
          <div
            className="absolute inset-0 pointer-events-none bg-crossfade"
            style={{
              backgroundColor: "var(--bg)",
              opacity: initResolved ? 1 : 0,
              zIndex: 0,
            }}
          />

          {}
          {appearance.bannerUrl && (
            <div
              className="absolute top-0 left-0 right-0 overflow-hidden pointer-events-none bg-crossfade flex justify-center"
              style={{
                height: 120,
                opacity:
                  initResolved &&
                  (config?.homeBackground === "banner" || config?.homeBackground === "both") &&
                  appState !== "importing"
                    ? 0.3
                    : 0,
                zIndex: 1,
              }}
            >
              <img
                src={appearance.bannerUrl}
                alt=""
                className="h-full w-auto min-w-full object-cover"
              />
            </div>
          )}

          {}
          <div
            className={
              appState === "importing" || (appState === "loading" && isReturningUser === true)
                ? "ripple-container ripple-inward"
                : initResolved &&
                    isReturningUser === false &&
                    (config?.homeBackground === "ripple" || config?.homeBackground === "both")
                  ? "ripple-container"
                  : "ripple-container ripple-hidden"
            }
            style={{
              position: "absolute",
              top:
                !initResolved || appState === "loading" || appState === "importing"
                  ? "calc(50% - 150px)"
                  : "-5%",
              transition: "top 0.7s ease-in-out",
              zIndex: 2,
            }}
          >
            <div />
            <div />
            <div />

            {}
            <img
              src="/title.png"
              alt="EchoWiki"
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-50 object-contain z-1 title-crossfade"
              style={{
                opacity: !initResolved || !config || config.homeLogo === "echowiki" ? 1 : 0,
              }}
            />

            {}
            {appearance.iconUrl && (
              <img
                src={appearance.iconUrl}
                alt={subredditName}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-30 w-30 rounded-full object-cover z-1 title-crossfade"
                style={{
                  opacity: initResolved && config?.homeLogo === "subreddit" ? 1 : 0,
                }}
              />
            )}

            {}
            {initResolved && wikiTitle && (
              <p
                className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-1 title-content-reveal"
                style={{ top: "70%" }}
              >
                <span className="text-base text-[var(--text)] whitespace-nowrap">{wikiTitle}</span>
                <span className="relative mt-1 flex justify-center" style={{ minHeight: 16 }}>
                  {config?.wikiDescription && (
                    <span
                      className="text-xs text-[var(--text-muted)] whitespace-nowrap title-crossfade"
                      style={{ opacity: loadingProgress === 0 ? 1 : 0 }}
                    >
                      {config.wikiDescription}
                    </span>
                  )}
                  <span
                    className={`text-xs text-[var(--text-muted)] whitespace-nowrap title-crossfade tabular-nums${config?.wikiDescription ? " absolute" : ""}`}
                    style={{ opacity: loadingProgress > 0 ? 1 : 0 }}
                  >
                    {Math.round(displayedProgress)}%
                  </span>
                </span>
              </p>
            )}
          </div>

          {(appState === "no-assets" || appState === "importing") && initResolved && (
            <div
              className={`flex flex-col items-center gap-6 max-w-md text-center${appState === "no-assets" ? " home-content-reveal" : ""}`}
              style={{
                position: "absolute",
                top: "50%",
                zIndex: 3,
                opacity: appState === "no-assets" ? 1 : 0,
                transition: "opacity 0.5s ease-out",
                pointerEvents: appState === "no-assets" ? "auto" : "none",
              }}
            >
              {appMode === "voting" ? (
                <p className="text-[var(--text-muted)] text-sm">
                  This vote includes game assets.
                  {config?.gameName ? (
                    <>
                      {" "}
                      Select the folder containing
                      <br />
                      <span className="font-semibold text-[var(--text)]">{config.gameName}</span>
                      <br />
                    </>
                  ) : (
                    <>
                      {" "}
                      Select your game folder
                      <br />
                    </>
                  )}
                  to view the comparison.
                </p>
              ) : config?.gameName ? (
                <p className="text-[var(--text-muted)] text-sm">
                  To view the Wiki, select the folder containing
                  <br />
                  <span className="font-semibold text-[var(--text)]">{config.gameName}</span>
                  <br />
                </p>
              ) : (
                <p className="text-[var(--text-muted)] text-sm">
                  To view the Wiki, select your game folder
                  <br />
                </p>
              )}
              <button
                className="flex items-center justify-center h-10 rounded-full cursor-pointer transition-all px-6 font-medium hover:scale-105 hover:font-bold hover:border-2 hover:border-[var(--text)]"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "var(--text)",
                }}
                onClick={handleImport}
              >
                Select Game Folder
              </button>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          )}

          {appState === "server-unavailable" && (
            <div
              className="flex flex-col items-center gap-4 max-w-xs text-center home-content-reveal"
              style={{
                position: "absolute",
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 3,
                paddingLeft: 24,
                paddingRight: 24,
              }}
            >
              <svg
                className="w-8 h-8"
                style={{ color: "var(--text-muted)", opacity: 0.7 }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                EchoWiki is not available
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                This app may have been removed from the subreddit.
                <br />
                Contact the moderators for more information.
              </p>
            </div>
          )}
        </div>
      )}

      {appState === "ready" && appMode === "voting" && votingData && (
        <VotingView
          data={votingData}
          wikiFontSize={style.wikiFontSize}
          isInline={isInline}
          onVoteCast={(updatedStatus, updatedMyVote) => {
            setVotingData((prev) =>
              prev ? { ...prev, voteStatus: updatedStatus, myVote: updatedMyVote } : null,
            );
          }}
        />
      )}

      {appState === "ready" && appMode === "main" && (
        <>
          <div className="relative" style={{ zIndex: 10 }}>
            <div
              ref={topBarRef}
              className={`flex items-center justify-between px-4 py-2 border-b ${showBreadcrumb && activeTab === "wiki" ? "border-transparent" : "border-gray-100"}`}
              onMouseEnter={cancelBreadcrumbHide}
              onMouseLeave={(e) => {
                const bar = breadcrumbBarRef.current;
                const related = e.relatedTarget;
                if (bar && related instanceof Node && bar.contains(related)) {
                  cancelBreadcrumbHide();
                  return;
                }
                scheduleBreadcrumbHide();
              }}
            >
              <div className="flex items-center gap-1">
                {!gameMismatch && (
                  <button
                    className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                      activeTab === "wiki"
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-muted)]"
                    }`}
                    style={activeTab !== "wiki" ? { backgroundColor: "transparent" } : undefined}
                    onMouseEnter={(e) => {
                      if (activeTab === "wiki") {
                        setShowBreadcrumb(true);
                      } else {
                        e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== "wiki")
                        e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    onClick={() => setActiveTab("wiki")}
                  >
                    Wiki
                  </button>
                )}
                {!isGameIndependent && (
                  <button
                    className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                      activeTab === "assets"
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-muted)]"
                    }`}
                    style={activeTab !== "assets" ? { backgroundColor: "transparent" } : undefined}
                    onMouseEnter={(e) => {
                      if (activeTab !== "assets")
                        e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== "assets")
                        e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    onClick={() => setActiveTab("assets")}
                  >
                    Assets
                    {meta && (
                      <span className="ml-1 opacity-70">{meta.assetCount.toLocaleString()}</span>
                    )}
                  </button>
                )}
                {(isMod || config?.collaborativeMode) && (
                  <button
                    className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                      activeTab === "submissions"
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-muted)]"
                    }`}
                    style={
                      activeTab !== "submissions" ? { backgroundColor: "transparent" } : undefined
                    }
                    onMouseEnter={(e) => {
                      if (activeTab !== "submissions")
                        e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== "submissions")
                        e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    onClick={() => setActiveTab("submissions")}
                  >
                    Submissions
                  </button>
                )}
                {isAllMod && (
                  <button
                    className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                      activeTab === "settings"
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-muted)]"
                    }`}
                    style={
                      activeTab !== "settings" ? { backgroundColor: "transparent" } : undefined
                    }
                    onMouseEnter={(e) => {
                      if (activeTab !== "settings")
                        e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== "settings")
                        e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    onClick={() => setActiveTab("settings")}
                  >
                    Settings
                  </button>
                )}
              </div>
              {gameMismatch && (
                <span className="text-[10px] text-red-600 truncate px-2">
                  Expected '{gameMismatch.expected}' but detected '{gameMismatch.detected}'
                </span>
              )}
              <div className="flex items-center gap-3">
                {earnedFlairs.length > 0 && (
                  <div ref={flairDropdownRef} className="relative">
                    <button
                      className="text-gray-400 hover:text-[var(--text-muted)] transition-colors cursor-pointer flex items-center gap-1"
                      title="Equip flair"
                      onClick={() => setShowFlairDropdown((v) => !v)}
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v4.563c0 .398.158.779.44 1.06l6.294 6.294a1.5 1.5 0 0 0 2.121 0l4.563-4.563a1.5 1.5 0 0 0 0-2.12L8.124 1.439A1.5 1.5 0 0 0 7.063 1H2.5ZM4 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
                      </svg>
                    </button>
                    {showFlairDropdown && (
                      <div className="absolute right-0 top-full mt-1 w-52 bg-[var(--bg)] border border-gray-200 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide border-b border-gray-100">
                          Equip flair
                        </div>
                        {earnedFlairs.map((flair) => (
                          <button
                            key={flair.id}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--thumb-bg)] cursor-pointer flex items-center gap-2 transition-colors"
                            onClick={() => void handleEquipFlair(flair.id)}
                          >
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[140px]"
                              style={{
                                backgroundColor: flair.backgroundColor || "var(--accent)",
                                color: flair.textColor || "#fff",
                              }}
                            >
                              {flair.text}
                            </span>
                            {equippedFlairId === flair.id && (
                              <svg
                                className="w-3 h-3 text-[var(--accent)] ml-auto shrink-0"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                              >
                                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                              </svg>
                            )}
                          </button>
                        ))}
                        {equippedFlairId && (
                          <button
                            className="w-full text-left px-3 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--thumb-bg)] cursor-pointer border-t border-gray-100 transition-colors"
                            onClick={() => void handleEquipFlair(null)}
                          >
                            Remove flair
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <button
                  className="text-gray-400 hover:text-[var(--text-muted)] transition-colors cursor-pointer"
                  title="Open EchoLink"
                  onClick={() => {
                    setEchoLinkInput("");
                    setEchoLinkError(null);
                    setShowEchoLinkDialog(true);
                  }}
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z" />
                  </svg>
                </button>
                {isInline && (
                  <button
                    className="text-gray-400 hover:text-[var(--text-muted)] transition-colors cursor-pointer"
                    title="Pop out"
                    onClick={(e) => {
                      void requestExpandedMode(e.nativeEvent, "app");
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </button>
                )}
                {!isGameIndependent && (
                  <button
                    className="text-sm px-3 py-1 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={isWiping}
                    onClick={(e) => {
                      setIsWiping(true);
                      if (isInline) {
                        void handleWipe();
                      } else {
                        void handleWipe().then(() => exitExpandedMode(e.nativeEvent));
                      }
                    }}
                  >
                    {isWiping ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" />
                        Clearing…
                      </span>
                    ) : (
                      "Exit"
                    )}
                  </button>
                )}
              </div>
            </div>

            {activeTab === "wiki" && (
              <div
                ref={breadcrumbBarRef}
                className="absolute left-0 right-0 top-full flex items-center gap-1 px-4 py-1 text-xs border-b border-gray-100 overflow-visible"
                style={{
                  backgroundColor: "var(--bg)",
                  opacity: showBreadcrumb ? 1 : 0,
                  pointerEvents: showBreadcrumb ? "auto" : "none",
                  transition: "opacity 0.15s ease",
                  borderBottomColor: showBreadcrumb ? undefined : "transparent",
                }}
                onMouseEnter={cancelBreadcrumbHide}
                onMouseLeave={handleBreadcrumbBarLeave}
              >
                {wikiBreadcrumbs.map((crumb, i) => (
                  <Fragment key={crumb.page}>
                    {i > 0 && <span className="text-[var(--text-muted)] mx-0.5">&gt;</span>}
                    <button
                      className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                        i === wikiBreadcrumbs.length - 1
                          ? "font-medium text-[var(--text)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                      onClick={() => setWikiCurrentPage(crumb.page)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (crumb.siblings.length > 0) {
                          setOpenBreadcrumbDropdown(openBreadcrumbDropdown === i ? null : i);
                        } else {
                          handleCopyEchoLink(`echolink://r/${subredditName}/wiki/${crumb.page}`);
                        }
                      }}
                    >
                      {crumb.label}
                    </button>
                    {crumb.siblings.length > 0 && (
                      <div className="relative">
                        <button
                          className="text-[var(--text-muted)] hover:text-[var(--text)] px-1.5 py-0.5 -my-0.5 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenBreadcrumbDropdown(openBreadcrumbDropdown === i ? null : i);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenBreadcrumbDropdown(openBreadcrumbDropdown === i ? null : i);
                          }}
                        >
                          &#9662;
                        </button>
                        {openBreadcrumbDropdown === i && (
                          <div
                            className="absolute top-full left-0 z-50 mt-1 py-1 rounded-lg shadow-lg border border-gray-200 min-w-[140px]"
                            style={{ backgroundColor: "var(--bg)" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {crumb.siblings.map((sib) => {
                              const sibLabel = sib
                                .split("/")
                                .pop()!
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (c) => c.toUpperCase());
                              return (
                                <button
                                  key={sib}
                                  className="w-full text-left text-xs px-3 py-1.5 cursor-pointer text-[var(--text)]"
                                  style={{ backgroundColor: "transparent" }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.backgroundColor = "var(--thumb-bg)")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.backgroundColor = "transparent")
                                  }
                                  onClick={() => {
                                    setWikiCurrentPage(sib);
                                    setOpenBreadcrumbDropdown(null);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    handleCopyEchoLink(`echolink://r/${subredditName}/wiki/${sib}`);
                                  }}
                                >
                                  {sibLabel}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          {mappingUpdateInfo && (
            <div className="flex items-center justify-between px-4 py-2 bg-green-50 border-b border-green-200 text-sm text-green-800">
              <span>{mappingUpdateInfo}</span>
              <button
                onClick={() => setMappingUpdateInfo(null)}
                className="ml-3 flex-shrink-0 text-green-600 hover:text-green-800 cursor-pointer"
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
          )}

          {activeTab === "wiki" && (
            <WikiView
              subredditName={subredditName}
              wikiFontSize={style.wikiFontSize}
              currentPage={wikiCurrentPage}
              onPageChange={setWikiCurrentPage}
              isMod={isMod}
              isExpanded={!isInline}
              username={username}
              onCopyEchoLink={handleCopyEchoLink}
              targetAnchor={wikiTargetAnchor}
              onAnchorConsumed={handleAnchorConsumed}
              canSuggest={canSuggest}
              voteOnSaveAvailable={
                isMod && (config?.collaborativeMode ?? false) && (config?.votingEnabled ?? false)
              }
              suggestionToLoad={suggestionToLoad}
              onSuggestionLoaded={handleSuggestionLoaded}
              onNavigateToSuggestion={handleNavigateToSuggestion}
              onInlineEditRequest={handleInlineEditRequest}
              startInEditMode={pendingEditPage}
              onStartInEditModeConsumed={() => setPendingEditPage(null)}
            />
          )}

          {activeTab === "assets" && (
            <>
              <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100">
                <FilterTabs
                  active={filter}
                  counts={counts}
                  onChange={(f) => {
                    setFilter(f);
                    setSubFilter(null);
                    setVisibleCount(PAGE_SIZE);
                  }}
                />
              </div>

              {subcategories.length > 1 && (
                <div className="px-4 py-1.5 border-b border-gray-50">
                  <SubFilterTabs
                    active={subFilter}
                    subcategories={subcategories}
                    groups={currentFolderGroups}
                    activeGroup={groupFilter}
                    foldersWithGroups={foldersWithGroups}
                    onChange={(name) => {
                      setSubFilter(name);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    onGroupChange={(g) => {
                      setGroupFilter(g);
                      setVisibleCount(PAGE_SIZE);
                    }}
                  />
                </div>
              )}

              <div
                className="flex-1 overflow-auto px-4 py-3"
                style={{ scrollbarGutter: "stable both-edges" }}
              >
                {filteredPaths.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <p className="text-sm">No assets in this category</p>
                  </div>
                ) : !assetsGridReady ? (
                  <div className="flex justify-center items-center py-16">
                    <div className="relative w-14 h-14">
                      <div className="absolute inset-0 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={`grid ${gridClass} gap-1`}>
                      {visiblePaths.map((p) => (
                        <AssetCard
                          key={p}
                          path={p}
                          mappedPath={pathToMapped.get(p)}
                          cardSize={style.cardSize}
                          onPreview={setPreviewPath}
                          onCopied={handleCopied}
                        />
                      ))}
                    </div>
                    {hasMore && (
                      <div className="flex justify-center py-4">
                        <button
                          className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)] text-white transition-opacity cursor-pointer hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={loadingMore}
                          onClick={async () => {
                            const newCount = visibleCount + PAGE_SIZE;
                            const newPaths = filteredPaths
                              .slice(visibleCount, newCount)
                              .filter(isImagePath);
                            setLoadingMore(true);
                            await preloadPaths(newPaths);
                            setLoadingMore(false);
                            setVisibleCount(newCount);
                          }}
                        >
                          {loadingMore ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" />
                              Loading…
                            </span>
                          ) : (
                            <>
                              Load more
                              <span className="ml-1 opacity-70">
                                {(filteredPaths.length - visibleCount).toLocaleString()}
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {activeTab === "submissions" && (isMod || config?.collaborativeMode) && (
            <SubmissionsPanel
              subredditName={subredditName}
              isMod={isMod}
              username={username}
              wikiFontSize={style.wikiFontSize}
            />
          )}

          {activeTab === "settings" && isAllMod && config && (
            <SettingsView
              mappingText={mappingText}
              style={style}
              config={config}
              appearance={appearance}
              subredditName={subredditName}
              paths={paths}
              onMappingSaved={handleMappingSaved}
              onStyleChanged={handleStyleChanged}
              onConfigChanged={handleConfigChanged}
            />
          )}
        </>
      )}
    </div>
  );
};
