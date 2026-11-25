import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { studioEnvironment } from './runtime-env.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const settings=studioEnvironment(root);
const data = resolve(settings.STUDIO_DATA_DIR || '.studio-data');
mkdirSync(data, { recursive:true });
const secretFile = join(data,'mcp.secret');
try { writeFileSync(secretFile,randomBytes(32).toString('hex'), {flag:'wx',mode:0o600}); } catch(e) { if(e.code!=='EEXIST') throw e; }
const port = String(settings.PORT || 3100);
const mcpPort = String(settings.STUDIO_MCP_PORT || 3101);
const env = {...settings, PORT:port, STUDIO_MCP_PORT:mcpPort, STUDIO_DATA_DIR:data, STUDIO_MCP_TOKEN:readFileSync(secretFile,'utf8'),NEXT_TELEMETRY_DISABLED:'1'};
const req=createRequire(import.meta.url);
const children=[];
let closing=false;
function finish(code){if(closing)return;closing=true;for(const child of children)child.kill();process.exitCode=code;}
function run(args,environment=env){const child=spawn(process.execPath,args,{cwd:root,env:environment,stdio:'inherit',windowsHide:true});children.push(child);child.on('exit',code=>finish(code??1));child.on('error',()=>finish(1));}
const mcpEnv=Object.fromEntries(Object.entries(env).filter(([name])=>!name.startsWith('OPENAI_')&&!name.startsWith('STUDIO_CONNECTOR_')));
run(['--import','tsx','src/mcp/server.ts'],mcpEnv);
run(['--import','tsx','src/server/worker.ts']);
run([req.resolve('next/dist/bin/next'),process.argv.includes('--production')?'start':'dev',...(process.argv.includes('--production')?[]:['--webpack']),'-H','127.0.0.1','-p',port]);
console.log('Workflow Studio   http://127.0.0.1:'+port);
process.on('SIGINT',()=>finish(0));process.on('SIGTERM',()=>finish(0));
if (process.send) process.on('message',message=>{if(message==='stop'){finish(0);process.disconnect();}});
