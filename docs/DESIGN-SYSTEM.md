# Workflow Studio 디자인 시스템

### 다이얼로그 크기와 조작

| 용도 | `StudioDialog`의 `size` | 최대 너비 |
|---|---|---|
| 삭제·이탈 확인 | `confirm` | 416px |
| 짧은 선택·안내 | `standard` | 504px |
| 생성·수정 폼 | `form` | 640px |
| 공유·복잡한 설정 | `settings` | 864px |
| 실습 상세 | `workspace` | 1120px |

기본 다이얼로그는 화면 좌우에 최소 16px 여백을 두고 높이의 88% 이내에서 본문을 스크롤한다. 지속해서 보여야 하는 확인·취소는 `footer`에 둔다. 삭제 확인의 첫 포커스는 **취소**, 새 Agent 생성의 첫 포커스는 **Agent 이름**이다. 가이드 그림은 설명에 필요한 너비에 따라 504·640·864px 상한을 사용한다. [공통 팝업](../src/ui/StudioDialog.tsx) · [편집기 팝업](../src/ui/editor/Modal.tsx) · [그림 확대](../src/ui/guide/GuideVisual.tsx)

공통 버튼의 기본 최소 높이는 40px이다. 주요 실행, 보조 선택, 가벼운 탐색, 위험 동작의 위계는 채움·윤곽선·텍스트·위험색으로 구분한다. 키보드 포커스와 누르는 순간의 테두리는 별도 상태다. 작업실의 밝은 본문과 짙은 탐색 영역에는 각각 읽을 수 있는 포커스 색을 쓴다. [작업실 스타일](../src/app/studio.css) · [탐색](../src/ui/workspace-nav.css)

그림 안의 한국어는 브라우저에서 크기를 조절하고 읽을 수 있는 텍스트로 둔다. 개념 그림에서는 회원증 질문, 이용규정 확인, 필요한 신분증을 한 장면씩 연결한다. 조작을 가르치는 그림에는 실제 제품 캡처를 사용한다. 공통 **크게 보기**는 그림의 이름과 설명을 유지하고 **1.5배 확대**와 키보드 스크롤을 제공한다. [공통 그림 보기](../src/ui/guide/GuideVisual.tsx) · [도서관 안내 흐름 FigJam](https://www.figma.com/board/UfGEEVFYyMVIeMgi7Obst1)

처음 사용하는 사람을 위한 가이드에서는 완성할 결과와 실제 시작 버튼을 먼저 보여 준다. 세 단계의 화면 그림은 제품을 촬영한 WebP에 번호와 윤곽을 겹쳐 조작 위치를 표시한다. 그림 아래의 링크로 해당 단계의 자세한 설명을 열 수 있다. 입력과 답변 예시는 연결된 이용규정에서 가져오며, 등록된 AI 모델 상태는 작업실의 실제 데이터를 따른다. [첫 실습 화면](../src/ui/guide/FirstGuideStart.tsx) · [질문 예시와 도움말](../src/ui/guide/FirstGuideQuestions.tsx)

가이드 본문 너비가 700px 이하이면 시작 소개와 결과, 세 단계의 그림을 한 열로 읽는다. 번호·윤곽의 위치는 원본 캡처 기준 백분율로 지정하고, 행동의 이름을 그림 아래 텍스트로 제공한다. 강제 색상 모드에서도 번호 테두리와 표시 영역을 식별할 수 있다. FAQ는 기본 `details`와 `summary`를 사용하며 각 질문의 조작 높이는 44px 이상이다. [첫 화면 스타일](../src/ui/guide/FirstGuideStart.module.css) · [FAQ 스타일](../src/ui/guide/FirstGuideQuestions.module.css) · [화면 비교](ui-review/guide.html)

흰 작업면과 짙은 내비게이션으로 개인 작업 공간을 구분한다. 첫 사용자는 할 일이나 실습을 선택하고, 재방문자는 최근 설계를 이어서 연다. 실습 안내는 목표·순서·완료 기준을 같은 흐름에 두고, 전체 보기는 현재 저장한 그래프의 연결 종류를 텍스트와 선으로 구분한다.

| 용도 | 토큰과 기준 |
|---|---|
| 텍스트 | `--ink #17273e`, `--muted #4e6077`. 본문은 시스템 한글 글꼴을 포함하는 산세리프와 1.55 행간을 사용한다. |
| 배경·경계 | `--workspace-bg #f6f8fb`, `--surface #fff`, `--navy #192535`. 구획은 `--border`, 조작하는 필드의 윤곽은 `--field-border`를 쓴다. |
| 동작·상태 | 주요 동작 `--accent #2449bc`, 호버 `--accent-hover #193791`, 포커스 `--focus #284bb5`, 성공 `--success`, 위험 `--danger`. 상태와 선택은 텍스트·아이콘·윤곽으로도 읽혀야 한다. |
| 반응형 | 창 너비가 720px 이하이면 상단 **메뉴**에서 이동한다. 721~1050px에서는 속성을 캔버스 아래에, 더 좁은 창에서는 팔레트·캔버스·속성을 세로로 배치한다. 넓은 도표와 캔버스는 해당 영역에서 스크롤한다. |
| 대화상자·알림 | 대화상자는 네이티브 dialog, 읽을 수 있는 제목, Escape 및 복귀 포커스를 사용한다. 실행 중·성공은 status, 작업을 막는 오류는 alert로 전달한다. |
| 전환·테마 | 로그인 머리글과 작업실 메뉴의 해·달 스위치는 왼쪽 해를 라이트, 오른쪽 달을 다크로 표시한다. 손잡이 위치로 현재 선택을 알 수 있다. 본문·컨트롤·캔버스와 공유 실행 화면에 같은 테마를 적용한다. 저장한 값이 없으면 첫 방문의 Windows 설정을 저장한다. 이전에 직접 선택한 라이트·다크는 유지되며, 이후 Windows 설정이 바뀌어도 스위치로 고른 값이 유지된다. |

구현 기준은 [공통 토큰](../src/app/studio.css), [탐색 스타일](../src/ui/workspace-nav.css), [실습 상세](../src/ui/guide/LessonHandout.module.css), [편집기](../src/ui/editor/workspace-editor.css)에 있다.

공유 주소는 **현재 공유 주소** 입력란에서 직접 선택할 수 있다. 클립보드 권한 안내는 주소 옆에 표시하고 철회와 닫기는 계속 사용할 수 있게 한다. 사용자가 먼저 다른 컨트롤로 이동했으면 늦게 도착한 복사 안내가 포커스를 가져가지 않는다. 게시 철회 후에는 기존 주소와 안내를 함께 지운다. [Agent 공유 패널](../src/ui/ProjectVersionPanel.tsx)

자료함의 최신판 주소·고정판 주소·MCP 식별자는 마지막으로 요청한 값에 대해서만 복사 결과를 알린다. 이벤트 토큰은 가려서 보여 주고, 자동 복사가 막혔을 때 사용자가 **토큰 표시**를 눌러 직접 복사한 뒤 다시 숨길 수 있다. 가이드의 예문은 이미 선택한 다른 문장과 포커스를 보존한다. [자료함](../src/ui/ResourceLibrary.tsx) · [공통 복사 처리](../src/ui/use-copy-field.ts) · [이벤트 토큰](../src/ui/TriggerPane.tsx) · [실습 예문](../src/ui/guide/GuideWalkthrough.tsx)

작업 도중 화면을 이동하면 완료 응답은 사용자가 마지막으로 선택한 화면을 존중한다. 통신이 중단되면 서버 응답 여부를 단정하지 않고 연결과 서버 상태를 확인할 수 있는 한국어 안내를 제공한다. 기존 작업별 복구 안내와 동일 요청 재시도 방식을 사용한다. [작업실](../src/ui/Studio.tsx) · [공통 요청 처리](../src/ui/client.ts)

긴 프로젝트 이름은 홈과 실행창에서 같은 두 줄 제목과 **전체 이름 보기**를 사용한다. 자료 원문은 긴 경우 영역 안에서 끝까지 읽고 다음 관리 동작으로 이동한다. 캔버스의 축소 배율과 관계없이 블록·경로 선택과 속성 열기에는 같은 화면의 일반 크기 조작을 제공한다. [공통 제목](../src/ui/ProjectNameHeading.tsx) · [자료 원문](../src/ui/ResourceLibrary.tsx)

블록 속성의 **고급 설정 → 위치 조정**에서 X·Y 좌표를 적용하거나 방향 버튼으로 8px씩 이동한다. **연결 → 연결 가능한 항목 보기**를 펼치면 해당 블록이 받을 수 있는 항목과 보낼 수 있는 항목을 확인할 수 있다. 필수 입력이 빠진 블록에서는 누락 안내의 **입력값 받기**를 눌러 바로 연결할 수 있다. [블록 속성](../src/ui/editor/Panels.tsx)

실습 상세는 최대 1,120px 너비와 화면 높이의 92% 안에서 본문을 스크롤한다. [실습 안내](../src/ui/guide/LessonHandout.module.css)

grill-me가 연결하는 grilling으로 확정한 A·B·C 결정을 사용했다. frontend-design과 design-taste-frontend는 작업 흐름과 시각적 위계를, design-shotgun은 세 시안 중 채택한 요소를, design-html과 web-artifacts-builder는 상세 시안과 브라우저 비교를 담당했다. ui-styling과 shadcn의 컴포넌트 기준은 기존 CSS·네이티브 컨트롤에 적용했다. frontend-ui-engineering과 ui-ux-pro-max로 반응형·접근성·상태·렌더링 비용을 검토했다. [승인된 Figma 보드](https://www.figma.com/design/6PNrJIchcMCPSYioUaXun7?node-id=10-11)

상세 시안과 실제 캡처에서 A안의 고정 탐색·홈 목록, B안의 목표와 파일명을 담은 표지·단계 안내·하단 시작 동작, C안의 실제 노드·종류별 연결을 대조했다. 홈의 첫 방문과 재방문 내용은 계정에 저장된 상태를 따른다. 라이브 Figma 프레임에는 Starter 호출 한도가 적용되어 별도로 보관한 승인 시안과 제품 캡처를 사용했다. [로컬 상세 시안](../.local/ui-audit-71910d09/detail/plan.html)

11월 27일 Figma MCP가 기존 파일의 세션을 만들었고, 프레임 재조회에는 Starter 호출 한도 응답을 반환했다. 이전에 Figma로 가져온 로그인·홈·편집기와 보관한 상세 시안을 기준으로 최종 Chrome 화면을 대조했다. 지정 스킬의 지침 파일은 모두 사용 가능했다. design-html·design-shotgun의 gstack 전용 실행기는 이 환경에 없어 Figma·HTML과 실제 브라우저 캡처로 확인했다. [디자인 검토 당시의 도구별 기록](../.local/ui-audit-71910d09/디자인-현황.md) · [제품 화면 비교](ui-review/index.html)

가이드 시각 자료에는 Figma MCP로 별도 FigJam 흐름도를 만들었다. 질문을 받은 안내원이 연결된 이용규정을 읽고, 사용자가 필요한 신분증을 답변과 원문에서 대조하는 과정을 담았다. 같은 보드에 생성 과정을 추가하는 호출에는 Starter 한도가 적용됐다. 생성 과정은 실제 작업실을 조작한 한국어 주석 캡처로 구현했다. [편집 가능한 FigJam](https://www.figma.com/board/UfGEEVFYyMVIeMgi7Obst1) · [ImageGen으로 제작한 개념 삽화](../public/guide/visuals/request-to-answer.webp)
