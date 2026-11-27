# 편집기와 시험 실행의 조작 검증

이 기록에서 말줄임으로 남겨 둔 41종 밀집 도면의 카드 8개는 후속 변경에서 다시 검토했다. [도면 안에서 전체 이름 읽기와 편집기 헤더 변경](dense-names.md)

실제 사용자 입력을 받는 Chrome에서 신규 계정과 격리 SQLite DB를 만들고, 제품 API로 **내 자료로 안내하기** 실습을 생성했다. 수정 전 빌드는 `JgaxZ_6K2R6MwLj_4K6vW`다. 화면 폭은 320·360·390·768·1024·1280·1440 CSS px로 설정했다. 별도의 밀집 도면에는 카탈로그의 41개 블록 종류를 다섯 열로 배치했다. [수정 전 화면과 실측](../../.local/ui-precision/editor/before/report.json)

기본 실습에서 작은 조작점 여덟 개가 처음 확인된 빌드는 `w2RBf5kthjSa1dPE22tbC`다. 여기에 기록된 본체 세 개와 출력점 다섯 개의 지적은 이번 세부 조정 전 빌드에서 이미 해소돼 있었다. [최초 320×568px 화면](../../.local/ui-touch-review/before/320-editor-fit.png) · [당시 표적 크기와 터치 실측](../../.local/ui-touch-review/before/report.json)

| 조작 | 기존 화면에서 확인한 점 | 적용 내용 |
|---|---|---|
| 이름 변경·분류 범주 삭제 | 짧은 확인창도 PC에서 폭 530px를 차지했다. 이름에 공백만 입력해도 적용 버튼을 누를 수 있었다. | 확인창은 416px, 공백 입력 시 적용 비활성, 이름 변경 취소, 삭제 확인 시 취소 버튼에 첫 초점을 둔다. |
| Agent 업무 범위·연결·설계 가져오기·AI 제안·내보내기 | 복잡도와 관계없이 같은 너비를 사용했다. | 일반 대화상자는 504px, 폼은 640px까지 사용한다. 480px 이하의 긴 폼은 하단 시트로 열리고 헤더 아래 본문이 스크롤된다. 설계 가져오기는 큰 파일도 같은 입력창에서 원문 전체를 편집할 수 있다. |
| 키보드 단축키 | 530px 창에서 키 조합과 긴 설명이 좁은 열에 배치됐다. | 넓은 화면에서 864px를 사용한다. 키 조합을 별도 배경으로 구분하고 좁은 화면에서는 본문을 키보드로 스크롤할 수 있다. |
| 팝업·속성 패널 복귀 | 편집기 포트는 손을 뗄 때 연결 창을 연다. 개발 중 하단 시트가 같은 터치의 후속 클릭을 받아 닫히는 경우를 발견했다. | 배경에서 누르고 배경에서 놓을 때만 연결 시트가 닫힌다. 편집기 모달·공개 실행·모바일 실행 기록에 Tab과 Shift+Tab 순환을 적용했다. |
| 실행 결과·설정·기록 | 시험 실행의 두 보조 버튼 간격이 들쭉날쭉했고, 패널 폭이 좁을 때 셀렉트는 130px까지만 표시됐다. | 실행 기록·설정을 같은 폭으로 정렬하고 선택 상태와 연결된 영역을 표시한다. 셀렉트는 패널 폭을 쓰고 시험 사례·자동 시작을 한 그룹으로 묶었다. 질문 안내와 실행 버튼은 별도 열을 쓴다. |
| 전체 보기 | 기본 실습과 41종 도면의 밀도가 다르다. 후자에서는 두 분기 본체와 Workflow 출력점이 작았고, 태블릿에서 기본 실습 출력점이 배율과 함께 줄었다. | 분기 본체와 경로의 좌우 영역을 나누고 인접 카드 사이에서 실제로 비는 공간을 사용한다. 선의 양 끝은 저장된 포트 좌표에 고정한다. 표준 배율에 가까운 축소에서는 단일 출력의 터치 영역만 26px로 보정한다. |

자료함·연결·범주·범위 등의 중첩 대화상자는 기존 React 컴포넌트와 폼 핸들러를 사용한다. 편집기 엔트리에서 적용되는 파일은 `src/ui/editor/Modal.tsx`, `Editor.tsx`, `Panels.tsx`, `AgentExportDialog.tsx`, `CanvasShortcuts.tsx`, `CategoryEditor.tsx`, `Canvas.tsx`, `node-layout.ts`, `editor.css`, `workspace-editor.css`, `inspector-tabs.css`다. 실행 화면은 `src/ui/RunPanel.tsx`, `src/ui/run-panel.css`를 수정했다. 도면 여백의 단위 시험은 `src/ui/editor/graph.test.ts`, 실제 터치 회귀 시험은 `tests/canvas-gesture-browser.ts`에 있다.

## 브라우저 확인 항목

- 일곱 폭에서 편집 초기 화면, 이름 변경, 단축키, Agent 내보내기, 설계 검사, AI 제안, 업무 전용 범위 폼, 시험 실행 빈 상태, 질문 입력, 실행 설정·자동 시작, 실행 기록을 열었다. 대화상자는 Escape로 닫은 뒤 원래 조작에 초점이 복귀하는지 확인했다.
- 320·1440px에서 41종 속성 패널을 열고 세부 설정을 펼쳤다. 390·1440px에서는 실제 워커를 통해 질문 접수, 추가 회신 대기, 완료, 결과 파일 다운로드와 파일 원문을 대조했다.
- 밀집 도면의 세 요소는 DOM 경계 상자와 화면 좌표에서 받는 터치 이벤트를 각각 검사한다. 분기 본체의 이름과 연결 창의 출발 블록을 대조해 가까운 블록이 잘못 선택되는 경우를 잡는다.

| 같은 조건에서 촬영한 화면 | 수정 전 | 최종 구현 |
|---|---|---|
| 320×568px 기본 실습 전체 보기 | [작은 표적 8개가 있던 화면](../../.local/ui-touch-review/before/320-editor-fit.png) | [블록과 출력점을 직접 누르는 화면](../../.local/ui-touch-review/after-precision-delivery-1/320-editor-fit.png) |
| 320×740px 41종 도면 | [분기와 Workflow 출력](../../.local/ui-precision/editor/before/320-dense.png) | [본체와 출력 구역](../../.local/ui-precision/editor/delivery-dense-1/320-dense.png) |
| 1440px 이름 변경 | [기존 대화상자](../../.local/ui-precision/editor/before/1440-rename-detail.png) | [확인 대화상자](../../.local/ui-precision/editor/verified/1440-rename-detail.png) |
| 390px 단축키 | [기존 설명창](../../.local/ui-precision/editor/before/390-shortcuts.png) | [스크롤되는 하단 시트](../../.local/ui-precision/editor/verified/390-shortcuts.png) |
| 390px 시험 실행 설정 | [기존 설정](../../.local/ui-precision/editor/before/390-run-settings.png) | [입력·설정과 자동 시작](../../.local/ui-precision/editor/verified/390-run-settings.png) |

## 편집기 접근성·조작 검증

최종 빌드 `5GJ4v1RvdnbnfWCIj9I_i`에서 기본 실습 6개 블록과 5개 출력의 중심을 눌렀다. 이어서 각 조작의 중심에서 가로·세로 10px씩 벗어난 네 위치와 작은 출력 원의 중심을 눌렀다. **60회씩 두 회차 모두** 의도한 블록의 이름 또는 연결 창의 출발 블록이 표시됐다. 최초 측정에서 약 7×7px였던 출력점 다섯 개는 28.00×34.75~37.40px로 커졌다. 30% 배율에서 6개 제목이 전부 보였고 5개 선 묶음을 각각 선택했다. 선과 포트 중심 사이의 최대 오차는 **0.007 CSS px 미만**이었다. 실행·데이터·참조 범례 3개를 전환하고 저장된 그래프가 같음을 대조했다. 두 회차 모두 axe 규칙 위반과 예상 밖 콘솔 메시지는 0개였다. [첫 번째 60회](../../.local/ui-touch-review/after-precision-delivery-1/report.json) · [두 번째 60회](../../.local/ui-touch-review/after-precision-delivery-2/report.json)

| 320px 밀집 도면의 직접 조작 | 작업 전 | 최종 터치 영역 | 최종 확인 |
|---|---|---|---|
| AI 분류 본체 | 46.58×12.58px | 28.00×33.46px | 중앙·주변 5/5에서 AI 분류 속성 |
| 조건 분기 본체 | 46.58×12.58px | 28.00×32.66px | 중앙·주변 5/5에서 조건 분기 속성 |
| 호출 가능한 Workflow 출력 | 25.70×17.67px | 25.70×29.58px | 중앙·주변 5/5에서 해당 Workflow가 출발점 |
| 작업 지침·Skill 본체 | 약 21×12px | 27.71×30.52px | 중앙·주변 5/5에서 Skill 속성 |

41종 도면에서 왼쪽 자료 카드의 출력 영역이 Skill 왼쪽 2.41px를 차지했다. 카드 오른쪽의 빈 공간을 다시 나눠 다음 카드까지 2.28px를 남겼다. 두 조작이 겹치는 위치는 실제 손가락 좌표로 구분한다. 최종 빌드에서 위의 20회와 왼쪽 자료 본체·출력 중앙 2회를 두 차례씩 확인했다. 두 회차 모두 직접 터치 22건, 전체 이름 선택기에서 속성·연결을 여는 조작 12건이 통과했다. 저장한 배치의 밀도 때문에 일부 짧은 카드는 24px보다 낮다. 41개 이름 중 8개는 남은 줄 끝에서 말줄임되며 전체 이름 41개를 모두 **살펴볼 블록**에서 읽을 수 있다. [첫 번째 밀집 도면 검사](../../.local/ui-precision/editor/delivery-dense-1/report.json) · [두 번째 밀집 도면 검사](../../.local/ui-precision/editor/delivery-dense-2/report.json) · [모든 최종 재시험의 소요 시간](../../.local/ui-precision/editor/delivery-timings.json)

일곱 폭 전수 검사는 대용량 가져오기 입력창을 조정하기 전의 `gVvJNPCFQOCs89tzkJdy5`에서 진행했다. 작은 화면부터 시험한 회차는 172개 화면·영역, 별도 계정으로 큰 화면부터 시험한 회차는 90개 화면·영역을 검사했다. 첫 회차는 유형별 속성의 axe 검사 82건을 포함한다. 두 회차 모두 axe 위반, 본문·검사 영역의 가로 넘침, 예상 밖 콘솔 메시지가 0개였다. 각 회차에서 모달의 정방향·역방향 Tab 순환 35건과 밀집 도면의 직접 터치 22건이 통과했다. 390·1440px에서는 추가 회신을 제출한 뒤 표시된 답변과 다운로드한 안내문 원문이 일치했다. [정순 회차](../../.local/ui-precision/editor/verified/report.json) · [역순 회차](../../.local/ui-precision/editor/verified-repeat/report.json) · [회신 대기 화면](../../.local/ui-precision/editor/verified/390-run-wait.png) · [완료 화면](../../.local/ui-precision/editor/verified/390-run-complete.png)

추가 시험에서는 **살펴볼 블록**으로 자료 가져오기, 작업 지침·Skill, 호출 가능한 Workflow를 차례로 선택했다. 세 블록 각각에서 **속성 열기**의 이름과 **연결 추가**의 출발점이 일치하고 Escape로 닫은 뒤 연결 버튼에 초점이 돌아오는지 두 번 확인했다. 속성과 연결을 여는 동등 조작 12건이 모두 통과했다. [전체 이름 선택기 검증](../../.local/ui-precision/editor/verified-reader/report.json)

## 설계 가져오기 회귀

2,521,049바이트 JSON의 한국어 본문이 한 줄에 길게 이어지는 사례를 확인했다. 기존 기준 빌드에서 파일 선택부터 적용 버튼 클릭까지 1.13초였다. 중간 빌드에서는 파일 읽기 20ms, 입력창 값 반영 6ms 뒤 버튼이 활성화됐지만 역할·이름으로 찾은 버튼 클릭이 90초 안에 끝나지 않았다. 가져오기 입력창에서 고정폭 글꼴과 자간을 지정한 클래스 한 개를 제거한 대조 시험에서는 0.90초 만에 같은 버튼을 눌렀다. 폼의 배치와 버튼 동작은 같은 조건에서 시험했다. [기준 빌드](../../.local/ui-precision/editor/import-before.json) · [지연이 관찰된 빌드](../../.local/ui-precision/editor/import-verified.json) · [클래스만 제거한 대조 시험](../../.local/ui-precision/editor/import-native-class.json)

최종 빌드 `5GJ4v1RvdnbnfWCIj9I_i`에서 같은 파일을 새 DB 두 곳에 가져왔다. 파일 선택부터 적용 클릭까지 각각 **0.94초·1.02초**, 중첩 블록의 **참고 자료 · 5판** 누락 경고까지 **0.95초·1.03초**, 마지막 글자를 포함한 본문 일치까지 **2.34초·2.53초**였다. [첫 번째 가져오기](../../.local/ui-precision/editor/import-delivery-1.json) · [두 번째 가져오기](../../.local/ui-precision/editor/import-delivery-2.json)

별도 계정에서 일반 파일을 열고 취소한 뒤, 창을 다시 열어 빈 상태인지 확인했다. 파일을 읽는 중에 다른 파일을 고르거나 클립보드에서 붙여넣고 먼저 선택한 파일 읽기를 완료해도 가장 최근 본문을 저장했다. 동일한 2MB 파일을 다시 선택한 뒤 열 번째 줄에 키보드로 공백을 삽입하고, 입력창과 저장된 블록의 본문 전체를 대조했다. [취소·붙여넣기·원문 편집과 저장 결과](../../.local/ui-precision/editor/import-contracts-delivery.json)

## 재현

프로젝트 루트에서 `node --import tsx .local/ui-precision/editor/check.mjs final-check 320 360 390 768 1024 1280 1440`을 실행한다. 저장된 빌드를 시험할 때는 `PRECISION_EDITOR_RUNTIME`에 빌드 폴더의 절대 경로를 지정한다. `EDITOR_PROPERTY_AX=1`을 지정하면 각 블록 속성에도 axe 검사를 실행한다. `node .local/ui-touch-review/measure.mjs after-final-check 320`은 같은 기본 실습을 320×568px에서 열어 11개 조작의 중앙·주변과 출력점의 보이는 중심을 각각 누른다. 이 명령으로 저장된 빌드를 지정하는 변수는 `TOUCH_RUNTIME`이다. 검증 환경은 Windows Chrome의 터치 에뮬레이션이었다. 실물 스마트폰과 화면 낭독 음성 시험은 수행하지 않았다.
