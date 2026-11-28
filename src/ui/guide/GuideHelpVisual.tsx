import Image from 'next/image';
import {ArrowRight, Check, RefreshCw} from 'lucide-react';
import {GuideVisual} from './GuideVisual';
import styles from './GuideHelpVisual.module.css';

export type HelpVisualIssue = 'question' | 'source' | 'instruction' | 'model';

type Shot = {file:string; width:number; height:number; alt:string};
type Scene = {label:string; detail:string; shot?:Shot};
type Recovery = {title:string; description:string; before:Scene; after:Scene};

const examples:Record<HelpVisualIssue,Recovery> = {
  question: {
    title:'질문 실행이 막힌 화면 비교',
    description:'질문이 채워져 있어도 Agent의 필수 속성이 비어 있으면 설계 검사를 먼저 합니다.',
    before:{label:'실행이 막힌 초안', detail:'설계 검사에서 오류를 열고 ‘맡길 일’을 입력하세요.',
      shot:{file:'help-inspect',width:822,height:242,alt:'맡길 일을 설정하라는 안내 아래의 설계 검사 버튼'}},
    after:{label:'질문을 보낼 위치', detail:'시험 실행으로 돌아와 회원증 질문을 확인하고 ‘질문 실행’을 누르세요.',
      shot:{file:'quick-question',width:816,height:446,alt:'입력된 회원증 질문과 활성화된 질문 실행 버튼'}},
  },
  source: {
    title:'자료 원문 적용 전후',
    description:'준비물을 안내할 때 사용할 문장이 도서관 이용규정에 있는지 확인합니다.',
    before:{label:'원문을 비운 상태', detail:'편집 중인 원문이 비면 변경을 적용할 수 없습니다.',
      shot:{file:'help-empty-source',width:808,height:166,alt:'비활성화된 변경 적용 버튼과 적용할 자료 원문을 입력하라는 안내'}},
    after:{label:'확인할 규정 문장', detail:'‘도서관 이용규정’의 ‘자료 원문’에 이 문장을 넣고 ‘변경 적용’을 누르세요.',
      shot:{file:'help-source-line',width:784,height:91,alt:'도서관 이용규정 원문에서 회원증을 처음 만들 때 신분증을 가져오라는 문장'}},
  },
  instruction: {
    title:'이전 답변과 새 대화의 답변',
    description:'작업 지시를 수정하면 새로 실행한 답변에서 인용을 확인할 수 있습니다.',
    before:{label:'실행 기록의 이전 답변', detail:'이전 버전에서 실제 모델로 실행한 답변입니다. 이미 완료된 기록에는 당시의 안내가 남습니다.',
      shot:{file:'quick-answer',width:500,height:230,alt:'이전 실행에서 신분증을 준비하라고 안내한 완료 답변'}},
    after:{label:'현재 초안으로 다시 실행', detail:'인용을 추가하도록 지시한 뒤 받은 답변 기록입니다. ‘＋ 새 대화’에서 ‘현재 초안’을 골라 같은 질문을 보내고 답변의 근거를 읽으세요.',
      shot:{file:'help-quoted-answer',width:462,height:85,alt:'새 답변의 근거에 도서관 이용규정 문장이 인용된 모습'}},
  },
  model: {
    title:'모델 연결 전후의 상태',
    description:'홈 상단의 모델 상태로 지금 할 수 있는 실습을 구분합니다.',
    before:{label:'연결을 기다리는 동안', detail:'예제를 열어 질문과 이용규정 원문을 읽을 수 있습니다.',
      shot:{file:'help-model-status',width:458,height:118,alt:'실제 작업실 홈의 모델 설정 필요 표시'}},
    after:{label:'운영자가 모델을 연결한 뒤', detail:'홈을 새로고침해 ‘모델 설정됨’을 확인하고 예제에서 질문을 실행하세요.'},
  },
};

function HelpScene({scene}:{scene:Scene}) {
  const shot=scene.shot;
  return <div className={styles.scene}>
    <strong>{scene.label}</strong>
    {shot ? <div className={styles.screen}>
      <Image unoptimized src={'/guide/captures/'+shot.file+'.webp'} width={shot.width} height={shot.height} alt={shot.alt}/>
    </div> : <div className={styles.stateChange}>
      <span><RefreshCw size={15} aria-hidden="true"/>홈 새로고침</span>
      <span><Check size={16} aria-hidden="true"/>모델 설정됨</span>
    </div>}
    <p>{scene.detail}</p>
  </div>;
}

export function GuideHelpVisual({issue}:{issue:HelpVisualIssue}) {
  const {title,description,before,after}=examples[issue];
  return <GuideVisual title={title} description={description}>
    <div className={styles.diagram}>
      <HelpScene scene={before}/>
      <ArrowRight className={styles.arrow} size={20} aria-hidden="true"/>
      <HelpScene scene={after}/>
    </div>
  </GuideVisual>;
}
