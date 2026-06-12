// Copy text to the clipboard from inside the Devvit webview iframe.
//
// The async Clipboard API (`navigator.clipboard.writeText`) is the modern path,
// but inside a sandboxed/cross-origin iframe it can be unavailable or rejected
// unless the host delegates the `clipboard-write` permission, and in some
// browsers that surfaces a permission prompt. We try it first (it preserves the
// user gesture), then fall back to the legacy `execCommand("copy")` over a
// hidden textarea, which works without any permission grant.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Keep it off-screen and non-disruptive to scroll/focus.
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
