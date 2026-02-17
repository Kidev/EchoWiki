import { reddit } from "@devvit/web/server";

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
  });
};
