import { useId, type ReactNode } from 'react';
import { GuideFigure } from './GuideFigure';
import styles from './VisualGlossary.module.css';

const terms = [
  {
    name: 'Workflow', title: '질문이 답변이 되기까지',
    meaning: 'Workflow는 일을 어떤 순서로 처리하고 어떤 정보를 건넬지 정한 설계입니다.',
    example: '‘질문 입력’에서 받은 회원증 질문은 ‘도서관 안내 Agent’를 거쳐 ‘답변 전달’로 갑니다. 아래의 ‘도서관 이용규정’은 답에 사용할 원문을 제공합니다.',
    action: '‘질문에서 답변까지’ 예제를 열고 왼쪽 질문 블록부터 화살표를 따라가 보세요. 블록 목록이 열려 있다면 ‘캔버스로 보기’를 누르세요.',
    image: 'terms-workflow',
  },
  {
    name: 'Agent', title: '규정을 읽고 답을 쓰는 담당자',
    meaning: 'Agent는 맡은 일과 지시에 따라 질문에 답하거나 작업을 수행하는 AI입니다.',
    example: '‘도서관 안내 Agent’는 회원증 질문과 이용규정을 읽고 준비물을 한 문장으로 안내합니다.',
    action: '‘도서관 안내 Agent’를 선택하고 ‘속성’에서 ‘작업 지시’를 읽어 보세요. 답변에 근거를 인용하게 하려면 이 지시를 바꾸면 됩니다.',
    image: 'terms-agent',
  },
  {
    name: '블록', title: '한 가지 일을 맡는 단위',
    meaning: '캔버스의 네모 하나가 블록입니다. 블록의 종류에 따라 질문을 받거나, 자료를 읽거나, 답을 전달합니다.',
    example: '‘질문 입력’ 블록에는 이용자가 보내 볼 ‘예시 질문’이 들어 있습니다. ‘답변 전달’ 블록은 완성된 안내를 이용자에게 돌려줍니다.',
    action: '캔버스에서 ‘질문 입력’을 선택하고 ‘속성’에서 ‘예시 질문’을 찾아보세요.',
    image: 'terms-block',
  },
  {
    name: '연결선', title: '다음 일과 전달할 값을 잇는 선',
    meaning: '블록 사이의 화살표를 따라가면 다음에 실행할 블록과 정보를 받는 블록을 알 수 있습니다.',
    example: '‘질문 입력’과 ‘도서관 안내 Agent’ 사이에는 선이 하나 보입니다. 이 선에는 Agent를 시작하는 순서와 질문을 건네는 연결이 함께 들어 있습니다.',
    action: '‘질문 입력’에서 ‘도서관 안내 Agent’로 가는 화살표를 선택하세요. ‘실행 순서’에서 Agent가 언제 시작하는지, ‘전달할 값’에서 질문이 Agent의 어느 항목으로 들어가는지 확인하세요.',
    image: 'terms-connection',
  },
  {
    name: '자료', title: '답변의 근거로 읽는 원문',
    meaning: '자료는 Agent가 답할 때 참고하는 내용입니다. 이 예제에서는 도서관 이용규정이 그 역할을 합니다.',
    example: '“회원증을 처음 만들 때는 신분증을 가져오세요.”라는 규정이 있어서 Agent가 신분증을 준비하라고 안내할 수 있습니다.',
    action: '‘도서관 이용규정’을 선택한 뒤 ‘자료 원문’에서 회원증에 관한 문장을 찾아보세요.',
    image: 'source-rule',
  },
  {
    name: '도구', title: '예약 목록처럼 필요한 정보를 조회하는 기능',
    meaning: '도구는 Workflow가 실행 중에 호출해 일을 맡기고 결과를 받을 수 있는 기능입니다.',
    example: '중급 예제 ‘도서관 방문 준비하기’에서는 ‘내 예약 조회’ 블록이 예약 목록을 가져옵니다. 작업실에서 도서관의 예약 도구를 쓸 수 있게 이어 주는 것이 MCP 연결입니다.',
    action: '‘내 예약 조회’ 블록을 선택하세요. ‘연결한 MCP에서 도구 선택’에 표시된 reservations.list가 예약 목록을 조회하는 도구입니다.',
    image: 'terms-tool',
  },
] as const;

export type GlossaryTerm = (typeof terms)[number]['name'];

export function VisualGlossary({selected, onSelect, libraryPreview}: {
  selected: GlossaryTerm;
  onSelect: (name: GlossaryTerm) => void;
  libraryPreview: ReactNode;
}) {
  const group = useId();
  const term = terms.find(item => item.name === selected)!;
  return <div className={styles.reader}>
    <fieldset className={styles.picker}>
      <legend>그림으로 볼 용어</legend>
      <div className={styles.options}>
        {terms.map(item => <label key={item.name} className={styles.option}>
          <input type="radio" name={group} value={item.name} checked={selected === item.name}
            aria-controls={group + '-example'} aria-describedby={selected === item.name ? group + '-meaning' : undefined}
            onChange={() => onSelect(item.name)} />
          <span>{item.name}</span>
        </label>)}
      </div>
    </fieldset>
    <section id={group + '-example'} className={styles.example} aria-labelledby={group + '-title'}>
      <div className={styles.definition}>
        <h3 id={group + '-title'}>{term.title}</h3>
        <p id={group + '-meaning'}>{term.meaning}</p>
      </div>
      <div className={styles.picture}>
        <GuideFigure key={term.image} id={term.image} />
      </div>
      <div className={styles.notes}>
        <h4>{term.name === '도구' ? '도서관 방문 준비하기에서' : '회원증 안내 예제에서'}</h4>
        <p>{term.example}</p>
        <h4>화면에서 찾아보기</h4>
        <p>{term.action}</p>
        {term.name === '도구' && libraryPreview}
        {term.image === 'terms-connection' && <details className={styles.locate}>
          <summary>캔버스에서 이 선의 위치 보기</summary>
          <GuideFigure id="terms-workflow" />
        </details>}
      </div>
    </section>
  </div>;
}
