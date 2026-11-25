import {NextRequest,NextResponse} from 'next/server';
import {lookupSession,authenticate,logOut,usage} from '../../../server/auth';
import {assetList,assetShare,copyAsset,documentPreviews,readLibraryAsset,sharedAssetList,writeAsset} from '../../../server/assets';
import {deleteAsset,listTrashedAssets,purgeTrashedAssets,restoreAsset} from '../../../server/asset-trash';
import {assetDeleteImpact,draftArchiveList,inspectImportedDesign,projectSharedAccess,publicationState} from '../../../server/projects';
import {openProject,listProjects,listTrashedProjects,createProject,saveProject,deleteProject,restoreProject,purgeTrashedProjects,projectCopy,versionList,snapshot,publish,decideRelease,restore,revoke,caseList,caseSave} from '../../../server/projects';
import {propose,modelReady} from '../../../server/model';
import {runGet,runList,startRun,replyRun,stopRun,refreshReceipts,stats,inputFiles,lastTestSources} from '../../../server/runs';
import {StudioError,requireThat} from '../../../server/errors';
import {templates} from '../../../domain';
import {triggerList,enableTrigger,disableTrigger,ownerEvent} from '../../../server/triggers';
import {readJsonBody} from '../../../server/request-json';
import {recordEditorVisit,resumeWorkspace} from '../../../server/projects';
import {prepareAgentExport,previewAgentExport} from '../../../server/agent-export';
import {buildAgentZip} from '../../../server/agent-zip';
export const runtime='nodejs';export const dynamic='force-dynamic';
function success(data: unknown, cookie?: string) {
  const res = NextResponse.json({data}, {headers: {'cache-control': 'no-store'}});
  if (cookie) res.headers.append('set-cookie', cookie);
  return res;
}
async function handler(req:NextRequest){
 try{
   if(req.method==='POST'){
     const origin=req.headers.get('origin');
     requireThat(!origin||new URL(origin).host===req.headers.get('host'),403,'다른 사이트에서 보낸 요청입니다.');
     requireThat(req.headers.get('content-type')?.includes('application/json'),415,'JSON 요청이 필요합니다.');
   }
   let action='bootstrap',b:any={};
   if(req.method==='POST'){
     const body=await readJsonBody(req,8_000_000);requireThat(body&&typeof body.action==='string',400,'요청 동작을 지정하세요.');
     action=body.action;b=body.data??{};requireThat(b&&typeof b==='object'&&!Array.isArray(b),400,'요청 내용을 확인하세요.');
   }
   const cookie = req.headers.get('cookie') ?? '';
   if (action === 'auth.login' || action === 'auth.signup') {
     const result = authenticate(action === 'auth.login' ? 'login' : 'signup', b.login, b.password, cookie, b.importGuestWork === true);
     return success(result.user, result.cookie);
   }
   if (action === 'auth.logout') return success(null, logOut(cookie));
   const user = lookupSession(cookie)?.user;
   requireThat(user?.login, 401, '작업실을 이용하려면 로그인하세요.');
   let data:unknown;
   switch(action){
     case 'auth.session':data=user;break;
     case 'bootstrap': data={user,admin:!!process.env.STUDIO_ADMIN_IDS?.split(',').includes(user.id),usage:usage(user),modelReady:modelReady(),projects:listProjects(user),resume:resumeWorkspace(user),assets:assetList(user),sharedAssets:sharedAssetList(user),lessons:templates.map(({graph,...rest})=>rest)};break;
     case 'editor.visit':data=recordEditorVisit(user,b.id,b.focus);break;
     case 'project.list':data=listProjects(user);break;
     case 'project.trash':data=listTrashedProjects(user);break;
     case 'project.open':data=openProject(user,b.id,b.token);break;
     case 'project.sharedAccess':data=projectSharedAccess(user,b.id,b.token,b.shareGeneration);break;
     case 'project.create':data=createProject(user,b);break;
     case 'project.save':data=saveProject(user,b);break;
     case 'project.inspectImport':data=inspectImportedDesign(user,b);break;
     case 'project.exportPreview':data=previewAgentExport(user,b);break;
     case 'project.exportAgent':{
       const pkg=prepareAgentExport(user,b);
       const filename=encodeURIComponent((pkg.title.replace(/[\\/:*?"<>|]/g,'-')||'Agent')+'.zip').replace(/'/g,'%27');
       return new Response(await buildAgentZip(pkg),{headers:{
         'content-type':'application/zip','cache-control':'no-store',
         'content-disposition':"attachment; filename=\"agent.zip\"; filename*=UTF-8''"+filename,
       }});
     }
     case 'project.delete':data=deleteProject(user,b);break;
     case 'project.restore':data=restoreProject(user,b);break;
     case 'project.purge':data=purgeTrashedProjects(user,b);break;
     case 'project.copy':data=projectCopy(user,b);break;
     case 'project.stats':data=stats(user,b.id);break;
     case 'project.revoke':data=revoke(user,b.id,b);break;
     case 'versions.list':data=versionList(user,b.id);break;
     case 'versions.state':data=publicationState(user,b.id);break;
     case 'versions.archives':data=draftArchiveList(user,b.id);break;
     case 'versions.save':data=snapshot(user,b);break;
     case 'versions.publish':data=publish(user,{expectedVisibility:'private',expectedPublicVersion:null,...b});break;
     case 'versions.decide':data=decideRelease(user,b);break;
     case 'versions.restore':data=restore(user,b);break;
     case 'asset.list':data=assetList(user);break;
     case 'asset.deleteImpact':data=assetDeleteImpact(user,b.id);break;
     case 'asset.delete':data=deleteAsset(user,b);break;
     case 'asset.trash':data=listTrashedAssets(user);break;
     case 'asset.restore':data=restoreAsset(user,b);break;
     case 'asset.purge':data=purgeTrashedAssets(user,b);break;
     case 'asset.previews':data=documentPreviews(user,b.pins);break;
     case 'asset.read':data=readLibraryAsset(user,b.id,b.version,b.token,b.sharedCatalog===true);break;
     case 'asset.save': data=writeAsset(user,b);break;
     case 'asset.share':data=assetShare(user,b.id,b.visibility,Boolean(b.rotate),b.version,b.revision);break;
     case 'asset.copy':data=copyAsset(user,b.id,b.version,b.token,b.requestKey,b.sharedCatalog===true);break;
     case 'propose':data=await propose(user,b,req.signal);break;
     case 'cases.list':data=caseList(user,b.id);break;
     case 'cases.save':data=caseSave(user,b);break;
     case 'run.inputFiles':data=inputFiles(user,b);break;
     case 'run.lastTestSources':data=lastTestSources(user,b.id,b.version);break;
     case 'run.start':data=startRun(user,b);break;
     case 'trigger.list':data=triggerList(user,b.id);break;
     case 'trigger.enable':data=enableTrigger(user,b);break;
     case 'trigger.disable':data=disableTrigger(user,b.id);break;
     case 'trigger.event':data=ownerEvent(user,b);break;
     case 'run.get':data=runGet(user,b.runId,b);break;
     case 'run.list':data=runList(user,b.id,b.conversation,b);break;
     case 'run.reply':data=replyRun(user,b);break;
     case 'run.stop':data=stopRun(user,b.runId);break;
     case 'run.receipts':data=await refreshReceipts(user,b.runId,b);break;
     default:throw new StudioError(404,'요청한 동작을 찾을 수 없습니다.');
   }
   return success(data);
 }catch(e){
   const status=e instanceof StudioError?e.status:e instanceof SyntaxError?400:500;
   if(status===500)console.error('Studio request error',e instanceof Error?e.name+': '+e.message:'unknown');
   return NextResponse.json({error:e instanceof StudioError?e.message:status===400?'요청 형식을 확인하세요.':'요청을 처리하지 못했습니다. 서버 상태를 확인하세요.'},{status,headers:{'cache-control':'no-store'}});
 }
}
export const GET=handler;export const POST=handler;

