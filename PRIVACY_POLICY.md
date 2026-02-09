# EchoWiki Privacy Policy

**Last updated:** February 9, 2026

EchoWiki is a Reddit Devvit app that lets subreddit communities browse and reference game assets within wiki pages. This policy explains what data the app handles and how.

## What EchoWiki Does Not Do

- Does **not** collect, store, or transmit your personal data to any third party.
- Does **not** use analytics, tracking pixels, cookies, or fingerprinting.
- Does **not** sell, rent, or share any data with anyone.
- Does **not** upload your game files anywhere. All file processing happens locally in your browser.

## Data Handled by EchoWiki

### 1. Reddit Account Information

When you open EchoWiki, the app reads your **Reddit username** and **moderator status** for the current subreddit through Reddit's own platform APIs. This is used solely to:

- Display your username in the interface.
- Determine whether to show moderator-only settings.

This information is provided by Reddit's Devvit platform as part of the app's execution context. EchoWiki does not store your username or moderator status anywhere. It is read on each page load and discarded when you leave.

### 2. Game Files (Client-Side Only)

When you import a game folder, EchoWiki processes your files **entirely within your browser**:

- Files are read from your local filesystem using the browser's File API.
- Assets are extracted and processed in-browser using JavaScript.
- Processed assets are stored in your browser's **IndexedDB** database under the origin of the Reddit webview.

**No game files, processed assets, or file metadata are ever sent to any server.** The data stays in your browser's local storage and is only accessible to you. You can delete all stored assets at any time using the "Exit" button in the app.

### 3. Subreddit Configuration (Server-Side, Moderator Only)

Moderators can configure the following settings, which are stored in Reddit's Devvit-provided **Redis** database scoped to the subreddit:

- **Game title** (e.g., "My Game"): displayed to users during import.
- **Engine type and processing key**: used to guide the client-side asset extraction process.
- **Style preferences**: colors, fonts, card sizes for the app's appearance.
- **Filename mappings**: pairs of original-to-custom filenames for display purposes.

This configuration data is:

- Stored within Reddit's infrastructure, namespaced to the specific subreddit installation.
- Accessible only through the app's server endpoints.
- Not shared across subreddits or with any external service.
- Deletable by uninstalling the app from the subreddit.

### 4. Wiki Content

EchoWiki reads subreddit wiki pages through Reddit's API to display them within the app. It does not modify, cache, or store wiki content. Wiki pages are fetched on demand and rendered in the browser.

## Data Retention

- **Browser data (IndexedDB):** Persists until you clear it using the "Exit" button, clear your browser data, or uninstall/reset your browser. EchoWiki has no ability to access or delete your browser data remotely.
- **Subreddit configuration (Redis):** Persists for the lifetime of the app installation on the subreddit. Uninstalling the app removes this data.

## Third-Party Services

EchoWiki does not integrate with any third-party services. All server-side functionality runs on Reddit's Devvit platform. The app makes no external network requests beyond Reddit's own APIs.

## Children's Privacy

EchoWiki does not knowingly collect any personal information from anyone, including children. The app relies entirely on Reddit's own account system and age verification.

## Changes to This Policy

If this policy changes, the updated version will be published in the app's repository with a new "Last updated" date.

## Contact

If you have questions about this policy, you can open an issue on the app's repository or contact the developer through Reddit.
