import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {inspectionReceiverModule} from './equipment-inspection-example';

const shell=readFileSync(join(process.cwd(),'src/domain/equipment-inspection-starters-shell.html'),'utf8');
const starters=readFileSync(join(process.cwd(),'src/domain/inspection-starters.mjs'),'utf8');
const receiverUrl='data:text/javascript;base64,'+Buffer.from(inspectionReceiverModule).toString('base64');
export const inspectionStartersHtml=shell
  .replace('<!-- shared receiver -->',()=>'<script type="importmap">'+JSON.stringify({imports:{'./inspection-receiver.mjs':receiverUrl}})+'</script>')
  .replace('/* starter module */',()=>starters);
