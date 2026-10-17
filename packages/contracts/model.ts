/** User-selected Bedrock Runtime US cross-Region profile; no account or provider lookup occurs here. */
const sourceRegion='us-east-1' as const;
const foundationModelId='openai.gpt-6-luna' as const;
const profileId='us.openai.gpt-6-luna' as const;
export const MODEL = {
  region:sourceRegion,
  model_id:profileId,
  foundation_model_id:foundationModelId,
  inference_type:'us_cross_region',
  destination_regions:['us-east-1','us-east-2','us-west-2'],
  inference_profile_arn_template:`arn:aws:bedrock:${sourceRegion}:\${AWS::AccountId}:inference-profile/${profileId}`,
  default_project_arn_template:`arn:aws:bedrock:${sourceRegion}:\${AWS::AccountId}:project/default`,
  foundation_model_arns:[
    `arn:aws:bedrock:us-east-1::foundation-model/${foundationModelId}`,
    `arn:aws:bedrock:us-east-2::foundation-model/${foundationModelId}`,
    `arn:aws:bedrock:us-west-2::foundation-model/${foundationModelId}`,
  ],
} as const;
/** Format only: callers supply an already approved account ID; this never resolves credentials. */
export function inferenceProfileArnForAccount(accountId:string):string {
  if(!/^\d{12}$/.test(accountId))throw new Error('INVALID_AWS_ACCOUNT_ID');
  return MODEL.inference_profile_arn_template.replace('${AWS::AccountId}',accountId);
}
