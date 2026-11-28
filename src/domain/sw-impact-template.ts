import { Drawing } from './template-drawing';
import type { Graph, Lesson } from './types';

const question = '목록, 상세, 검색, 알림';
const supplement = '[알림 QA] 완료한 일의 예약 알림이 발송되지 않았다. 통과.';

function investigation(): Graph {
  const d = new Drawing();
  d.node('module', 'input.user_request', '배정된 모듈', 0, 0);
  d.node('search', 'knowledge.search', '모듈의 QA 기록 찾기', 1, 0, {
    query:'[{{input}} QA]', matchMode:'literal',
  });
  d.node('evidence', 'quality.evidence', '시험 결과를 적은 원문 확인', 2, 0, {
    includeSourceLines:true,
    criterion:'배정된 모듈의 QA 기록에 실제 관찰과 통과 또는 실패가 명시되어야 합니다. ' +
      '실패 기록도 결과를 확인한 근거입니다. 같은 시험에서 결과가 다르면 근거 상충으로 표시하세요. ' +
      '모듈 이름, 관찰 내용, 통과 또는 실패를 포함한 원문 한 줄 전체를 인용하세요.',
  });
  d.node('result', 'output.answer', '원문과 확인 상태 반환', 3, 0);
  d.step('module','search');
  d.step('search','evidence');
  d.data('module','evidence','question');
  for (const route of ['verified','insufficient','conflicting']) d.order('evidence','result',route);
  d.data('evidence','result');
  return d.graph;
}

function reportRow(): Graph {
  const d = new Drawing();
  d.node('row','input.user_request','담당자의 조사 결과',0,1);
  d.node('incomplete','control.branch','미완료 사유가 있나요?',1,0,{
    path:'error', operator:'truthy', yesLabel:'미완료', noLabel:'근거 확인',
  });
  d.node('cited','control.branch','인용한 QA 기록이 있나요?',1,2,{
    path:'result.sourceLines', operator:'truthy', yesLabel:'원문 있음', noLabel:'원문 없음',
  });
  d.node('module','data.transform','미완료 모듈 이름',2,0,{path:'target'});
  d.node('reason','data.transform','미완료 사유',2,1,{path:'error'});
  d.node('quote','data.transform','인용한 QA 원문 행',2,2,{path:'result.sourceLines'});
  d.node('report','control.join','조사 사유와 QA 원문',3,1,{merge:'text'});
  d.node('output','output.answer','판단에 쓸 근거',4,1);
  d.step('row','incomplete');
  d.step('row','cited');
  for (const [branch,id] of [['incomplete','module'],['incomplete','reason'],['cited','quote']]) {
    d.order(branch,id,'yes');
    d.data(branch,id);
    d.step(id,'report');
  }
  d.order('incomplete','report','no');
  d.order('cited','report','no');
  d.step('report','output');
  return d.graph;
}

function releaseImpact(): Graph {
  const d = new Drawing('할 일 앱의 완료 처리 변경이 요청된 모듈에 미치는 영향을 조사하고 QA 근거와 출시 판단을 정리합니다.');
  d.node('input','input.user_request','조사 후보 모듈',0,1,{question});
  d.node('spawn','agent.create_dynamic','모듈별 조사 담당 생성',1,1,{
    role:'할 일 앱 QA 조사 담당',
    instruction:'배정된 모듈에서 완료 상태 변경을 시험한 기록을 찾아 원문과 근거 상태를 돌려줍니다.',
    separator:',', maxCreatedAgents:3, maxInFlightAgents:2, maxDepth:1,
    failurePolicy:'collect', resultRequirement:'evidence',
  },investigation());
  d.step('input','spawn');
  d.doc('qa-log','모듈별 QA 기록',[
    '[목록 QA] 완료한 일이 진행 중인 일 아래로 이동했다. 통과.',
    '[상세 QA] 완료한 일을 다시 열어도 완료 표시가 유지됐다. 통과.',
    '[검색 QA] 진행 중인 일만 검색하면 완료한 일이 빠졌다. 통과.',
  ].join('\n'),1,2,'spawn');

  d.node('selected','data.transform','조사한 모듈 가져오기',2,0,{path:'results'});
  d.node('rows','control.loop','모듈별 원문 또는 미완료 사유 정리',3,0,{maxIterations:20},reportRow());
  d.node('scope','control.branch','선택에서 빠진 모듈이 있나요?',2,2,{
    path:'excluded', operator:'truthy', yesLabel:'일부 선택', noLabel:'모두 조사',
  });
  d.node('excluded','data.transform','선택 제외 모듈',3,2,{
    operation:'rename', path:'excluded', target:'선택 제외',
  });
  d.node('summary','control.join','출시 판단에 쓸 조사 결과',4,1,{merge:'sections'});
  d.step('spawn','selected');
  d.step('selected','rows');
  d.step('spawn','scope');
  d.order('scope','excluded','yes');
  d.data('scope','excluded');
  d.order('scope','summary','no');
  d.step('rows','summary');
  d.step('excluded','summary');

  d.node('decision','input.form','출시 판단과 근거 입력',5,1,{
    prompt:'{{input}}\n\n완료 처리 변경을 출시할지 정하세요. 출시 판단에 ‘진행’ 또는 ‘보류’를 쓰고, 판단 근거에 해당 모듈과 관찰 내용을 적으세요.',
    fields:['출시 판단','판단 근거'],
  });
  d.node('record','control.join','조사 결과에 사람의 판단 첨부',6,1,{merge:'sections'});
  d.node('output','output.answer','출시 판단 기록',7,1);
  d.step('summary','decision');
  d.data('summary','record');
  d.step('decision','record');
  d.step('record','output');
  return d.graph;
}

export const swImpactTemplate: Lesson = {
  id:'sw-release-impact', title:'변경 영향 조사팀을 구성해 출시 판단하기', level:'전문가', topic:'소프트웨어 개발',
  description:'가상의 할 일 앱에서 완료 처리를 바꿨습니다. 네 모듈 중 이번에 조사할 모듈을 고르고, QA 원문을 보고 출시 여부를 결정합니다.',
  goal:'한정된 조사 인원으로 확인한 결과와 남은 위험을 구분하고, 출시 판단의 근거를 설명합니다.',
  task:'같은 세 모듈을 두 번 조사하세요. 빠진 QA 원문을 보완한 뒤 두 실행에 남긴 출시 판단과 근거를 비교하세요.',
  question,
  steps:[
    '‘모듈별 조사 담당 생성 → 고급 설정’에서 전체 생성 상한과 동시 실행 상한을 정하세요. 첫 비교에는 기본값인 전체 3명·동시 2명과 ‘확인된 결과와 미완료 사유 수집’을 사용하세요.',
    '‘시험 실행’에서 네 모듈을 보내고 목록, 상세, 알림을 차례대로 고르세요. 목록과 상세의 QA 원문, 알림의 근거 부족 사유, 검색의 선택 제외를 확인하세요.',
    '‘출시 판단’에 진행 또는 보류를 쓰고 ‘판단 근거’에 영향을 받는 모듈을 적으세요. 예를 들어 알림 기록이 없어 보류한다고 적고 ‘같은 실행 이어가기’를 누르세요.',
    '‘모듈별 QA 기록’의 ‘자료 원문’ 맨 아래 새 줄에 “' + supplement + '”를 추가하고 ‘변경 적용’을 누르세요.',
    '새 대화에서 같은 네 모듈을 보내고 목록, 상세, 알림을 같은 순서로 고르세요. 알림 원문이 생긴 뒤에도 검색은 조사 범위 밖입니다. 남은 위험을 고려해 다시 판단하고 두 실행 기록을 비교하세요.',
  ],
  checks:[
    '기본 설정에서는 1차에 목록·상세, 2차에 알림 담당자가 생성됩니다. 검색 담당자는 생성되지 않습니다.',
    '첫 조사에서는 목록·상세의 통과 원문, 알림의 근거 부족, 검색의 선택 제외가 구분됩니다. 보완 후에는 알림의 예약 알림 시험 결과가 인용됩니다.',
    '두 실행 기록에는 해당 실행의 조사 결과와 사람이 입력한 출시 판단 및 이유가 함께 남습니다.',
  ],
  sampleCase:{title:'완료 처리 변경의 출시 판단', expected:'전체 3명·동시 2명에서 목록·상세·알림을 고르면 처음에는 목록·상세만 통과 기록이 있습니다. 알림 원문을 보완한 뒤에는 같은 세 모듈 모두에 통과 기록이 있고, 검색은 두 번 모두 선택 제외입니다.'},
  example:'첫 조사에서 “알림이 계속 발송될지 확인할 QA가 없어 보류한다”라고 기록할 수 있습니다. 보완 후에는 알림 시험 결과와 아직 조사하지 않은 검색을 근거로 진행 또는 보류를 결정합니다.',
  examples:['목록, 알림'],
  graph:releaseImpact(),
};
