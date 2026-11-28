# Workflow Studio 컴포넌트와 조작 목록

2026-11-28에 `src/app`과 `src/ui`의 TSX 70개를 TypeScript 구문 트리로 확인했다. 일반 버튼 태그 297개, 입력 60개, 텍스트 영역 11개, 선택 필드 36개, 폼 12개, 접기 37개, 표 2개를 찾았다. 다이얼로그 구현에는 네이티브 `dialog` 6개가 있으며 공통 다이얼로그 호출과 반복 렌더링이 있어 소스 개수와 실행 화면의 개수는 다르다. 조건부 속성과 동적 화면은 렌더링 흐름과 관련 회귀 시험을 함께 읽었다.

**직접**은 이번 검토의 브라우저 측정·캡처에 연결돼 있다. **회귀**는 브라우저 시험 코드에 조작이 명시돼 있다. **정적**은 해당 조작의 구현을 찾았고 이번 화면 증거에 검증 결과가 없다. [전체 검증 결과](../../QA-REPORT.md)

## 화면과 권한

| 진입 화면 | 실제 조작과 권한 | 근거 |
| --- | --- | --- |
| `/login` | 로그인·계정 생성 전환, 비밀번호 표시, 기존 체험 작업 가져오기 또는 유지, 중복 아이디·네트워크 오류, 공유 주소로 복귀 | 로그인·가입·오류 **직접**. 기존 체험 작업·주소 복귀·다중 탭 로그아웃 **회귀**. [계정 상태 캡처](account/before/) · [인증 시험](../../../tests/browser-smoke.ts) |
| `/`, `?view=editor` | 처음 시작·이전 편집 계속·실습 선택, 편집기 진입, 한 문장으로 시작, JSON과 이전 브라우저 시안 가져오기 | 생성·이전 시안 오류·탐색 **직접**. AI 초안·명확화 질문·재시도·가져오기 **회귀**. [작업실](workspace/README.md) · [생성 시험](../../../tests/creation-sharing-browser.ts) |
| `?view=projects`, `?view=shared`, `?agent=` | 이름 검색·빈 검색, 소유자용 버전·게시·삭제, 수신자용 공개판 실행·사본, 비밀 링크 철회와 재발급, Agent 휴지통·복구·영구 삭제 | 소유자 및 수신자 화면 **직접**. 게시판 고정, 철회·복구·다중 사용자 **회귀**. [작업실](workspace/README.md) · [공유 시험](../../../tests/creation-sharing-browser.ts) · [휴지통 시험](../../../tests/browser-smoke.ts) |
| `?view=assets`, `?view=shared-assets`, `?asset=` | 자료 범위·유형·이름, 원문·Skill·지식 저장소, 자료별 판·공유 주소·사본·연결·휴지통, 운영자만 활성화되는 MCP 등록 | 일반·수신자·운영자 상태, 탭, 삭제·미저장 확인 **직접**. 링크·자료 버전·충돌·복구·복사·연결 **회귀**. [작업실](workspace/README.md) · [자료함 시험](../../../tests/resource-library-browser.ts) · [자료 편집 시험](../../../tests/resource-editing-browser.ts) · [수신 자료 시험](../../../tests/shared-resource-gallery-browser.ts) |
| `?edit=` | 프로젝트 메뉴, 팔레트·캔버스·목록, 속성·연결·실행 결과, 원문, Agent ZIP, 게시와 복구, 시험 사례·자동 시작 | 그래프와 목록, 원문, 메뉴·팝업, 시험 실행 **직접**. 키보드, 다중 연결, 저장, 복제, 내보내기, 자동 시작 **회귀**. [편집기](editor/README.md) · [편집기 시험](../../../tests/editor-contracts-browser.ts) · [ZIP 시험](../../../tests/agent-export-browser.ts) · [자동 시작 시험](../../../tests/trigger-browser.ts) |
| `?view=templates`, `?lesson=`, `?view=guide` | 수준·주제 필터, 13개 실습 상세, 사본 생성, 전문가 정책 선택, 첫 실습 단계, 목적별 예제·용어·메뉴·블록 검색·FAQ·그림 확대 | 여섯 창 너비에서 섹션 전환, 예제·그림·설정과 오류 **직접**. 실습 사본, 편집 왕복·실제 워커 결과 **회귀**. [가이드](guide/README.md) · [가이드 시험](../../../tests/workflow-guide-browser.ts) · [가이드 그림 시험](../../../tests/guide-visuals-browser.ts) |
| `/prototype/library`, 미등록 주소 | 개발 시안의 실습 안내, 편집·결과 미리보기와 파일 다운로드. 프로덕션의 시안 주소와 미등록 주소에는 404 안내와 홈 복귀 링크가 있다. | 시안 **직접**. 프로덕션의 두 주소에 390px·1440px 밝은·어두운 창에서 접속해 HTTP 404와 제목을 확인했고, Tab·Enter로 로그인에 복귀했다. [시안 확인](editor/README.md) · [404 조작과 측정](guide/routes/results.json) · [404 화면](../../../src/app/not-found.tsx) |

## 공유 컴포넌트와 화면별 컨트롤

| 종류 | 구현과 사용처 | 검증 근거 |
| --- | --- | --- |
| 버튼과 아이콘 | 작업실 `.btn`의 주요·윤곽선·위험 동작, `.plain`의 가벼운 탐색, `.icon-btn`의 닫기·탐색. 편집기 `ToolButton`·`.ws-btn`, 자료함 `.rl-primary`·`.rl-delete`, 실행 `.run-primary`와 계정 제출은 화면별 스타일을 쓴다. Lucide 및 공통 `Icon`으로 아이콘을 표시한다. | 작업실·계정·공유 컨트롤, 클릭·포커스·비활성·보류 상태와 세 가지 색상 조건 **직접**. 화면별 버튼 근거는 해당 검토 기록. [공통 스타일](../../../src/app/studio.css) · [상태 캡처](controls/) · [편집기](editor/README.md) |
| 폼과 검색 | 기본 텍스트·비밀번호·검색·숫자·URL·파일 입력, 네이티브 선택, 체크박스와 라디오, `label`·`fieldset`. 긴 글 입력은 `PromptTextarea`와 확대창을 공유한다. 자료 종류·버전, 실습 수준·주제, 블록 팔레트, 휴지통 검색과 실행 회신은 화면별 필터·검증이 있다. | 자료 등록·운영자 폼·선택, 편집기 원문·오류, 실행 질문 **직접**. 긴 글 입력 확대, 첨부·업로드, 체크박스·복수 선택 및 필수 회신 **회귀**. [작업실](workspace/README.md) · [원문 입력 시험](../../../tests/editor-source-navigation-browser.ts) · [실행 시험](../../../tests/engine-run-browser.ts) |
| 탐색·탭·접기 | `WorkspaceNav`, 본문 건너뛰기, 좁은 창의 메뉴, 작업 경로 표시, 편집기와 실행의 제목·상태·작업 하단. `InspectorTabs` 및 공유 자료 탭은 방향키를 지원한다. 프로젝트 메뉴·도구 및 자료·실습 예시·실행 경로·FAQ는 `details/summary` 기반 조작이다. | 세 너비에서 Tab 순서·Escape 복귀, 공유 자료 방향키, 가이드 섹션 및 편집기·실행 메뉴 **직접**. [작업실 탐색 기록](workspace/nav-keyboard-results.json) · [편집기](editor/README.md) · [가이드](guide/README.md) |
| 카드·행·표·표식 | 실습·프로젝트·자료·휴지통은 카드 또는 목록 행과 작업 버튼을 쓴다. 가이드의 회의록 결과와 목적별 예제에서 실제 `table`을 사용한다. 판·공개 범위·선택 블록은 배지·칩으로 표시한다. 내비게이션 사용자 아바타는 계정 아이콘과 이름으로 구성된다. | 프로젝트·자료·휴지통·실습 행과 표 **직접**. 가이드 예제 전환과 저장판 판별 **회귀**. [작업실](workspace/README.md) · [실습 표](../../../src/ui/guide/TemplateGallery.tsx) · [회의록 표](../../../src/ui/guide/GuideVisualConcepts.tsx) |
| 연결도·그래프·단계 | SVG 연결도와 홈의 저장 캔버스, 포트, 배율 조절, 블록 선택기, 목록 보기와 범례. 가이드 단계와 실습 코치는 다음·이전과 현재 단계 표시를 쓴다. 스크롤바는 캔버스·모달 본문·표와 각 탐색 영역의 스크롤에 속한다. | 마우스 드래그·전체 보기·이전/다음·연결·스크롤 및 키보드 다중 경로 **직접** 또는 **회귀**. [편집기](editor/README.md) · [캔버스 제스처 시험](../../../tests/canvas-gesture-browser.ts) · [가이드](guide/README.md) |
| 로딩·빈 화면·오류·성공 | 부트스트랩·가이드·편집기 지연 로딩, 목록·검색·캔버스 빈 상태, 폼의 `role=alert`, 작업 중·성공·개수의 `role=status`, 전역 알림·오류와 화면별 재시도. 실행에는 대기·회신·승인·완료·중지·실패의 별도 상태가 있다. | 모델 미설정, 목록·검색 빈 상태, 접수 중·중복 방지, 통신·파일 오류, 실행 성공, **원래 요청의 처리 결과 다시 확인**을 눌러 결과 미확인에서 처리 확인으로 전환 **직접**. 연결 복구, 중단·같은 답변 이어가기, 다른 권한의 안내 **회귀**. [상태 캡처](controls/) · [미확인 영수증 수정 전](editor/before/receipt-1280.json) · [수정 후](editor/after/receipt-1280.json) · [실행 복구 시험](../../../tests/run-recovery-browser.ts) |

## 대화상자와 펼침 조작

| 제품 화면 | 다이얼로그 호출 또는 펼침 상태 | 근거 |
| --- | --- | --- |
| 작업실 공통 `StudioDialog` | 새 Agent, 한 문장 및 업무별 설계, 실습 상세, 공유 Agent 설명, 버전 및 복구, 공유 설정, 프로젝트 삭제, 설계·자료 연결 대상 프로젝트 선택 | **직접**. [작업실](workspace/README.md) · [가이드](guide/README.md) · [공통 대화상자](../../../src/ui/StudioDialog.tsx) |
| 자료·휴지통 `StudioDialog` | Skill 가져오기 적용 확인, 최신판과 내 초안 비교, 저장하지 않은 자료, 자료 삭제, 프로젝트와 자료 영구 삭제 | 미저장·자료 삭제 **직접**. 390×540px 밝은·어두운 설정의 Skill 파일 교체, 실제 409 충돌 비교, 자료·프로젝트 영구 삭제 및 포커스 복귀 **직접**. [대화상자 전후 측정](workspace/rare-dialogs/after.json) · [작업실](workspace/README.md) · [자료 편집 시험](../../../tests/resource-editing-browser.ts) |
| 편집기 `Modal` | 이름 변경, 업무 범위, 단축키, 설계 검사, 설계 가져오기·내보내기, Agent 내보내기, AI 설계, 연결 추가·전달 항목 추가, 실행 조건 변경 | 주요 명령, 폼, 내부 스크롤과 하단 버튼 **직접**. [편집기](editor/README.md) · [연결 시험](../../../tests/canvas-connection-edit-browser.ts) |
| 편집기 조건부 `Modal` | 분류 범주 삭제, 복제할 원문 선택, 따라갈 연결선 선택, 겹친 연결선 선택, 공유 자료를 연결할 블록 | 390×540px 밝은·어두운 설정의 범주 삭제, 겹친 연결선·따라갈 연결선·연결 블록 선택 **직접**. 원문 선택·복제 **회귀**. [좁은 편집기 대화상자](editor/after/choices-390x540.json) · [편집기](editor/README.md) · [복제 시험](../../../tests/canvas-copy-browser.ts) |
| 전용 네이티브 `dialog` | 실행 대화상자, 긴 글 입력 확대, 개발 시안의 실습 안내와 결과 미리보기. 편집기 시험 실행은 같은 실행 본문을 결과 패널에서 표시한다. | 실행·개발 시안 **직접**. 질문·시험 예상 결과와 편집기 원문의 확대 및 포커스 복귀 **회귀**. [편집기·실행](editor/README.md) · [긴 글 입력 시험](../../../tests/run-case-conversation-browser.ts) |
| 그림·메뉴·툴팁 | `GuideFigure`·`GuideVisual`의 그림 확대는 모달이다. 좁은 작업실 메뉴, 편집기 **프로젝트 메뉴**, 실행 기록·설정, 파일 미리보기는 화면 안에서 펼친다. 캔버스 범례와 연결선에는 호버·포커스 시 열리는 실제 ARIA 툴팁이 있다. | 메뉴·기록·그림 확대 **직접**. 툴팁의 호버·포커스·Escape **회귀**. [작업실 키보드 기록](workspace/nav-keyboard-results.json) · [그림](guide/README.md) · [툴팁 시험](../../../tests/canvas-editing-browser.ts) |

## 별도 위젯이 없는 항목

제품 TSX에서 전용 Switch, 범위 Slider, 숫자 페이지네이션, 우클릭 컨텍스트 메뉴, HTML Popover, 별도 Drawer, Skeleton, 로딩 스피너, 수치 차트를 찾지 못했다. 켜기·끄기는 체크박스와 누름 상태 버튼, 선택 목록은 네이티브 드롭다운, 열고 닫는 보조 화면은 버튼 또는 `details`, 로딩은 상태 문구, 연결 방향과 단계는 그래프와 단계 안내로 구현돼 있다. 브라우저 자체 우클릭 메뉴와 HTML 입력의 기본 팝업은 제품 컴포넌트 집계에서 제외했다.

## 원문 복제와 대화 회신

1440px의 어두운 설정에서 원문을 편집한 다음 **블록 복제**를 열었다. Escape로 닫은 뒤 편집 중인 원문과 마지막으로 적용한 원문을 각각 골라 실제 사본 내용을 비교했다. 같은 설정의 공유 대화에서는 회신 초안과 첨부를 복구하고, 파일을 다시 첨부해 실행을 마쳤다. 원문 복제 검사에서 열린 문서 2개, 실행·대화 검사에서 열린 문서 7개가 모두 어두운 설정을 보고했다.

| 상태 | 변경 전 | 변경 후 |
|---|---|---|
| 복제할 원문 선택 | [이전 확인창](dark-details/before/source-copy-choice-1440.webp) | [현재 확인창](dark-details/after/source-copy-choice-1440.webp) |
| 새 시험 사례의 자료 편집 | [이전 편집](dark-details/before/new-case-material-1440.webp) | [현재 편집](dark-details/after/new-case-material-1440.webp) |
| 저장한 사례의 근거 확인 | [이전 결과](dark-details/before/saved-case-evidence-1440.webp) | [현재 결과](dark-details/after/saved-case-evidence-1440.webp) |
| 공개판의 연속 대화 | [이전 대화](dark-details/before/published-conversation-1440.webp) | [현재 대화](dark-details/after/published-conversation-1440.webp) |
| 새로고침 후 회신 초안 | [이전 복구](dark-details/before/restored-conversation-draft-1440.webp) | [현재 복구](dark-details/after/restored-conversation-draft-1440.webp) |

## 추가 근거가 필요한 화면

| 우선 | 상태 | 현재 근거와 남은 검증 |
| --- | --- | --- |
| 환경 필요 | 실제 연결된 모델의 생성·실행 응답 | 격리 환경의 저장·실행과 로컬 워커, 시험 응답 및 모델 미설정 화면을 확인했다. 현재 외부 모델로 새 응답을 받아 확인한 근거는 없다. 가이드의 이전 모델 응답 그림은 실제 이전 답변이라는 출처가 기록돼 있다. [가이드 이미지 출처](guide/README.md) · [실제 모델 시험 진입점](../../../scripts/test-browser.mjs) |
