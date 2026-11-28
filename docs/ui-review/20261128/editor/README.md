# 편집기와 Agent 실행 검토

Windows Chrome에서 PC 마우스와 키보드를 사용했다. 화면 너비는 360·390·768·1024·1280·1440 CSS px, 기본 높이는 900px로 설정했다. 두 서버의 격리 SQLite에 같은 도서관 Agent 설계와 게시판을 넣고, 소유자와 수신자 계정을 각각 만들었다. 브라우저 시작 시점에 복사한 작업 트리를 수정 전 서버로 사용했다. 모델 호출은 두 서버에서 껐다.

## 화면과 조작 결과

| 장면 | 수정 전 | 수정 후 |
| --- | --- | --- |
| 360px 편집기 | 190px 탐색 영역 옆에 편집기 폭 170px가 남았다. 작업 영역의 스크롤 너비는 846px였다. 제목과 시험 실행 버튼이 잘렸다. | 탐색을 접을 수 있는 상단에 배치하고, 팔레트·캔버스·속성 순으로 배치했다. 작업 영역의 너비와 스크롤 너비는 360px다. [수정 전](before/workbench-360.png) · [수정 후](after/workbench-360.png) |
| 390px 편집기 | 작업 영역 200px 안에 846px를 가로 스크롤해야 했다. | 작업 영역은 폭과 스크롤 너비가 390px다. 필수 조작은 영역 밖으로 밀리지 않는다. [수정 전](before/workbench-390.png) · [수정 후](after/workbench-390.png) |
| 768·1024px 편집기 | 작업 영역의 실제 너비는 각각 578px와 834px, 스크롤 너비는 둘 다 846px였다. | 팔레트와 캔버스를 한 줄에 놓고, 속성을 그 아래 같은 너비로 읽는다. 작업 영역 가로 스크롤은 두 너비 모두 0px다. [768px 전](before/workbench-768.png) · [768px 후](after/workbench-768.png) · [1024px 전](before/workbench-1024.png) · [1024px 후](after/workbench-1024.png) |
| 1280·1440px 편집기 | 작업 영역의 너비는 1090px와 1250px였다. | 세 열의 작업대를 각각 1090px와 1250px로 표시했다. [1280px 전](before/workbench-1280.png) · [1280px 후](after/workbench-1280.png) · [1440px 전](before/workbench-1440.png) · [1440px 후](after/workbench-1440.png) |
| 360px 프로젝트 메뉴 | 숨겨진 메뉴 버튼으로 키보드 초점을 옮기면 편집기 자체가 수평 이동했다. | 메뉴와 명령을 같은 오른쪽 경계에 정렬했다. Tab으로 **저장**에 이동하고 Escape로 **프로젝트 메뉴**에 돌아왔다. [수정 전](before/menu-360.png) · [수정 후](after/menu-360.png) |
| 360·390px 공유 Agent | 실행 영역의 너비는 344·372px, 스크롤 너비는 475px였다. 390px에서 **질문 실행**의 왼쪽이 x=354px에 있었다. | 기록을 별도 버튼으로 여닫고 질문·답변을 한 열에 표시했다. 실행 영역의 폭과 스크롤 너비가 각각 334·364px다. 390px에서 **질문 실행**은 x=249px에서 시작한다. [360px 전](before/published-run-360.png) · [360px 후](after/published-run-360.png) · [390px 전](before/published-run-390.png) · [390px 후](after/published-run-390.png) |

360·390·768·1024·1280·1440px에서 목록 보기로 전환해 **도서관 이용규정**의 원문을 3권에서 5권으로 고치고 **변경 적용**을 눌렀다. 속성은 창 폭 안에서 나오며 원문은 같은 라벨을 유지한다. [390px 입력 전](before/source-fields-390.png) · [390px 입력 후](after/source-fields-390.png) · [1440px 입력 전](before/source-fields-1440.png) · [1440px 입력 후](after/source-fields-1440.png)

캔버스 회귀 시험에서 1280px 창을 900×700px로 줄인 뒤 보기 버튼의 초점을 유지하는지 확인했다. 팔레트와 캔버스는 같은 줄, 속성은 아래에 표시됐다. 문서와 작업 영역에 가로 스크롤이 없었다. `/`로 팔레트 검색에 들어가고 Escape로 블록에 돌아왔다. Enter로 속성을 열고 Tab으로 **이름** 입력까지 이동했을 때 입력이 화면에 온전히 들어왔다. 1280·1440px의 세 열 배치 검증도 통과했다. [캔버스 회귀 시험](../../../../tests/canvas-gesture-browser.ts)

## 팝업과 상태

이름 변경, Agent 업무 범위, 버전 및 복구, Agent 공유 설정, Agent 내보내기, 키보드 단축키, 설계 검사, AI 설계 제안을 실제로 열었다. 짧은 이름 변경은 416px, 입력·내보내기 폼은 640px, 장문의 버전·공유 설정과 단축키는 864px 상한을 적용한다. 좁은 창에서는 측정한 모달의 너비가 390px에서 366px다. 명령을 열어 Tab과 Shift+Tab을 실행하고 Escape로 닫은 뒤 호출 버튼의 초점을 대조했다. [이름 변경 전](before/rename-1440.png) · [이름 변경 후](after/rename-1440.png) · [내보내기 전](before/export-390.png) · [내보내기 후](after/export-390.png) · [공유 설정 전](before/share-1440.png) · [공유 설정 후](after/share-1440.png) · [치수 기록 전](before/measurements.json) · [치수 기록 후](after/measurements.json)

설계 가져오기, 데이터 연결, 실행 조건 변경, 적용할 AI 설계 제안은 본문을 스크롤하는 동안 하단 버튼을 유지한다. 390×540px에서 설계에 `{`를 입력했다. 이전에는 영문 파싱 오류가 본문에 나왔고 적용 버튼이 스크롤 아래에 있었다. 수정 후에는 오류와 **현재 초안에 적용**이 화면에 함께 남는다. 입력을 고치면 오류를 지운다. 자료판이 누락된 설계에는 본문 경고에서 초점을 잡는다. 2MB가 넘는 설계의 경고와 재적용도 기존 회귀 시험에서 통과했다. [390×540px 전](before/import-error-390.png) · [390×540px 후](candidate/import-error-390.png)

### 390×540px의 선택과 삭제

폭과 높이가 작은 PC 창에서 실제 Chrome 마우스와 키보드로 선택을 시작했다. 밝은 설정과 어두운 설정에서 같은 자료와 조작을 사용했다. [수정 전 조작 기록](before/choices-390x540.json) · [수정 후 조작 기록](after/choices-390x540.json)

| 화면과 확인한 동작 | 밝은 설정 | 어두운 설정 |
| --- | --- | --- |
| 겹친 연결선 선택. 같은 위치의 선을 클릭해 두 후보를 확인하고 Enter로 첫 번째를 선택했다. | [전](before/overlapping-wire-light-390x540.png) · [후](after/overlapping-wire-light-390x540.png) | [전](before/overlapping-wire-dark-390x540.png) · [후](after/overlapping-wire-dark-390x540.png) |
| 따라갈 연결선 선택. 목록에서 Ctrl+아래쪽 화살표로 대출·예약 경로를 열고 Escape로 출발 블록에 복귀했다. | [전](before/keyboard-wire-light-390x540.png) · [후](after/keyboard-wire-light-390x540.png) | [전](before/keyboard-wire-dark-390x540.png) · [후](after/keyboard-wire-dark-390x540.png) |
| 분류 범주 삭제. 규정 범주에 연결된 도착 블록을 표시했다. 시작 초점을 **닫기**에서 **취소**로 옮겼다. Escape로 닫은 뒤 삭제 버튼에 돌아왔고 연결이 남았다. | [전](before/category-delete-light-390x540.png) · [후](after/category-delete-light-390x540.png) | [전](before/category-delete-dark-390x540.png) · [후](after/category-delete-dark-390x540.png) |
| 자료를 연결할 블록. 공유 문서 1판을 골라 두 후보 중 **대출 안내 담당**에 연결했다. 선택 전에는 버튼이 비활성화됐고 적용 뒤 저장된 참조 연결을 확인했다. | [전](before/attach-block-light-390x540.png) · [후](after/attach-block-light-390x540.png) | [전](before/attach-block-dark-390x540.png) · [후](after/attach-block-dark-390x540.png) |
| 빈 캔버스의 블록 선택. Enter로 팔레트 검색을 열어 **사용자 입력**을 찾고 키보드로 추가했다. | [전](before/empty-block-light-390x540.png) · [후](after/empty-block-light-390x540.png) | [전](before/empty-block-dark-390x540.png) · [후](after/empty-block-dark-390x540.png) |

시험 실행에서 **실행 기록**, **실행 설정**, **시험 사례**, **시험 초기 데이터**, **자동 시작**을 열었다. 실제 워커가 입력을 답변으로 전달했고 **실행 경로**를 펼쳐 실행 기록을 읽었다. 프로덕션 후보에서는 6개 너비의 메뉴·실행·공유 조작과 2개 너비의 설계 파일 오류 전부 통과했다. 각 페이지의 콘솔 오류와 런타임 오류는 0건이다. 최초 개발 서버 실행에서는 탐색이 다시 시작돼 일부 조작이 시간 초과 또는 HTTP 500으로 끝났으며, 같은 조작을 프로덕션 후보에서 다시 수행했다. [시험 설정 전](before/run-settings-390.png) · [시험 설정 후](candidate/run-settings-390.png) · [실행 결과 후](candidate/run-result-390.png) · [프로덕션 후보 측정](candidate/additional-measurements.json)

1280×900px에서 로컬 도서관 MCP로 시험 예약을 한 건 만들었다. 앱이 처리 응답을 받지 못한 상황을 재현하기 위해 테스트 계정의 실행 DB에서 해당 작업 한 건만 **결과 미확인**으로 설정했다. MCP의 예약과 영수증은 처음 저장된 상태로 두었다. **원래 요청의 처리 결과 다시 확인**을 Enter로 누른 뒤 요청이 진행되는 동안 버튼이 비활성화됐으며, 응답 후 **처리 확인**으로 바뀌고 버튼이 사라졌다. 수정 전후 모두 확인 요청은 한 번이었고, 같은 영수증을 읽었으며 예약 수는 한 건이었다. 콘솔·런타임 오류는 0건이다. [미확인 전](before/receipt-unknown-1280.png) · [요청 중 전](before/receipt-checking-1280.png) · [확인 전](before/receipt-confirmed-1280.png) · [미확인 후](after/receipt-unknown-1280.png) · [요청 중 후](after/receipt-checking-1280.png) · [확인 후](after/receipt-confirmed-1280.png) · [실측 전](before/receipt-1280.json) · [실측 후](after/receipt-1280.json)

390×844px에서 **전체 보기 → 편집기로 돌아가기 → 시험 실행**을 눌렀다. axe는 32×32px 닫기 버튼에 연결선의 영역이 겹쳐 사용할 수 있는 폭을 23.5px로 계산했다. 닫기 버튼의 영역을 44×44px로 늘리고 연결선 위에 표시했다. 최종 프로덕션 빌드에서 밝은·어두운 설정 모두 axe 위반, 콘솔 오류, 런타임 오류가 0건이었다. 버튼의 네 모서리 근처가 포인터를 받았고 마우스와 Enter로 닫을 때 **시험 실행**에 초점이 돌아왔다. [밝은 설정 전](before/run-close-light-390.png) · [밝은 설정 후](after/run-close-light-390.png) · [어두운 설정 전](before/run-close-dark-390.png) · [어두운 설정 후](after/run-close-dark-390.png) · [측정 전](before/run-close-390.json) · [최종 빌드 측정](after/run-close-390.json)

개발 경로 `/prototype/library`에서 실습 안내를 열고, 편집기에서 3권을 5권으로 변경한 뒤 **결과 미리보기**를 열었다. 답변과 대출안내.txt의 내려받기, Escape와 복귀 초점을 여섯 너비에서 확인했다. 390px 작업 영역은 폭 248px에 스크롤 너비 747px에서 폭과 스크롤 너비 390px로 바뀌었다. 결과 미리보기는 본문만 스크롤하며 닫기와 파일 받기 버튼을 유지한다. [390px 편집 전](before/prototype-editor-390.png) · [390px 편집 후](after/prototype-editor-390.png) · [미리보기 전](before/prototype-result-390.png) · [미리보기 후](after/prototype-result-390.png) · [개발 경로 재점검 기록](after/additional-measurements.json)

## 캔버스에서 이름 선택과 연결

390·1280·1440px에서 Enter로 **전체 보기**를 열고 **살펴볼 블록**에서 키보드로 블록을 선택했다. **속성 열기**로 선택한 블록의 이름을 확인했다. **연결 추가**에서 도착 블록을 골라 적용한 뒤 저장된 연결을 확인했다. 목록으로 전환해 같은 연결을 열고 **전달 항목 추가**를 찾았다. 작업을 시작하고 돌아오는 초점과 프로젝트 메뉴 Tab·Escape를 확인했다. 390px에서 세 블록을 넓게 펼친 기준 설계는 수정 전 axe의 대상 크기 지적 4곳이 나왔으며 프로덕션 후보에서는 세 너비의 전체 보기와 목록에서 axe 위반이 검출되지 않았다. 초밀집 설계에서는 연결도 자체의 작은 조작점이 남을 수 있으며, 같은 선택과 연결을 블록 선택기·목록·속성에서 수행할 수 있다. [수정 전 axe](before/accessibility.json) · [프로덕션 후보 키보드·axe](candidate/accessibility.json) · [390px 전체 보기](candidate/canvas-overview-390.png)

초급 실습 **내 자료로 안내하기**는 390×900px에서 별도로 검사했다. 전체 보기의 블록 선택기에서 여섯 블록을 열어 이름이나 자료 원문을 확인했다. 출력 포트가 있는 다섯 블록의 **연결 추가**가 해당 출발점을 지정하는지, Escape 이후 버튼에 초점이 돌아오는지 확인했다. 목록에서 기존 연결 다섯 쌍을 열어 출발점과 도착점을 대조했다. 같은 실습에서 axe의 대상 크기 지적은 수정 전 11곳, 수정 후 0곳이었다. [전체 보기 전](before/beginner-overview-390.png) · [전체 보기 후](after/beginner-overview-390.png) · [목록 조작 후](after/beginner-wire-list-390.png) · [실측 전](before/beginner-ports-390.json) · [실측 후](after/beginner-ports-390.json)

**전체 보기**의 연결선 글자는 화면에 보이는 SVG 인스턴스까지 글자색을 상속하도록 수정했다. 1440×920px에서 **규정 또는 미분류** 글자의 실제 렌더링 영역을 측정했다. 밝은·어두운 시스템 설정 모두 어두운 색 `#2e3b52`의 픽셀은 40개에서 0개로 바뀌었고, 밝은 색 `#f2f6ff`의 픽셀은 0개에서 40개로 바뀌었다. [밝은 설정 전](before/wire-label-light.png) · [밝은 설정 후](after/wire-label-light.png) · [어두운 설정 후](after/wire-label-dark.png) · [실측 전](before/wire-label-colors.json) · [실측 후](after/wire-label-colors.json)

## 코드와 재현

- 편집기 작업대와 프로젝트 메뉴. [workspace-editor.css](../../../../src/ui/editor/workspace-editor.css)
- 공유 실행 기록과 질문 영역. [RunPanel.tsx](../../../../src/ui/RunPanel.tsx) · [run-panel.css](../../../../src/ui/run-panel.css)
- 캔버스 연결선 색과 상속. [editor.css](../../../../src/ui/editor/editor.css) · [schematic.css](../../../../src/ui/editor/schematic.css) · [workspace-editor.css](../../../../src/ui/editor/workspace-editor.css)
- 편집기 공통 모달과 폼 동작. [Modal.tsx](../../../../src/ui/editor/Modal.tsx) · [editor.css](../../../../src/ui/editor/editor.css) · [Editor.tsx](../../../../src/ui/editor/Editor.tsx) · [Panels.tsx](../../../../src/ui/editor/Panels.tsx) · [FlowConditionsModal.tsx](../../../../src/ui/editor/FlowConditionsModal.tsx)
- 개발 시안의 작업대와 결과 다이얼로그. [Editor.tsx](../../../../src/app/prototype/library/Editor.tsx) · [editor.css](../../../../src/app/prototype/library/editor.css) · [preview.css](../../../../src/app/prototype/library/preview.css)
- 작은 PC 창에서 프로젝트 메뉴, 잘못된 설계 내용, 공유 Agent 실행 기록을 재현하는 회귀 시험. [editor-contracts-browser.ts](../../../../tests/editor-contracts-browser.ts)
