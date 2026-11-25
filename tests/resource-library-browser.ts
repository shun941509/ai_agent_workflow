import assert from 'node:assert/strict';
import { registerBrowserAccount } from './browser-account';
import {existsSync} from 'node:fs';
import {chromium, expect, type BrowserContext} from '@playwright/test';
import {strToU8,strFromU8,zipSync,unzipSync} from 'fflate';
import {createBlock,type Graph} from '../src/domain';
import {verifyResourceEditing} from './resource-editing-browser';

const baseURL=process.env.STUDIO_TEST_URL;
if(!baseURL)throw new Error('격리된 Studio 시험 서버의 STUDIO_TEST_URL을 지정하세요.');
const systemChrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(systemChrome)?systemChrome:undefined)});
const owner=await browser.newContext({baseURL,acceptDownloads:true});
const visitor=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
async function api(ctx:BrowserContext,action:string,data:unknown={}) {
  const response=await ctx.request.post('/api/studio',{data:{action,data}});
  const body=await response.json();
  assert.ok(response.ok(),action+' → '+response.status()+' '+(body.error??''));return body.data;
}
async function checkResourceHistory(ctx:BrowserContext,first:{id:string;name:string}) {
  const page=await ctx.newPage();
  try {
    const listAddress='/?view=assets';
    const detailed='/?asset='+first.id+'&edition=';
    await page.goto(detailed+'1');
    const lib=page.getByRole('region',{name:'도구 및 자료'});
    const back=lib.getByRole('button',{name:'← 도구 및 자료'});
    await expect(lib.getByLabel('자료 버전')).toHaveValue('1');
    await back.click();
    await expect(page).toHaveURL(new URL(listAddress,baseURL).href);
    await page.reload();
    await expect(lib.getByRole('heading',{name:'도구 및 자료',exact:true})).toBeVisible();
    const mine=lib.getByRole('button',{name:'내 자료',exact:true});
    await mine.click();
    await lib.getByLabel('종류',{exact:true}).selectOption('document');
    await lib.getByRole('searchbox').fill('자료함');
    const row=lib.getByRole('button',{name:new RegExp(first.name+' 참고 자료')});
    await row.scrollIntoViewIfNeeded();
    const y=await page.evaluate(()=>window.scrollY);
    assert.ok(y>150,'Scroll down in a real list before opening the last matching row.');
    await row.click();
    await expect(page).toHaveURL(new URL(detailed+'2',baseURL).href);
    await expect(lib.getByRole('heading',{name:first.name})).toBeInViewport();
    await page.reload();
    await expect(lib.getByLabel('자료 버전')).toHaveValue('2');
    await lib.getByLabel('자료 버전').selectOption('1');
    await expect(page).toHaveURL(new URL(detailed+'1',baseURL).href);
    await expect(lib.locator('.rl-source')).toHaveText('테스트 전용 안내문');
    await page.goBack();
    await expect(lib.getByLabel('자료 버전')).toHaveValue('2');
    await page.goForward();
    await expect(lib.getByLabel('자료 버전')).toHaveValue('1');
    await page.reload();
    await expect(lib.getByLabel('자료 버전')).toHaveValue('1');
    await back.click();
    await expect(row).toBeFocused();
    await expect.poll(()=>page.evaluate(target=>Math.abs(window.scrollY-target),y)).toBeLessThan(5);
    await expect(lib.getByLabel('종류',{exact:true})).toHaveValue('document');
    await expect(lib.getByRole('searchbox')).toHaveValue('자료함');
    await expect(mine).toHaveAttribute('aria-pressed','true');
    await lib.getByRole('searchbox').focus();
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.goForward();
    await expect(lib.getByLabel('자료 버전')).toHaveValue('2');
    await page.goBack();
    await expect(lib.getByRole('searchbox')).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
    const trash=lib.getByRole('link',{name:'휴지통',exact:true});
    await trash.click();
    await expect(page.getByRole('heading',{name:'휴지통',exact:true})).toBeVisible();
    await page.reload();
    await page.getByRole('link',{name:'도구 및 자료로 돌아가기'}).click();
    await expect(trash).toBeFocused();
    await expect(lib.getByRole('searchbox')).toHaveValue('자료함');
    await page.goForward();
    await expect(page.getByRole('heading',{name:'휴지통',exact:true})).toBeVisible();
    await page.goBack();
    await expect(trash).toBeFocused();
    await lib.getByRole('button',{name:'자료 등록'}).click();
    await lib.getByLabel('자료 본문').fill('오후 다섯 시까지 운영합니다.');
    await lib.getByRole('button',{name:/지식 저장소/}).click();
    await expect(lib.getByLabel('자료 본문')).toHaveValue('오후 다섯 시까지 운영합니다.');
  }finally{await page.close();}
}
async function checkResourceDrafts(ctx:BrowserContext,small:boolean) {
  const page=await ctx.newPage();
  const name='지침 초안 '+crypto.randomUUID().slice(0,8);
  const original='대출은 세 권까지 가능합니다.';
  const modified='대출은 다섯 권까지 가능합니다. 📚';
  const skill=await api(ctx,'asset.save',{kind:'skill',name,payload:{content:original,files:[
    {path:'SKILL.md',data:Buffer.from(original).toString('base64')},
    {path:'notes.txt',data:Buffer.from('첨부 자료').toString('base64')},
  ]}});
  try {
    const lib=page.getByRole('region',{name:'도구 및 자료'}), field=lib.getByLabel('SKILL.md 지침');
    const decision=page.getByRole('dialog',{name:'저장하지 않은 자료'});
    const back=lib.getByRole('button',{name:'← 도구 및 자료'});
    await page.goto('/?view=assets');
    await lib.locator('.rl-asset-open').filter({hasText:name}).click();
    await lib.getByRole('button',{name:'수정',exact:true}).click();
    await field.fill(modified);
    await expect(lib.locator('.rl-filegrid .rl-source')).toHaveText(modified);
    await expect(lib.locator('.rl-filetitle small')).toHaveText(Buffer.byteLength(modified)+' B');
    const reloadWarning=page.waitForEvent('dialog');
    await page.evaluate(()=>{window.setTimeout(()=>location.reload(),0);});
    const nativeDialog=await reloadWarning;
    assert.equal(nativeDialog.type(),'beforeunload');
    await nativeDialog.dismiss();
    await expect(field).toHaveValue(modified);
    await back.click();
    await expect(decision.getByRole('button',{name:'계속 작성'})).toBeFocused();
    await decision.getByRole('button',{name:'계속 작성'}).click();
    await expect(field).toHaveValue(modified);
    await expect(field).toBeFocused();
    await page.evaluate(()=>history.back());
    await decision.getByRole('button',{name:'계속 작성'}).click();
    await expect(page).toHaveURL(new RegExp('asset='+skill.id));
    await expect(field).toHaveValue(modified);
    if(small)await page.getByRole('button',{name:'메뉴 열기'}).click();
    await page.getByRole('button',{name:'내 Agent',exact:true}).click();
    await decision.getByRole('button',{name:'계속 작성'}).click();
    await field.fill(original);
    await lib.getByRole('button',{name:'취소'}).click();
    await expect(decision).toHaveCount(0);
    await expect(lib.getByRole('heading',{name,exact:true})).toBeVisible();
    await lib.getByRole('button',{name:'수정',exact:true}).click();
    await field.fill(modified);
    await page.evaluate(()=>history.back());
    await decision.getByRole('button',{name:'변경 버리기'}).click();
    await expect(lib.getByRole('heading',{name:'도구 및 자료',exact:true})).toBeVisible();
    assert.equal((await api(ctx,'asset.read',{id:skill.id})).payload.content,original);
    await page.goForward();
    await expect(lib.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(lib.locator('.rl-filegrid .rl-source')).toHaveText(original);
    await page.goBack();

    await lib.getByRole('button',{name:'자료 등록'}).click();
    await lib.getByRole('button',{name:/^✧ Skill/}).click();
    await field.fill(modified);
    await lib.getByRole('button',{name:/참고 자료/}).click();
    await back.click();
    await decision.getByRole('button',{name:'계속 작성'}).click();
    await lib.getByRole('button',{name:/^✧ Skill/}).click();
    await expect(field).toHaveValue(modified);
    await lib.getByLabel('이름',{exact:true}).fill(name+' 새 자료');
    await lib.getByRole('button',{name:'등록',exact:true}).click();
    await expect(lib.getByRole('heading',{name:name+' 새 자료'})).toBeVisible();
    await expect(lib.locator('.rl-filegrid .rl-source')).toHaveText(modified);
    await expect(decision).toHaveCount(0);
  }finally{await page.close();}
}
try {
  await verifyResourceEditing(browser,baseURL);
  const operator=await registerBrowserAccount(owner);
  await registerBrowserAccount(visitor);
  const first=await api(owner,'asset.save',{name:'자료함 열기',kind:'document',payload:{content:'테스트 전용 안내문'}});
  const page=await owner.newPage();await page.goto('/?asset='+first.id);
  const lib=page.getByRole('region',{name:'도구 및 자료'});
  await expect(lib.getByRole('heading',{name:'자료함 열기'})).toBeVisible({timeout:45_000});
  await api(owner,'asset.save',{id:first.id,baseVersion:1,name:first.name,payload:{content:'대출 한도는 5권입니다. 다음 문장입니다.'}});
  for(let n=0;n<16;n++)await api(owner,'asset.save',{name:'자료함 '+String(n).padStart(2,'0'),kind:'document',payload:{content:'목록 이동 시험'}});
  const mobileOwner=await browser.newContext({baseURL,storageState:await owner.storageState(),viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    await checkResourceHistory(owner,first);await checkResourceHistory(mobileOwner,first);
    await checkResourceDrafts(owner,false);await checkResourceDrafts(mobileOwner,true);
  }
  finally{await mobileOwner.close();}
  const material = createBlock('resource.context',{id:'rules',title:'연결한 자료',config:{assetId:first.id,version:1}});
  const pinned = await api(owner,'project.create',{title:'연결한 자료 원문 확인',graph:{nodes:[material],edges:[]}});
  const editor = await owner.newPage();
  await editor.goto('/?edit='+pinned.id);
  const card = editor.locator('[data-workflow-node="rules"]');
  await expect(card.locator('.ws-material-preview')).toHaveText('테스트 전용 안내문');
  const openEdition = editor.getByRole('link',{name:/연결한 자료 원문 열기/});
  const opened = editor.waitForEvent('popup');
  await openEdition.click();
  const original = await opened;
  await expect(original.getByLabel('자료 버전')).toHaveValue('1');
  await expect(original.locator('.rl-source')).toHaveText('테스트 전용 안내문');
  await original.close();
  await editor.getByLabel('고정할 자료 버전').selectOption('2');
  await expect(card.locator('.ws-material-preview')).toHaveText('대출 한도는 5권입니다.');
  await editor.close();
  await lib.getByRole('button',{name:'← 도구 및 자료'}).click();await lib.getByRole('button',{name:'자료 등록'}).click();
  await lib.getByLabel('이름',{exact:true}).fill('인용 Skill');
  await lib.getByLabel('자료 본문').fill('휴관일은 월요일입니다.');
  await lib.getByRole('button',{name:/지식 저장소/}).click();
  await expect(lib.getByLabel('자료 본문')).toHaveValue('휴관일은 월요일입니다.');
  await lib.getByLabel('자료 본문').fill('정기 휴관일은 월요일입니다.');
  await lib.getByRole('button',{name:/^✧ Skill/}).click();
  await expect(lib.getByLabel('SKILL.md 지침')).toHaveValue('');
  const archive=zipSync({'citation/SKILL.md':strToU8('# 인용\n원문을 인용하세요.'),'citation/scripts/check.ts':strToU8('const quote = "원문";'),'citation/assets/icon.bin':Uint8Array.from([0,128,255])});
  await lib.locator('input[accept*=".zip"]').setInputFiles({name:'citation.zip',mimeType:'application/zip',buffer:Buffer.from(archive)});
  await lib.getByRole('button',{name:'scripts/check.ts'}).click();
  await expect(lib.locator('.rl-filegrid code')).toHaveText('const quote = "원문";');
  await lib.getByRole('button',{name:/참고 자료/}).click();
  await expect(lib.getByLabel('자료 본문')).toHaveValue('정기 휴관일은 월요일입니다.');
  await lib.getByRole('button',{name:/^✧ Skill/}).click();
  await expect(lib.getByLabel('이름',{exact:true})).toHaveValue('인용 Skill');
  await expect(lib.getByLabel('SKILL.md 지침')).toHaveValue('# 인용\n원문을 인용하세요.');
  await expect(lib.locator('.rl-filegrid code')).toHaveText('const quote = "원문";');
  await lib.getByRole('button',{name:'등록',exact:true}).click();
  await expect(lib.getByRole('heading',{name:'인용 Skill',exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await lib.getByRole('button',{name:'Skill ZIP 다운로드'}).click();
  const download=await downloadEvent,stream=await download.createReadStream();assert.ok(stream);
  const chunks:Buffer[]=[];for await (const chunk of stream)chunks.push(Buffer.from(chunk));const exported=unzipSync(Buffer.concat(chunks));
  assert.equal(strFromU8(exported['scripts/check.ts']),'const quote = "원문";');assert.deepEqual([...exported['assets/icon.bin']],[0,128,255]);
  await lib.getByLabel('공유 범위',{exact:true}).selectOption('link');
  await expect(lib.getByRole('group',{name:'공유 설정'})).toContainText('현재 공개 범위 · 나만 사용');
  await expect(lib.getByRole('group',{name:'공유 설정'}).getByRole('status')).toContainText('적용 전 · 나만 사용 → 비밀 링크');
  await lib.getByRole('button',{name:'1판 공유'}).click();
  const latestLink=lib.getByRole('textbox',{name:'최신 게시판 주소'});
  const fixedLink=(edition:number)=>lib.getByRole('textbox',{name:edition+'판 고정 주소',exact:true});
  const address=await latestLink.inputValue(),firstEdition=await fixedLink(1).inputValue();
  assert.ok(new URL(address).searchParams.get('token'));
  assert.equal(new URL(address).searchParams.get('edition'),'published');
  assert.equal(new URL(firstEdition).searchParams.get('edition'),'1');
  await page.evaluate(()=>{
    let copied='';
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
      async writeText(value:string){copied=value;},
      async readText(){return copied;},
    }});
  });
  for (const [label,href] of [['최신 게시판 주소 복사',address], ['1판 고정 주소 복사',firstEdition]]) {
    await lib.getByRole('button',{name:label,exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(href);
  }
  const recipient=await visitor.newPage();await recipient.goto(address);const received=recipient.getByRole('region',{name:'도구 및 자료'});
  await expect(received.getByRole('heading',{name:'인용 Skill',exact:true})).toBeVisible();
  await received.getByRole('button',{name:'이 버전의 사본 만들기'}).click();await expect(received.getByRole('heading',{name:'인용 Skill 사본'})).toBeVisible();
  await lib.getByRole('button',{name:'수정',exact:true}).click();
  await lib.getByLabel('SKILL.md 지침').fill('두 번째 판의 지침');await lib.getByRole('button',{name:'새 버전 저장'}).click();
  await expect(lib.getByText('2판을 저장했습니다.')).toBeVisible();
  await expect(latestLink).toHaveValue(address);await expect(fixedLink(2)).toHaveCount(0);
  await recipient.goto(address);await expect(received.getByRole('heading',{name:'인용 Skill',exact:true})).toBeVisible();
  await expect(received.locator('.rl-form>section').first()).toContainText('원문을 인용하세요.');
  await lib.getByRole('button',{name:'2판 공유'}).click();await expect(lib.getByText('2판을 공유했습니다.')).toBeVisible();
  await recipient.reload();await expect(received.locator('.rl-form>section').first()).toContainText('두 번째 판의 지침');
  await lib.getByLabel('자료 버전').selectOption('1');await expect(fixedLink(1)).toHaveValue(firstEdition);
  await expect(latestLink).toHaveValue(address);
  await recipient.goto(firstEdition);await expect(received.locator('.rl-form>section').first()).toContainText('원문을 인용하세요.');
  await expect(received.getByRole('textbox',{name:'1판 고정 주소'})).toHaveValue(firstEdition);
  await lib.getByRole('button',{name:'현재 링크 철회·재발급'}).click();await expect(lib.getByText('기존 링크를 철회하고 새 주소를 만들었습니다.')).toBeVisible();
  await recipient.reload();await expect(received.getByRole('alert')).toContainText(/권한|공유/);
  await recipient.goto(address);await expect(received.getByRole('alert')).toContainText(/권한|공유/);
  console.log('Asset browser checks passed: ZIP round trip, source preview, immutable versions, independent copy, revocation and mobile recipient.');

  // Delete a source from its edition link. Its current and historical editions share one trash entry.
  await page.goto('/?asset='+first.id+'&edition=1');
  await lib.getByRole('button',{name:'자료 삭제',exact:true}).click();
  const deletion=page.getByRole('dialog',{name:'자료 삭제'});
  await expect(deletion).toContainText(pinned.title);
  await expect(deletion).toContainText('블록과 연결선');
  await deletion.getByRole('button',{name:'취소'}).click();
  await expect(lib.locator('.rl-source')).toHaveText('테스트 전용 안내문');
  await lib.getByRole('button',{name:'자료 삭제',exact:true}).click();
  await deletion.getByRole('button',{name:'휴지통으로 이동'}).click();
  await expect(page).toHaveURL(/\?view=assets$/);
  await expect(lib.getByRole('button',{name:first.name+' 삭제'})).toHaveCount(0);
  await lib.getByRole('link',{name:'휴지통'}).click();
  await expect(page).toHaveURL(/\?view=assets&folder=trash$/);
  await page.reload();
  await page.getByRole('button',{name:first.name+' 복구'}).click();
  await expect(page).toHaveURL(/\?view=assets$/);
  await expect(lib.getByRole('button',{name:first.name+' 삭제'})).toBeVisible();
  await expect(lib.getByRole('searchbox')).toBeFocused();
  assert.equal((await api(owner,'asset.read',{id:first.id,version:1})).payload.content,'테스트 전용 안내문');
  await lib.getByRole('button',{name:first.name+' 삭제'}).click();
  await deletion.getByRole('button',{name:'휴지통으로 이동'}).click();
  await expect(deletion).toHaveCount(0);
  await lib.getByRole('link',{name:'휴지통'}).click();
  await page.getByRole('checkbox',{name:first.name+' 선택'}).check();
  await page.getByRole('button',{name:'선택 항목 영구 삭제'}).click();
  const purge=page.getByRole('dialog',{name:'자료 영구 삭제'});
  await expect(purge).toContainText(first.name);
  await purge.getByRole('button',{name:'영구 삭제',exact:true}).click();
  await expect(page.getByText('휴지통이 비어 있습니다.')).toBeVisible();
  const unavailable=await owner.request.post('/api/studio',{data:{action:'asset.read',data:{id:first.id,version:1}}});
  assert.equal(unavailable.status(),404);
  console.log('Asset trash browser checks passed: dependency warning, cancel, restore pinned edition, deep link and permanent deletion.');
  if(process.env.STUDIO_TEST_DATA_DIR){
    process.env.STUDIO_DATA_DIR=process.env.STUDIO_TEST_DATA_DIR;
    const {one,db}=await import('../src/server/db'),{writeAsset}=await import('../src/server/assets');
    assert.ok(one('SELECT 1 FROM people WHERE id=? AND login=?',operator.id,operator.login),'Use the data directory of the isolated HTTP test server.');
    process.env.STUDIO_ADMIN_IDS=operator.id;
    const payload={url:'http://127.0.0.1:1/unused',tools:['lookup'],readOnlyTools:['lookup']};
    const mcp=writeAsset(operator,{kind:'mcp',name:'대출 연결',payload});
    writeAsset(operator,{id:mcp.id,baseVersion:1,name:'새 대출 연결',payload:{...payload,tools:['reserve'],readOnlyTools:[]}});
    const graph:Graph={nodes:[
      createBlock('agent.task',{id:'agent',title:'대출 담당',x:200,y:80,config:{goal:'대출 정보를 확인하세요.'}}),
      createBlock('tool.invoke',{id:'action',title:'지점 조회',x:430,y:230}),
      createBlock('connection.mcp',{id:'server',title:'고정 연결',x:30,y:260,config:{assetId:mcp.id,version:1}})
    ],edges:['agent','action'].map(to=>({id:'ref-'+to,from:'server',to,kind:'reference',out:'ref',input:'mcp'}))};
    const project=await api(owner,'project.create',{title:'MCP 편집기 시험',graph});
    await page.goto('/?edit='+project.id);
    const panel=page.getByRole('complementary',{name:'속성 패널'});
    const allowed=panel.getByLabel('연결한 MCP에서 허용 도구 추가');
    await expect(allowed).toBeEnabled();await expect(allowed.locator('option')).toHaveCount(2);
    const lookup='mcp.'+mcp.id+'.lookup',reserve='mcp.'+mcp.id+'.reserve';
    await allowed.selectOption(lookup);await expect(panel.getByRole('button',{name:lookup+' 삭제'})).toBeVisible();
    await page.getByRole('button',{name:'지점 조회 블록 속성',exact:true}).click();
    const picker=panel.getByLabel('연결한 MCP에서 도구 선택');
    await picker.selectOption(lookup);
    const manual=panel.locator('[data-field-key="tool"] input');
    await expect(manual).toHaveValue(lookup);await manual.fill('reservations.list');await expect(manual).toHaveValue('reservations.list');
    await page.getByRole('button',{name:'고정 연결 블록 속성',exact:true}).click();
    await panel.getByLabel('고정할 자료 버전').selectOption('2');
    await page.getByRole('button',{name:'지점 조회 블록 속성',exact:true}).click();
    await expect(picker).toBeEnabled();await expect(picker.locator('option')).toHaveCount(2);
    await expect(picker.locator('option').last()).toHaveText(/2판.*reserve.*승인/);await picker.selectOption(reserve);await expect(manual).toHaveValue(reserve);
    await expect.poll(async()=>(await api(owner,'project.open',{id:project.id})).graph.nodes.find((n:{id:string})=>n.id==='action').config.tool).toBe(reserve);
    await page.reload();await page.getByRole('button',{name:'지점 조회 블록 속성',exact:true}).click();await expect(picker).toHaveValue(reserve);
    await page.goto('/?asset='+mcp.id);await expect(lib.getByLabel('reserve 도구 식별자')).toHaveValue(reserve);
    db().close();console.log('Editor MCP checks passed: connected editions, agent allowlist, approval labels, manual override, save and reopen.');
  }
}finally{await visitor.close();await owner.close();await browser.close();}
