import {workOne} from './runs';
import {dispatchDue} from './triggers';
import {purgeExpiredProjects} from './projects';
import {purgeExpiredAssets} from './asset-trash';
import {setTimeout as schedule} from 'node:timers';
import {setTimeout} from 'node:timers/promises';
let shuttingDown=false;
process.on('SIGTERM',()=>{shuttingDown=true;});process.on('SIGINT',()=>{shuttingDown=true;});
async function loop(){while(!shuttingDown){try{dispatchDue();if(!await workOne())await setTimeout(400);}catch(e){console.error('실행기 오류:',e instanceof Error?e.message:'unknown');await setTimeout(1000);}}}

function maintainTrash() {
  if (shuttingDown) return;
  let delayMs = 60_000;
  try {
    // Drain an expiry backlog in batches, yielding to queued Agent runs in between.
    const projects = purgeExpiredProjects();
    const assets = purgeExpiredAssets();
    if (projects + assets > 0) delayMs = 1000;
  } catch (error) {
    console.error('휴지통 정리 오류', error instanceof Error ? error.message : 'unknown');
  }
  schedule(maintainTrash, delayMs).unref();
}

maintainTrash();
await Promise.all([loop(),loop()]);

