import { reddit } from "@devvit/web/server";

const TEXT_FALLBACK = `# EchoWiki

An interactive game wiki and asset browser for Reddit.

---

> **Your Reddit client does not support interactive posts.**
> Open this post using the Reddit app for [iOS](https://apps.apple.com/app/reddit/id1064216828) or [Android](https://play.google.com/store/apps/details?id=com.reddit.frontpage), or at [new.reddit.com](https://new.reddit.com).`;

export const createPost = async (title: string) => {
  return await reddit.submitCustomPost({
    title,
    splash: {
      appDisplayName: "EchoWiki",
      backgroundUri: "default-splash.png",
      buttonLabel: "Open EchoWiki",
      description: "Browse game assets from your own copy",
      appIconUri: "default-icon.png",
    },
    textFallback: { text: TEXT_FALLBACK },
  });
};
