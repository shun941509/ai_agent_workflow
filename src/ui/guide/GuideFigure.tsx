import { useId, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Maximize2 } from 'lucide-react';
import StudioDialog from '../StudioDialog';
import { captures } from './captures';
import styles from './GuidePage.module.css';

type Capture = NonNullable<(typeof captures)[keyof typeof captures]>;
type ZoomSize = 'fit' | 'original' | 'double';

const captureNames: Record<string, string> = {
  'terms-workflow': '도서관 질문의 전체 Workflow',
  'terms-agent': '도서관 안내 Agent의 속성',
  'terms-block': '질문 입력 블록의 속성',
  'terms-connection': '질문과 Agent 사이의 연결',
  'terms-tool': '예약을 조회하는 도구',
  '01-start': '작업실에서 가이드를 여는 위치',
  '02-start-example': '가이드에서 예제로 시작하기',
  '02-editor': '도서관 예제가 열린 편집기',
  'source-rule': '도서관 이용규정의 자료 원문',
  '03-question': '시험 질문과 실행 버튼',
  'help-question-blocked': '질문 실행이 차단된 설계와 설계 검사',
  '04-answer': '첫 실행의 답변',
  '05-instruction': '도서관 안내 Agent의 작업 지시',
  '05-compare': '지시를 바꾼 뒤의 실행 결과',
  'error-source': '자료 원문과 연결을 확인할 위치',
  'error-model-home': '작업실의 모델 설정 상태',
  'error-model': '모델 연결 실패와 다시 실행할 위치',
};

function MarkedImage({ capture, preview = false, scale = 1, eager = false }: { capture: Capture; preview?: boolean; scale?: 1 | 2; eager?: boolean }) {
  return <span className={styles.markedImage} style={preview ? undefined : {width:capture.width * scale}}>
    <Image src={capture.src} alt={capture.alt} width={capture.width} height={capture.height} unoptimized loading={eager ? 'eager' : undefined} />
    {capture.marks.map((mark, index) => <span className={styles.marker} aria-hidden="true" key={index}
      style={{left: mark.x + '%', top: mark.y + '%', width: mark.w + '%', height: mark.h + '%'}}>
      <b>{index + 1}</b>
    </span>)}
  </span>;
}

export function GuideFigure({id, title = captureNames[id] ?? '실습 화면', eager = false}: {id: string; title?: string; eager?: boolean}) {
  const capture = captures[id];
  const [zoom, setZoom] = useState(false);
  const [size, setSize] = useState<ZoomSize>('fit');
  const opener = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  const readingPoint = useRef<{x:number; y:number} | null>(null);
  function changeSize(next: ZoomSize) {
    const area = viewport.current;
    const image = area?.querySelector('img');
    if (area && image && size !== 'fit' && next !== 'fit') {
      const box = image.getBoundingClientRect();
      const frame = area.getBoundingClientRect();
      if (box.width && box.height) readingPoint.current = {
        x:(frame.left + area.clientLeft + area.clientWidth / 2 - box.left) / box.width,
        y:(frame.top + area.clientTop + area.clientHeight / 2 - box.top) / box.height,
      };
    }
    setSize(next);
  }
  useLayoutEffect(() => {
    const area = viewport.current;
    if (!area || !capture) return;
    const first = capture.marks[0];
    const point = readingPoint.current ?? (first && {x:(first.x + first.w / 2) / 100, y:(first.y + first.h / 2) / 100});
    readingPoint.current = null;
    if (size !== 'fit' && point) {
      const scale = size === 'double' ? 2 : 1;
      area.scrollLeft = point.x * capture.width * scale - area.clientWidth / 2;
      area.scrollTop = point.y * capture.height * scale - area.clientHeight / 2;
    } else {
      area.scrollTo(0, 0);
    }
  }, [zoom, size, capture]);

  if (!capture) return <figure className={styles.pending}>
    <figcaption><strong>추가 캡처 필요</strong><span>{title}</span></figcaption>
  </figure>;
  const dialogSize = capture.width <= 720 ? 'form' : capture.width <= 1400 ? 'settings' : 'workspace';

  return <figure className={styles.figure}>
    <button ref={opener} type="button" className={styles.pictureButton} aria-label={title + ' 확대'}
      style={{width:capture.width < 1000 ? Math.min(capture.width, Math.max(320, capture.width * .75)) : capture.width}}
      aria-haspopup="dialog" onClick={event => {
        setSize(event.currentTarget.clientWidth < capture.width * .75 ? 'original' : 'fit');
        setZoom(true);
      }}>
      <MarkedImage capture={capture} preview eager={eager} />
      <span className={styles.zoomLabel}><Maximize2 size={14} aria-hidden="true" />화면 확대</span>
    </button>
    <figcaption>
      <span className={styles.imageKind}>실제 제품 화면</span>
      <span>{capture.caption}</span>
      {capture.marks.length > 0 && <span className={styles.legend}>
        <span>설명용 표시</span>
        {capture.marks.map((mark, index) => <span key={index}><b>{index + 1}</b>
          {mark.label}</span>)}
      </span>}
    </figcaption>
    {zoom && <StudioDialog size={dialogSize} title={title + ' 확대'} descriptionId={descriptionId} onClose={() => {
      setZoom(false);
      requestAnimationFrame(() => opener.current?.focus({preventScroll: true}));
    }}>
      <div className={styles.zoomTools}>
        <span id={descriptionId}>{capture.caption}</span>
        <div role="group" aria-label="이미지 배율">
          <button type="button" className="btn" onClick={() => changeSize(size === 'fit' ? 'original' : 'fit')}>
            {size === 'fit' ? '원본 크기로 보기' : '화면에 맞추기'}
          </button>
          <button type="button" className="btn" aria-pressed={size === 'double'} onClick={() => changeSize(size === 'double' ? 'original' : 'double')}>
            2배로 확대
          </button>
        </div>
      </div>
      <div ref={viewport} className={styles.zoomViewport} data-original={size !== 'fit'} role="region" aria-label="확대한 실습 화면" tabIndex={0}>
        <MarkedImage capture={capture} scale={size === 'double' ? 2 : 1} />
      </div>
    </StudioDialog>}
  </figure>;
}
