/** Keep provider credentials out of the web development server's environment. */
export function webEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const web={...env};
  for(const name of ['OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','BOX_ACCESS_TOKEN','BOX_WEBHOOK_PRIMARY_KEY','BOX_WEBHOOK_SECONDARY_KEY'])delete web[name];
  return web;
}
