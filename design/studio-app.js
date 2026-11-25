(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const catalog = window.StudioBlocks;
  const icon = name => window.StudioIcon(name);
  const catalogEntry = type => catalog.find(entry => entry.type === type);
  const basic = ['input.user_request','control.trigger','output.answer','control.terminate','agent.task','resource.context','control.branch'];
  const groups = {input:'시작·입력·종료',agent:'AI·Agent·협업',resource:'도구·자료·기억·연결',file:'파일·문서·RAG',flow:'흐름 제어·재사용',quality:'검토·승인·품질',error:'오류·보상'};
  const linkTypes = {flow:'진행',data:'데이터',reference:'참조'};
  const storeKey = 'library-agent-studio.design.v2';
  const oneSentence = '예시 이용규정을 근거로 한 문장으로 답하세요.';
  const withSource = '답을 먼저 쓰고, 다음 줄에 안내문의 근거 문장을 붙여 주세요.';
  const saturday = '토요일에도 여나요?';
  const membership = '회원증을 만들려면 무엇을 가져가나요?';
  const handbook = '평일에는 오전 9시부터 오후 6시까지, 토요일에는 오전 10시부터 오후 4시까지 엽니다. 일요일은 휴관합니다.\n한 사람의 대출 한도는 3권입니다.\n회원증을 처음 만들 때는 신분증을 가져오세요.\n이용 안내는 1층 안내데스크에서 도와드립니다.';
  const levels = [
    ['입문','질문을 바꿔 답변 받아보기','운영시간과 회원증 준비물을 차례로 물어보고 안내 Agent의 답변 지시를 바꿉니다.'],
    ['초급','내 안내자료로 답하게 만들기','대출 규정을 3권에서 5권으로 고치고 답변에 붙는 근거를 비교합니다.'],
    ['중급','답을 모를 때의 경로 만들기','근거 없는 질문을 안내데스크로 보내거나, 추가 정보를 묻는 경로로 연결합니다.'],
    ['고급','두 담당자의 답변 합치기','운영시간과 회원증 준비물을 각각 확인하고, 한쪽 자료가 빠진 경우를 살펴봅니다.'],
    ['전문가','규정 변경을 검증하고 배포하기','같은 시험 질문으로 두 버전을 비교하고 공개 전후와 복구 시점의 결과를 확인합니다.']
  ];
  const kinds = {'control.trigger':'start','control.terminate':'end','output.answer':'output','file.create':'output','resource.context':'resource','control.branch':'condition'};
  const groupKinds = {input:'input',agent:'agent',resource:'resource',file:'resource',flow:'condition',quality:'review',error:'review'};
  function makeNode(type,id,title,description,extra={}) {
    const entry=catalogEntry(type);
    return {id,type,kind:kinds[type]||groupKinds[entry.group],title:title||entry.name,description:description||entry.description,...extra};
  }
  function initialDesign() {
    return {nodes:[
      makeNode('input.user_request','input','질문 입력','사용자가 입력한 질문',{question:saturday}),
      makeNode('agent.task','agent','안내 Agent','도서관 이용 안내 담당',{goal:'참고 자료에 있는 정보로 이용자의 질문에 답합니다.',instruction:oneSentence,criterion:'질문에 필요한 사실을 확인하고 답변을 전달합니다.'}),
      makeNode('output.answer','output','답변 전달','질문한 사용자에게 전달'),
      makeNode('resource.context','resource','도서관 이용규정','운영시간 · 대출 · 회원증',{content:handbook})
    ],edges:[
      {id:'first',from:'input',to:'agent',kind:'flow',label:'사용자가 입력한 질문'},
      {id:'second',from:'agent',to:'output',kind:'data',label:'작성한 답변'},
      {id:'reference',from:'resource',to:'agent',kind:'reference',label:'예시 이용규정'}
    ],layout:{a:{},b:{}},visibility:'private'};
  }
  function parseStore(key,fallback) {
    try { const raw=localStorage.getItem(key);return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function isDesign(value) {return value && Array.isArray(value.nodes) && Array.isArray(value.edges);}
  const saved=parseStore(storeKey,null);
  let design=isDesign(saved) ? saved : initialDesign();
  let selected=design.nodes.length ? {kind:'node',id:(design.nodes.find(node=>node.id==='agent')||design.nodes[0]).id} : null;
  let paletteMode='basic', dirty=false, inspectMode='properties';
  let favorites=new Set(parseStore(storeKey+'.stars',[]));
  let versions=parseStore(storeKey+'.versions',[]);
  const undoStack=[], redoStack=[];
  const selectedNode=()=>selected?.kind==='node' ? design.nodes.find(n=>n.id===selected.id) : null;
  const selectedEdge=()=>selected?.kind==='edge' ? design.edges.find(e=>e.id===selected.id) : null;
  const nodeName=id=>design.nodes.find(n=>n.id===id)?.title||'블록 선택';
  const uid=prefix=>prefix+'-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
  function element(tag,text,css) {const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(css)item.className=css;return item;}
  function button(text,callback,css) {const el=element('button',text,css);el.type='button';el.onclick=callback;return el;}
  function glyph(name) {const span=element('span');span.setAttribute('aria-hidden','true');span.innerHTML=icon(name);return span;}
  function pane(name) {$('app-shell').dataset.pane=name;}
  function closeDialog(){if($('studio-dialog').open)$('studio-dialog').close();}
  function dialog(title,...children) {
    $('dialog-title').textContent=title;$('dialog-body').replaceChildren(...children);
    if(!$('studio-dialog').open)$('studio-dialog').showModal();
  }
  function hint(text){return element('p',text,'muted');}
  function status(text){$('status-text').textContent=text;}
  function remember() {undoStack.push(JSON.stringify(design));if(undoStack.length>50)undoStack.shift();redoStack.length=0;}
  function toolbar(){
    $('status-count').textContent=design.nodes.length+'개 블록 · '+design.edges.length+'개 연결';
    if($('save-badge'))$('save-badge').textContent=dirty?'편집 중':(saved||parseStore(storeKey,null)?'저장됨':'작업 초안');
    document.querySelectorAll('[data-action="undo"]').forEach(b=>b.disabled=!undoStack.length);
    document.querySelectorAll('[data-action="redo"]').forEach(b=>b.disabled=!redoStack.length);
  }
  function change(operation,message){remember();operation();dirty=true;render();if(message)status(message);}
  function popHistory(from,to){
    if(!from.length)return;
    to.push(JSON.stringify(design));design=JSON.parse(from.pop());dirty=true;
    if(!selectedNode()&&!selectedEdge())selected=null;
    render();status('편집 기록을 적용했습니다.');
  }
  function showSelection(kind,id,open=true){
    selected=id ? {kind,id}:null;inspectMode='properties';render();
    if(open&&id)pane('props');
  }
  const canvas=window.StudioCanvas.mount($('graph-root'),{
    onSelect:showSelection,
    onLayoutChange:(mode,positions)=>{
      if(!['a','b'].includes(mode)||!positions)return;
      if(JSON.stringify(design.layout?.[mode]||{})===JSON.stringify(positions))return;
      remember();design.layout||={};design.layout[mode]=structuredClone(positions);dirty=true;toolbar();
    }
  });
  function renderGraph(){canvas.render({nodes:design.nodes,edges:design.edges,variant:'b',selected,layout:design.layout});}
  function render(){
    renderGraph();inspector();toolbar();
  }
  function addBlock(entry){
    const node=makeNode(entry.type,uid('node'));
    if(node.kind==='agent'){node.goal='';node.instruction=oneSentence;node.criterion='';}
    if(node.kind==='input')node.question='';
    if(node.kind==='resource')node.content='';
    change(()=>{design.nodes.push(node);selected={kind:'node',id:node.id};inspectMode='properties';},entry.name+' 블록을 추가했습니다.');
    pane('props');
  }
  function displayPalette(){
    const list=$('palette-list'),query=$('palette-search').value.trim().toLocaleLowerCase(), group=$('palette-category').value;
    list.replaceChildren();
    for(const mode of ['basic','all','favorites'])$('palette-'+mode)?.setAttribute('aria-pressed',String(paletteMode===mode));
    for(const entry of catalog){
      if(paletteMode==='basic'&&!basic.includes(entry.type)||paletteMode==='favorites'&&!favorites.has(entry.type))continue;
      if(group&&entry.group!==group)continue;
      if(query&&!(entry.name+' '+entry.description+' '+groups[entry.group]).toLocaleLowerCase().includes(query))continue;
      const kind=kinds[entry.type]||groupKinds[entry.group],row=element('div',undefined,'palette-entry');
      const add=button('',()=>addBlock(entry),'palette-card');add.dataset.kind=kind;add.dataset.blockType=entry.type;add.setAttribute('aria-label',entry.name+' 추가');
      const chip=glyph(kind);chip.className='block-icon '+kind;
      const copy=element('span');copy.append(element('strong',entry.name),element('small',entry.description));add.append(chip,copy);
      const star=button('',()=>{if(favorites.has(entry.type))favorites.delete(entry.type);else favorites.add(entry.type);try{localStorage.setItem(storeKey+'.stars',JSON.stringify([...favorites]));}catch{}displayPalette();},'favorite-toggle');
      star.append(glyph('star'));star.setAttribute('aria-label',entry.name+' 즐겨찾기');star.setAttribute('aria-pressed',String(favorites.has(entry.type)));
      row.append(add,star);list.append(row);
    }
    if(!list.children.length)list.append(hint(paletteMode==='favorites'?'별표를 누른 블록이 여기에 표시됩니다.':'조건에 맞는 블록이 없습니다.'));
  }
  function field(label,control){const wrap=element('label',undefined,'field');wrap.append(element('span',label),control);return wrap;}
  function editor(item,key,label,multiline=false){
    const control=element(multiline?'textarea':'input');control.value=item[key]||'';control.dataset.field=key;
    if(multiline)control.rows=3;
    let recorded=false;control.onfocus=()=>{recorded=false;};
    control.oninput=()=>{if(!recorded){remember();recorded=true;}item[key]=control.value;dirty=true;
      if(['title','description','label'].includes(key))renderGraph();toolbar();status('변경 사항을 편집했습니다.');};
    return field(label,control);
  }
  function selectField(label,options,current,update){
    const select=element('select');for(const [value,name] of options)select.add(new Option(name,value));
    select.value=current;select.onchange=()=>update(select.value);return field(label,select);
  }
  function group(...children){const div=element('div',undefined,'form-stack');div.append(...children);return div;}
  function panelTitle(title,...actions){
    const header=element('div',undefined,'panel-heading');header.append(element('h2',title));
    if(actions.length){const bar=element('div',undefined,'panel-actions');bar.append(...actions);header.append(bar);}return header;
  }
  function iconButton(name,label,callback){const b=button('',callback,'icon-button');b.title=label;b.setAttribute('aria-label',label);b.append(glyph(name));return b;}
  function duplicateNode(node){
    change(()=>{const copy=structuredClone(node);copy.id=uid('node');copy.title+=' 사본';design.nodes.push(copy);selected={kind:'node',id:copy.id};},'블록을 복제했습니다.');
  }
  function removeSelection(){
    const node=selectedNode(),edge=selectedEdge();if(!node&&!edge)return;
    change(()=>{if(node){design.nodes=design.nodes.filter(n=>n.id!==node.id);design.edges=design.edges.filter(e=>e.from!==node.id&&e.to!==node.id);}
      else design.edges=design.edges.filter(e=>e.id!==edge.id);selected=null;},'선택한 항목을 삭제했습니다. 실행 취소로 복구할 수 있습니다.');
  }
  function newConnection(node) {
    const targets=design.nodes.filter(n=>n.id!==node.id);if(!targets.length){dialog('연결 추가',hint('먼저 연결할 블록을 하나 더 추가하세요.'));return;}
    let target=targets[0].id,kind=node.kind==='resource'?'reference':'flow';
    const message=hint('');
    const form=group(selectField('시작 블록',[[node.id,node.title]],node.id,()=>{}),selectField('다음 블록 선택',targets.map(n=>[n.id,n.title]),target,id=>{target=id;}),
      selectField('연결 종류',Object.entries(linkTypes),kind,v=>{kind=v;}),message,button('연결 추가',()=>{
        if(design.edges.some(e=>e.from===node.id&&e.to===target&&e.kind===kind)){message.textContent='같은 종류의 연결이 이미 있습니다.';return;}
        const edge={id:uid('edge'),from:node.id,to:target,kind,label:linkTypes[kind]};
        closeDialog();change(()=>{design.edges.push(edge);selected={kind:'edge',id:edge.id};},'연결을 추가했습니다.');
      },'primary'));
    dialog('연결 추가',form);
  }
  function validate(){
    const issues=[];
    for(const node of design.nodes){
      if(!node.title.trim())issues.push([node,'블록 이름을 입력하세요.']);
      if(!design.edges.some(edge=>edge.from===node.id||edge.to===node.id))issues.push([node,(node.title||'새 블록')+'에 연결이 없습니다.']);
      if(node.kind==='input'&&!design.edges.some(e=>e.from===node.id))issues.push([node,'질문을 전달할 다음 블록을 연결하세요.']);
      if(node.kind==='output'&&!design.edges.some(e=>e.to===node.id))issues.push([node,'이 블록이 전달할 결과를 연결하세요.']);
    }
    if(!design.nodes.length)issues.push([null,'블록 목록에서 시작 블록을 추가하세요.']);
    return issues;
  }
  function showInspectorCheck(panel){
    const issues=validate();panel.append(panelTitle('설계 검사'),hint(issues.length?'수정할 항목을 누르면 해당 블록으로 이동합니다.':'현재 블록의 이름과 기본 연결을 확인했습니다.'));
    for(const [node,msg] of issues)panel.append(button(msg,()=>node?showSelection('node',node.id):pane('palette')));
  }
  function inspector(){
    const panel=$('inspector');panel.replaceChildren();
    if(inspectMode==='check'){showInspectorCheck(panel);return;}
    const node=selectedNode(),edge=selectedEdge();
    if(edge){
      const options=design.nodes.filter(n=>n.id!==edge.from).map(n=>[n.id,n.title]);
      const edgeChange=(key,value)=>{
        const next={...edge,[key]:value};
        if(design.edges.some(e=>e.id!==next.id&&e.from===next.from&&e.to===next.to&&e.kind===next.kind)){inspector();status('같은 종류의 연결이 이미 있습니다.');return;}
        change(()=>{edge[key]=value;},'연결을 수정했습니다.');
      };
      panel.append(panelTitle('연결 속성',iconButton('trash','연결 삭제',removeSelection)),hint(nodeName(edge.from)+' → '+nodeName(edge.to)),
        group(selectField('다음 블록 선택',options,edge.to,id=>edgeChange('to',id)),selectField('연결 종류',Object.entries(linkTypes),edge.kind,v=>edgeChange('kind',v)),
          editor(edge,'label','넘겨줄 값 또는 참조할 자료')));return;
    }
    if(!node){panel.append(panelTitle('속성'),hint('캔버스에서 블록이나 연결선을 선택하세요.'));return;}
    panel.append(panelTitle('블록 속성',iconButton('copy','블록 복제',()=>duplicateNode(node)),iconButton('trash','블록 삭제',removeSelection)),hint(catalogEntry(node.type)?.description||'블록의 동작을 정의합니다.'));
    const fields=group(editor(node,'title','이름'));
    if(node.kind==='agent'){
      fields.append(editor(node,'description','역할 이름'),editor(node,'goal','목표',true),editor(node,'instruction','답변 지시',true),
        button(node.instruction===withSource?'한 문장으로 답하게 하기':'근거 문장도 붙이기',()=>change(()=>{node.instruction=node.instruction===withSource?oneSentence:withSource;})),editor(node,'criterion','완료 기준',true));
    }else if(node.kind==='input'){
      fields.append(editor(node,'question','사용자의 질문',true),selectField('예제 질문 고르기',[['','직접 입력'],[saturday,saturday],[membership,membership]],[saturday,membership].includes(node.question)?node.question:'',v=>change(()=>{node.question=v;})));
    }else if(node.kind==='resource'){fields.append(editor(node,'description','자료 설명'),editor(node,'content','자료 내용',true));}
    else fields.append(editor(node,'description','역할과 전달할 결과',true));
    fields.append(element('h3','연결'));
    for(const e of design.edges.filter(e=>e.from===node.id||e.to===node.id))fields.append(button(nodeName(e.from)+' → '+nodeName(e.to),()=>showSelection('edge',e.id)));
    fields.append(button('연결 추가',()=>newConnection(node)));panel.append(fields);
  }
  function save(){
    try {localStorage.setItem(storeKey,JSON.stringify(design));dirty=false;toolbar();status('이 브라우저에 설계 초안을 저장했습니다.');return true;}
    catch {status('브라우저 저장 공간을 사용할 수 없습니다. 내보내기로 설계를 보관하세요.');return false;}
  }
  function versionsView(){
    const list=group(hint('이 브라우저에 보관한 버전으로 돌아갈 수 있습니다.'),button('현재 설계를 새 버전으로 저장',()=>{
      const next=[{name:'버전 '+((versions[0]?.number||0)+1),number:(versions[0]?.number||0)+1,design:structuredClone(design)},...versions].slice(0,12);
      try{localStorage.setItem(storeKey+'.versions',JSON.stringify(next));versions=next;versionsView();}catch{status('버전을 저장할 공간이 없습니다.');}
    },'primary'));
    for(const v of versions)list.append(button(v.name+' 복원',()=>{closeDialog();change(()=>{design=structuredClone(v.design);selected=null;},v.name+'을 초안에 복원했습니다.');}));
    dialog('버전',list);
  }
  function templates(){
    const list=group();for(const [level,title,task] of levels){const item=element('section',undefined,'lesson-card');item.append(element('h3',level+' · '+title),hint(task));list.append(item);}
    const link=element('a','다섯 템플릿의 예제 질문과 완료 기준');link.href='./도서관-템플릿.md';list.append(link);dialog('템플릿 체험 과제',list);
  }
  function share(){
    dialog('공유 설정',group(hint('이 시안에서는 공개 범위를 초안에 기록합니다.'),
      selectField('공개 범위',[['private','나만 사용'],['public','모두에게 공개'],['link','비밀 링크']],design.visibility,v=>change(()=>{design.visibility=v;})),
      button('이 브라우저에 저장',()=>{if(save())closeDialog();},'primary')));
  }
  function exportDesign(){const file=new Blob([JSON.stringify(design,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download='도서관-안내-Agent.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function guide(){dialog('만들며 배우기',group(hint('질문 입력 블록에서 예제 질문을 고르고 예시 답변을 확인하세요. 안내 Agent의 지시를 ‘근거 문장도 붙이기’로 바꾼 뒤 같은 질문으로 비교할 수 있습니다.'),
    button('질문 입력 열기',()=>{closeDialog();const input=design.nodes.find(n=>n.kind==='input');if(input)showSelection('node',input.id);else pane('palette');}),button('수준별 과제 보기',templates)));}
  function preview(){
    const input=design.nodes.find(n=>n.id==='input'),agent=design.nodes.find(n=>n.id==='agent'),resource=design.nodes.find(n=>n.id==='resource');
    const graphMatches=design.edges.some(e=>e.from==='input'&&e.to==='agent'&&e.kind==='flow')&&design.edges.some(e=>e.from==='agent'&&e.to==='output'&&e.kind==='data')&&design.edges.some(e=>e.from==='resource'&&e.to==='agent'&&e.kind==='reference');
    const question=input?.question?.trim(),instructions=agent?.instruction?.trim();
    const examples={
      [saturday]:['네. 토요일은 오전 10시부터 오후 4시까지 엽니다.','평일에는 오전 9시부터 오후 6시까지, 토요일에는 오전 10시부터 오후 4시까지 엽니다.'],
      [membership]:['회원증을 만들려면 신분증을 가져오세요.','회원증을 처음 만들 때는 신분증을 가져오세요.']
    };
    const example=Object.hasOwn(examples,question)?examples[question]:null;
    if(!graphMatches||design.nodes.length!==4||design.edges.length!==3||!example||![oneSentence,withSource].includes(instructions)||resource?.content!==handbook){
      dialog('예시 답변',hint('이 시안에는 입문 템플릿의 두 질문과 두 가지 답변 지시에 대한 기록이 있습니다. 현재 설계를 실행하려면 실제 AI 연결이 필요합니다.'));return;
    }
    const content=group(hint('입문 템플릿에 미리 작성한 예시입니다.'),element('h3',question),element('p',example[0]));
    if(instructions===withSource)content.append(element('blockquote',example[1]));
    const trace=element('details');trace.append(element('summary','블록별 예시 기록'));const list=element('ol');
    for(const text of [input.title+' · '+question,resource.title+' · '+example[1],agent.title+' · '+instructions,nodeName('output')+' · '+example[0]])list.append(element('li',text));
    trace.append(list);content.append(trace);dialog('예시 답변',content);
  }
  function resourceList(){const content=group();
    for(const n of design.nodes.filter(n=>n.kind==='resource'))content.append(button(n.title,()=>{closeDialog();showSelection('node',n.id);}));
    if(!content.children.length)content.append(hint('아직 연결할 자료가 없습니다.'));dialog('도구 및 자료',content);}
  function sharedList(){const isPrivate=design.visibility==='private';
    dialog('공유 Agent',group(hint(isPrivate?'현재 설계의 공개 범위는 나만 사용입니다.':'현재 초안의 공개 범위는 '+(design.visibility==='link'?'비밀 링크':'모두에게 공개')+'입니다.'),button('공유 설정 열기',share)));}
  function projectList(){dialog('내 프로젝트',group(button('도서관 안내 Agent 열기',()=>{closeDialog();pane('canvas');}),hint('현재 브라우저에서 편집하는 설계입니다.')));}
  const actions={edit:()=>{closeDialog();pane('canvas');},templates,projects:projectList,resources:resourceList,shared:sharedList,guide,
    share,undo:()=>popHistory(undoStack,redoStack),redo:()=>popHistory(redoStack,undoStack),export:exportDesign,
    'close-pane':()=>pane('canvas'),'close-dialog':closeDialog};
  for(const mode of ['basic','all','favorites'])actions['palette-'+mode]=()=>{paletteMode=mode;$('palette-search').value='';$('palette-category').value='';displayPalette();};
  document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target){const fn=actions[target.dataset.action];if(fn)fn();}});
  const commands={arrange:()=>canvas.arrange(),'list-mode':()=>{const list=canvas.toggleList();$('list-mode').setAttribute('aria-pressed',String(list));},guide,validate:()=>{inspectMode='check';inspector();pane('props');},run:preview,save,versions:versionsView,share,template:templates,'sidebar-open':()=>pane('nav'),'palette-open':()=>pane('palette'),'props-open':()=>pane('props')};
  for(const [id,fn] of Object.entries(commands))$(id)?.addEventListener('click',fn);
  for(const [id,name] of Object.entries(groups))$('palette-category').add(new Option(name,id));
  $('palette-category').onchange=displayPalette;$('palette-search').oninput=()=>{if($('palette-search').value.trim()&&paletteMode==='basic')paletteMode='all';displayPalette();};
  $('studio-dialog').addEventListener('click',event=>{if(event.target===$('studio-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('studio-dialog').open)pane('canvas');});
  displayPalette();render();
})();
