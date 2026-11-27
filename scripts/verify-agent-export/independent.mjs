import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sourceFingerprint} from './source.mjs';

// The engine suite owns its graphs, inputs, database and ZIP assertions independently of the worker suite.
const directory=join('artifacts','agent-zip-audit');
const worker=JSON.parse(readFileSync(join(directory,'worker-results.json'),'utf8'));
const source=sourceFingerprint();
assert.equal(source,worker.source,'먼저 현재 소스로 worker.mjs --write를 실행하세요.');
const execution=spawnSync(process.execPath,['--import','tsx','--test','tests/engine.test.ts'],{
  encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,
  env:{...process.env,OPENAI_API_KEY:'',OPENAI_MODEL:'',FORCE_COLOR:'0'},
});
if(execution.error)throw execution.error;
if(execution.status!==0){
  process.stderr.write(execution.stdout+execution.stderr);
  process.exit(execution.status??1);
}
const marker='SQLite engine and exported ZIP comparison ';
const line=execution.stdout.split(/\r?\n/).find(text=>text.includes(marker));
assert.ok(line,'SQLite 실행과 ZIP 대조 집계가 없습니다.');
const metrics=JSON.parse(line.slice(line.indexOf(marker)+marker.length));
assert.equal(metrics.menus,worker.palette);
assert.equal(metrics.types,worker.types);
assert.equal(sourceFingerprint(),source,'검증 중 제품 소스가 변경되었습니다.');
const report=JSON.stringify({source,...metrics},null,2)+'\n';
if(process.argv.includes('--write'))writeFileSync(join(directory,'independent-results.json'),report);
process.stdout.write(report);
