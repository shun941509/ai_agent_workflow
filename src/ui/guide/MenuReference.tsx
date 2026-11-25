import type { Ref } from 'react';
import { workspaceLabels } from '../WorkspaceNav';
import { Icon, type IconName } from '../editor/Icons';
import styles from './MenuReference.module.css';

const menuGroups: { heading?: string; items: [string, IconName, string][] }[] = [
  {
    items: [
      [workspaceLabels.home, 'home', '처음에는 도서관 실습을 시작하고, 다음 방문에는 편집하던 설계를 이어갑니다.'],
      [workspaceLabels.editor, 'workflow', '블록을 배치하고 선을 연결합니다. 블록을 선택해 속성을 고친 뒤 시험 실행에서 답을 확인하세요.'],
      [workspaceLabels.projects, 'folder', '만든 프로젝트를 다시 엽니다. 공유 설정에서 누구에게 어느 판을 보여줄지 정하고, 휴지통에서는 삭제한 프로젝트를 복구합니다.'],
      [workspaceLabels.assets, 'file', 'Agent가 읽을 문서와 지침, 호출할 도구를 등록합니다. 자료의 판을 고른 뒤 내 Workflow에 연결하세요.'],
    ],
  },
  {
    heading: '공유',
    items: [
      [workspaceLabels.shared, 'users', '모두에게 공개된 Agent와 비밀 링크로 받은 Agent를 열어 대화합니다.'],
      [workspaceLabels['shared-assets'], 'layers', '공유된 자료의 판을 골라 내 Workflow에 연결하거나 내 사본으로 만듭니다.'],
    ],
  },
  {
    heading: '예제',
    items: [
      [workspaceLabels.templates, 'book', '난이도와 실습 목표를 확인하고 내 사본을 만들어 시험합니다.'],
    ],
  },
  {
    heading: '설계 도구',
    items: [
      ['설계 가져오기', 'folder', '내보낸 설계 JSON 파일을 불러옵니다. 편집 중이면 현재 프로젝트에서 가져옵니다.'],
      [workspaceLabels.guide, 'info', '설계 순서를 익히고, 다음에 만들 Agent에 맞는 템플릿과 블록을 찾습니다.'],
    ],
  },
];

export function MenuReference({headingRef}: {headingRef: Ref<HTMLHeadingElement>}) {
  return <section className={styles.reference} aria-labelledby="guide-menu-reference">
    <h2 ref={headingRef} tabIndex={-1} id="guide-menu-reference">메뉴별 사용법</h2>
    <p>작업실 왼쪽 메뉴의 아이콘과 이름을 찾아보세요. 작은 화면에서는 상단의 ‘메뉴 열기’를 누르세요.</p>
    {menuGroups.map(({ heading, items }) => <div className={styles.group} key={heading ?? 'workspace'}>
      {heading && <h3>{heading}</h3>}
      <dl>{items.map(([name, icon, description]) => <div key={name}>
        <dt><Icon name={icon} />{name}</dt>
        <dd>{description}</dd>
      </div>)}</dl>
    </div>)}
  </section>;
}
