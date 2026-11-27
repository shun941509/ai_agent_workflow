import { Modal } from './Modal';

const groups = [
  {title:'캔버스와 목록 탐색', rows:[
    ['/', '현재 팀에서 이름으로 블록 찾기. 검색창에서 Enter를 누르면 첫 결과로 이동합니다.'],
    ['Page Up / Page Down', '이전·다음 블록 또는 연결선으로 초점 이동'],
    ['Home / End', '같은 종류의 첫 항목·마지막 항목으로 초점 이동'],
    ['Ctrl + ↑', '연결선의 도착 블록으로 이동'],
    ['Ctrl + ↓', '블록 또는 출력점에 연결된 선으로 이동. 여러 개면 따라갈 경로를 고릅니다.'],
    ['Tab / Shift + Tab', '펼친 경로를 이동합니다. Enter 또는 Space로 경로를 선택한 뒤 Tab으로 목적지 보기와 돌아가기 버튼을 찾을 수 있습니다.'],
    ['Esc', '경로 상세에서는 선택한 행으로 돌아갑니다. 경로 행에서는 강조를 해제합니다.'],
    ['Enter 또는 Space', '초점을 둔 블록·연결선의 속성 열기. 출력점에서는 연결 추가'],
    ['?', '키보드 단축키 열기'],
  ]},
  {title:'캔버스 배율', rows:[
    ['+ 또는 =', '초점을 둔 블록·출력점·연결선을 기준으로 확대'],
    ['-', '축소'],
    ['0', '100% 배율로 돌아가기'],
  ]},
  {title:'설계 편집', rows:[
    ['방향키', '캔버스에서 초점을 둔 블록을 8px 이동. Shift와 함께 누르면 24px 이동합니다.'],
    ['Delete', '초점을 둔 블록 삭제'],
    ['Ctrl + Z', '설계 변경 되돌리기. Shift와 함께 누르면 다시 실행합니다.'],
    ['Ctrl + S', '편집한 원문과 프로젝트 저장'],
    ['Esc', '드래그 취소 또는 열린 패널·대화상자 닫기'],
  ]},
];

export function CanvasShortcuts({onClose}:{onClose:()=>void}) {
  return <Modal title="키보드 단축키" size="settings" onClose={onClose}>
    <p className="ws-shortcut-intro">편집기의 첫 Tab에서 ‘캔버스로 바로 가기’를 선택하세요. Mac에서는 Ctrl 대신 ⌘를 사용하세요.</p>
    {groups.map(group => <section className="ws-shortcut-group" key={group.title}>
      <h3>{group.title}</h3>
      <dl>
        {group.rows.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}
      </dl>
    </section>)}
  </Modal>;
}
