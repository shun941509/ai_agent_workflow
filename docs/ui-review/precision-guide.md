# 작업실 홈 · 실습 · 가이드 정밀 검토

360px 초급 실습에서 Tab으로 ‘제공된 예시와 완료 기준’에 도착했을 때 하단의 사본 생성 버튼이 해당 항목을 가렸다. 본문만 스크롤되고 사본 생성 영역은 본문 아래에 머물도록 고쳤다. 그림 확대 창은 공통 대형 창 규격을 따른다. 창을 닫으면 그림을 열었던 버튼으로 포커스가 돌아온다.

| 화면 | 확인한 상태와 변경 사항 |
|---|---|
| 첫 방문 작업실 | 작은 화면에서 ‘내 업무로 시작’과 ‘예제로 시작’을 세로로 놓아 설명과 동작 버튼을 같은 열에서 읽도록 했다. |
| 재방문 작업실 | 긴 제목 펼침·접기, 주변 블록 2개와 전체 배치 6개 간 전환, 빈 설계, 실습 순서 펼침을 검사했다. 전체 배치 전환과 실습 순서 손잡이를 44px 이상으로 맞췄다. |
| 수준별 템플릿과 실습 상세 | 실제 13개 템플릿의 제목, 단계, 예시, 사본 생성, 선택 실습, 전문가 조사 정책을 확인했다. 총 생성 한도를 줄였을 때 동시 실행 한도가 해제되고 이유가 표시되는 상태도 촬영했다. |
| 처음 시작하기 | 다섯 단계의 선택 표시를 숫자·테두리·배경으로 구분했다. 모바일 360px에서 단계 버튼 36→44px, 처음부터 보기 30→44px, 시험 질문 복사 32→44px, 다음·이전 40→44px로 확대했다. |
| 기능·용어 / 목적별로 만들기 | 여섯 용어 선택, 열한 개 목적별 미리보기, 검색 결과 없음, 메뉴별 사용법, 문제 해결과 복귀를 검사했다. 위치 안내와 결과 상세의 펼침 동작을 44px로 맞췄다. |
| 그림과 FAQ | 개념 그림, 실제 화면 3단계, Agent 생성·설정 5단계, 기능별 설명, 네 가지 활용 사례, 질문 예시와 FAQ를 확인했다. 구체적인 회원증 질문 바로 밑에서 실제 실행 결과를 펼치고 화면을 확대할 수 있다. |

## 가이드 이미지 출처

통합 배포 후보 `9ZgKerobe_I-QhQFMO0Xm`에서 홈, 편집기, 시험 질문, 자료 원문, 설정 오류, 생성 폼을 격리 계정으로 촬영했다. 목적별 실습 그림 10개에는 해당 사본과 팀 내부의 실제 블록을 표시했다. ‘예제로 시작하기’, ‘질문 실행’, ‘설계 검사’ 등의 한국어 설명·번호·화살표·강조 영역은 보이는 컨트롤의 경계에서 다시 계산했다.

제품에 포함한 화면 파일 40개 중 36개를 당시 UI로 재생성했다. 첫 답변과 인용을 추가한 두 번째 답변의 원본 2개와 확대 부분 2개는 이전 버전에서 실제 모델이 회원증 질문에 응답한 기록이다. 해당 출처를 캡션과 FAQ에 표시했다. 개념 일러스트는 작업 흐름을 설명하는 별도 자산이다.

이 사진을 포함한 배포본 `i-Qcc2Gf8jg7z42GiJ9st`를 다시 촬영한 뒤 이미지 크기와 표시 좌표를 대조했다. 36장의 이미지 크기와 원본 30장의 측정 좌표가 모두 일치했다. RGB 채널 차이 8을 초과한 픽셀은 28,061,970개 중 64개였다. 두 이미지에 각각 49개와 15개가 있었고 나머지 34개 이미지에서는 검출되지 않았다. [이미지별 픽셀 대조](../../.local/ui-precision/guide/release-captures/assets/comparison.json)

| 동작 | 변경 파일 |
|---|---|
| 작업 시작과 재방문 | [WorkspaceDesk.module.css](../../src/ui/home/WorkspaceDesk.module.css) |
| 실습 상세 본문과 사본 생성 | [LessonHandout.module.css](../../src/ui/guide/LessonHandout.module.css) |
| 단계 이동, 복사, 체크, 용어·목적 선택 | [GuidePage.module.css](../../src/ui/guide/GuidePage.module.css), [VisualGlossary.module.css](../../src/ui/guide/VisualGlossary.module.css), [TemplateGallery.module.css](../../src/ui/guide/TemplateGallery.module.css), [WorkflowGuide.module.css](../../src/ui/WorkflowGuide.module.css) |
| 그림 확대와 실제 결과 | [GuideFigure.tsx](../../src/ui/guide/GuideFigure.tsx), [GuideVisual.tsx](../../src/ui/guide/GuideVisual.tsx), [GuideVisual.module.css](../../src/ui/guide/GuideVisual.module.css), [FirstGuideQuestions.tsx](../../src/ui/guide/FirstGuideQuestions.tsx), [FirstGuideQuestions.module.css](../../src/ui/guide/FirstGuideQuestions.module.css) |
| 실습 사진, 원본 크기와 표시 위치 | [제품 캡처](../../public/guide/captures/), [captures.ts](../../src/ui/guide/captures.ts), [goal-captures.ts](../../src/ui/guide/goal-captures.ts), [FirstGuideStart.tsx](../../src/ui/guide/FirstGuideStart.tsx), [GuideCreationVisual.tsx](../../src/ui/guide/GuideCreationVisual.tsx), [GuideHelpVisual.tsx](../../src/ui/guide/GuideHelpVisual.tsx) |
| 답변 펼침과 키보드 회귀 | [guide-visuals-browser.ts](../../tests/guide-visuals-browser.ts) |

## 검증 범위

Windows Chrome에서 360·390·768·1024·1280·1440px로 첫 방문과 재방문, 13개 실습, 가이드 메뉴 여섯 개를 열었다. 첫 회차의 화면·상태 검사 240행에서 기준선의 Tab 가림 1건이 수정 후 0건이었다. 페이지 가로 넘침, 검사 대상 텍스트의 계산 대비 미달, 예기치 않은 콘솔 출력이 0건이었다. 그림 원본·확대, Escape·닫기, 정책 폼 변경, 재방문 전환도 여섯 너비에서 직접 조작했다.

첫 회차와 최신 그림이 들어간 배포본에서 제품 테스트 `guide-visuals-browser.ts`, `workflow-guide-browser.ts`, `home-lesson-browser.ts`가 각각 종료 코드 0으로 통과했다. 이 중 시각 자료 회귀는 320·390·768·1440px에서 그림과 확대, 완성 이미지 로딩, 포커스 복귀를 검사한다.

최신 그림이 들어간 배포본으로 240행을 다시 검사해 같은 결과를 확인했다. 첫 방문, 초급 실습, 실제 답변을 펼친 상태, 사진 확대 창, 질문 실행 안내의 다섯 상태에 대해 여섯 너비에서 axe-core 4.10.3도 실행했다. WCAG 2 A·AA, 2.1 A·AA, 2.2 AA 태그의 자동 위반은 후보와 최종 가이드 배포본 각각 30회 모두 0건이었다. 브라우저 조작은 Windows Chrome에서 검증했다.

- [15개 화면·컴포넌트 × 6개 너비 전후 대조](../../.local/ui-precision/guide/comparison.html)
- [수정 전 측정값](../../.local/ui-precision/guide/before/observations.json) · [수정 후 1차 측정값](../../.local/ui-precision/guide/pass1/observations.json)
- [2차 측정값](../../.local/ui-precision/guide/release/observations.json) · [최종 접근성 30회](../../.local/ui-precision/guide/release/accessibility.json) · [확대 창과 입력 폼](../../.local/ui-precision/guide/release/details.json) · [재방문 작업실](../../.local/ui-precision/guide/release/home-observations.json)
- [후보 배포본에서 측정한 홈·실습 그래프](../../.local/ui-precision/guide/candidate-captures/assets/home-goal-marks.json) · [편집기와 실행 상태](../../.local/ui-precision/guide/candidate-captures/assets/guide-editor-marks.json) · [생성·설정 단계](../../.local/ui-precision/guide/candidate-captures/assets/creation.json)
