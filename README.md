# EchoWiki

A Devvit app that turns subreddit wiki pages into interactive game asset wikis. Users import game files from their own copy, assets are decrypted and stored client-side in IndexedDB, and echo links in wiki markdown resolve to real images and audio inline.

## How It Works

1. **Import** Users select their game folder. The app auto-detects the engine and decrypts assets entirely in the browser.
2. **Store** Decrypted assets are saved to IndexedDB. Nothing is uploaded to any server.
3. **Browse** Wiki pages render `echo://` links as inline images and audio players. An asset browser lets users explore all imported files and copy echo markdown to the clipboard.

## Echo Links

Standard markdown with the `echo://` scheme:

```markdown
![Character portrait](echo://img/characters/hero.png)
[Battle theme](echo://audio/bgm/battle.ogg)
```

Users who have imported the game see resolved assets through the application. Everyone else and those looking at the original wiki page only sees the alt text.

## Supported Engines

| Engine           | Encryption                      |
| ---------------- | ------------------------------- |
| RPG Maker 2003   | None (XYZ image conversion)     |
| RPG Maker XP     | RGSSAD v1 archive               |
| RPG Maker VX     | RGSSAD v1 archive               |
| RPG Maker VX Ace | RGSS3A v3 archive               |
| RPG Maker MV     | 16-byte XOR header              |
| RPG Maker MZ     | 16-byte XOR header              |
| TCOAAL 3.0+      | Evolving XOR with basename mask |

## Wiki Integration

Wiki pages are fetched from the subreddit's wiki. A page selector dropdown lets users navigate between pages. A link icon opens the Reddit wiki page in the browser.

## Asset Browser

A gallery view with filter tabs (All, Images, Audio, Data), search, and pagination. Clicking any asset opens a preview (full-size image or audio player with frequency visualization). Right-clicking copies the echo markdown to the clipboard. A copy icon appears on hover. When a filename mapping is configured, assets display mapped names instead of raw filenames.

## Mod Settings

Moderators see a Settings tab with:

- **Filename Mapping** A textarea containing a `const filenamesMapped = {...};` JavaScript snippet. Mapping keys are filename stems (no extension, no path). Values are human-readable replacement names displayed in the asset browser and used in echo links.
