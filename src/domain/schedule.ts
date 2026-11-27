const minute=60_000;
const day=24*60*minute;
const koreaOffset=9*60*minute;
export const scheduleSyntax='매일 09:00(한국 표준시), 매 15분 또는 시간대가 있는 ISO 시각';

/** Times with offsets are unambiguous; fixed wall-clock daily schedules use Korea Standard Time. */
export function scheduleTime(setting:string,after:number):{time:number|null}|{error:string}{
  const text=setting.trim();
  const interval=text.match(/^(?:every\s+(\d+)m|매\s*(\d+)\s*분)$/i);
  if(interval){
    const count=Number(interval[1]??interval[2]);
    if(count<1||count>525600)return {error:'반복 간격은 1~525600분입니다.'};
    return {time:after+count*minute};
  }
  const daily=text.match(/^(?:daily|매일)\s+(\d{1,2}):(\d{2})$/i);
  if(daily){
    const hour=Number(daily[1]),minutes=Number(daily[2]);
    if(hour>=24||minutes>=60)return {error:'일정 시각을 확인하세요.'};
    const dayStart=Math.floor((after+koreaOffset)/day)*day-koreaOffset;
    const candidate=dayStart+(hour*60+minutes)*minute;
    return {time:candidate>after?candidate:candidate+day};
  }
  const date=Date.parse(text),localDay=text.slice(0,10);
  const calendar=new Date(localDay+'T00:00:00Z');
  const includesZone=/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(text);
  if(!includesZone || !Number.isFinite(date) || !Number.isFinite(calendar.getTime()) ||
     calendar.toISOString().slice(0,10)!==localDay || Number(text.slice(11,13))>=24){
    return {error:'일정은 '+scheduleSyntax+'을 입력하세요.'};
  }
  return {time:date>after?date:null};
}
