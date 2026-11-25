import assert from 'node:assert/strict';
import { registerBrowserAccount } from './browser-account';
import { existsSync, mkdirSync } from 'node:fs';
import {mkdtemp,readFile,rm,rmdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { chromium,expect,type BrowserContext } from '@playwright/test';
import { createBlock,templates } from '../src/domain';
import type { Graph } from '../src/domain/types';

const baseURL=process.env.STUDIO_TEST_URL;
if(!baseURL)throw new Error('격리 시험 서버의 STUDIO_TEST_URL을 지정하세요.');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(chrome)?chrome:undefined)});
const context=await browser.newContext({baseURL,viewport:{width:1200,height:900}});
context.setDefaultTimeout(15000);
async function api(ctx:BrowserContext,action:string,data:unknown={}){
  const response=await ctx.request.post('/api/studio',{data:{action,data}}),payload=await response.json();
  assert.ok(response.ok(),action+' '+response.status()+' '+(payload.error||''));return payload.data;
}
async function checkInlineLibraryRule(ctx: BrowserContext) {
  const copy = await api(ctx, 'project.create', { lesson: 'beginner' });
  const original = (copy.graph as Graph).nodes.find(node => node.id === 'rules')!.config.content as string;
  const readSaved = async () => {
    const project = await api(ctx, 'project.open', { id: copy.id });
    return (project.graph as Graph).nodes.find(node => node.id === 'rules')!.config.content;
  };
  const page = await ctx.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.goto('/?edit=' + copy.id);
    const chooseBlock = (name: string) => page.getByRole('button', { name: name + ' 블록 속성', exact: true }).click();
    await chooseBlock('도서관 이용규정');
    const source = page.getByRole('textbox', { name: '자료 원문', exact: true });
    const apply = page.getByRole('button', { name: '변경 적용', exact: true });
    await expect(source).toHaveValue(original);
    await source.fill(' ');
    await expect(apply).toBeDisabled();
    await chooseBlock('도서관 안내 Agent');
    await page.keyboard.press('Control+s');
    await expect(source).toBeFocused();
    await expect(source).toHaveAttribute('aria-invalid', 'true');
    assert.equal(await readSaved(), original);
    const changed = original.replace('3권', '5권');
    assert.notEqual(original, changed);
    await source.fill(changed);
    await chooseBlock('도서관 안내 Agent');
    await chooseBlock('도서관 이용규정');
    await expect(source).toHaveValue(changed);
    assert.equal(await readSaved(), original);
    await chooseBlock('도서관 안내 Agent');
    await page.getByLabel('프로젝트 메뉴', {exact:true}).click();
    await page.getByRole('button', {name:'저장', exact:true}).click();
    await expect.poll(readSaved).toBe(changed);
    await page.reload();
    await chooseBlock('도서관 이용규정');
    await expect(source).toHaveValue(changed);
    const shortcutEdit = changed.replace('5권', '6권');
    await source.fill(shortcutEdit);
    await source.press('Control+s');
    await expect.poll(readSaved).toBe(shortcutEdit);
    await expect(page.locator('[data-workflow-node="rules"] .ws-material-preview')).toContainText('6권');

    await page.getByRole('tab', { name:'속성', exact:true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileInspector = page.getByRole('dialog', { name:'속성 패널' });
    await expect(mobileInspector.getByRole('textbox', { name:'자료 원문' })).toHaveValue(shortcutEdit);
    await mobileInspector.getByRole('button', { name:'속성 닫기' }).click();
    await expect(mobileInspector).toHaveCount(0);
    await page.getByRole('button', { name: '속성 열기', exact: true }).click();
    await expect(mobileInspector.getByRole('textbox', { name:'자료 원문' })).toHaveValue(shortcutEdit);
    const mobileText = changed + '\n방학 중에도 같은 대출 한도를 적용합니다.';
    await source.fill(mobileText);
    await apply.click();
    await expect.poll(readSaved).toBe(mobileText);
    const fresh = await api(ctx, 'project.create', { lesson: 'beginner' });
    assert.equal((fresh.graph as Graph).nodes.find(node => node.id === 'rules')!.config.content, original);
    console.log('PASS library source validation, menu and keyboard saves, SQLite reopen, mobile apply and independent template copy');
  } finally {
    await page.close();
  }
}
async function checkQuestionDrafts(project: {id:string;title:string}, embedded:boolean, mobile:boolean) {
  const session=await browser.newContext({baseURL,storageState:embedded?await context.storageState():undefined,
    viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile});
  const page=await session.newPage();
  async function capture(name:string){
    const folder=process.env.STUDIO_SCREENSHOTS;
    if(!folder)return;
    mkdirSync(folder,{recursive:true});
    await page.screenshot({path:join(folder,name+'-'+(embedded?'editor':'published')+'-'+(mobile?'390':'1440')+'.png')});
  }
  let connected=false, submission=0, resume=()=>{};
  const gate=new Promise<void>(resolve=>{resume=resolve;});
  try {
    if (!embedded) await registerBrowserAccount(session);
    const initialRunCount=(await api(session,'run.list',{id:project.id})).length;
    await page.route('**/api/studio',async route=>{
      const action=route.request().postDataJSON().action;
      if(action==='run.start')submission++;
      if((action==='run.inputFiles' && !connected) || (action==='run.start' && submission===1)) {
        await route.fulfill({status:503,json:{error:'시험 연결 일시 중단'}});return;
      }
      if(action==='run.start' && submission===2) {
        const response=await route.fetch();
        await gate;
        if(mobile&&!embedded)await route.abort();
        else await route.fulfill({response});
        return;
      }
      await route.continue();
    });
    await page.goto('/?'+(embedded?'edit':'agent')+'='+project.id);
    await page.getByRole('button',{name:embedded?'시험 실행':'Agent 사용',exact:true}).click();
    const panel=embedded?page.getByRole('tabpanel',{name:'실행 결과'}):page.getByRole('dialog',{name:project.title,exact:true});
    const first=panel.getByLabel('Agent에게 보낼 질문'), submit=panel.getByRole('button',{name:'질문 실행',exact:true});
    const reconnect=panel.getByRole('button',{name:'다시 연결',exact:true});
    await expect(reconnect).toBeVisible();
    await first.fill('첫 자료를 읽어 주세요.');
    await expect(submit).toBeDisabled();
    connected=true;
    await reconnect.click();
    await expect(first).toHaveValue('첫 자료를 읽어 주세요.');
    const fileInput=panel.getByLabel(/^입력 파일/);
    await fileInput.setInputFiles({name:'첫째.txt',mimeType:'text/plain',buffer:Buffer.from('처음 보낸 파일 원문')});
    const firstFile=panel.getByRole('button',{name:'첫째.txt 첨부 해제'});
    await expect(firstFile).toBeVisible();
    if(mobile && !embedded){
      const history=panel.getByRole('button',{name:'실행 기록',exact:true});
      const sheet=page.getByRole('dialog',{name:'실행 기록',exact:true});
      for(const dismiss of ['button','escape','outside']) {
        await history.tap();
        const close=sheet.getByRole('button',{name:'기록 닫기'});
        await expect(close).toBeFocused();
        if(dismiss==='button')await capture('run-history');
        if(dismiss==='escape')await page.keyboard.press('Escape');
        else if(dismiss==='outside')await page.touchscreen.tap(378,416);
        else await close.tap();
        await expect(sheet).toHaveCount(0);
        await expect(history).toBeFocused();
        await expect(first).toHaveValue('첫 자료를 읽어 주세요.');
        await expect(firstFile).toBeVisible();
      }
    }
    await submit.click();
    await expect(panel.getByRole('alert')).toContainText('시험 연결 일시 중단');
    await expect(first).toHaveValue('첫 자료를 읽어 주세요.');
    await expect(firstFile).toBeVisible();
    await submit.click();
    const next=panel.getByLabel('같은 대화의 새 질문');
    await expect(panel.getByText('접수 중인 질문',{exact:true})).toBeVisible();
    await expect(next).toHaveValue('');
    await next.fill('다음 자료도 읽어 주세요.');
    await fileInput.setInputFiles({name:'둘째.txt',mimeType:'text/plain',buffer:Buffer.from('다음에 보낼 파일 원문')});
    const nextFile=panel.getByRole('button',{name:'둘째.txt 첨부 해제'});
    await expect(nextFile).toBeVisible();
    await capture('run-pending-draft');
    resume();
    if(mobile&&!embedded){
      await expect(panel.getByText('접수를 확인하지 못한 질문',{exact:true})).toBeVisible();
      await expect(nextFile).toBeVisible();
      await panel.getByRole('button',{name:'이 질문 다시 보내기',exact:true}).click();
    }
    await expect(panel.locator('.run-output')).toHaveText('처음 보낸 파일 원문',{timeout:15000});
    await expect(next).toHaveValue('다음 자료도 읽어 주세요.');
    await expect(nextFile).toBeVisible();
    await submit.click();
    await expect(panel.locator('.run-output').last()).toHaveText('다음에 보낼 파일 원문',{timeout:15000});
    if(!embedded)await expect(panel.locator('.run-output')).toHaveText(['처음 보낸 파일 원문','다음에 보낼 파일 원문']);
    const runs=await api(session,'run.list',{id:project.id}) as {input:string;conversation:string}[];
    assert.equal(runs.length,initialRunCount+2);
    const latest=JSON.parse(runs[0].input);
    assert.equal(latest.question,'다음 자료도 읽어 주세요.');
    assert.equal(latest.fileName,'둘째.txt');
    assert.equal(runs[0].conversation,runs[1].conversation);
  } finally {resume();await session.close();}
}
try{
  await registerBrowserAccount(context);
  await checkInlineLibraryRule(context);
  const beginner=templates.find(lesson=>lesson.id==='beginner')!;
  const notice=beginner.graph.nodes.find(node=>node.type==='file.create')!;
  const graph:Graph={nodes:[
    createBlock('input.user_request',{id:'input',title:'질문',x:40,y:50,config:{question:'도서관의 대출 규정은 무엇인가요?'}}),
    createBlock('input.form',{id:'ask',title:'규정 확인',x:290,y:50,config:{prompt:'회신할 규정을 입력하세요.',replyTimeoutMinutes:30}}),
    {...notice,id:'save',x:540,y:50},
    createBlock('output.answer',{id:'out',title:'완료',x:790,y:50})
  ],edges:['input','ask','save'].flatMap((from,i)=>['flow','data'].map(kind=>({
    id:from+kind,kind:kind as 'flow'|'data',from,to:['ask','save','out'][i],out:kind==='flow'?'next':'value',input:kind==='flow'?'in':'input'
  })))};
  const p=await api(context,'project.create',{title:'대기와 문서 생성',graph});
  const page=await context.newPage();await page.goto('/?edit='+p.id);
  await page.getByRole('button',{name:'시험 실행',exact:true}).click({timeout:50000});
  const panel=page.getByRole('tabpanel',{name:'실행 결과'});
  await expect(panel).toBeVisible();
  await expect(page.locator('.ws-stage')).toBeVisible();
  const firstQuestion=panel.getByLabel('Agent에게 보낼 질문');
  await expect(firstQuestion).toHaveValue('도서관의 대출 규정은 무엇인가요?');
  await firstQuestion.fill('자료 요청');
  await page.getByRole('button',{name:'질문 블록 속성',exact:true}).click();
  await page.getByRole('textbox',{name:'예시 질문',exact:true}).fill('대출 한도를 알려주세요.');
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  await expect(firstQuestion).toHaveValue('자료 요청');
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  await expect(panel.locator('.run-wait').getByText('회신할 규정을 입력하세요.',{exact:true})).toBeVisible({timeout:15000});
  const [waiting] = await api(context,'run.list',{id:p.id});
  assert.ok(waiting.prompt.expiresAt);
  await expect(panel.locator('.run-wait time')).toHaveAttribute('datetime',waiting.prompt.expiresAt);
  const citedAnswer='5권까지 빌릴 수 있습니다.\n“한 사람의 대출 한도는 5권입니다.”';
  await panel.getByLabel('대기 중인 요청에 답하기').fill(citedAnswer);
  await panel.getByRole('button',{name:'같은 실행 이어가기'}).click();
  await expect(panel.locator('.run-output')).toHaveText(citedAnswer,{timeout:15000});
  const downloadEvent=page.waitForEvent('download');
  await panel.getByRole('button',{name:'대출안내.txt 내려받기'}).click();
  const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'대출안내.txt');
  assert.equal(await readFile(await download.path(),'utf8'),citedAnswer);
  await panel.getByText('실행 경로',{exact:false}).first().click();
  await expect(panel.locator('.run-trace ol')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await panel.getByRole('button',{name:'실행 기록',exact:true}).click();
  await expect(panel.locator('.run-sidebar')).toBeVisible();
  const old=await api(context,'run.list',{id:p.id});assert.equal(old.length,1);assert.equal(old[0].state,'completed');
  console.log('PASS Windows Chromium desktop/mobile results tab, same-run reply, file download, trace and private history');

  const formGraph=structuredClone(graph);
  formGraph.nodes[1].config.fields=['지점','권수',{name:'비고',required:false}];
  const formProject=await api(context,'project.create',{title:'지점과 권수 신청',graph:formGraph});
  await page.goto('/?edit='+formProject.id);
  await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  const requiredBranch=panel.getByRole('textbox',{name:'지점 필수'});
  const requiredCount=panel.getByRole('textbox',{name:'권수 필수'});
  await expect(requiredBranch).toBeVisible();
  await expect(panel.getByRole('textbox',{name:'비고 선택'})).toBeVisible();
  await requiredBranch.fill('중앙점');
  await panel.getByRole('button',{name:'같은 실행 이어가기'}).click();
  await expect(requiredCount).toBeFocused();
  const [formWait]=await api(context,'run.list',{id:formProject.id});
  assert.equal(formWait.state,'waiting');
  await requiredCount.fill('2');
  await page.reload();
  await expect(page.getByRole('dialog',{name:'속성 패널'})).toBeVisible();
  await expect(panel).toBeVisible();
  await panel.getByRole('button',{name:'실행 기록',exact:true}).click();
  await panel.locator('.run-sidebar .run-history').first().click();
  await expect(requiredBranch).toHaveValue('중앙점');
  await expect(requiredCount).toHaveValue('2');
  await page.route('**/api/studio',async route=>{
    if(route.request().postDataJSON().action==='run.reply')await route.fulfill({status:503,json:{error:'잠시 후 회신하세요.'}});
    else await route.continue();
  });
  await panel.getByRole('button',{name:'같은 실행 이어가기'}).click();
  await expect(panel.getByRole('alert')).toHaveText('잠시 후 회신하세요.');
  await expect(requiredCount).toHaveValue('2');
  await page.unroute('**/api/studio');
  await panel.getByRole('button',{name:'같은 실행 이어가기'}).click();
  await expect(panel.locator('.run-answer-meta span')).toHaveText('완료');
  const [formDone]=await api(context,'run.list',{id:formProject.id});
  assert.equal(formDone.id,formWait.id);
  assert.deepEqual(JSON.parse(formDone.output),{지점:'중앙점',권수:'2'});
  assert.deepEqual(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('studio.wait-draft.'))),[]);
  console.log('PASS editable example, preserved test draft and required form fields on the same mobile run');

  const connect=(from:string,to:string):Graph['edges']=>[
    {id:from+'-'+to+'-flow',kind:'flow',from,to,out:'next',input:'in'},
    {id:from+'-'+to+'-data',kind:'data',from,to,out:'value',input:'input'},
  ];
  const fileGraph:Graph={nodes:[
    createBlock('file.input',{id:'upload',config:{accept:'.txt',fileName:'작업실 예시.txt',content:'설계자 전용 예시 원문'}}),
    createBlock('document.read',{id:'read'}),
    createBlock('output.answer',{id:'out'}),
  ],edges:[...connect('upload','read'),...connect('read','out')]};
  const child=await api(context,'project.create',{title:'텍스트 원문 읽기',graph:fileGraph});
  const childEdition=await api(context,'versions.save',{id:child.id,revision:child.revision});
  await api(context,'versions.publish',{id:child.id,visibility:'public',version:childEdition.number});
  for(const mobile of [false,true])for(const embedded of [true,false])await checkQuestionDrafts(child,embedded,mobile);
  console.log('PASS desktop/mobile submission drafts, attached files, reconnection and mobile history dismissal');
  const question=createBlock('input.user_request',{id:'question'}),answer=createBlock('output.answer',{id:'answer'});
  const parentGraph:Graph={nodes:[question,
    createBlock('workflow.call',{id:'call',config:{workflowId:child.id,version:childEdition.number}}),
    answer],edges:[...connect('question','call'),...connect('call','answer')]};
  const parent=await api(context,'project.create',{title:'공개된 문서 읽기',graph:parentGraph});
  const edition=await api(context,'versions.save',{id:parent.id,revision:parent.revision});
  await api(context,'versions.publish',{id:parent.id,visibility:'public',version:edition.number});
  await api(context,'project.save',{id:parent.id,title:parent.title,revision:parent.revision,graph:{nodes:[question,answer],edges:connect('question','answer')}});
  await page.goto('/?edit='+parent.id);await page.getByRole('button',{name:'시험 실행',exact:true}).click();
  await panel.getByRole('button',{name:'실행 설정',exact:true}).click();
  await expect(panel.getByLabel('입력 파일')).toHaveCount(0);
  await panel.getByLabel('실행할 설계 버전').selectOption(String(edition.number));
  await expect(panel.getByLabel('입력 파일')).toHaveAttribute('accept','.txt');
  await panel.getByRole('button',{name:'예시 파일로 시험',exact:true}).click();
  await expect(panel.getByRole('button',{name:'작업실 예시.txt 첨부 해제'})).toBeVisible();
  await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
  await expect(panel.locator('.run-answer-meta span')).toHaveText('완료');
  await expect(panel.locator('.run-output')).toHaveText('설계자 전용 예시 원문');
  await page.goto('/?agent='+parent.id);await page.getByRole('button',{name:'Agent 사용',exact:true}).click();
  const ownerPanel=page.getByRole('dialog',{name:parent.title});
  await expect(page.getByLabel('실행 환경')).toHaveValue('live');
  await expect(page.getByLabel('입력 파일')).toBeVisible();

  const visitor=await browser.newContext({baseURL});
  visitor.setDefaultTimeout(15000);
  const temp=await mkdtemp(join(tmpdir(),'studio-upload-'));
  const path=join(temp,'도서관 안내.txt');
  try{
    await registerBrowserAccount(visitor);
    const publicPage=await visitor.newPage();await publicPage.goto('/?agent='+parent.id);
    await publicPage.getByRole('button',{name:'Agent 사용',exact:true}).click();
    const publicPanel=publicPage.getByRole('dialog',{name:parent.title});
    const picker=publicPanel.getByLabel('입력 파일'),submit=publicPanel.getByRole('button',{name:'질문 실행',exact:true});
    await expect(picker).toHaveAttribute('accept','.txt');
    await expect(publicPanel.getByRole('button',{name:'예시 파일로 시험'})).toHaveCount(0);
    const pastedQuestion='{"fileName":"질문예시.txt","content":"붙여넣은 JSON","question":"내부 문자열"}';
    await publicPanel.getByLabel('Agent에게 보낼 질문').fill(pastedQuestion);
    await submit.click();
    const requested=publicPanel.getByLabel('요청받은 파일');
    await expect(requested).toBeVisible();
    await expect(publicPanel.locator('.run-question')).toHaveText(pastedQuestion);
    await expect(publicPanel.getByRole('button',{name:'예시 파일로 시험'})).toHaveCount(0);
    const [waitingFile]=await api(visitor,'run.list',{id:parent.id});
    assert.equal(waitingFile.state,'waiting');
    assert.doesNotMatch(JSON.stringify(waitingFile),/설계자 전용 예시 원문/);
    await requested.setInputFiles({name:'안내.csv',mimeType:'text/csv',buffer:Buffer.from('잘못된 형식')});
    await expect(publicPanel.locator('.run-wait').getByRole('alert')).toContainText('허용된 파일 형식');
    await requested.setInputFiles({name:'게시 공지.TXT',mimeType:'text/plain',buffer:Buffer.from('이번 방문자가 첨부한 공지')});
    await publicPanel.getByRole('button',{name:'첨부하고 같은 실행 이어가기'}).click();
    await expect(publicPanel.locator('.run-output')).toHaveText('이번 방문자가 첨부한 공지');
    const [finishedFile]=await api(visitor,'run.list',{id:parent.id});
    assert.equal(finishedFile.id,waitingFile.id);
    await publicPanel.getByRole('button',{name:'＋ 새 대화'}).click();
    await writeFile(path,'"'.repeat(20_100),'utf8');await picker.setInputFiles(path);
    await expect(publicPanel.getByRole('alert')).toContainText('40,000자');
    await expect(submit).toBeDisabled();
    await picker.setInputFiles(path);
    await expect(publicPanel).toBeVisible();
    await publicPanel.getByRole('button',{name:'도서관 안내.txt 첨부 해제'}).click();
    const content='서가 위치 "A-7"과 경로 C:\\도서관\n'+'가'.repeat(38_050)+'\n안내문 끝';
    await writeFile(path,content,'utf8');await picker.setInputFiles(path);
    await expect(publicPanel.getByRole('button',{name:'도서관 안내.txt 첨부 해제'})).toBeEnabled();
    const field=publicPanel.getByLabel('Agent에게 보낼 질문');
    await field.fill('문서 원문을 보여주세요.'.repeat(500));
    await expect(submit).toBeDisabled();
    await field.fill('문서 원문을 보여주세요.');
    await expect(submit).toBeEnabled();await submit.click();
    await expect(publicPanel.locator('.run-answer-meta span')).toHaveText('완료',{timeout:20000});
    assert.equal(await publicPanel.locator('.run-output').textContent(),content);
    await expect(publicPanel.locator('.run-question')).toHaveText('문서 원문을 보여주세요. · 도서관 안내.txt');
    await ownerPanel.getByLabel('실행 환경').selectOption('test');
    await ownerPanel.getByLabel('실행할 설계 버전').selectOption(String(edition.number));
    await ownerPanel.getByLabel('입력 파일').setInputFiles(path);
    await ownerPanel.getByLabel('Agent에게 보낼 질문').fill('저장할 원문입니다.');
    await ownerPanel.getByRole('button',{name:'시험 사례',exact:true}).click();
    await ownerPanel.getByLabel('사례 이름').fill('긴 원문과 질문');
    await ownerPanel.getByLabel('기대 결과').fill('파일의 전체 본문');
    await ownerPanel.getByRole('button',{name:'현재 입력으로 사례 저장'}).click();
    await expect(ownerPanel.getByRole('status')).toContainText('저장했습니다.');
    const [savedCase]=await api(context,'cases.list',{id:parent.id});
    assert.deepEqual(JSON.parse(savedCase.input),{fileName:'도서관 안내.txt',content,question:'저장할 원문입니다.'});
    console.log('PASS published and nested file input, large saved file case, serialized size guard and exact UTF-8 contents through the worker');
  }finally{await visitor.close();await rm(path,{force:true});await rmdir(temp);}
}finally{await context.close();await browser.close();}
