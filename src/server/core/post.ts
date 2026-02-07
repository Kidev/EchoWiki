import { reddit, context } from '@devvit/web/server';

export const createPost = async () => {
  const sub = context.subredditName ?? 'unknown';
  return await reddit.submitCustomPost({
    title: `EchoWiki - r/${sub}`,
  });
};
