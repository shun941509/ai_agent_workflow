import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** Workspace credentials chosen by the operator override stale inherited credentials.
 * Keep explicitly selected ports and isolated test storage from the launcher. */
export function studioEnvironment(root, inherited=process.env){
  const file=(name)=>{const path=join(root,name);return existsSync(path)?parseEnv(readFileSync(path,'utf8')):{};};
  const defaults=file('.env'),local=file('.env.local');
  const env={...defaults,...local,...inherited};
  for(const field of ['OPENAI_API_KEY','OPENAI_MODEL']){
    if(local[field]?.trim())env[field]=local[field];
  }
  if(inherited.STUDIO_DISABLE_MODEL==='1'){
    env.OPENAI_API_KEY='';
    env.OPENAI_MODEL='';
  }
  return env;
}
