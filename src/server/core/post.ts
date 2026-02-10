import { reddit, context } from '@devvit/web/server';

export const createPost = async () => {
  const sub = context.subredditName ?? 'unknown';
  return await reddit.submitCustomPost({
    title: `EchoWiki - r/${sub}`,
    splash: {
      appDisplayName: 'EchoWiki',
      backgroundUri: 'default-splash.png',
      buttonLabel: 'Open EchoWiki',
      description: 'Browse game assets from your own copy',
      appIconUri: 'default-icon.png',
    },
  });
};
