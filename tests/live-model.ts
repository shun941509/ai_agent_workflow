/** Opt-in network smoke: npm exec tsx tests/live-model.ts. Never print credentials. */
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { model } from '../src/server/model';
import { executeGraph } from '../src/engine';
import { templates } from '../src/domain';
import type { Graph } from '../src/domain/types';

const n=randomInt(12,27),owner='담당 '+String.fromCharCode(65+randomInt(0,26));
const graph:Graph={nodes:[
  {id:'in',type:'input.user_request',title:'회의 내용',x:0,y:0,config:{}},
  {id:'agent',type:'ai.single_task',title:'회의록 정리',x:200,y:0,config:{goal:'제공한 회의록에서 결정과 담당자를 추출합니다.',instruction:'결정 사항과 담당자를 원문에서 그대로 한 줄로 작성하세요. 담당자가 없는 항목은 미정으로 적으세요.'}},
  {id:'out',type:'output.answer',title:'결정 사항',x:400,y:0,config:{}}
],edges:['in','agent'].flatMap((id,i)=>['flow','data'].map((kind)=>({
  id:id+'-'+kind,kind:kind as 'flow'|'data',from:id,to:i?'out':'agent',out:kind==='flow'?'next':'value',input:kind==='flow'?'in':'input'
})))};
async function live(g:Graph,input:string){
  const r=await executeGraph(g,{runId:crypto.randomUUID(),input},{model,tool:async()=>{throw Error('예상하지 못한 도구 호출');}});
  assert.equal(r.status,'completed',r.error??r.wait?.prompt??'실행이 완료되지 않았습니다.');
  return r;
}
try{
  const r=await live(graph,'오늘 회의 결정: 자료집 '+n+'권을 준비합니다. '+owner+'가 맡습니다. 홍보 계획은 담당자가 아직 정해지지 않았습니다.');
  assert.match(r.output,new RegExp(String(n)));assert.ok(r.output.includes(owner));assert.match(r.output,/미정/);
  console.log('PASS live OpenAI meeting, fresh input / owner / missing owner / '+r.checkpoint.counts.modelCalls+' model call(s)');
  const parallel=templates.find(t=>t.id==='parallel')!;
  const reduced=structuredClone(parallel.graph);
  const team=reduced.nodes.find(n=>n.type==='agent.team')!.graph!;
  team.edges=team.edges.filter(e=>!(e.kind==='reference'&&e.from==='membership-document'));
  const p=await live(reduced,parallel.question);
  const lookups=p.events.filter(e=>e.kind==='lookup');
  assert.equal(lookups.length,2);assert.match(p.output,/10시|10:00/);assert.match(p.output,/4시|16시|16:00/);
  assert.match(p.output,/확인|자료|근거/); assert.ok(!p.output.includes('신분증'),'제외한 회원증 근거에서 나온 단정을 확인하세요.');
  console.log('PASS live parallel RAG partial result, two independent searches and one final response');
}catch(e){
  const err=e instanceof Error?e:new Error(String(e));
  console.error(err.message);if(err.cause instanceof Error)console.error(err.cause.name+' '+err.cause.message.replace(/Bearer [^\s]+/gi,'[redacted]'));
  process.exitCode=1;
}
