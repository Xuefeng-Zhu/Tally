import {build} from 'esbuild';
await build({entryPoints:{'api/handler':'services/api/handler.ts','worker/handler':'services/worker/handler.ts'},bundle:true,platform:'node',target:'node22',format:'esm',outdir:'.aws-sam/local',sourcemap:true});
console.log('Lambda boundary bundles compiled locally; live provider workflow remains gated.');
