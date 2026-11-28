import assert from 'node:assert/strict';
import { registerBrowserAccount } from './browser-account';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,type Browser,type BrowserContext} from '@playwright/test';
import {strToU8,zipSync} from 'fflate';

async function request(context:BrowserContext,action:string,data:unknown={}) {
  const response=await context.request.post('/api/studio',{data:{action,data}});
  const result=await response.json();
  assert.ok(response.ok(),action+' → '+response.status()+' '+(result.error??''));
  return result.data;
}

export async function verifyResourceEditing(browser:Browser,baseURL:string) {
  {
    const viewport={width:1440,height:900};
    const context=await browser.newContext({baseURL,viewport});
    const recipient=await browser.newContext({baseURL,viewport});
    try {
      await registerBrowserAccount(context);
      await registerBrowserAccount(recipient);
      const original='대출 규정의 첫 판',markdown='가져온 다섯 권 지침',typed='직접 쓰던 세 권 지침';
      const image=Buffer.from([0,127,128,255]).toString('base64');
      const skill=await request(context,'asset.save',{name:'안내 Skill',kind:'skill',payload:{files:[
        {path:'SKILL.md',data:Buffer.from(original).toString('base64')},{path:'assets/icon.bin',data:image},
        {path:'scripts/check.ts',data:Buffer.from('return 3').toString('base64')},
      ]}});
      const page=await context.newPage(),other=await context.newPage();
      context.setDefaultTimeout(12_000);recipient.setDefaultTimeout(12_000);
      const lib=page.getByRole('region',{name:'도구 및 자료'});
      const field=lib.getByLabel('SKILL.md 지침');
      const confirm=page.getByRole('dialog',{name:'Skill 가져오기 확인'});
      const md=lib.locator('input[accept*=".md"]');
      const loadMd=()=>md.setInputFiles({name:'규정.md',mimeType:'text/markdown',buffer:Buffer.from(markdown)});
      await page.goto('/?asset='+skill.id+'&edition=1');
      await lib.getByRole('button',{name:'수정',exact:true}).click();
      await field.fill(typed);
      await loadMd();
      await expect(confirm.getByText(/작성 중인 SKILL.md/)).toBeVisible();
      await confirm.getByRole('button',{name:'현재 내용 유지'}).click();
      await expect(field).toHaveValue(typed);
      await loadMd();
      await confirm.getByRole('button',{name:'가져온 내용 적용'}).click();
      await expect(field).toHaveValue(markdown);
      await expect(lib.getByRole('button',{name:'assets/icon.bin',exact:true})).toBeVisible();
      let editionRequests=0;
      await page.route('**/api/studio',async route=>{
        const body=route.request().postDataJSON();
        if(body?.action!=='asset.save'||body.data.id!==skill.id)return route.continue();
        editionRequests++;
        if(editionRequests>1)return route.continue();
        const [first,repeated]=await Promise.all([route.fetch(),context.request.post('/api/studio',{data:body})]);
        assert.equal(first.status(),200);
        assert.equal(repeated.status(),200);
        await route.abort('connectionreset');
      });
      await lib.getByRole('button',{name:'새 버전 저장'}).click();
      await expect(lib.getByRole('alert')).toBeVisible();
      await expect(field).toHaveValue(markdown);
      await lib.getByRole('button',{name:'새 버전 저장'}).click();
      await expect(lib.getByLabel('자료 버전')).toHaveValue('2');
      assert.equal(editionRequests,2);
      await page.unroute('**/api/studio');
      const second=await request(context,'asset.read',{id:skill.id,version:2});
      assert.equal(second.payload.content,markdown);
      assert.deepEqual(second.payload.files.filter((f:{path:string})=>f.path!=='SKILL.md').map((f:{path:string;data:string})=>[f.path,f.data]),
        [['assets/icon.bin',image],['scripts/check.ts',Buffer.from('return 3').toString('base64')]]);

      await lib.getByRole('button',{name:'수정',exact:true}).click();
      // Chromium's headless native directory picker can withhold its input event on
      // Windows. Supply its normal FileList and relative paths to the real form.
      await lib.locator('input[webkitdirectory]').evaluate((input:HTMLInputElement)=>{
        const folder=new DataTransfer();
        const main=new File(['폴더에서 가져온 지침'],'SKILL.md',{type:'text/markdown'});
        Object.defineProperty(main,'webkitRelativePath',{value:'선택한 폴더/SKILL.md'});
        folder.items.add(main);input.files=folder.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
      });
      await expect(confirm.getByText('assets/icon.bin',{exact:true})).toBeVisible();
      await confirm.getByRole('button',{name:'현재 내용 유지'}).click();
      await expect(field).toHaveValue(markdown);
      const archive=Buffer.from(zipSync({'SKILL.md':strToU8('꾸러미 교체'),'refs/new.txt':strToU8('추가 자료')}));
      const zipButton=lib.getByRole('button',{name:'ZIP 파일',exact:true});
      const loadZip=async()=>{
        const fileChooser=page.waitForEvent('filechooser');
        await zipButton.click();
        await (await fileChooser).setFiles({name:'작업.zip',mimeType:'application/zip',buffer:archive});
      };
      await loadZip();
      await expect(confirm.getByText('assets/icon.bin',{exact:true})).toBeVisible();
      await expect(confirm.getByText('scripts/check.ts',{exact:true})).toBeVisible();
      if(process.env.STUDIO_SCREENSHOTS){
        await mkdir(process.env.STUDIO_SCREENSHOTS,{recursive:true});
        await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'skill-import-'+viewport.width+'.png')});
      }
      await confirm.getByRole('button',{name:'현재 내용 유지'}).click();
      await expect(field).toHaveValue(markdown);
      await expect(zipButton).toBeFocused();
      await loadZip();
      await confirm.getByRole('button',{name:'가져온 내용 적용'}).click();
      await expect(field).toHaveValue('꾸러미 교체');
      await expect(lib.getByRole('button',{name:'assets/icon.bin',exact:true})).toHaveCount(0);
      const binary=Buffer.alloc(350_000,0xab);
      const changedZip=Buffer.from(zipSync({'SKILL.md':strToU8('꾸러미 교체'),'refs/new.txt':strToU8('교체할 정책'),'files/archive.bin':binary}));
      const loadChanged=()=>lib.locator('input[accept*=".zip"]').setInputFiles({name:'다음.zip',mimeType:'application/zip',buffer:changedZip});
      const replace=confirm.getByRole('checkbox',{name:'refs/new.txt 교체'});
      await loadChanged();
      await expect(replace).not.toBeChecked();
      await confirm.getByRole('button',{name:'가져온 내용 적용'}).click();
      await lib.getByRole('button',{name:'refs/new.txt',exact:true}).click();
      await expect(lib.getByText('추가 자료',{exact:true})).toBeVisible();
      await loadChanged();
      await replace.check();
      await confirm.getByRole('button',{name:'가져온 내용 적용'}).click();
      await lib.getByRole('button',{name:'refs/new.txt',exact:true}).click();
      await expect(lib.getByText('교체할 정책',{exact:true})).toBeVisible();
      await lib.getByRole('button',{name:'files/archive.bin',exact:true}).click();
      const downloadPromise=page.waitForEvent('download');
      await lib.getByRole('button',{name:'이 파일 내려받기'}).click();
      const downloaded=await downloadPromise;
      assert.equal(downloaded.suggestedFilename(),'archive.bin');
      assert.deepEqual(await readFile((await downloaded.path())!),binary);
      assert.equal((await request(context,'asset.read',{id:skill.id})).version,2);
      await lib.getByRole('button',{name:'취소',exact:true}).click();
      await page.getByRole('button',{name:'변경 버리기'}).click();
      await expect(lib.getByLabel('자료 버전')).toHaveValue('2');

      await other.goto('/?asset='+skill.id+'&edition=2');
      await lib.getByRole('button',{name:'수정',exact:true}).click();
      await field.fill('탭 A에서 쓴 본문');
      await other.getByRole('button',{name:'수정',exact:true}).click();
      await other.getByLabel('SKILL.md 지침').fill('탭 B가 먼저 저장한 본문');
      await other.getByRole('button',{name:'새 버전 저장'}).click();
      await expect(other.getByLabel('자료 버전')).toHaveValue('3');
      await lib.getByRole('button',{name:'새 버전 저장'}).click();
      await expect(lib.getByRole('button',{name:'최신판과 비교'})).toBeVisible();
      await expect(field).toHaveValue('탭 A에서 쓴 본문');
      page.once('dialog',dialog=>dialog.accept());
      await page.reload();
      await expect(field).toHaveValue('탭 A에서 쓴 본문');
      await lib.getByRole('button',{name:'최신판과 비교'}).click();
      const comparison=page.getByRole('dialog',{name:'최신판과 내 초안 비교'});
      await expect(comparison.getByText('탭 B가 먼저 저장한 본문')).toBeVisible();
      await expect(comparison.getByText('탭 A에서 쓴 본문')).toBeVisible();
      await page.keyboard.press('Escape');
      const compare=lib.getByRole('button',{name:'최신판과 비교'});
      await expect(compare).toBeFocused();
      await compare.press('Enter');
      await expect(comparison).toBeVisible();
      if(process.env.STUDIO_SCREENSHOTS)await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'conflict-compare-'+viewport.width+'.png')});
      let dropped=false;
      await page.route('**/api/studio',async route=>{
        const body=route.request().postDataJSON();
        if(dropped||body?.action!=='asset.save'||!body.data.requestKey)return route.continue();
        const response=await route.fetch();
        assert.ok(response.ok());dropped=true;
        await route.abort('connectionreset');
      });
      await comparison.getByRole('button',{name:'내 사본으로 저장'}).click();
      await expect(comparison.getByRole('alert')).toBeVisible();
      await comparison.getByRole('button',{name:'내 사본으로 저장'}).click();
      await expect(lib.getByRole('heading',{name:'안내 Skill 사본',exact:true})).toBeVisible();
      assert.ok(dropped);
      assert.equal((await request(context,'asset.list')).filter((item:{mine:boolean;name:string})=>item.mine&&item.name==='안내 Skill 사본').length,1);
      await page.unroute('**/api/studio');
      const copy=await request(context,'asset.read',{id:new URL(page.url()).searchParams.get('asset')});
      assert.equal(copy.payload.content,'탭 A에서 쓴 본문');
      assert.equal(copy.payload.files.find((f:{path:string})=>f.path==='assets/icon.bin').data,image);
      assert.equal((await request(context,'asset.read',{id:skill.id})).payload.content,'탭 B가 먼저 저장한 본문');

      await page.goto('/?asset='+skill.id+'&edition=3');
      await lib.getByRole('button',{name:'수정',exact:true}).click();
      await field.fill('비교하고 적용할 본문');
      const newer=async(base:number,text:string)=>request(context,'asset.save',{
        id:skill.id,baseVersion:base,name:skill.name,payload:{content:text}});
      await newer(3,'먼저 저장한 넷째 판');
      await lib.getByRole('button',{name:'새 버전 저장'}).click();
      await lib.getByRole('button',{name:'최신판과 비교'}).click();
      await expect(comparison.getByText('최신 4판')).toBeVisible();
      await newer(4,'비교 중에 저장한 다섯째 판');
      await comparison.getByRole('button',{name:'내 초안을 5판으로 저장'}).click();
      await expect(comparison).toHaveCount(0);
      await expect(field).toHaveValue('비교하고 적용할 본문');
      await lib.getByRole('button',{name:'최신판과 비교'}).click();
      await expect(comparison.getByText('비교 중에 저장한 다섯째 판')).toBeVisible();
      await comparison.getByRole('button',{name:'내 초안을 6판으로 저장'}).click();
      await expect(lib.getByLabel('자료 버전')).toHaveValue('6');
      assert.equal((await request(context,'asset.read',{id:skill.id,version:5})).payload.content,'비교 중에 저장한 다섯째 판');
      assert.equal((await request(context,'asset.read',{id:skill.id,version:6})).payload.content,'비교하고 적용할 본문');

      const named=async(name:string,visibility:string)=>{
        const item=await request(context,'asset.save',{kind:'document',name,payload:{content:'공유 목록 검증'}});
        return request(context,'asset.share',{id:item.id,visibility,version:1});
      };
      const label=crypto.randomUUID().slice(0,8);
      const secret=await named('직접 받은 시험 규정 '+label,'link'),publicDoc=await named('모두가 읽는 시험 규정 '+label,'public');
      const revisedName='개정한 시험 규정 '+label;
      await request(context,'asset.save',{id:secret.id,baseVersion:1,name:revisedName,payload:{content:'공유한 둘째 판'}});
      await request(context,'asset.share',{id:secret.id,visibility:'link',version:2});
      const reader=await recipient.newPage();
      await reader.goto('/?asset='+secret.id+'&edition=1&token='+secret.token);
      await expect(reader.getByRole('heading',{name:secret.name,exact:true})).toBeVisible();
      await reader.getByRole('button',{name:'← 도구 및 자료'}).click();
      await reader.getByRole('button',{name:'직접 받은 자료',exact:true}).click();
      await expect(reader.locator('.rl-asset-open').filter({hasText:revisedName})).toContainText('2판');
      await expect(reader.locator('.rl-asset-open').filter({hasText:publicDoc.name})).toHaveCount(0);
      await reader.getByRole('button',{name:'모두에게 공개',exact:true}).click();
      await expect(reader.locator('.rl-asset-open').filter({hasText:publicDoc.name})).toBeVisible();
      await expect(reader.locator('.rl-asset-open').filter({hasText:revisedName})).toHaveCount(0);

      await request(context,'asset.share',{id:secret.id,visibility:'link',version:1});
      await page.goto('/?asset='+secret.id+'&edition=1');
      const rotate=lib.getByRole('button',{name:'현재 링크 철회·재발급'});
      await expect(rotate).toBeVisible();
      await request(context,'asset.share',{id:secret.id,visibility:'link',version:2});
      await rotate.click();
      await expect(lib.getByRole('alert')).toContainText('현재 게시판과 공개 범위');
      const latestAddress=lib.getByLabel('최신 게시판 주소',{exact:true});
      assert.equal(new URL(await latestAddress.inputValue()).searchParams.get('token'),secret.token);
      await rotate.click();
      await expect(lib.locator('.rl-notice')).toContainText('새 주소');
      const renewed=await request(context,'asset.read',{id:secret.id});
      assert.equal(renewed.asset.publicVersion,2);
      assert.notEqual(renewed.asset.token,secret.token);
      await request(context,'asset.share',{id:secret.id,visibility:'private'});
      await rotate.click();
      await expect(lib.getByRole('alert')).toContainText('현재 게시판과 공개 범위');
      await expect(rotate).toHaveCount(0);
      if(process.env.STUDIO_SCREENSHOTS)await page.screenshot({path:join(process.env.STUDIO_SCREENSHOTS,'preserved-private-share-'+viewport.width+'.png')});
      await expect(latestAddress).toHaveCount(0);
      assert.equal((await request(context,'asset.read',{id:secret.id})).asset.visibility,'private');

      const large=Buffer.alloc(3_555_584,'# Lending policy: five books per person.\n');
      const medium=await request(context,'asset.save',{kind:'skill',name:'용량 시험',payload:{files:[
        {path:'SKILL.md',data:Buffer.from('# 지침').toString('base64')},
        {path:'사진.bin',data:Buffer.alloc(1_500_000).toString('base64')},
      ]}});
      await page.goto('/?asset='+medium.id+'&edition=1');
      await lib.getByRole('button',{name:'수정',exact:true}).click();
      const loadLarge=()=>md.setInputFiles({name:'SKILL.md',mimeType:'text/markdown',buffer:large});
      await loadLarge();
      await expect(lib.getByRole('alert')).toContainText('부속 파일을 합쳐');
      await expect(field).toHaveValue('# 지침');
      await lib.getByRole('button',{name:'취소',exact:true}).click();
      await page.goto('/?asset='+skill.id+'&edition=6');
      await lib.getByRole('button',{name:'수정',exact:true}).click();
      await loadLarge();
      await expect(lib.getByRole('status')).toContainText('반영했습니다',{timeout:30_000});
      const outgoing=page.waitForRequest(req=>req.method()==='POST'&&req.postDataJSON()?.action==='asset.save');
      await lib.getByRole('button',{name:'새 버전 저장'}).click();
      const sent=await outgoing;
      assert.ok(sent.postDataBuffer()!.length<8_000_000);
      assert.equal(sent.postDataJSON().data.payload.content,undefined);
      await expect(lib.getByLabel('자료 버전')).toHaveValue('7',{timeout:30_000});
      const edition=await request(context,'asset.read',{id:skill.id,version:7});
      assert.equal(edition.payload.content,large.toString('utf8'));
    }finally{await context.close();await recipient.close();}
  }
  console.log('PASS Skill imports, final bundle limits, large single-payload save, conflict recovery, retry-safe draft copy, stale link rotation and received-link filtering.');
}
