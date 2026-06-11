import type { EchoLinkTarget } from "./appTypes";

// Parse an internal `echolink://r/<sub>/...` link into a navigation target.
// Returns null for links that don't target this subreddit or aren't recognized.
export function parseEchoLink(
  text: string,
  subredditName: string,
  wikiPages: string[],
): EchoLinkTarget | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("echolink://r/")) return null;
  const withoutScheme = trimmed.slice("echolink://r/".length);
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) return null;
  const sub = withoutScheme.slice(0, slashIdx);
  if (sub.toLowerCase() !== subredditName.toLowerCase()) return null;
  const path = withoutScheme.slice(slashIdx + 1);
  if (path === "assets") return { type: "assets" };
  if (path.startsWith("wiki/")) {
    const pagePart = path.slice("wiki/".length);
    const hashIdx = pagePart.indexOf("#");
    const pageWithoutAnchor =
      hashIdx === -1 ? pagePart : pagePart.slice(0, hashIdx);
    const anchor = hashIdx === -1 ? null : pagePart.slice(hashIdx + 1) || null;
    if (wikiPages.includes(pageWithoutAnchor)) {
      return { type: "wiki", page: pageWithoutAnchor, anchor };
    }
  }
  return null;
}
