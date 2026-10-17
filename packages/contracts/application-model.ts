/** User-selected application inference target. Legacy Bedrock probes are not application fallbacks. */
export const APPLICATION_MODEL = {
  provider: 'openrouter',
  model_id: 'openai/gpt-6-luna',
  canonical_model_id: 'openai/gpt-6-luna-20260922',
} as const;
