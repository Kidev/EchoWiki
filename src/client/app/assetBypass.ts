import { createContext } from "react";

// When true (provided by a vote viewer that chose "continue without assets"),
// echo:// references are rendered as inert placeholders instead of being
// resolved against IndexedDB. This lets a voter review a suggestion's text/diff
// without importing the game's assets first. The choice is session-only and is
// never persisted, so each visit must opt in again.
export const AssetBypassContext = createContext(false);
