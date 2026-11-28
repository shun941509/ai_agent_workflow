import { Drawing } from './template-drawing';
import type { Lesson } from './types';
import { attachWebDesignSkill } from './web-design-skills';

const question = '주문 목록에서 ‘배송 중’을 고르고 Tab을 누르니 필터가 풀린 것 같아요. 무엇을 고쳐야 할지 함께 정해 주세요.';
const behavior = '주문 목록에는 처음에 주문 세 건이 보입니다. ‘배송 중’을 누르면 유리 물병 한 건이 남습니다. 다음 조작은 Tab을 눌러 ‘배송 완료’ 버튼으로 포커스를 옮기는 것입니다. 그 뒤 화면에 몇 건이 보였고 어느 버튼에 선택 표시가 있었는지는 아직 기록하지 않았습니다.';

function questionsGraph() {
  const d = new Drawing('사용자가 설명한 웹 화면의 불편을 질문으로 확인하고, 회신에서 합의한 용어와 관찰 가능한 개선 기준을 정리합니다.');
  d.node('request', 'input.user_request', '불편한 화면 설명', 0, 1, {question});
  d.node('interviewer', 'agent.delegate', '요구사항 확인 담당', 1, 1, {
    role:'요구사항 확인 담당',
    instruction:[
      '원래 요청과 연결된 화면 동작 설명을 읽고, 무엇을 개선할지 결정하는 데 필요한 관찰 한 가지를 사용자에게 확인하세요. 이미 설명한 사실은 활용하세요.',
      '같은 말이 가리킬 수 있는 두 상황을 구별하도록 실제 조작과 보이는 결과를 담아 한국어로 물으세요. 권장하는 확인 방법을 함께 제시하고 질문에서 답변을 기다리세요.',
    ].join('\n'),
  });
  d.node('reply', 'input.form', '확인 질문에 답하기', 2, 1, {prompt:'{{input}}', fields:['사용자 답변']});
  d.node('exchange', 'data.transform', '질문과 사용자 답변 모으기', 3, 1, {operation:'text'});
  d.node('modeler', 'agent.delegate', '용어 정리 담당', 4, 1, {
    role:'용어 정리 담당',
    instruction:[
      '원래 요청, 화면 동작 설명, 요구사항 확인 담당이 물은 질문과 ‘사용자 답변’을 읽으세요. 질문에 제시된 선택지 중 실제 답변이 뒷받침하는 관찰을 한 문장으로 기록하세요.',
      '사용자가 혼동한 화면 용어를 하나 골라 이 화면에서의 뜻을 일상 언어로 정의하세요. 그 뜻과 사용자 답변을 근거로 시작 상태, 사용자가 할 조작, 그 뒤 눈으로 확인할 결과가 드러나는 개선 기준을 작성하세요.',
      '기존에 알려진 동작과 새로 원하는 동작을 구분하세요. 회신이 모호하면 확인된 내용까지만 정리하고 추가로 확인할 점을 적으세요. 제안한 기대 결과와 검증 여부를 구분해 최종 답변으로 전달하세요.',
    ].join('\n'),
  });
  d.node('answer', 'output.answer', '용어와 개선 기준 전달', 5, 1);
  d.doc('behavior', '화면 동작 설명', behavior, 2, 0, 'interviewer');
  d.edge('behavior', 'modeler', 'reference', 'ref', 'context');
  attachWebDesignSkill(d, 'grilling', 1, 2, 'interviewer');
  attachWebDesignSkill(d, 'domain-modeling', 4, 2, 'modeler');
  d.step('request', 'interviewer');
  d.step('interviewer', 'reply');
  d.data('interviewer', 'exchange');
  d.step('reply', 'exchange');
  d.step('exchange', 'modeler');
  d.data('request', 'modeler', 'question');
  d.step('modeler', 'answer');
  return d.graph;
}

export const webDesignQuestionsTemplate: Lesson = {
  id:'web-design-questions', title:'질문으로 화면 개선 기준 정하기', topic:'웹 디자인 개선', level:'중급',
  description:'필터가 풀린 것처럼 보일 때 무엇이 달라졌는지 질문에 답하고, 그 관찰을 확인 가능한 개선 기준으로 정리합니다.',
  goal:'화면에서 직접 본 일과 원하는 동작을 구분하고, 같은 조작으로 다시 확인할 개선 기준을 작성합니다.',
  task:'‘배송 중’을 선택하고 Tab을 누른 뒤 보인 주문 수와 버튼 표시를 설명하세요. 그 답변이 최종 기준에 어떻게 반영되는지 확인하세요.',
  question,
  steps:[
    '실습 상세에서 ‘주문 관리 예제 내려받기’를 눌러 HTML을 브라우저로 여세요. 작업실로 돌아와 ‘내 사본으로 시작’을 누르고 ‘화면 동작 설명’에서 Tab을 누른 뒤 확인해야 할 점을 읽으세요.',
    '‘시험 실행’에서 예시 질문을 보내세요. ‘확인 질문에 답하기’가 열리면 내려받은 주문 화면에서 같은 조작을 해 보세요. ‘사용자 답변’에 본 내용을 적고 ‘같은 실행 이어가기’를 누르세요.',
    '최종 답변에서 용어의 뜻, 내가 한 조작과 그 뒤의 기대 결과를 읽으세요. 다른 화면으로 연습할 때는 ‘화면 동작 설명’을 바꾸고 새 대화에서 그 화면의 불편을 알려 주세요.',
  ],
  skillSteps:['사본의 각 담당자 블록에서 적용되는 Skill을 확인하세요. 요구사항 확인 담당이 어떤 질문을 골랐고, 용어 정리 담당이 답변에서 어떤 표현의 뜻을 정리했는지 대조하세요.'],
  checks:[
    '요구사항 확인 담당이 현재 설명만으로 알 수 없는 점을 묻고 사용자의 답변을 기다립니다.',
    '용어 정리 담당이 실제 답변을 근거로 화면 용어의 뜻과 다시 관찰할 수 있는 개선 기준을 작성합니다.',
  ],
  sampleCase:{title:'Tab을 누르니 필터가 풀린 것 같아요', expected:'질문을 받은 뒤 관찰한 결과를 회신하면, 그 답변에 맞는 용어 정의와 확인 가능한 개선 기준이 나옵니다.'},
  example:'“한 건 그대로이고 선택 표시만 사라져요”라고 답했다면 적용 중인 필터는 목록에 어떤 주문이 보일지 정하는 조건입니다. Tab을 누른 뒤에도 ‘배송 중’에 선택 표시가 남고 포커스는 ‘배송 완료’로 이동해야 합니다.',
  examples:[],
  graph:questionsGraph(),
};
