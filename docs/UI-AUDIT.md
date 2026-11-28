# 작업실 UI 점검

## 2026-11-28 · 실제 작업 트리에서 다시 확인한 화면

작업을 시작할 때의 소스와 공개 가이드 파일을 복사해 변경 전 서버를 만들었다. 변경 전후 비교용 프로덕션 서버마다 빈 SQLite를 준비하고 같은 이름의 계정, 도서관 문서, 초급 Agent, 동료의 공개판, ‘5권’이라고 답하는 설계를 등록했다. Windows Chrome에서 비로그인 진입부터 질문 실행 결과까지 20개 상태를 같은 크기로 촬영했다. 화면과 너비를 선택하면 원본 해상도의 그림 두 장을 비교할 수 있다. [전후 화면 비교](ui-review/20261128/index.html)

| 발견한 문제 | 변경과 확인 근거 |
|---|---|
| 390px에서 작업실 본문이 200px로 줄었다. 자료 행의 삭제와 생성 버튼, 편집기 도구를 찾으려면 가로로 이동해야 했다. | 작은 창에서는 상단 **메뉴**로 탐색한다. Agent·자료 행이 제목과 동작을 나눠 표시하며, 같은 창에서 편집 작업 영역의 표시 폭과 스크롤 폭이 모두 390px였다. [작업실과 권한별 화면](ui-review/20261128/workspace/README.md) · [편집기](ui-review/20261128/editor/README.md) |
| 중복 아이디 안내가 아이디 입력란 아래 173px에 나타났고, 비밀번호만 고쳐도 사라졌다. | 390px에서 안내가 입력란 아래 34px에 나타난다. 아이디로 포커스가 돌아오고, 비밀번호를 고쳐도 안내가 유지된다. 형식이 잘못된 아이디도 같은 위치에서 수정할 수 있다. [이전 폼](ui-review/20261128/account/before/390-duplicate.webp) · [수정한 폼](ui-review/20261128/account/after/390-duplicate.webp) |
| 하단 오류 알림 닫기의 클릭 영역은 21×21px였다. | 기존 아이콘의 클릭 영역을 40×40px로 넓혔다. 밝게·어둡게·강제 색상에서 키보드로 닫았고, 로그인의 포커스·누름·대기·비활성도 확인했다. [알림 전](ui-review/20261128/controls/before/light-notice.webp) · [알림 후](ui-review/20261128/controls/after/light-notice.webp) · [조작 실측](ui-review/20261128/checks/states-after.json) |
| 좁은 실습 창의 소개가 293px를 차지했고, 조사 정책을 끝까지 읽으면 사본 생성 버튼이 화면 밖으로 이동했다. | 같은 창에서 소개가 176px로 줄었다. 사본 생성 버튼을 본문 밖 하단에 두고, 13개 실습을 직접 열었다. 가이드 이미지 확대창은 콘텐츠에 맞춰 크기를 달리한다. [실습 상세와 그림 비교](ui-review/20261128/guide/README.md) |
| 어두운 배경의 연결선 설명이 흐렸고, 다크 모드 첫 검사에서 편집기 제목의 대비가 1.05:1이었다. | 실제 SVG 인스턴스의 연결선 글자색을 확인했다. 제목·입력·선택·연결선에 테마 색을 적용하고 축소 지도와 눈금을 조정했다. [연결도 픽셀 검증](ui-review/20261128/editor/README.md) · [다크 모드 편집기](ui-review/20261128/dark/after/1440-editor.webp) |
| 390×540px에서 Skill 교체 파일 목록에 스크롤이 중첩됐다. ZIP 교체와 최신판 비교를 닫으면 호출 버튼을 다시 찾아야 했다. | 파일 목록을 대화상자 본문 안에서 함께 스크롤하도록 바꿨다. 본문을 521px 내리는 동안 하단 버튼이 고정됐고 두 확인창에서 각각 Escape로 돌아왔다. [짧은 창 전후 비교](ui-review/20261128/workspace/README.md) |
| 390×844px에서 시험 실행을 열었을 때 질문 실행 버튼의 하단은 원래 829px였다. 좁은 창의 편집기 배치를 바꾼 중간 빌드에서 963px까지 밀렸다. | 결과 탭에 포커스를 주고 고정 상단 바 아래로 스크롤한다. 같은 창에서 버튼 하단은 799px였다. 닫기는 바로 아래 캔버스의 연결선과 겹쳐 클릭 가능 폭이 23.5px로 줄어들던 문제를 고쳐 네 모서리를 포함한 44×44px를 확보했다. [시작 시점](ui-review/20261128/run-entry/starting/390-entry.webp) · [중간 빌드](ui-review/20261128/run-entry/before/390-entry.webp) · [최종 빌드](ui-review/20261128/run-entry/after/390-entry.webp) · [클릭 영역 측정](ui-review/20261128/editor/after/run-close-390.json) |

요청한 열 개 스킬의 지침을 읽었다. `grill-me`가 연결하는 `grilling`의 요구사항 점검은 기존 승인 시안과 이번 완료 조건으로 해결했다. `design-shotgun`의 작업대·실습·연결도 시안, `design-html`과 `web-artifacts-builder`의 화면 비교 방식을 적용했다. `frontend-design`, `design-taste-frontend`, `ui-styling`, `ui-ux-pro-max`는 실제 조작의 우선순위와 테마 대비를 정하는 데 사용했다. `shadcn`과 `frontend-ui-engineering`의 폼·모달·포커스 기준은 기존 React 컴포넌트로 구현했다.

Figma MCP에서 기존 승인 파일에 세션을 열었다. 버튼·다이얼로그·입력 자산 검색은 빈 결과였고, 프레임 이미지 요청은 Starter 호출 한도에 도달했다. 이번 프레임 비교의 근거는 격리한 Chrome 화면이다. [승인 파일](https://www.figma.com/design/6PNrJIchcMCPSYioUaXun7?node-id=10-11) · [컴포넌트별 검토 범위](ui-review/20261128/components.md) · [검증 결과](QA-REPORT.md)

## 2026-11-27 · 버튼, 입력, 다이얼로그와 연결도 재점검

격리 프로덕션 빌드 `JgaxZ_6K2R6MwLj_4K6vW`의 Chrome에서 1024·1280·1440px로 새 Agent, 한 문장 설계, 삭제 확인, 공유 설정을 열었다.

| 화면과 문제 | 적용한 변경과 검토 방법 |
|---|---|
| 새 Agent와 삭제 확인창의 데스크톱 너비가 모두 485px였다. 두 창의 입력량과 결정에 필요한 정보가 달랐다. | 생성 폼은 640px, 삭제 확인은 416px, 버전·공유 설정은 864px 상한을 쓴다. 긴 본문만 스크롤되며 삭제 대상·취소·삭제 동작을 분리했다. |
| 새 Agent·삭제·한 문장 설계에서 Tab으로 순환할 때 브라우저 UI로 포커스가 빠졌다. 일반 팝업의 배경 문서는 스크롤이 허용됐다. | 활성 다이얼로그 안에서 정방향 및 역방향 Tab을 순환한다. Escape로 닫은 뒤 원래 버튼에 포커스가 돌아오는지 검사한다. 모달이 열려 있는 동안 배경 스크롤을 잠근다. |
| 잘못된 설계 파일을 고르면 JSON 파서의 오류가 그대로 표시됐다. 새 파일을 선택해도 앞선 오류가 보였다. | 한국어로 다시 선택할 파일을 설명하고 파일을 교체할 때 오류를 지운다. 실제 생성 요청의 응답을 잠시 보류해 대기 안내·중복 방지·저장 완료를 점검한다. |
| 좁은 프로젝트 목록에서는 최근 수정일이 숨겨졌다. 검색 상자의 테두리 안에 입력을 받지 않는 여백이 있었다. | 공개 범위 옆에 수정일을 표시하고, 행을 여는 동작과 공유·삭제 동작을 구획으로 나눴다. 돋보기를 포함한 검색 상자 내부가 입력 포커스를 받는다. |
| 1024px에서 실습 전체 보기의 조작 대상 다섯 곳이 접근성 검사에 지적됐다. | 캔버스의 실제 배율과 블록 간격, 분기 수를 확인했다. |

### 디자인 지침과 도구

지정한 디자인 스킬 9종과 `grill-me`가 가리키는 `grilling` 지침을 확인했다. 승인된 A안의 화면 위계, B안의 실습 단계, C안의 연결도를 유지하면서 다음 기준을 적용했다.

| 지침 | 이번 검토에서 맡은 역할 |
|---|---|
| frontend-design · design-taste-frontend | 편집·설정·학습 작업의 목적에 따라 버튼 우선순위, 정보 밀도, 여백을 결정했다. |
| ui-styling · ui-ux-pro-max | 버튼 상태, 키보드 조작, 선택 영역과 포커스 가림을 검사했다. |
| shadcn · frontend-ui-engineering | 다이얼로그의 제목·본문·액션 구조와 역할별 크기를 기존 React·CSS·네이티브 dialog로 구현했다. 저장소에는 shadcn 설정이 없다. |
| web-artifacts-builder · design-html · design-shotgun | 승인된 세 콘셉트의 용도를 유지하고 같은 작업 상태의 시각 비교본을 HTML로 구성했다. gstack 전용 생성 명령의 실행 결과는 없다. |
| grill-me · grilling | 승인된 범위·일반 사용자의 첫 실습·직접 연결이라는 기준을 적용하고 코드와 실제 화면에서 결정에 필요한 사실을 확인했다. |

공식 Figma MCP에서 기존 디자인 파일의 세션을 생성했다. 승인 프레임을 읽는 요청은 Starter 호출 한도에 걸렸다. 이번 검증의 원본은 실제 Chrome 캡처이며 새 Figma 컴포넌트나 프레임은 작성하지 못했다. [기존 승인 시안](https://www.figma.com/design/6PNrJIchcMCPSYioUaXun7?node-id=10-11)

### 컴포넌트를 확인한 화면

| 컴포넌트 | 실제 화면과 조작 |
|---|---|
| 주요·보조·위험·아이콘 버튼 | 생성 폼의 빈 캔버스, 시험 실행, 실습 사본 생성, 자료·프로젝트 삭제, 닫기, 전체 보기. 생성 요청을 보류해 비활성 상태와 중복 생성도 확인한다. |
| 입력·텍스트 영역·선택·라디오·체크박스 | 계정 정보, 이름 검색, 설계 파일, 자료 원문, 공유 범위, 계정에 가져올 작업, 실습 종류와 휴지통 선택. 편집기에서는 블록 속성 폼과 실행 시의 추가 회신을 사용한다. |
| 탐색·메뉴·탭·접기 | 작업실 메뉴, 편집기 프로젝트 메뉴·팔레트·속성 탭, 실행 기록, 자료 버전과 가이드 FAQ를 연다. |
| 카드·행·필터·표·상태 라벨 | 내 Agent·공유 Agent 목록, 자료 유형 선택과 공개 범위, 수준별 실습, 가이드의 회의록 예시 표와 작업 결과 표. 내용이 없는 계정과 검색 결과가 없는 두 상태를 확인한다. |
| 단계 안내·도해·상태 알림 | 실습 상세의 단계, 가이드 이미지 확대·원본·2배 보기, 편집기 저장 상태, 실행 오류·응답 대기·결과와 파일 내려받기를 확인한다. |
| 그래프·작업 공간 | 저장된 블록 위치와 연결선을 사용하는 편집기·다시 시작하는 홈·실습 가이드. 확대·축소와 전체 보기의 원점, 실제 화면의 연결점과 본체를 각각 확인한다. |

제품 JSX에서 검색한 범위에는 별도 슬라이더 입력, ARIA switch, 전용 tooltip 위젯 또는 skeleton 컴포넌트가 없었다. 도움말에는 제목 속성, 작업 중에는 상태 문구, 그래프 탐색에는 확대 버튼·선택기를 사용한다. 작업실은 밝은 본문과 짙은 탐색 영역을 함께 사용한다. [홈·가이드 검증](ui-review/precision-guide.md) · [등록된 회귀 목록](../scripts/test-browser.mjs)

## 2026-11-27 재점검

시작할 때 제품·스크립트·정적 파일·설정 228개의 해시가 직전 검증 빌드와 일치했다. 이 빌드에서 다음 세 동작을 직접 재현했다.

| 상황 | 이전 동작 | 변경 파일 |
|---|---|---|
| 게시한 Agent의 주소 복사 | 클립보드를 사용할 수 없는 환경에서는 영문 오류만 나타났고 주소를 직접 선택할 수 없었다. | [공유 패널](../src/ui/ProjectVersionPanel.tsx) · [공유 회귀 시험](../tests/creation-sharing-browser.ts) |
| 사본을 요청하고 브라우저 뒤로 가기 | 성공 응답은 사용자를 사본 편집기로 다시 이동시켰다. 실패 응답은 사용자가 돌아간 목록에 이전 작업의 오류를 표시했다. | [작업실](../src/ui/Studio.tsx) · [브라우저 시험](../tests/browser-smoke.ts) |
| 로그인 중 네트워크 연결 끊김 | 1440px에서 브라우저의 영문 오류 `Failed to fetch`가 그대로 노출됐다. | [공통 요청 처리](../src/ui/client.ts) · [인증 화면 회귀 시험](../tests/browser-smoke.ts) |

권한 창이 열려 있는 동안 사용자가 계속 작업할 수 있는 다른 복사 버튼도 조사했다. 자료함의 최신판·고정판 주소와 MCP 도구 식별자, 자동 시작의 이벤트 토큰, 가이드 예제 문장이 대상이다. 계정 소개·홈·실습·편집기·자료·실행까지의 전체 화면 점검 범위는 아래 표에 있다. [자료함](../src/ui/ResourceLibrary.tsx) · [공유 입력란 복사](../src/ui/use-copy-field.ts) · [자동 시작](../src/ui/TriggerPane.tsx) · [단계별 가이드](../src/ui/guide/GuideWalkthrough.tsx)

### 첫 실습의 사용자 흐름

세 단계 캡처만으로는 일반 채팅과 작업실의 차이, 새 Agent를 만들 때 입력할 값, 설계·시험·자료·공유가 각각 필요한 시점을 충분히 설명하지 못했다. 개념과 버튼을 따로 설명하는 대신 도서관 예제 하나로 질문·작업 지시·원문·답변을 대조할 수 있도록 구성했다. 목적별 장에는 실제 네 템플릿의 입력과 결과를, FAQ에는 막힌 화면과 다음 조작을 배치했다. [개념·기능·업무 사례](../src/ui/guide/GuideVisualConcepts.tsx) · [상태별 도움 그림](../src/ui/guide/GuideHelpVisual.tsx)

첫 방문자가 회원증 준비물을 묻는 예제를 열어 답의 근거까지 확인하는 흐름을 점검했다. 기존 가이드의 개별 단계에는 버튼 설명과 캡처가 있었다. 첫 화면에서는 예제를 시작하기 전에 어떤 결과를 얻을지, 세 번의 조작 중 어디에 해당하는지 한눈에 대조하기 어려웠다.

| 사용자가 알고 싶은 것 | 구현한 화면과 동작 |
|---|---|
| 무엇을 만들고 어디서 시작하는가 | 도서관 규정을 읽는 안내원을 소개하고 **예제로 시작하기**와 회원증 질문·예시 답변·사용한 규정을 함께 보여 준다. 기존 사본이 있으면 **예제 편집기 열기**로 이어간다. |
| 무엇을 누르면 결과가 나오는가 | 실제 **시험 실행**, **질문 실행**, **완료** 상태를 담은 캡처를 순서대로 보여 준다. 그림의 링크는 가이드의 해당 단계로 이동한다. 작업 버튼은 예제 편집기를 연다. |
| 답이 맞는지, 막혔을 때 어떻게 확인하는가 | 넓은 방문 질문과 회원증 발급 질문을 비교한다. 준비물인 신분증을 이용규정에서 확인하는 법, 질문 입력 위치, 작업 지시를 바꾼 뒤 새 대화로 시험하는 법을 도움말로 연결한다. |
| 모델을 쓸 수 없으면 무엇을 할 수 있는가 | 실제 연결 상태를 읽어 예제를 열어볼 수 있는 일과 답변을 받기 위해 운영자에게 모델 연결을 요청할 일을 안내한다. |

첫 화면 이후에는 회의 메모로 회의록을 만들거나 자료 한 줄을 고쳐 안내가 어떻게 바뀌는지 보는 예제로 이동할 수 있다. [가이드 전후 비교](ui-review/guide.html) · [첫 화면·세 단계](../src/ui/guide/FirstGuideStart.tsx) · [질문 비교·FAQ](../src/ui/guide/FirstGuideQuestions.tsx) · [가이드와 실습 연결](../src/ui/guide/GuidePage.tsx)

### 클립보드 응답 전후의 화면 상태

| 재현한 상황 | 기대하는 결과와 관련 시험 |
|---|---|
| 최신 게시판 주소 복사 후 고정판 주소로 포커스 이동 | 늦은 권한 거부 후에도 선택한 고정판 입력란에 머문다. 판 변경·링크 재발급·MCP 도구 변경 후에는 이전 요청이 현재 안내를 바꾸지 않는다. [자료함 회귀 시험](../tests/resource-library-browser.ts) |
| 이벤트 토큰 복사 후 자동 시작을 해제하고 같은 등록을 다시 활성화 | 새 토큰에 이전 복사 성공이 표시되지 않는다. 자동 복사를 사용할 수 없을 때 **토큰 표시**로 직접 선택한다. [자동 시작 회귀 시험](../tests/trigger-browser.ts) |
| 작업 지시 복사를 요청한 뒤 시험 질문을 직접 선택 | 늦은 권한 거부가 현재 선택을 작업 지시 문장으로 바꾸지 않는다. [가이드 회귀 시험](../tests/workflow-guide-browser.ts) |

상세 캡처와 별도로 주요 화면의 원본 전후 캡처를 저장소에서 바로 열 수 있도록 보관했다. [오프라인 화면 비교](ui-review/index.html) · [화면별 검증](QA-REPORT.md)

## 2026-11-26 전체 화면 점검

2026-11-26의 작업 트리와 이전 개편의 제품 캡처를 기준으로 다시 점검했다. 사용자와 확정한 공통 작업대(A), 실습 상세의 단계 안내(B), 편집기의 연결도(C)를 유지한다. [개선 계획](IMPROVEMENT-PLAN.md) · [작업 이력](IMPROVEMENT-LOG.md) · [검증 결과](QA-REPORT.md)

| 진입점 | 점검 범위 |
|---|---|
| `/login` | 로그인·가입 전환, 게스트 작업 선택, 제출·오류·원래 주소로 복귀 |
| `/` 및 `?view=` | 홈, 편집기 선택, 내 Agent, 수준별 템플릿, 내 자료, 공유 Agent·자료, 가이드, 프로젝트·자료 휴지통 |
| 실습·가이드 | 13개 실습 상세, 사본 생성, 단계별 도움말, 목적별·용어·메뉴·블록 찾아보기 |
| `?edit=` | 저장한 그래프·블록·속성·원문, 캔버스·목록·전체 보기, 버전, 게시, 자동 시작, 시험 실행 |
| `?agent=` 및 `?asset=` | 실제 사용 권한에 따른 공유, 사본, 자료판과 내려받기, 링크·철회 |
| `/prototype/library` | 인증된 개발 시안의 홈·편집·미리보기와 프로덕션에서의 404 |
| 알 수 없는 주소 | 한국어 오류 설명, 유효한 화면으로 복귀, 404 응답 |
| API 라우트 | 화면 데이터를 공급하는 `/api/studio`와 자동 시작 `/api/events/[id]`는 기존 계약·HTTP 회귀 시험으로 확인 |

첫 조사에서 화면 전환에 따라 바뀌지 않는 탭 제목, 복귀 링크가 없는 영문 404, 홈이 동기적으로 가져오는 편집기 코드, 이전 홈의 미사용 전역 스타일을 발견했다. 세부 화면의 관찰 결과와 수정 근거는 [작업 이력](IMPROVEMENT-LOG.md)에 기록한다.

## 공통 컴포넌트 점검 범위

| 화면 묶음 | 확인한 구성과 상태 |
|---|---|
| 공통·계정 | 루트 레이아웃, Studio, StudioMark, WorkspaceNav와 메뉴, AccountEntry, StudioDialog, ProjectNameHeading. 문서 언어·제목, 로딩·오류·빈 목록, 이름 펼치기와 포커스 복귀 |
| 프로젝트 | ProjectActionPicker, ProjectTrash, TrashList, ProjectVersionPanel, ReleaseDecisionForm, HomeDesignProposal. 선택, 생성과 가져오기, 공유·철회·판단·복원, 오류 재시도, 비공개 초안 |
| 홈·실습 | WorkspaceHome, HomeLayout, SavedCanvas, LibraryArtwork, LessonHandout, DynamicLessonSetup, OptionalPractice. 첫 방문·재방문, 저장한 블록, 긴 이름과 빈 그래프, 복제·설정 |
| 가이드 | WorkflowGuide, GuidePage, GuideWalkthrough, GuideFigure, TemplateGallery, VisualGlossary, MenuReference. 탐색·검색, 읽던 단계 복원, 용어·캡처 확대 |
| 편집 작업대 | Editor, Canvas와 포트·방향·단축키, Icons, Modal, InspectorTabs, Panels, ConnectionInspector, PracticeCoach와 단계, FlowConditionsModal, CategoryEditor, ReplyFieldsEditor. 실제 그래프와 블록 종류별 속성, 드래그·키보드·선택과 취소 |
| 편집기 상세 | AgentContextFields, AgentExportDialog, AgentScopeDialog, AssetPicker, InlineSourceEditor, McpToolPicker, SharedAssetDialog, SourceOutputChoice, WorkflowRefPicker, TriggerPane. 권한·버전, 연결 조회, 원문 비교·오류·재시도, 저장·내보내기 |
| 실행·자료·시안 | RunPanel, RunFileReply, FormattedAnswer, ResourceLibrary 및 개발 시안의 Preview, Home, Editor, LibraryGraph. 실제 결과·첨부, 기록, 취소·복구, 대용량 원문과 포커스, 좁은 폭의 시안 이동 |

점검 범위에는 실제 페이지와 그 안에서 열리는 화면 상태가 함께 들어간다. 공개 링크는 소유자와 수신자 계정에서 각각 확인한다. 개발 전용 도서관 시안의 상호작용은 개발 서버, 외부 노출 여부는 프로덕션 빌드가 기준이다.

## 이번 후속 수정 파일

A·B·C 개편을 마친 시점의 작업 트리를 기준으로, 아래에는 이번 반복 검토에서 직접 수정한 부분을 기록했다. 같은 파일에 이미 있던 편집과 앞 단계에서 갱신한 가이드 PNG는 이전 작업에 속한다.

| 화면·작업 | 후속 변경 | 파일 |
|---|---|---|
| 첫 사용자용 그림 | 개념·기능·네 사례, Agent 생성 다섯 화면, 시험 세 단계와 FAQ 비교를 가이드의 해당 장에 연결했다. 그림을 크게 열고 닫은 후 읽던 위치로 돌아온다. | [장 구성](../src/ui/guide/GuidePage.tsx), [첫 단계](../src/ui/guide/FirstGuideStart.tsx), [생성](../src/ui/guide/GuideCreationVisual.tsx), [개념·기능·사례](../src/ui/guide/GuideVisualConcepts.tsx), [FAQ](../src/ui/guide/FirstGuideQuestions.tsx)·[비교 그림](../src/ui/guide/GuideHelpVisual.tsx), [공통 확대](../src/ui/guide/GuideVisual.tsx), [그림 회귀 시험](../tests/guide-visuals-browser.ts)·[전체 실행기에 등록](../scripts/test-browser.mjs) |
| 계정·작업실·404 | 화면과 탭 제목을 맞추고, 없는 주소에 한국어 복귀 링크를 추가했다. 편집기·실행 패널은 진입할 때 로드한다. | [루트 페이지](../src/app/page.tsx), [404](../src/app/not-found.tsx), [공통 스타일](../src/app/studio.css), [계정](../src/ui/AccountEntry.tsx), [작업실](../src/ui/Studio.tsx) |
| 프로젝트 공유·판단 | 미게시 소유자 초안의 시험·사본, 실패한 공유·시험 기록 조회 재시도, 공유 범위 변경 후 판단 선택과 입력 근거를 처리한다. | [작업실](../src/ui/Studio.tsx), [버전·공유 패널](../src/ui/ProjectVersionPanel.tsx), [게시 판단](../src/ui/ReleaseDecisionForm.tsx) |
| 홈·가이드 | 같은 그래프의 연결 계산을 재사용한다. 검색 초기화, 실습 선택기의 포커스, 강제 색상 선택 표시, 캡처 확대 시 읽던 지점과 사용 가능한 높이를 고쳤다. | [저장한 배치](../src/ui/home/SavedCanvas.tsx), [블록·자료 검색](../src/ui/WorkflowGuide.tsx)·[스타일](../src/ui/WorkflowGuide.module.css), [메뉴 설명](../src/ui/guide/MenuReference.tsx), [목적별 실습](../src/ui/guide/TemplateGallery.tsx)·[스타일](../src/ui/guide/TemplateGallery.module.css), [캡처 뷰어](../src/ui/guide/GuideFigure.tsx)·[레이아웃](../src/ui/guide/GuidePage.module.css) |
| 편집기·자동 시작 | 블록 위치 입력, 전체 보기의 큰 조작 버튼, 동적 필드 삭제 후 포커스, JSON 편집과 연결 조회 재시도를 개선했다. 내보내기에서는 준비 내역의 스크롤 영역에 이름과 키보드 포커스를 부여했다. | [캔버스](../src/ui/editor/Canvas.tsx)·[스타일](../src/ui/editor/workspace-editor.css), [속성](../src/ui/editor/Panels.tsx), [회신 필드](../src/ui/editor/ReplyFieldsEditor.tsx), [자료](../src/ui/editor/AssetPicker.tsx)·[MCP](../src/ui/editor/McpToolPicker.tsx)·[Workflow 판](../src/ui/editor/WorkflowRefPicker.tsx) 선택기, [내보내기](../src/ui/editor/AgentExportDialog.tsx), [자동 시작](../src/ui/TriggerPane.tsx)·[사용 안내](triggers.md) |
| 자료·휴지통·실행 | 긴 원문을 키보드로 읽고 등록·수정을 마친 뒤 해당 위치로 복귀한다. 실행과 홈에서 같은 제목 펼침을 사용한다. | [자료함](../src/ui/ResourceLibrary.tsx)·[스타일](../src/ui/ResourceLibrary.css), [휴지통](../src/ui/TrashList.tsx), [실행](../src/ui/RunPanel.tsx)·[스타일](../src/ui/run-panel.css), [공용 제목](../src/ui/ProjectNameHeading.tsx)·[스타일](../src/ui/project-name-heading.css), [홈 레이아웃](../src/ui/home/HomeLayout.tsx)·[스타일](../src/ui/home/workspace-home.css) |
| 개발용 도서관 시안 | 페이지 제목, 키보드 포커스, 도면 위 텍스트 대비를 수정했다. | [시안 페이지](../src/app/prototype/library/page.tsx), [편집](../src/app/prototype/library/Editor.tsx)·[편집 스타일](../src/app/prototype/library/editor.css), [시안 레이아웃](../src/app/prototype/library/preview.css) |
| 회귀 시험 | 소유자 초안과 게시판, 게시 판단과 제출, 편집기 입력과 위치, 자료·자동 시작 조회 실패, 가이드 선택·확대 동작을 기존 시험에 추가했다. | [생성·공유](../tests/creation-sharing-browser.ts), [통합 동작](../tests/browser-smoke.ts), [편집기](../tests/editor-contracts-browser.ts), [자료함](../tests/resource-library-browser.ts), [자동 시작](../tests/trigger-browser.ts), [가이드](../tests/workflow-guide-browser.ts) |
| 기록·캡처 | 이 UI 점검 문서와 함께 계획·이력·디자인 규칙·QA 결과를 관리한다. | [개선 계획](IMPROVEMENT-PLAN.md), [작업 이력](IMPROVEMENT-LOG.md), [디자인 시스템](DESIGN-SYSTEM.md), [QA 보고서](QA-REPORT.md) |

같은 너비·상태에서 확인한 절차와 원본 캡처는 로컬 검토 기록에 있다. [홈·가이드](../.local/ui-continuous/home/review-notes.md) · [자료·실행·시안](../.local/ui-continuous/library/review.md) · [편집기](../.local/ui-continuous/editor/REVIEW.md)
