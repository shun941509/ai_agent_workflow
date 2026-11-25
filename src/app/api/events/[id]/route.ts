import {NextRequest,NextResponse} from 'next/server';
import {acceptEvent} from '../../../../server/triggers';
import {requireThat,StudioError} from '../../../../server/errors';
import {readJsonBody} from '../../../../server/request-json';
export const runtime='nodejs';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const token=request.headers.get('authorization')?.match(/^Bearer ([\w-]+)$/)?.[1];
    requireThat(token,403,'이벤트 토큰이 필요합니다.');
    requireThat(request.headers.get('content-type')?.includes('application/json'),415,'JSON 요청이 필요합니다.');
    const b=await readJsonBody(request,80000);requireThat(b&&typeof b==='object'&&!Array.isArray(b),400,'이벤트 정보를 확인하세요.');
    return NextResponse.json(acceptEvent((await params).id,token,b),{status:202,headers:{'cache-control':'no-store'}});
  }catch(e){return NextResponse.json({error:e instanceof StudioError?e.message:'이벤트를 접수하지 못했습니다.'},{status:e instanceof StudioError?e.status:e instanceof SyntaxError?400:500});}
}
