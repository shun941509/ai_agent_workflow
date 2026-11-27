import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import {
  ArrowRight, BookOpen, Check, ClipboardList, FileText, FolderOpen, GitBranch,
  ListChecks, MessageCircle, Play, Repeat, Search, Share2, type LucideIcon,
} from 'lucide-react';
import { GuideVisual } from './GuideVisual';
import { guideAddress } from './navigation';
import styles from './GuideVisualConcepts.module.css';

function Path({parts}: {parts: readonly {name: string; text: string; icon: LucideIcon}[]}) {
  return <ol className={styles.path}>
    {parts.map(({name, text, icon: Icon}, index) => <li key={name}>
      <span className={styles.pathName}><Icon size={17} aria-hidden="true" />{name}</span>
      <span>{text}</span>
      {index < parts.length - 1 && <ArrowRight className={styles.connector} size={16} aria-hidden="true" />}
    </li>)}
  </ol>;
}

export function GuideAgentConcept() {
  return <details className={styles.disclosure}>
    <summary>Agent와 일반 채팅은 어떻게 다른가요?</summary>
    <GuideVisual title="도서관 안내원이 답을 찾는 과정"
      description="질문을 받고, 맡겨 둔 일에 맞는 자료를 읽고, 근거가 담긴 답을 돌려주는 흐름입니다.">
      <div className={styles.concept}>
        <dl className={styles.comparison}>
          <div><dt>일반 채팅의 예</dt><dd>질문을 보내 답을 받고, 궁금한 점을 이어서 묻습니다.</dd></div>
          <div><dt>이 작업실의 Agent</dt><dd>읽을 자료와 맡길 일을 미리 연결합니다. 다음 사람이 물어도 같은 순서로 일합니다.</dd></div>
        </dl>
        <Image className={styles.illustration} unoptimized src="/guide/visuals/request-to-answer.webp"
          width={1050} height={375} alt="회원증 질문을 받고 도서관 규정에서 준비물을 확인해 신분증을 가져오라고 답하는 과정" />
        <Path parts={[
          {name:'방문자의 질문', text:'회원증을 만들 때 뭘 가져가죠?', icon:MessageCircle},
          {name:'안내원의 일', text:'연결된 이용규정에서 준비물을 찾기', icon:BookOpen},
          {name:'근거를 담은 답', text:'처음 만들 때는 신분증을 가져오세요.', icon:Check},
        ]} />
        <p className={styles.note}>회의에서는 안내원에게 회의 메모와 작성 규칙을 맡길 수 있습니다. 그러면 메모가 바뀌어도 같은 형식으로 담당 업무를 정리합니다.</p>
      </div>
    </GuideVisual>
  </details>;
}

const features = [
  {icon:GitBranch, label:'Workflow 편집기', example:'질문 입력 → 도서관 안내 Agent → 답변 전달',
    description:'일을 작은 블록으로 나누고 선으로 이으면 질문이 어느 순서로 처리될지 정할 수 있습니다.'},
  {icon:FolderOpen, label:'도구 및 자료', example:'도서관 이용규정 → 안내원이 읽을 자료',
    description:'‘자료 등록’으로 문서를 보관하고 편집기에서 연결하세요. 여러 질문에 같은 원문을 참고할 수 있습니다.'},
  {icon:Play, label:'시험 실행', example:'회원증 질문 보내기 → 신분증 안내 확인',
    description:'질문을 보내 답을 읽습니다. ‘실행 기록’에서 이전 대화를 열면 작업 지시를 바꾸기 전의 답과 비교할 수 있습니다.'},
  {icon:Share2, label:'버전과 공유', example:'현재 초안 버전 저장 → 선택한 버전 게시',
    description:'시험한 설계를 버전으로 저장하고 공개 범위를 정해 게시하세요. 공유할 판을 고를 수 있습니다.'},
];

export function GuideCoreFeatures() {
  return <GuideVisual title="설계부터 공유까지, 어디에서 무엇을 할까요?"
    description="회원증을 안내하는 예제 하나로 편집기와 자료함, 시험 실행, 버전의 역할을 살펴봅니다.">
    <ol className={styles.featureList}>
      {features.map(({icon: Icon, label, example, description}) => <li key={label}>
        <span className={styles.station}><Icon size={20} aria-hidden="true" /></span>
        <div><strong>{label}</strong><p className={styles.example}>{example}</p><p>{description}</p></div>
      </li>)}
    </ol>
  </GuideVisual>;
}

const useCases = [
  {id:'sw-requirements', label:'업무 도우미', title:'사용자 요청을 개발 업무로 바꾸기', icon:ListChecks,
    input:'“끝낸 할 일을 잠깐 숨겼다가 다시 보고 싶어요.”', action:'원하는 동작을 개발자가 확인할 문장으로 정리', output:'목록에서 완료 항목을 숨기고 다시 표시할 수 있다.', template:'할 일 앱 요구사항'},
  {id:'meeting-report', label:'문서 정리', title:'회의 메모에서 확정한 일 골라내기', icon:ClipboardList,
    input:'안내문 12부 인쇄는 확정. 20부 추가는 다음 회의 안건.', action:'회의록 작성 규칙에 따라 결정과 제안을 분리', output:'결정한 업무에는 담당과 기한을 붙이고 미결 안건은 따로 기록한다.', template:'회의록·업무 보고'},
  {id:'library-visit', label:'정보 조사', title:'방문 전 운영시간과 예약 함께 알아보기', icon:Search,
    input:'토요일에 예약한 책을 받으려면 어떻게 해야 하나요?', action:'도서관 운영시간을 검색하고 연결된 도구로 예약 내역을 조회', output:'토요일 10시~16시, 중앙도서관에 예약한 책은 ‘어린 왕자’다.', template:'도서관 방문 준비하기'},
  {id:'manufacturing-report', label:'반복 업무', title:'매번 들어오는 측정표에서 기준 초과 찾기', icon:Repeat,
    input:'웨이퍼 정렬 오차를 기록한 CSV 6행', action:'저장한 기준표의 허용 범위 −4~+4 nm를 각 행에 적용', output:'예시 6건 중 3건이 범위를 벗어났고 해당 LOT는 2개다.', template:'반도체·제조 보고'},
] as const;

function CaseExample({id}: {id: (typeof useCases)[number]['id']}) {
  if (id === 'meeting-report') return <table className={styles.minute}>
    <caption>회의록의 확정 업무 예시</caption>
    <thead><tr><th scope="col">확정 업무</th><th scope="col">담당</th><th scope="col">기한</th></tr></thead>
    <tbody><tr><td>안내문 12부 인쇄</td><td>민지</td><td>미정</td></tr></tbody>
  </table>;
  if (id === 'manufacturing-report') return <ul className={styles.measurements} aria-label="측정값 여섯 건의 판정">
    {[-4, 5, -7, 6, -2, 1].map(value => <li key={value}>
      <strong>{value > 0 ? '+' : ''}{value} nm</strong><span>{Math.abs(value)>4?'초과':'범위 안'}</span>
    </li>)}
  </ul>;
  if (id === 'library-visit') return <dl className={styles.comparison}>
    <div><dt>운영시간 자료</dt><dd>토요일 오전 10시부터 오후 4시까지</dd></div>
    <div><dt>예약 조회 결과</dt><dd>어린 왕자 · 중앙도서관</dd></div>
  </dl>;
  return <dl className={styles.comparison}>
    <div><dt>완료 항목 숨기기 켜기</dt><dd>아직 끝내지 않은 일만 표시</dd></div>
    <div><dt>완료 항목 숨기기 끄기</dt><dd>끝낸 일을 목록에 다시 표시</dd></div>
  </dl>;
}

export function GuideUseCases({step}: {step: number}) {
  const group = useId();
  const preview = useRef<HTMLAnchorElement>(null);
  const [selected, setSelected] = useState<(typeof useCases)[number]['id']>('sw-requirements');
  const item = useCases.find(option => option.id === selected)!;
  useEffect(() => {
    let frame = 0;
    function restorePreviewLink() {
      const previous = useCases.find(option => option.id === window.history.state?.guideCaseReturn);
      if (!previous) return;
      setSelected(previous.id);
      frame = requestAnimationFrame(() => {
        const {guideCaseReturn, ...state} = window.history.state ?? {};
        if (guideCaseReturn !== previous.id) return;
        window.history.replaceState(state, '');
        preview.current?.focus();
      });
    }
    restorePreviewLink();
    window.addEventListener('pageshow', restorePreviewLink);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pageshow', restorePreviewLink);
    };
  }, []);
  return <section className={styles.cases} aria-label="네 가지 Agent 활용 사례">
    <fieldset className={styles.picker}>
      <legend>어떤 일을 맡겨 보고 싶나요?</legend>
      {useCases.map(({id,label,icon: Icon}) => <label key={id} className={styles.option}>
        <input type="radio" name={group} checked={id === selected} onChange={() => setSelected(id)} />
        <Icon size={17} aria-hidden="true" /><span>{label}</span>
      </label>)}
    </fieldset>
    <GuideVisual title={item.title} description={item.label+' 사례의 입력, 처리 방식과 결과 예시입니다.'}>
      <div className={styles.casePicture}>
        <Path parts={[
          {name:'받는 내용', text:item.input, icon:FileText},
          {name:'맡기는 일', text:item.action, icon:item.icon},
          {name:'예상 결과', text:item.output, icon:Check},
        ]} />
        <CaseExample id={item.id} />
      </div>
    </GuideVisual>
    <a className={styles.previewLink} ref={preview}
      href={guideAddress('goals',step)+'&template='+item.id+'#guide-template-title'}
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        window.history.replaceState({...window.history.state, guideCaseReturn:item.id}, '');
      }}>
      {item.template} 미리보기<ArrowRight size={16} aria-hidden="true" />
    </a>
  </section>;
}
