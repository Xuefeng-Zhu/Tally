import { resolve } from 'node:path';
import { buildLambda } from './build-one-lambda.mjs';
const args=process.argv.slice(2),index=args.indexOf('--outdir');
const destination=resolve(index>=0?args[index+1]:'.aws-sam/local');
const receipts=[];
for(const functionName of ['ApiFunction','WorkerFunction'])receipts.push(await buildLambda({functionName,artifactsDir:resolve(destination,functionName),mode:'host'}));
console.log(JSON.stringify({status:'host_build_verified',deployable:false,artifacts:receipts}));
