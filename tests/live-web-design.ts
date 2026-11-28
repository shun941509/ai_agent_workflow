import assert from 'node:assert/strict';
import type { Graph } from '../src/domain';
import type { Project, Run } from './live-service';
import { eventData } from './optional-team-exercises';

type Studio = {
  create(id: string): Promise<Project>;
  edit(project: Project, mutate: (graph: Graph) => void): Promise<Project>;
  runSample(project: Project): Promise<Run>;
  reply(run: Run, value: string): Promise<Run>;
};

const keyboard = /키보드|포커스|초점|Tab|Enter|Space/i;
const shipping = /배송\s*중/;
const oneOrder = /ORD-1002|유리\s*물병|(?:1|한)\s*(?:건|개|행)/i;
const threeOrders = /(?:3|세)\s*(?:건|개|행)|ORD-1003/i;
const twoReturns = /(?:2|두)\s*(?:건|개|행)|RET-2002/i;

function resultText(run: Run, node: string) {
  const text = eventData(run, node).value;
  assert.ok(typeof text === 'string' && text.trim(), node + '의 결과');
  return text;
}

export function webDesignScenarios(studio: Studio): [string, () => Promise<void>][] {
  const sample = async (id: string) => studio.runSample(await studio.create(id));
  return [
    ['web-design-diagnose', async () => {
      const run = await sample('web-design-diagnose');
      assert.equal(run.state, 'completed');
      assert.match(run.output, shipping);
      assert.match(run.output, oneOrder);
      assert.match(run.output, /선택|상태|활성|적용/);
    }],
    ['web-design-component', async () => {
      const project = await studio.create('web-design-component');
      const run = await studio.runSample(project);
      assert.equal(run.state, 'completed');
      assert.match(run.output, shipping);
      assert.match(run.output, keyboard);
      assert.match(run.output, threeOrders);
      assert.match(run.output, /aria-pressed|data-status|filter-button|renderOrders|order-filters/);
      assert.deepEqual(eventData(run, 'file').value, {fileName:'컴포넌트-개선.md', format:'markdown', content:run.output});
      const edited = await studio.edit(project, graph => {
        const skill = graph.nodes.find(node => node.id === 'skill-component' && node.type === 'instruction.skill');
        assert.ok(skill);
        skill.config.content += '\n선택 상태를 색과 글자로 함께 표시한다. 선택된 버튼 옆에 “현재 적용” 문구가 보이도록 코드 예시를 작성한다.';
      });
      const next = await studio.runSample(edited);
      assert.equal(next.state, 'completed');
      assert.notEqual(next.conversation, run.conversation);
      assert.equal(next.input, run.input);
      assert.match(next.output, /현재 적용/);
      assert.match(next.output, keyboard);
    }],
    ['web-design-flow', async () => {
      const run = await sample('web-design-flow');
      assert.equal(run.state, 'completed', '재현 정보가 있는 사례는 추가 회신 없이 완료됩니다.');
      assert.match(run.output, /없는\s*상품/);
      assert.match(run.output, /0\s*(?:건|개|행)|빈\s*(?:결과|목록|상태|표)|결과.{0,15}없/s);
      assert.match(run.output, /해제|초기화|지우|복구|재설정|reset/i);
      assert.match(run.output, threeOrders);
    }],
    ['web-design-questions', async () => {
      const waiting = await sample('web-design-questions');
      assert.equal(waiting.state, 'waiting');
      const question = resultText(waiting, 'interviewer');
      assert.ok(waiting.prompt);
      assert.ok(waiting.prompt.prompt.includes(question));
      assert.deepEqual(waiting.prompt.fields?.map(field => field.name), ['사용자 답변']);
      assert.ok(!waiting.events.some(event => event.nodeId === 'modeler' && event.kind === 'start'));
      const reply = 'Tab을 눌러도 주문은 한 건 그대로입니다. 배송 중의 선택 표시만 사라집니다.';
      const done = await studio.reply(waiting, JSON.stringify({'사용자 답변':reply}));
      assert.equal(done.id, waiting.id);
      assert.equal(done.state, 'completed');
      const criteria = resultText(done, 'modeler');
      assert.ok(done.output.includes(criteria));
      assert.match(criteria, shipping);
      assert.match(criteria, oneOrder);
      assert.match(criteria, keyboard);
      assert.match(criteria, /선택|표시|적용/);
    }],
    ['web-design-shared-ui', async () => {
      const run = await sample('web-design-shared-ui');
      assert.equal(run.state, 'completed');
      const changes = resultText(run, 'developer');
      const checks = resultText(run, 'qa');
      assert.match(changes, /공통|공유|재사용/);
      assert.match(checks, shipping);
      assert.match(checks, /반품/);
      assert.match(checks, /접수/);
      assert.match(checks, threeOrders);
      assert.match(checks, twoReturns);
      assert.match(checks, keyboard);
      for (const value of [changes, checks]) assert.ok(run.output.includes(value));
    }],
    ['web-design-tdd-review', async () => {
      const waiting = await sample('web-design-tdd-review');
      assert.equal(waiting.state, 'waiting');
      assert.deepEqual(waiting.prompt?.fields?.map(field => field.name), ['확정한 테스트 범위']);
      assert.ok(!waiting.events.some(event => event.nodeId === 'developer' && event.kind === 'start'));
      const reply = '배송 중을 선택하고 Tab으로 배송 완료에 포커스를 옮겨도, 배송 중 선택 표시와 유리 물병 한 건이 유지되는지 확인합니다.';
      const done = await studio.reply(waiting, JSON.stringify({'확정한 테스트 범위':reply}));
      assert.equal(done.id, waiting.id);
      assert.equal(done.state, 'completed');
      const changes = resultText(done, 'developer');
      assert.match(changes, /실패|RED/i);
      assert.match(changes, /통과|GREEN/i);
      for (const role of ['standards','spec']) {
        const findings = resultText(done, role);
        assert.ok(done.output.includes(findings), role);
      }
      assert.ok(done.output.includes(changes));
      assert.match(resultText(done, 'spec'), /배송|필터/);
    }],
    ['web-design-single-screen', async () => {
      const run = await sample('web-design-single-screen');
      assert.equal(run.state, 'completed');
      const visual = resultText(run, 'visual');
      const accessibility = resultText(run, 'accessibility');
      const change = resultText(run, 'developer');
      const checks = resultText(run, 'qa');
      for (const id of ['visual', 'accessibility']) assert.equal(eventData(run, id, 'start').input, run.input);
      const reviews = String(eventData(run, 'developer', 'start').input);
      assert.ok(reviews.includes(visual) && reviews.includes(accessibility));
      assert.ok(String(eventData(run, 'qa', 'start').input).includes(change));
      assert.match(visual, /선택|활성|적용/);
      assert.match(accessibility, keyboard);
      assert.match(change, /선택|눌림|활성|적용/);
      assert.match(change, keyboard);
      assert.match(checks, oneOrder);
      assert.match(checks, threeOrders);
      assert.match(checks, keyboard);
      for (const value of [visual, accessibility, change, checks]) assert.ok(run.output.includes(value));
    }],
    ['web-design-review-followup', async () => {
      const project = await studio.create('web-design-review-followup');
      const waiting = await studio.runSample(project);
      assert.equal(waiting.state, 'waiting');
      assert.deepEqual(waiting.prompt?.fields?.map(field => field.name), [
        '코딩 규칙 검토 결과', '개선 기준 검토 결과', '확정한 테스트 범위',
      ]);
      const roles = ['developer', 'standards', 'spec'];
      assert.ok(!waiting.events.some(event => roles.includes(event.nodeId) && event.kind === 'start'));
      const done = await studio.reply(waiting, JSON.stringify({
        '코딩 규칙 검토 결과':'규칙 1 · 선택 표시를 주문 필터 값과 별도로 보관합니다.',
        '개선 기준 검토 결과':'기준 1 · 전체로 복구해도 배송 중에 선택 표시가 남습니다.',
        '확정한 테스트 범위':'동의',
      }));
      assert.equal(done.id, waiting.id);
      assert.equal(done.state, 'completed');
      for (const role of roles) assert.ok(done.output.includes(resultText(done, role)));
      assert.match(resultText(done, 'developer'), /실패|RED/i);
      assert.match(resultText(done, 'developer'), /통과|GREEN/i);
      assert.match(resultText(done, 'standards'), /상태|필터/);
      assert.match(resultText(done, 'spec'), /전체/);
      const next = await studio.runSample(project);
      assert.equal(next.state, 'waiting');
      const clear = await studio.reply(next, JSON.stringify({
        '코딩 규칙 검토 결과':'지적 없음', '개선 기준 검토 결과':'0건', '확정한 테스트 범위':'동의',
      }));
      assert.equal(clear.id, next.id);
      assert.equal(clear.state, 'completed');
      assert.ok(!clear.events.some(event => roles.includes(event.nodeId) && event.kind === 'start'));
      assert.match(clear.output, /지적 없음|0건/);
    }],
    ['web-design-rollout', async () => {
      const waiting = await sample('web-design-rollout');
      assert.equal(waiting.state, 'waiting');
      assert.deepEqual(waiting.prompt?.fields?.map(field => field.name), ['반영 범위', '판단 근거']);
      const orders = resultText(waiting, 'primary');
      const returns = resultText(waiting, 'related');
      assert.match(orders, /1,?280/);
      assert.match(orders, threeOrders);
      assert.match(returns, /1,?440/);
      assert.match(returns, /RET-2001|(?:1|한)\s*(?:건|개|행)/i);
      assert.match(returns, twoReturns);
      for (const value of [orders, returns]) assert.ok(waiting.prompt!.prompt.includes(value));
      const decision = {'반영 범위':'공통 필터 반영 보류', '판단 근거':'반품 필터를 해제해도 두 번째 행이 돌아오지 않았습니다.'};
      const final = await studio.reply(waiting, JSON.stringify(decision));
      assert.equal(final.id, waiting.id);
      assert.equal(final.state, 'completed');
      for (const value of [orders, returns, ...Object.values(decision)]) assert.ok(final.output.includes(value));
    }],
  ];
}
