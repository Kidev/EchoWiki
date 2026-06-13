import {
  type CSSProperties,
  type ReactNode,
  lazy,
  Suspense,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { navigateTo } from "@devvit/web/client";
import type { WikiFontSize } from "../../../shared/types/api";
import {
  preprocessAlerts,
  preprocessCenterBlocks,
  withCodeProtected,
  preprocessEchoBlocks,
  extractDisplayHints,
} from "../echoRender";
import {
  EchoInlineAsset,
  EchoRawImage,
  EchoSceneFrame,
} from "./EchoInlineAsset";
import { AssetBypassContext } from "../assetBypass";
import { getFileName, isModelPath, slugify } from "../assetUtils";
import { highlightEchoCode } from "../wikiHighlight";

const ModelViewer = lazy(() => import("./ModelViewer"));

// Minimal shape of the hast nodes react-markdown hands a `pre` renderer: a
// single `code` child carrying the language class and one text node with the
// raw fenced content. Used to detect ```echo blocks and pull their source out.
type HastElement = {
  tagName?: string;
  properties?: { className?: unknown };
  children?: { type?: string; value?: string }[];
};

function getFencedCode(
  node: unknown,
): { lang: string | null; source: string } | null {
  const codeEl = (node as { children?: HastElement[] } | undefined)
    ?.children?.[0];
  if (!codeEl || codeEl.tagName !== "code") return null;
  const classes = codeEl.properties?.className;
  const langClass = Array.isArray(classes)
    ? classes.find(
        (c): c is string => typeof c === "string" && c.startsWith("language-"),
      )
    : undefined;
  const lang = langClass ? langClass.slice("language-".length) : null;
  const source = (codeEl.children ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.value ?? "")
    .join("");
  return { lang, source };
}

function extractWikiPage(href: string, subredditName: string): string | null {
  const sub = subredditName.toLowerCase();

  try {
    const url = new URL(href, "https://www.reddit.com");
    if (
      url.hostname === "www.reddit.com" ||
      url.hostname === "reddit.com" ||
      url.hostname === "old.reddit.com" ||
      url.hostname === "new.reddit.com"
    ) {
      const match = /^\/r\/([^/]+)\/wiki\/(.+?)(?:\/?#.*)?$/.exec(url.pathname);
      if (match && match[1]!.toLowerCase() === sub) {
        return match[2]!;
      }
    }
  } catch {}

  const pathMatch = /^\/r\/([^/]+)\/wiki\/(.+?)(?:\/?#.*)?$/.exec(href);
  if (pathMatch && pathMatch[1]!.toLowerCase() === sub) {
    return pathMatch[2]!;
  }

  return null;
}

function HeadingLinkButton({
  id,
  subredditName,
  currentPage,
  onCopyEchoLink,
}: {
  id: string;
  subredditName: string;
  currentPage: string;
  onCopyEchoLink: (link: string) => void;
}) {
  return (
    <span
      role="button"
      className="inline-flex items-center ml-2 opacity-0 group-hover/heading:opacity-100 transition-opacity cursor-pointer align-middle text-[var(--text-muted)] hover:text-[var(--link-color)]"
      title="Copy link to section"
      onClick={() => {
        onCopyEchoLink(
          `echolink://r/${subredditName}/wiki/${currentPage}#${id}`,
        );
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z" />
      </svg>
    </span>
  );
}

export function WikiMarkdownContent({
  content,
  subredditName,
  currentPage,
  wikiFontSize,
  onPageChange,
  onCopyEchoLink,
  targetAnchor,
  onAnchorConsumed,
}: {
  content: string;
  subredditName: string;
  currentPage: string;
  wikiFontSize: WikiFontSize;
  onPageChange: (page: string) => void;
  onCopyEchoLink: (link: string) => void;
  targetAnchor?: string | null | undefined;
  onAnchorConsumed?: (() => void) | undefined;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const assetsBypassed = useContext(AssetBypassContext);
  useLayoutEffect(() => {
    if (!targetAnchor) return;
    const el =
      containerRef.current?.querySelector(
        `[id="${CSS.escape(targetAnchor)}"]`,
      ) ??
      containerRef.current?.querySelector(
        `[id="${CSS.escape(targetAnchor.toLowerCase())}"]`,
      );
    if (el) {
      el.scrollIntoView({ behavior: "instant", block: "start" });
    }
    onAnchorConsumed?.();
  }, [targetAnchor, content, onAnchorConsumed]);
  const proseSize =
    wikiFontSize === "small"
      ? "prose-sm"
      : wikiFontSize === "large"
        ? "prose-lg"
        : "";

  return (
    <div ref={containerRef} className="px-4 py-4">
      <div
        className={`prose ${proseSize} max-w-none`}
        style={
          {
            "--tw-prose-body": "var(--text)",
            "--tw-prose-headings": "var(--text)",
            "--tw-prose-bold": "var(--text)",
            "--tw-prose-links": "var(--link-color)",
            "--tw-prose-quotes": "var(--text-muted)",
            "--tw-prose-quote-borders": "var(--accent)",
            "--tw-prose-code": "var(--text)",
            "--tw-prose-counters": "var(--text-muted)",
            "--tw-prose-bullets": "var(--text-muted)",
            "--tw-prose-hr": "var(--text-muted)",
            "--tw-prose-th-borders": "var(--text-muted)",
            "--tw-prose-td-borders": "var(--text-muted)",
          } as CSSProperties
        }
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          urlTransform={(url) =>
            url.startsWith("echo://") ? url : defaultUrlTransform(url)
          }
          components={{
            div: ({
              node: _node,
              className: divClass,
              style: divStyle,
              children: divChildren,
              ...rest
            }: {
              node?: unknown;
              className?: string | undefined;
              style?: CSSProperties | undefined;
              children?: ReactNode | undefined;
            }) => {
              // :::scene blocks with both a bg and fg render as an
              // `echo-scene-frame` div whose two images must be measured at
              // runtime to size the box to the larger one (see EchoSceneFrame).
              if (divClass?.split(/\s+/).includes("echo-scene-frame")) {
                return (
                  <EchoSceneFrame className={divClass} style={divStyle}>
                    {divChildren}
                  </EchoSceneFrame>
                );
              }
              return (
                <div className={divClass} style={divStyle} {...rest}>
                  {divChildren}
                </div>
              );
            },
            h1: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h1 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h1>
              );
            },
            h2: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h2 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h2>
              );
            },
            h3: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h3 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h3>
              );
            },
            h4: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h4 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h4>
              );
            },
            h5: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h5 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h5>
              );
            },
            h6: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h6 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h6>
              );
            },
            p: ({
              children,
              node,
            }: {
              children?: ReactNode;
              node?: unknown;
            }) => {
              const n = node as
                | {
                    children?: {
                      type: string;
                      tagName?: string;
                      properties?: Record<string, unknown>;
                      value?: string;
                    }[];
                  }
                | undefined;
              const kids = n?.children ?? [];
              const echoOnly =
                kids.length > 0 &&
                kids.every(
                  (c) =>
                    (c.type === "element" &&
                      c.tagName === "img" &&
                      typeof c.properties?.src === "string" &&
                      (c.properties.src as string).startsWith("echo://")) ||
                    (c.type === "element" &&
                      c.tagName === "a" &&
                      typeof c.properties?.href === "string" &&
                      (c.properties.href as string).startsWith("echo://")) ||
                    (c.type === "text" && !(c.value ?? "").trim()),
                );
              if (echoOnly) return <>{children}</>;
              return <p>{children}</p>;
            },
            img: ({
              src,
              alt,
              style,
              className: imgClass,
            }: {
              src?: string | undefined;
              alt?: string | undefined;
              style?: CSSProperties | undefined;
              className?: string | undefined;
            }) => {
              if (src?.startsWith("echo://")) {
                const rawPath = src.slice("echo://".length).toLowerCase();
                // 3D models (![name](echo://3d/king.glb)) render in an
                // interactive, drag-to-rotate viewer. The base extension is
                // tested separately because the path may carry display params
                // (?autorotate, ?height=...) after the file name.
                if (isModelPath(rawPath.split("?")[0] ?? rawPath)) {
                  // Assets bypassed: don't pull in the 3D viewer or its model;
                  // surface the model as a labelled placeholder instead.
                  if (assetsBypassed) {
                    return (
                      <EchoInlineAsset path={rawPath} style={style}>
                        {alt ?? getFileName(rawPath.split("?")[0] ?? rawPath)}
                      </EchoInlineAsset>
                    );
                  }
                  return (
                    <Suspense
                      fallback={
                        <span className="my-2 inline-flex h-[340px] w-full items-center justify-center rounded-lg border border-gray-200 bg-[var(--thumb-bg)] align-middle">
                          <span className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                        </span>
                      }
                    >
                      <ModelViewer path={rawPath} alt={alt} />
                    </Suspense>
                  );
                }
                // Images emitted by :::scene / :::fbf / :::anim blocks are marked
                // with the `echo-raw` class. They carry their own positioning and
                // animation styles, so render them bare (no inline-asset wrapper).
                if (imgClass?.split(/\s+/).includes("echo-raw")) {
                  return (
                    <EchoRawImage
                      path={rawPath}
                      alt={alt}
                      style={style}
                      className={imgClass}
                    />
                  );
                }
                const { hints, cleanPath } = extractDisplayHints(rawPath);
                const hintStyle: CSSProperties = {};
                if (hints.has("emoji")) {
                  hintStyle.height = "1.2em";
                  hintStyle.width = "auto";
                  hintStyle.verticalAlign = "-0.25em";
                  hintStyle.display = "inline";
                  hintStyle.borderRadius = "2px";
                  hintStyle.maxWidth = "none";
                }
                if (hints.has("outline")) {
                  hintStyle.outline = "2px dashed var(--accent)";
                  hintStyle.outlineOffset = "2px";
                }
                const mergedStyle =
                  Object.keys(hintStyle).length > 0
                    ? { ...hintStyle, ...style }
                    : style;
                return (
                  <EchoInlineAsset
                    path={cleanPath}
                    style={mergedStyle}
                    className={imgClass}
                  >
                    {alt ?? getFileName(cleanPath)}
                  </EchoInlineAsset>
                );
              }
              return (
                <img src={src} alt={alt} style={style} className={imgClass} />
              );
            },
            a: ({
              href,
              children: linkChildren,
            }: {
              href?: string | undefined;
              children?: ReactNode | undefined;
            }) => {
              if (!href) {
                return <span>{linkChildren}</span>;
              }

              if (href.startsWith("echo://")) {
                const echoPath = href.slice("echo://".length).toLowerCase();
                return (
                  <EchoInlineAsset path={echoPath}>
                    {linkChildren}
                  </EchoInlineAsset>
                );
              }

              const wikiPage = extractWikiPage(href, subredditName);
              if (wikiPage !== null) {
                return (
                  <span
                    role="link"
                    className="text-[var(--link-color)] hover:underline cursor-pointer"
                    onClick={() => onPageChange(wikiPage)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onCopyEchoLink(
                        `echolink://r/${subredditName}/wiki/${wikiPage}`,
                      );
                    }}
                  >
                    {linkChildren}
                  </span>
                );
              }

              if (href.startsWith("#")) {
                return (
                  <span
                    role="link"
                    className="text-[var(--link-color)] hover:underline cursor-pointer"
                    onClick={() => {
                      const id = href.slice(1);
                      const target =
                        containerRef.current?.querySelector(
                          `[id="${CSS.escape(id)}"]`,
                        ) ??
                        containerRef.current?.querySelector(
                          `[id="${CSS.escape(id.toLowerCase())}"]`,
                        );
                      if (target) {
                        target.scrollIntoView({
                          behavior: "instant",
                          block: "start",
                        });
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onCopyEchoLink(
                        `echolink://r/${subredditName}/wiki/${currentPage}${href}`,
                      );
                    }}
                  >
                    {linkChildren}
                  </span>
                );
              }

              const externalUrl =
                href.startsWith("http://") || href.startsWith("https://")
                  ? href
                  : `https://www.reddit.com${href.startsWith("/") ? href : `/${href}`}`;
              return (
                <a
                  href={externalUrl}
                  onClick={(e) => {
                    e.preventDefault();
                    // Route through Devvit's navigateTo, which the Reddit host
                    // shell handles. We deliberately avoid a window.open(_blank)
                    // fallback: that raw hand-off triggers the browser's "access
                    // other apps and services on this device" prompt.
                    try {
                      navigateTo({ url: externalUrl });
                    } catch {
                      // navigateTo unavailable (non-Devvit context): no-op.
                    }
                  }}
                  className="text-[var(--link-color)] hover:underline cursor-pointer"
                >
                  {linkChildren}
                </a>
              );
            },
            pre: ({
              node,
              children,
            }: {
              node?: unknown;
              children?: ReactNode;
            }) => {
              // ```echo fenced blocks are the EchoWiki showcase snippets: render
              // them through the same dialect highlighter the editor uses so the
              // :::blocks, echo:// links, and key=value params show up in color.
              const fenced = getFencedCode(node);
              if (fenced && fenced.lang === "echo") {
                return (
                  <pre
                    className="echo-code-block overflow-x-auto font-mono text-sm leading-relaxed"
                    style={{
                      background: "var(--thumb-bg)",
                      color: "var(--text)",
                      border: "1px solid var(--text-muted)",
                      borderRadius: "8px",
                      padding: "1rem",
                    }}
                    dangerouslySetInnerHTML={{
                      __html: highlightEchoCode(fenced.source),
                    }}
                  />
                );
              }
              return <pre>{children}</pre>;
            },
            style: ({ children }: { children?: ReactNode }) => {
              const css =
                typeof children === "string"
                  ? children
                  : Array.isArray(children)
                    ? (children as ReactNode[])
                        .filter((c): c is string => typeof c === "string")
                        .join("")
                    : "";
              if (!css.trim()) return null;
              return <style dangerouslySetInnerHTML={{ __html: css }} />;
            },
          }}
        >
          {withCodeProtected(content, (s) =>
            preprocessEchoBlocks(preprocessCenterBlocks(preprocessAlerts(s))),
          )}
        </Markdown>
      </div>
    </div>
  );
}
