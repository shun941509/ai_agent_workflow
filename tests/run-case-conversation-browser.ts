import assert from 'node:assert/strict';
import { registerBrowserAccount } from './browser-account';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium, expect, type BrowserContext, type Page} from '@playwright/test';
import {createBlock, type Graph} from '../src/domain';

const baseURL = process.env.STUDIO_TEST_URL;
if (!baseURL) throw new Error('격리 시험 서버의 STUDIO_TEST_URL을 지정하세요.');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
});

async function api(context:BrowserContext, action:string, data:object={}) {
  const response = await context.request.post('/api/studio', {data:{action,data}});
  const result = await response.json();
  assert.ok(response.ok(), action+' '+(result.error||response.status()));
  return result.data;
}
async function screenshot(page:Page, name:string) {
  const folder=process.env.STUDIO_SCREENSHOTS;
  if (!folder) return;
  mkdirSync(folder,{recursive:true});
  await page.screenshot({path:join(folder,name+'.png')});
}
const graph:Graph = {
  nodes:[
    createBlock('input.user_request',{id:'ask',x:10,y:20}),
    createBlock('resource.context',{id:'rules',x:10,y:210,config:{content:'기본 규정은 1권입니다.'}}),
    createBlock('output.answer',{id:'answer',x:310,y:20}),
  ],
  edges:[
    {id:'flow',from:'ask',to:'answer',kind:'flow',out:'next',input:'in'},
    {id:'answer-text',from:'rules',to:'answer',kind:'data',out:'value',input:'input'},
  ],
};
try {
  for (const mobile of [false,true]) {
    const width=mobile?390:1440;
    const options={baseURL,viewport:{width,height:mobile?844:900},isMobile:mobile,hasTouch:mobile};
    const owner=await browser.newContext(options);
    const visitor=await browser.newContext(options);
    try {
      await registerBrowserAccount(owner);
      const project=await api(owner,'project.create',{title:'지점별 대출 규정 안내',graph});
      const id=project.id;
      const edition=await api(owner,'versions.save',{id,revision:project.revision});
      await api(owner,'versions.publish',{id,version:edition.number,visibility:'public'});
      const examples:{id:string;input:string;expected:string}[]=[];
      for (const [branch,limit] of [['중앙점',3],['분관',5]]) {
        const expected=branch+'은 '+limit+'권입니다.';
        const input=branch+'의 대출 한도는?';
        const saved=await api(owner,'cases.save',{id,title:branch+' 규정',input,expected,fixture:{documents:{rules:expected}}});
        examples.push({id:saved.id,input,expected});
      }
      const page=await owner.newPage();
      await page.goto('/?edit='+id);
      await page.getByRole('button',{name:'시험 실행',exact:true}).click();
      const panel=page.getByRole('tabpanel',{name:'실행 결과'});
      await panel.getByRole('button',{name:'실행 설정',exact:true}).click();
      await panel.getByRole('button',{name:'시험 사례',exact:true}).click();
      for (const sample of examples) {
        await panel.getByLabel('시험 사례 선택').selectOption(sample.id);
        await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
        await expect(panel.locator('.run-question')).toHaveText(sample.input);
        await expect(panel.locator('.run-output')).toHaveText(sample.expected,{timeout:15000});
      }
      await screenshot(page,'new-case-material-'+width);
      await panel.getByLabel('같은 대화의 새 질문').fill('분관에서 다시 확인해 주세요.');
      await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
      await expect(panel.locator('.run-question')).toHaveText('분관에서 다시 확인해 주세요.');
      await expect(panel.locator('.run-output')).toHaveText(examples[1].expected,{timeout:15000});
      const [followup,branch,first]=await api(owner,'run.list',{id});
      assert.notEqual(first.conversation, branch.conversation);
      assert.equal(branch.conversation, followup.conversation);
      await panel.getByLabel('시험 사례 선택').selectOption(examples[0].id);
      const seven='중앙점은 7권입니다.';
      await panel.getByText('시험 초기 데이터',{exact:true}).click();
      await panel.getByLabel('시험 초기 데이터 JSON').fill(JSON.stringify({documents:{rules:seven}}));
      await panel.getByLabel('기대 결과').fill(seven);
      await panel.getByRole('button',{name:'질문 실행',exact:true}).click();
      await expect(panel.locator('.run-output')).toHaveText(seven,{timeout:15000});
      await panel.getByRole('button',{name:'저장된 사례로 시험',exact:true}).click();
      await expect(panel.locator('.run-output')).toHaveText(examples[0].expected,{timeout:15000});
      await panel.getByLabel('시험 사례 선택').selectOption(examples[1].id);
      await panel.getByLabel('시험 사례 선택').selectOption(examples[0].id);
      await expect(panel.getByLabel('기대 결과')).toHaveValue(seven);
      await panel.getByRole('button',{name:'이 사례 업데이트',exact:true}).click();
      await expect(panel.getByRole('status')).toContainText('업데이트');
      assert.equal((await api(owner,'cases.list',{id})).length,2);
      await panel.getByRole('button',{name:'새 사례로 저장',exact:true}).click();
      await expect(panel.getByRole('status')).toContainText('저장했습니다');
      const savedCases=await api(owner,'cases.list',{id});
      assert.equal(savedCases.length,3);
      assert.equal(new Set(savedCases.map((item:{title:string})=>item.title)).size,3);
      const oldCase=savedCases.find((item:{id:string})=>item.id===examples[1].id);
      await panel.getByLabel('시험 사례 선택').selectOption(oldCase.id);
      const changed={title:'서쪽 지점',input:JSON.stringify({question:'서쪽 질문',fileName:'서쪽.txt',content:'서쪽 원문'}),
        expected:'서쪽은 9권입니다.',fixture:{documents:{rules:'서쪽은 9권입니다.'}}};
      await api(owner,'cases.save',{id,caseId:oldCase.id,original:oldCase,...changed});
      await panel.getByRole('button',{name:'저장된 사례로 시험',exact:true}).click();
      await expect(panel.locator('.run-question')).toHaveText('서쪽 질문 · 서쪽.txt');
      await expect(panel.locator('.run-output')).toHaveText(changed.expected,{timeout:15000});
      await expect(panel.locator('.run-case-expectation')).toContainText(changed.expected);
      const [record]=await api(owner,'run.list',{id});
      const detail=await api(owner,'run.get',{id,runId:record.id});
      assert.equal(detail.input,changed.input);assert.deepEqual(detail.testCase.fixture,changed.fixture);
      await page.reload();
      await expect(panel).toBeVisible();
      await panel.getByRole('button',{name:'실행 기록',exact:true}).click();
      const savedRecord=panel.getByRole('button',{name:/서쪽 질문/});
      await expect(savedRecord).toContainText('답변 · '+changed.expected);
      await savedRecord.click();
      await expect(panel.locator('.run-case-expectation')).toContainText(changed.expected);
      await panel.getByText('실행한 시험 사례 · 서쪽 지점',{exact:true}).click();
      await expect(panel.getByText('서쪽 원문',{exact:true})).toBeVisible();
      await screenshot(page,'saved-case-evidence-'+width);

      await registerBrowserAccount(visitor);
      const publicPage=await visitor.newPage();
      await publicPage.goto('/?agent='+id);
      const open=publicPage.getByRole('button',{name:'Agent 사용',exact:true});
      await open.click();
      const dialog=publicPage.getByRole('dialog',{name:project.title,exact:true});
      const question1='첫 질문 · 회원증으로 대출할 수 있나요?';
      const question2='둘째 질문 · 가족 회원도 같은가요?';
      const send=async (question:string,initial:boolean) => {
        await dialog.getByLabel(initial?'Agent에게 보낼 질문':'같은 대화의 새 질문').fill(question);
        await dialog.getByRole('button',{name:'질문 실행',exact:true}).click();
        await expect(dialog.locator('.run-question').last()).toHaveText(question);
        await expect(dialog.locator('.run-answer-meta span').last()).toHaveText('완료',{timeout:15000});
        await expect(dialog.locator('.run-output').last()).toHaveText('기본 규정은 1권입니다.',{timeout:15000});
      };
      await send(question1,true);
      await send(question2,false);
      await expect(dialog.locator('.run-question')).toHaveText([question1,question2]);
      await expect(dialog.locator('.run-output')).toHaveCount(2);
      await screenshot(publicPage,'published-conversation-'+width);
      const records=await api(visitor,'run.list',{id});
      assert.equal(records[0].conversation,records[1].conversation);
      const history=async () => {
        if(!mobile) return dialog.locator('.run-sidebar');
        await dialog.getByRole('button',{name:'실행 기록',exact:true}).click();
        return publicPage.getByRole('dialog',{name:'실행 기록',exact:true});
      };
      await (await history()).getByRole('button',{name:'새 대화'}).click();
      await expect(dialog.locator('.run-question')).toHaveCount(0);
      await send('다른 대화의 질문',true);
      await expect(dialog.locator('.run-question')).toHaveCount(1);
      const previousGroup=(await history()).locator('.run-conversation').filter({hasText:question1});
      await expect(previousGroup.locator('time')).toBeVisible();
      await previousGroup.getByText('문답 2개').click();
      await previousGroup.locator('details').getByRole('button',{name:new RegExp(question1.slice(0,4))}).click();
      await expect(dialog.locator('.run-question')).toHaveText([question1,question2]);
      const selected=dialog.locator('[data-run-turn="'+records[1].id+'"]');
      await expect(selected).toBeFocused();
      await expect(selected.locator('.run-question')).toBeInViewport();
      await send(('오래 읽어야 하는 질문입니다. '.repeat(12)+'\n\n').repeat(16).trim(),false);
      const jump=dialog.getByRole('button',{name:'새 답변 보기',exact:true});
      await expect(jump).toBeInViewport();
      await jump.click();
      await expect(dialog.locator('.run-answer').last()).toBeFocused();
      await expect(dialog.locator('.run-output').last()).toBeInViewport();
      assert.equal((await api(owner,'run.list',{id,conversation:records[1].conversation})).length,0);

      const fileGraph:Graph={nodes:[
        createBlock('file.input',{id:'upload',config:{accept:'.txt'}}),createBlock('document.read',{id:'read'}),
        createBlock('output.answer',{id:'answer'}),
      ],edges:['upload','read'].flatMap((from,i)=>['flow','data'].map(kind=>({
        id:from+kind,kind:kind as 'flow'|'data',from,to:['read','answer'][i],
        out:kind==='flow'?'next':'value',input:kind==='flow'?'in':'input'
      })))};
      const files=await api(owner,'project.create',{title:'지점 원문 읽기',graph:fileGraph});
      const published=await api(owner,'versions.save',{id:files.id,revision:files.revision});
      await api(owner,'versions.publish',{id:files.id,version:published.number,visibility:'public'});
      for(const name of ['중앙점','분관']){
        await api(visitor,'run.start',{id:files.id,mode:'live',requestKey:crypto.randomUUID(),
          input:JSON.stringify({fileName:name+'.txt',content:name+' 규정',question:name+' 확인'})});
      }
      await publicPage.goto('/?agent='+files.id);await open.click();
      const fileDialog=publicPage.getByRole('dialog',{name:files.title,exact:true});
      const fileHistory=async()=>{
        if(!mobile)return fileDialog.locator('.run-sidebar');
        await fileDialog.getByRole('button',{name:'실행 기록',exact:true}).click();
        return publicPage.getByRole('dialog',{name:'실행 기록',exact:true});
      };
      async function openHistory(name:string){
        await (await fileHistory()).getByRole('button',{name:new RegExp(name)}).click();
      }
      async function attach(name:string){
        await fileDialog.getByLabel(/^입력 파일/).setInputFiles({
          name:name+'.txt',mimeType:'text/plain',buffer:Buffer.from(name+'의 원문')
        });
        await expect(fileDialog.getByRole('button',{name:name+'.txt 첨부 해제'})).toBeVisible();
      }
      const newField=fileDialog.getByLabel('Agent에게 보낼 질문');
      const followupField=fileDialog.getByLabel('같은 대화의 새 질문');
      await newField.fill('미전송 새 대화');await attach('새 자료');
      await openHistory('분관 확인');
      await expect(followupField).toHaveValue('');
      await followupField.fill('분관용 초안');await attach('분관 검토');
      await openHistory('중앙점 확인');
      await expect(followupField).toHaveValue('');
      await expect(fileDialog.getByRole('button',{name:/첨부 해제/})).toHaveCount(0);
      await openHistory('새 대화');
      await expect(newField).toHaveValue('미전송 새 대화');
      await expect(fileDialog.getByRole('button',{name:'새 자료.txt 첨부 해제'})).toBeVisible();
      await fileDialog.getByRole('button',{name:'실행 화면 닫기'}).click();
      await publicPage.goto('/?agent='+files.id);await open.click();
      await expect(newField).toHaveValue('미전송 새 대화');
      await openHistory('분관 확인');
      await expect(followupField).toHaveValue('분관용 초안');
      await expect(fileDialog.getByRole('button',{name:'분관 검토.txt 첨부 해제'})).toBeVisible();
      await expect(fileDialog.getByLabel('입력 파일 바꾸기')).toHaveAccessibleDescription('첨부됨 · 분관 검토.txt');
      await fileDialog.getByLabel('입력 파일 바꾸기').setInputFiles({name:'분관.csv',mimeType:'text/csv',buffer:Buffer.from('잘못된 형식')});
      await expect(fileDialog.locator('.run-compose').getByRole('alert')).toContainText('기존 첨부 분관 검토.txt');
      await fileDialog.getByLabel('입력 파일 바꾸기').setInputFiles({name:'큰파일.txt',mimeType:'text/plain',buffer:Buffer.alloc(130000)});
      await expect(fileDialog.locator('.run-compose').getByRole('alert')).toContainText('기존 첨부 분관 검토.txt');
      await screenshot(publicPage,'restored-conversation-draft-'+width);
      await fileDialog.getByRole('button',{name:'질문 실행',exact:true}).click();
      await expect(fileDialog.locator('.run-output').last()).toHaveText('분관 검토의 원문',{timeout:15000});
      const [actual]=await api(visitor,'run.list',{id:files.id});
      assert.equal(JSON.parse(actual.input).fileName,'분관 검토.txt');
      await openHistory('분관 확인');await expect(followupField).toHaveValue('');
      for(let i=0;i<2;i++)await api(visitor,'run.start',{id:files.id,mode:'live',requestKey:crypto.randomUUID(),input:'같은 첫 질문'});
      await expect.poll(async()=>(await api(visitor,'run.list',{id:files.id})).filter((r:{state:string})=>r.state==='waiting').length).toBe(2);
      await publicPage.reload();await open.click();
      const duplicate=(await fileHistory()).locator('.run-conversation').filter({hasText:'같은 첫 질문'});
      await expect(duplicate).toHaveCount(2);
      await expect(duplicate.locator('time')).toHaveCount(2);
      await duplicate.getByRole('button',{name:/같은 제목의 대화 1/}).click();
      const request=fileDialog.getByLabel('요청받은 파일');
      await request.setInputFiles({name:'보관.txt',mimeType:'text/plain',buffer:Buffer.from('회신 파일 원문')});
      await expect(fileDialog.locator('.run-wait')).toContainText('첨부할 파일 · 보관.txt');
      await request.setInputFiles({name:'거절.csv',mimeType:'text/csv',buffer:Buffer.from('무효')});
      await expect(fileDialog.locator('.run-wait').getByRole('alert')).toContainText('기존 첨부 보관.txt');
      await fileDialog.getByRole('button',{name:'실행 화면 닫기'}).click();
      await publicPage.goto('/?agent='+files.id);await open.click();
      const waitingGroups=(await fileHistory()).locator('.run-conversation').filter({hasText:'같은 첫 질문'});
      await waitingGroups.getByRole('button',{name:/같은 제목의 대화 1/}).click();
      await expect(fileDialog.locator('.run-wait')).toContainText('첨부할 파일 · 보관.txt');
      await fileDialog.getByRole('button',{name:'첨부하고 같은 실행 이어가기'}).click();
      await expect(fileDialog.locator('.run-output')).toHaveText('회신 파일 원문',{timeout:15000});
      assert.deepEqual(await publicPage.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('studio.wait-draft.'))),[]);
      console.log('PASS '+width+'px: run edited and saved material, update or copy, restore conversation drafts and attachments, jump to a long answer');
    } finally {
      await owner.close();
      await visitor.close();
    }
  }
} finally { await browser.close(); }
