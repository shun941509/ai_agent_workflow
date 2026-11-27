// node --import tsx tests/agent-export-native.ts <codex|claude|opencode> <absolute CLI> [parallel-team|agent-workflow-tool]
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join} from 'node:path';
import {promisify} from 'node:util';
import {strFromU8,unzipSync} from 'fflate';
import {parse} from 'yaml';
import {connectBlocks,createBlock} from '../src/domain/graph';
import type {Graph} from '../src/domain/types';
import {buildAgentZip} from '../src/server/agent-zip';

const [client,binary,artifact]=process.argv.slice(2);
assert.ok(!artifact||['parallel-team','agent-workflow-tool'].includes(artifact));
assert.ok(['codex','claude','opencode'].includes(client)&&binary&&isAbsolute(binary),'클라이언트 이름과 실행 파일의 절대 경로를 지정하세요.');
const scratch=mkdtempSync(join(tmpdir(),'workflow-native-probe-'));
const project=join(scratch,'project'),profile=join(scratch,'profile'),config=join(profile,'.codex');
for(const folder of [project,profile,config])mkdirSync(folder,{recursive:true});
let marker='PROJECT-'+randomUUID();
const skill='sample-reading',mcp='sample-library';
let roles:string[]=[],skillDescription='',modelRequests=0,rootLoaded=false,skillLoaded=false,roleLoaded=false;
const endpoints=new Map<string,number>();
const childFiles=new Set<string>(),returned=new Set<string>();
const delegate=artifact==='parallel-team';
type Part={type:string;text?:string};
const spawned=new Map<string,{call:string;id?:string}>();
const readCalls=new Map<string,string>();
const readFailures=new Set<string>();
let waitCalls=0;
const modelServer=createServer(async(req,res)=>{
  const chunks=[];
  for await(const chunk of req)chunks.push(chunk);
  const raw=Buffer.concat(chunks).toString();
  const endpoint=(req.url??'').split('?')[0];endpoints.set(endpoint,(endpoints.get(endpoint)??0)+1);
  if(endpoint==='/mcp'){
    if(!raw){res.writeHead(405);res.end();return;}
    const call=JSON.parse(raw);
    if(call.id==null){res.writeHead(202);res.end();return;}
    const result=call.method==='initialize'?{protocolVersion:call.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:mcp,version:'1'}}:{tools:[{name:'lookup',inputSchema:{type:'object',properties:{}}}]};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result}));
  }else if(endpoint.includes('/messages')&&!endpoint.includes('count_tokens')){
    modelRequests++;
    rootLoaded||=raw.includes(marker);skillLoaded||=Boolean(skillDescription&&raw.includes(skillDescription));
    const body=JSON.parse(raw);
    let text=raw.includes(marker)?marker:'ready';
    const calls:{name:string;input:Record<string,unknown>}[]=[];
    if(delegate){
      const messages=body.messages as {role:string;content:string|Part[]}[];
      const userText=messages.filter(m=>m.role==='user').flatMap(m=>typeof m.content==='string'?[m.content]:m.content.filter(p=>p.type==='text').map(p=>p.text??'')).join('\n');
      const toolResults=JSON.stringify(messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='tool_result'):[]));
      const child=roles.find(role=>userText.includes('NATIVE-CHILD-'+role));
      const toolNames=(body.tools??[]).map((t:{name:string})=>t.name);
      const spawn=toolNames.find((name:string)=>['task','Task','Agent'].includes(name));
      if(child){
        const path=join(project,'agents',child+'.md');
        const assignment=readFileSync(path,'utf8').split('\n').find(line=>/^- (맡길 일|이어갈 일) — /.test(line))!;
        if(toolResults.includes(assignment)){
          childFiles.add(child);text='CHILD-FINISHED-'+child;
        }else if(!toolResults.includes('tool_result')){
          const isClaude=toolNames.includes('Read');
          calls.push({name:isClaude?'Read':'read',input:isClaude?{file_path:path}:{filePath:path}});
        }
      }else if(userText.includes('Collect the assigned roles')&&spawn){
        for(const role of roles){
          if(toolResults.includes('CHILD-FINISHED-'+role))returned.add(role);
          else if(!raw.includes('NATIVE-CHILD-'+role))calls.push({name:spawn,input:{subagent_type:role,description:'Read assigned role instruction',
            prompt:'NATIVE-CHILD-'+role+' Read your project role instructions and report completion.'}});
        }
      }
    }
    const message={id:'msg_test',type:'message',model:'claude-sonnet-4-6',role:'assistant',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:50,output_tokens:1}};
    if(body.stream){
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const blocks=calls.length?calls.map(({name,input},index)=>({start:{type:'tool_use',name,id:'tool_'+randomUUID(),input:{}},delta:{type:'input_json_delta',partial_json:JSON.stringify(input)},index}))
        :[{start:{type:'text',text:''},delta:{type:'text_delta',text},index:0}];
      const frames=[{type:'message_start',message},...blocks.flatMap(({start,delta,index})=>[
        {type:'content_block_start',index,content_block:start},{type:'content_block_delta',index,delta},{type:'content_block_stop',index}]),
        {type:'message_delta',delta:{stop_reason:calls.length?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:1}},{type:'message_stop'}];
      for(const frame of frames)res.write('event: '+frame.type+'\ndata: '+JSON.stringify(frame)+'\n\n');
      res.end();
    }else{
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({...message,content:[{type:'text',text}],stop_reason:'end_turn'}));
    }
  }else if(endpoint.includes('/responses')){
    modelRequests++;
    const body=JSON.parse(raw),text=JSON.stringify(body.input);
    rootLoaded||=text.includes(marker);skillLoaded||=Boolean(skillDescription&&text.includes(skillDescription));
    roleLoaded||=roles.length>0&&roles.every(role=>JSON.stringify(body.tools).includes(role));
    const tools=body.tools.flatMap((tool:{type:string;name:string;tools?:{name:string}[]})=>tool.tools?tool.tools.map(t=>({name:t.name,namespace:tool.name})):[{name:tool.name}]);
    const calls:{type:string;id:string;call_id:string;name:string;namespace?:string;arguments:string}[]=[];
    const call=(name:string,args:object)=>{
      const t=tools.find((t:{name:string})=>t.name===name);
      const id='call_'+randomUUID();
      calls.push({type:'function_call',id:'fc_'+randomUUID(),call_id:id,name,...(t?.namespace?{namespace:t.namespace}:{}),arguments:JSON.stringify(args)});
      return id;
    };
    let answer=rootLoaded?marker:'ready';
    if(delegate&&modelRequests<35){
      const userText=JSON.stringify(body.input.filter((item:{role?:string})=>item.role==='user'));
      const results=body.input.filter((item:{type:string})=>item.type==='function_call_output');
      const child=roles.find(role=>userText.includes('NATIVE-CHILD-'+role));
      if(child){
        const path=join(project,'agents',child+'.md');
        const assignment=readFileSync(path,'utf8').split('\n').find(line=>/^- (맡길 일|이어갈 일) — /.test(line))!;
        const result=results.find((item:{call_id:string})=>item.call_id===readCalls.get(child));
        if(result){
          const output=JSON.stringify(result.output);
          const digest=createHash('sha256').update(readFileSync(path)).digest('hex');
          if(output.includes(assignment)||output.toLowerCase().includes(digest))childFiles.add(child);
          else{
            const detail=typeof result.output==='string'?result.output:JSON.stringify(result.output);
            readFailures.add(detail.includes('CreateProcess')?detail.slice(0,1400):'The shell response did not contain the requested role instruction.');
          }
          answer=(childFiles.has(child)?'CHILD-FINISHED-':'CHILD-BLOCKED-')+child;
        }else{
          const shell=tools.find((t:{name:string})=>['exec_command','shell_command'].includes(t.name));
          if(shell&&!readCalls.has(child)){
            const file="'agents/"+child+".md'";
            const command='Get-Content -Raw -Encoding UTF8 -LiteralPath '+file;
            readCalls.set(child,call(shell.name,shell.name==='exec_command'?{cmd:command}:{command}));
          }else{
            if(!shell)readFailures.add('The child provider request exposed no exec_command or shell_command tool.');
            answer='CHILD-BLOCKED-'+child;
          }
        }
      }else if(userText.includes('Collect the assigned roles')){
        for(const role of roles){
          const job=spawned.get(role);
          if(!job){
            const id=call('spawn_agent',{agent_type:role,fork_context:false,message:'NATIVE-CHILD-'+role+' Read your project role instructions and report completion.'});
            spawned.set(role,{call:id});
          }else{
            const result=results.find((item:{call_id:string})=>item.call_id===job.call);
            if(result)job.id=JSON.stringify(result.output).match(/[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}/)?.[0];
          }
          if(['CHILD-FINISHED-','CHILD-BLOCKED-'].some(prefix=>JSON.stringify(results).includes(prefix+role)))returned.add(role);
        }
        const pending=[...spawned].filter(([role,job])=>job.id&&!returned.has(role)).map(([,job])=>job.id);
        if(!calls.length&&pending.length&&++waitCalls<9)call('wait_agent',{targets:pending,timeout_ms:10000});
      }
    }
    const output={id:'msg_'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
    const response={id:'resp_'+randomUUID(),object:'response',created_at:1,model:'gpt-5',status:'completed',output:calls.length?calls:[output],usage:{input_tokens:10,output_tokens:2,total_tokens:12}};
    const frames=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},...(calls.length?calls.flatMap((item,output_index)=>[
      {type:'response.output_item.added',output_index,item:{...item,arguments:''}},
      {type:'response.function_call_arguments.delta',output_index,item_id:item.id,delta:item.arguments},
      {type:'response.output_item.done',output_index,item}])
      :[{type:'response.output_item.added',output_index:0,item:{...output,status:'in_progress',content:[]}},
        {type:'response.output_text.delta',item_id:output.id,output_index:0,content_index:0,delta:answer},
        {type:'response.output_item.done',output_index:0,item:output}]),{type:'response.completed',response}];
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for(const [index,frame] of frames.entries())res.write('event: '+frame.type+'\ndata: '+JSON.stringify({...frame,sequence_number:index})+'\n\n');
    res.end();
  }else{
    res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"offline fixture"}');
  }
});
await new Promise<void>(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
const port=(modelServer.address() as {port:number}).port,url='http://127.0.0.1:'+port;
// Some native HTTP clients send even localhost requests through their configured proxy.
// Permit a tunnel only back to this fixture's listener.
modelServer.on('connect',(request,socket,head)=>{
  if(request.url!=='127.0.0.1:'+port){socket.destroy();return;}
  const local=connect(port,'127.0.0.1',()=>{
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if(head.length)local.write(head);
    socket.pipe(local).pipe(socket);
  });
  local.on('error',()=>socket.destroy());socket.on('error',()=>local.destroy());
});
try{
  const name='sample-reviewer';
  const graph:Graph={nodes:[createBlock('input.user_request',{id:'start'}),createBlock('agent.delegate',{id:'review',title:'검토',config:{role:name,task:'작업 결과로 '+marker+'를 반환하세요.'}}),
    createBlock('output.answer',{id:'end'}),createBlock('instruction.skill',{id:'skill',config:{exportResource:'r-skill'}})],edges:[]};
  graph.edges.push(...connectBlocks(graph,'start','review'),...connectBlocks(graph,'review','end'),
    {from:'skill',to:'review',id:'skill-link',kind:'reference',input:'skill',out:'ref'});
  // Place the marker in the root, so a matching reply proves the host loaded the ZIP.
  const resourcePath='resources/r-skill/SKILL.md';
  const bytes=artifact?readFileSync(join('artifacts','agent-zip-audit',artifact+'.zip')):buildAgentZip({title:marker,graph,resources:[{key:'r-skill',kind:'skill',name:skill,version:'1',available:true,included:true,files:[resourcePath],steps:['검토']},
    {key:'r-mcp',kind:'mcp',name:mcp,version:'1',available:true,included:true,files:[],steps:['검토'],mcp:{id:mcp,url:url+'/mcp',tools:['lookup']}}],
    files:[{path:resourcePath,data:Buffer.from('---\nname: '+skill+'\ndescription: Local sample instructions\n---\nRead the supplied note.').toString('base64')}]});
  const zip=unzipSync(bytes);
  marker=strFromU8(zip['AGENTS.md']).split('\n')[0].slice(2);
  const skillPath=Object.keys(zip).find(path=>path.startsWith('.agents/skills/')&&path.endsWith('/SKILL.md'));
  if(skillPath)skillDescription=parse(strFromU8(zip[skillPath]).split('---')[1]).description;
  for(const [path,data] of Object.entries(zip)){
    assert.ok(!path.includes('\\')&&!path.includes(':')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'));
    const file=join(project,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,data);
  }
  roles=Object.keys(zip).filter(path=>path.startsWith('agents/')).map(path=>path.slice(7,-3));
  // Only system executable paths are inherited. Account settings, API keys and CLI state are synthetic.
  const env:NodeJS.ProcessEnv={NODE_ENV:'test'};
  for(const key of ['Path','PATH','PATHEXT','SystemRoot','windir','COMSPEC','TEMP','TMP','ProgramFiles','ProgramFiles(x86)']){
    if(process.env[key])env[key]=process.env[key];
  }
  Object.assign(env,{HOME:profile,USERPROFILE:profile,APPDATA:join(profile,'roaming'),LOCALAPPDATA:join(profile,'local'),CODEX_HOME:config,
    XDG_CONFIG_HOME:join(profile,'config'),XDG_DATA_HOME:join(profile,'data'),XDG_CACHE_HOME:join(profile,'cache'),XDG_STATE_HOME:join(profile,'state'),
    CLAUDE_CONFIG_DIR:join(profile,'claude'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',DISABLE_TELEMETRY:'1',
    ANTHROPIC_BASE_URL:url,ANTHROPIC_API_KEY:'synthetic',OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',
    OPENCODE_CONFIG_CONTENT:JSON.stringify({enabled_providers:['anthropic'],provider:{anthropic:{options:{baseURL:url+'/v1',apiKey:'synthetic'}}}}),
    HTTP_PROXY:url,HTTPS_PROXY:url,NO_PROXY:'127.0.0.1,localhost',API_TIMEOUT_MS:'6000'});
  const run=async(args:string[])=>{
    const js=/\.[cm]?js$/i.test(binary);
    try{
      const pending=promisify(execFile)(js?process.execPath:binary,js?[binary,...args]:args,{cwd:project,env,windowsHide:true,timeout:60000,maxBuffer:32*1024*1024});
      pending.child.stdin?.end();
      const {stdout}=await pending;
      return stdout;
    }catch(error){
      const failure=error as {code?:number;signal?:string;stderr?:string};
      const debug=join(scratch,'claude-probe.log');
      const tail=existsSync(debug)?readFileSync(debug,'utf8').split('\n').filter(line=>/error|warn|retry|query|request|git-bash/i.test(line)).slice(-12).join('\n'):'';
      throw Error(client+' '+args[0]+' ('+(failure.code??failure.signal)+') '+JSON.stringify(Object.fromEntries(endpoints))+' '+(failure.stderr??'').slice(-650)+' '+tail.slice(-1500));
    }
  };
  if(client==='codex'){
    writeFileSync(join(config,'config.toml'),'model="gpt-5"\nmodel_provider="localprobe"\n[model_providers.localprobe]\nname="Local Probe"\nbase_url="'+url+'/v1"\nwire_api="responses"\n[projects.'+JSON.stringify(project)+']\ntrust_level="trusted"\n');
    if(!artifact){
      const configList=await run(['mcp','get',mcp,'--json']);
      assert.ok(configList.includes(mcp)&&configList.includes('lookup'),'Codex MCP와 허용 도구');
    }
    const prompt=await run(['debug','prompt-input','Read the current project instructions.']);
    rootLoaded=prompt.includes(marker);skillLoaded=Boolean(skillDescription&&prompt.includes(skillDescription));
    assert.ok(rootLoaded&&(!skillPath||skillLoaded),'Codex의 모델 문맥에 공통 지침과 선택한 Skill이 있어야 합니다.');
    const response=await run(['exec','--skip-git-repo-check','--ephemeral','--sandbox','read-only',delegate?'Collect the assigned roles and return the project title.':'Return the identifier from the project instructions.']);
    assert.ok(modelRequests>0&&response.includes(marker),'Codex의 로컬 모의 모델 응답');
  }else if(client==='claude'){
    const agents=await run(['agents','--setting-sources','project']);
    roleLoaded=roles.length>0&&roles.every(role=>agents.includes(role));
    assert.ok(!roles.length||roleLoaded,'Claude 역할 등록');
    const response=await run(['--print','--debug-file',join(scratch,'claude-probe.log'),'--setting-sources','project','--strict-mcp-config','--tools','Read,Skill,Agent','--allowedTools','Read,Skill,Agent','--no-session-persistence',
      '--model','claude-sonnet-4-6','--output-format','json',delegate?'Collect the assigned roles and return the project title.':'Return the identifier from the project instructions.']);
    assert.ok(rootLoaded&&response.includes(marker),'Claude의 모의 모델 요청 및 최종 응답');
  }else{
    const configs=await run(['debug','config']);
    if(!artifact)assert.ok(configs.includes(mcp),'OpenCode MCP 설정');
    const agents=await run(['agent','list']);
    roleLoaded=roles.length>0&&roles.every(role=>agents.includes(role));
    skillLoaded=Boolean(skillDescription&&(await run(['debug','skill'])).includes(skillDescription));
    assert.ok((!roles.length||roleLoaded)&&(!skillPath||skillLoaded),'OpenCode 역할 및 Skill 등록');
    const response=await run(['run','--model','anthropic/claude-sonnet-4-6',delegate?'Collect the assigned roles and return the project title.':'Return the identifier from the project instructions.']);
    assert.ok(modelRequests>0&&rootLoaded&&response.includes(marker),'OpenCode의 로컬 모의 모델 응답');
  }
  if(delegate){
    for(const role of roles.filter(name=>!childFiles.has(name))){
      const policyBlocked=client==='codex'&&readCalls.has(role)&&[...readFailures].some(detail=>
        detail.includes('agents/'+role+'.md')&&detail.includes('CreateProcess')&&detail.includes('blocked by policy'));
      assert.ok(policyBlocked,'역할 원문을 읽지 못했습니다: '+role);
      process.exitCode=2;
    }
    assert.deepEqual([...returned].sort(),[...roles].sort(),'대표가 두 하위 작업 결과를 모두 회수 '+JSON.stringify({modelRequests,spawned:[...spawned],reads:readCalls.size,waitCalls}));
  }
  if(roles.length)assert.ok(roleLoaded,client+'의 등록 역할');
  if(skillPath)assert.ok(skillLoaded,client+'의 등록 Skill');
  console.info(JSON.stringify({client,status:process.exitCode===2?'partial':'passed',version:(await run(['--version'])).trim(),runnerNode:process.version,artifact:artifact??'synthetic',sha256:createHash('sha256').update(bytes).digest('hex'),
    rootLoaded,skillLoaded:skillPath?skillLoaded:null,rolesRegistered:roleLoaded?roles.length:0,roleNames:roleLoaded?roles:[],modelRequests,childFilesRead:childFiles.size,
    childResultsReturned:returned.size,returnedRoles:[...returned],...(client==='codex'&&delegate?{waitCalls,childSessions:[...spawned].map(([role,job])=>({role,id:job.id}))}:{}),
    ...(readFailures.size?{readFailures:[...readFailures]}:{})}));
}finally{
  modelServer.closeAllConnections();modelServer.close();
  await rm(scratch,{recursive:true,force:true,maxRetries:12,retryDelay:250});
}
