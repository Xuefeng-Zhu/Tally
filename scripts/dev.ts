import {spawn} from 'node:child_process';
import {webEnvironment} from '../services/runtime/web-environment.js';
const children=[spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','apps/local-proxy/server.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts'],{stdio:'inherit',env:webEnvironment(process.env)})];
const stop=()=>children.forEach(p=>p.kill('SIGTERM'));
process.on('SIGINT',stop);process.on('SIGTERM',stop);for(const child of children)child.on('exit',code=>{if(code){stop();process.exitCode=code;}});
