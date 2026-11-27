import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {posix} from 'node:path';

/** Compare independent verification runs against the same working-tree sources. */
export function sourceFingerprint(){
  const hash=createHash('sha256');
  function add(path){
    if(statSync(path).isDirectory()){
      for(const name of readdirSync(path).sort())add(posix.join(path,name));
    }else{
      hash.update(path).update('\0').update(readFileSync(path)).update('\0');
    }
  }
  for(const path of ['package.json','pnpm-lock.yaml','src/domain','src/engine','src/mcp','src/server',
    'src/app/api','src/ui/RunPanel.tsx','src/ui/editor/AgentExportDialog.tsx','src/ui/evidence-result.ts'])add(path);
  return hash.digest('hex');
}
