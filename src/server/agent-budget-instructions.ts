import type {Block, Field} from '../domain/types';
import {defaultConcurrency, defaultDepth, defaultModelCallLimit, defaultRunCounts} from '../engine/limits';
import {integer} from '../engine/values';

const defaults = '전체 모델 호출 ' + defaultModelCallLimit + '회, 동시 실행 ' + defaultConcurrency + '개';

export const runBudgetInstruction = '실행 한도는 ' + defaults +
  '가 기본입니다. 클라이언트의 해당 한도가 더 낮으면 낮은 값을 적용하세요. 대표는 실제 모델 호출 전에 잔여 횟수에서 1회를 차감하고 모델·외부 도구에 빈 자리를 배정하세요. 잔여가 0이면 새 모델 호출을 중단하고, 회신 후에는 같은 실행 기록을 이어 쓰세요. 하위 역할 배정과 재개 예시는 [실행 한도와 기록](README.md#run-limits)에 있습니다.';

export const runBudgetReadme = [
  '', '<a id="run-limits"></a>', '', '## 실행 한도와 기록', '',
  '새 Workflow 실행은 ' + defaults + '로 시작합니다. 각 한도는 현재 클라이언트에서 사용할 수 있는 낮은 값까지 줄이세요. 예를 들어 병렬 작업의 설정이 10개이고 클라이언트가 2개를 지원하면 한 차수에 최대 2개를 시작합니다.',
  '실행 전체의 기본 상한은 실행 단계 '+defaultRunCounts.steps+'개, 외부 도구 호출 '+defaultRunCounts.toolCalls+'회, 동적으로 생성한 담당자 '+defaultRunCounts.agents+'명입니다. 하위 설계 호출 깊이는 기본 '+defaultDepth+'층입니다. 확인한 참조·건너뛴 단계와 이미 완료한 단계의 재개는 새 단계로 세지 마세요. 외부 도구의 실제 호출 직전과 새 대상의 담당자를 시작할 때 각각 해당 잔여를 차감하세요. 현재 배정이 상한을 넘으면 새 작업을 멈추고 소진된 항목을 알리세요.',
  '',
  '대표 Agent가 현재 대화의 실행 기록 한 곳에 유효 상한, 사용한 모델 호출 수, 남은 횟수(상한 − 사용), 진행 중인 호출과 단계 결과를 유지하세요. 새 실행의 기본 기록은 사용 0회, 남음 ' + defaultModelCallLimit + '회, 진행 중 0개입니다. 단계마다 설계가 요구하는 모델 작업을 세고, 승인 대기나 문서 열기에서는 사용량을 유지하세요.',
  '',
  '모델 작업마다 호출한 경로·단계·대상 또는 반복 번호·판단 차수·용도를 묶어 호출을 식별하세요. 대표가 병렬 요청을 하나씩 확인해 잔여 횟수와 빈 자리를 확보한 뒤 시작을 허가하세요. 허가할 때 사용 횟수를 1 올리고 잔여를 1 줄이세요. 요청이 끝나면 동시 실행 자리만 돌려주세요. 실패한 호출도 사용 횟수에 포함합니다.',
  '담당자가 작업 중 대표와 메시지를 주고받을 수 없는 클라이언트에서는 호출 전에 다음 모델·도구 작업 하나를 지정해 배정하세요. 담당자가 그 결과와 다음에 필요한 호출을 반환하면 같은 단계의 다음 차수를 배정하세요.',
  '',
  '모델과 외부 도구는 하위 Workflow와 모든 담당자를 통틀어 같은 동시 실행 자리를 사용합니다. 외부 도구는 도구 호출 횟수와 자리를 배정하세요. Workflow를 호출하거나 역할을 배정하는 단계는 내부에서 실제로 수행할 모델 작업별로 차감하세요. 별도 모델로 업무 범위를 판정할 때도 1회를 사용합니다. 하위 호출을 기다리는 상위 단계는 원격 호출 자리를 비워 두세요.',
  '',
  '각 Workflow에서는 한 차수에 시작할 단계 수를 유효 동시 실행 한도 이내로 정하세요. 같은 Workflow 안에서 겹치는 병렬 블록의 설정도 모두 지키세요. 바깥 병렬 블록은 그 층에서 시작하는 하위 호출 수를 제한합니다. 하위 설계 내부는 자체 병렬 설정과 실행 전체의 원격 호출 한도를 적용하세요.',
  '',
  '동시 실행 자리가 차면 진행 중인 호출이 끝날 때까지 기다리세요. 다음 모델 작업에 필요한 잔여 횟수가 0이면 그 작업과 후속 호출을 중단하고 한도에 도달한 단계·사용량·잔여를 알리세요. 마지막 허가된 호출로 일을 마쳤다면 결과 전달까지 진행하세요.',
  '',
  '승인·자료·검토 회신을 기다릴 때는 완료 결과, 이미 허가한 호출과 진행 중인 호출 ID, 블록별 사용량과 남은 횟수를 보존하세요. 재개할 때 완료 결과를 재사용하고 진행 중인 호출은 같은 ID로 상태를 확인하세요. 이미 차감한 같은 호출은 다시 차감하지 마세요. 새 판단·새 대상·별도 하위 호출에는 새 식별자를 사용하세요.',
];

const limitFields = new Set(['maxSteps', 'maxIterations', 'maxCreatedAgents', 'maxInFlightAgents', 'maxDepth', 'maxConcurrency']);
const groundedResult=' 검색 후보로 답할 때는 질문에 직접 답하는 구절을 해당 후보에서 그대로 인용하고, 연결 원문이 있으면 같은 판·위치를 대조하세요. 인용을 찾지 못하거나 원문과 다르면 근거 부족으로 답변을 보류하세요. 유효한 인용이 있어도 마지막 완료 판정이 미충족·확인 필요이면 이유와 근거 부족을 전달하세요.';

// Older snapshots can omit these fields. Use the catalog defaults and bounds shown by the editor.
export function budgetFieldValue(field: Field, value: unknown) {
  return limitFields.has(field.key) && typeof field.default === 'number' && field.min !== undefined && field.max !== undefined
    ? integer(value, field.default, field.min, field.max) : value;
}

export function stageBudgetInstruction(node: Block) {
  switch (node.type) {
    case 'agent.task':
      return '이 단계의 남은 판단 횟수를 기록하고 도구 선택이나 답변 초안 한 차수마다 1회 줄이세요. 전체 모델 호출은 초안·도구 선택에 1회, 목표·완료 기준 또는 인용 근거의 완료 판정이 필요하면 별도로 1회 차감하세요. 미충족·확인 필요이면 남은 판단 횟수 안에서만 재시도하세요. 일반 업무에서 마지막 판정까지 목표를 충족하지 못하면 단계 실패와 이유를 반환하세요.' + groundedResult;
    case 'ai.single_task':
      return '일반 단발 응답은 전체 모델 호출 1회입니다. 인용이 있는 근거 답변의 완료 판정이 필요하면 별도로 1회 차감하세요.' + groundedResult;
    case 'agent.delegate': case 'agent.handoff':
      return '하위 설계가 있으면 내부 모델 작업마다, 없으면 배정된 대상의 응답을 생성할 때마다 전체 모델 호출을 차감하세요. 인용이 있는 근거 답변을 별도로 판정할 때는 그 호출도 차감하세요.' + (node.graph?'':groundedResult);
    case 'agent.create_dynamic':
      return '대상마다 하위 설계의 모델 작업 또는 단일 응답 생성에 쓴 호출을 차감하세요. 현재 실행에서 이 블록이 이미 생성하거나 선택 대기로 예약한 수를 전체 생성 상한에서 빼고, 반복 진입·회신 후에도 남은 생성 수를 이어 쓰세요. 대상별 작업은 동시 실행 상한 안에서 배정하고 전체 원격 호출 자리도 확인하세요.';
    case 'quality.evidence':
      return '후보가 있을 때의 근거 판정은 모델 호출 1회입니다. 후보가 비어 곧바로 근거 부족으로 진행하거나 회신한 원문을 대조할 때는 해당 판정의 잔여 횟수를 유지하세요.';
    case 'ai.classify': case 'agent.coordinate': case 'agent.select_candidate': case 'quality.evaluate': case 'context.compress':
      return '이 단계의 모델 판단은 전체 호출에서 1회 차감하세요.';
    case 'control.loop':
      return '항목 수가 최대 반복을 넘으면 시작 전에 실패 처리하세요. 각 반복의 하위 호출은 전체 잔여 횟수를 이어서 사용하세요.';
  }
}
