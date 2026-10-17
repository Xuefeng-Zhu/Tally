/** Fixed, user-approved regional Bedrock target. No account or provider lookup occurs here. */
const sourceRegion='us-east-1' as const;
const foundationModelId='mistral.ministral-3-14b-instruct' as const;
export const MODEL = {
  region:sourceRegion,
  model_id:foundationModelId,
  foundation_model_id:foundationModelId,
  inference_type:'in_region',
  destination_regions:[sourceRegion],
  foundation_model_arns:[`arn:aws:bedrock:${sourceRegion}::foundation-model/${foundationModelId}`],
} as const;
