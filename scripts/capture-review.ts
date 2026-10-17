export {};
/** Reuse the verified product journey; requires a fresh isolated local state file. */
process.env.TALLY_WEB_URL ??= 'http://127.0.0.1:5174';
process.env.TALLY_API_URL ??= 'http://127.0.0.1:4319';
process.env.TALLY_ARTIFACTS_DIR ??= '.artifacts/redesign';
await import('./browser-test.js');
