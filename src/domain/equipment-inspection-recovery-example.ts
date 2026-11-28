import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {inspectionReceiverModule} from './equipment-inspection-example';

export const inspectionRecoveryModule=readFileSync(join(process.cwd(),'src/domain/inspection-recovery.mjs'),'utf8');
const page=readFileSync(join(process.cwd(),'src/domain/equipment-inspection-recovery-shell.html'),'utf8');
const markdown=readFileSync(join(process.cwd(),'src/domain/markdown-section.mjs'));
// Resolve the shared inventory module even when this document is opened from an extracted ZIP.
export const inspectionRecoveryHtml=page
  .replace('<!-- shared-module -->',()=>'<script type="importmap">'+JSON.stringify({imports:{
    './inspection-receiver.mjs':'data:text/javascript;base64,'+Buffer.from(inspectionReceiverModule).toString('base64'),
    './markdown-section.mjs':'data:text/javascript;base64,'+markdown.toString('base64'),
  }})+'</script>')
  .replace('/* recovery-module */',()=>inspectionRecoveryModule);
