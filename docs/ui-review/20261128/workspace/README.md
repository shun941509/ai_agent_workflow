# 작업실 탐색과 자료 관리 브라우저 검토

2026-11-28에 Windows Chrome에서 작업실을 확인했다. 브라우저의 입력 방식은 마우스와 키보드로 유지하고 창의 너비를 바꿨다. 비교용 창은 390×900과 1440×900이며 각각 소스와 DB를 분리한 격리 서버에 같은 제목, 원문, 게시 상태의 시험용 계정과 프로젝트를 만들었다. 화면에서 열람한 자료와 공유 주소에는 시험 데이터가 들어 있다.

| 바뀐 부분 | 확인한 문제와 변경 | 비교 화면 |
| --- | --- | --- |
| 작업실 메뉴와 내 작업실 | 390px 창에서 고정 탐색 영역이 190px를 차지했다. 본문이 480px 아래로 줄지 않아 200px 영역에서 잘렸다. 720px 이하에서는 위쪽의 **메뉴**를 열어 기존 탐색과 로그아웃을 사용한다. 홈의 실습 이름·수준·설명은 좁은 행에서 줄을 나눈다. | [홈 이전](baseline-390-home.png) · [홈 이후](candidate-390-home.png) · [메뉴 이전](baseline-390-nav.png) · [메뉴 이후](candidate-390-nav.png) |
| 내 Agent와 공유 Agent | 작은 창에서 이름이 한 글자씩 갈라지고 공유·삭제 버튼이 밖으로 밀렸다. 이름과 수정일을 첫 영역에서 읽고 소유자 조작은 행 아래에서 사용하도록 바꿨다. 방문자는 공유 Agent를 열어 **Agent 사용**을 선택할 수 있다. | [목록 이전](baseline-390-projects.png) · [목록 이후](candidate-390-projects.png) · [공유 상세 이전](baseline-390-shared-agent.png) · [공유 상세 이후](candidate-390-shared-agent.png) |
| 자료함·공유 자료함 | 390px에서 기존 자료 열기 행의 가로 스크롤 영역은 442px였고 내용은 510px였다. 내용 폭이 작은 목록에서 이름과 자료판·공개 범위를 줄을 나눠 표시하며 삭제 버튼을 같은 행에서 누를 수 있다. 검색과 종류 필터를 세로로 배치하고 검색 결과 개수를 종류 옆에 표시한다. | [자료함 이전](baseline-390-assets.png) · [자료함 이후](candidate-390-assets.png) · [공유 자료 이전](baseline-390-shared-assets.png) · [공유 자료 이후](candidate-390-shared-assets.png) |
| 새 Agent | 열자마자 **Agent 이름**에 포커스가 간다. 템플릿을 고른 뒤 내 사본에서 편집한다는 설명을 추가했다. 브라우저에 가져올 이전 시안이 있을 때 해당 동작을 표시한다. | [생성 이전](baseline-390-create.png) · [생성 이후](candidate-390-create.png) |

## 기능과 팝업

| 화면 | 브라우저에서 조작한 동작 | 넓은 창 비교 |
| --- | --- | --- |
| 홈페이지 | 내 업무·예제로 시작 CTA, 최근 Agent와 실습 목록 표시 | [이전](baseline-1440-home.png) · [이후](candidate-1440-home.png) |
| 프로젝트 삭제 | 취소 포커스, Escape 후 삭제 버튼 복귀, 삭제 대상과 공유 범위 확인 | [이전](baseline-1440-project-delete.png) · [이후](candidate-1440-project-delete.png) |
| 게시 설정 | 대상 버전·공유 범위와 **선택한 버전 게시** 활성화, 1440px와 390px에서 제목과 양식 확인 | [이전](baseline-1440-project-share.png) · [이후](candidate-1440-project-share.png) |
| 프로젝트 휴지통 | **휴지통**을 눌러 삭제된 Agent의 이름·복구 기한·선택란 확인 | [이전](baseline-1440-projects-trash.png) · [이후](candidate-1440-projects-trash.png) |
| 자료 등록 및 수정 | 필드 입력, 종류 선택, 미저장 내용 취소 후 계속 작성, 기존 본문 확인 | [등록 이전](baseline-1440-asset-create.png) · [등록 이후](candidate-1440-asset-create.png) |
| 자료 상세 및 삭제 | 원문과 공유 범위, 삭제 확인에서 취소 포커스와 Escape 복귀, 자료 휴지통의 삭제 항목 확인 | [상세 이전](baseline-1440-asset-detail.png) · [상세 이후](candidate-1440-asset-detail.png) · [삭제 이전](baseline-1440-asset-delete.png) · [삭제 이후](candidate-1440-asset-delete.png) |
| 공유된 자료 | **모두에게 공개** 및 **직접 받은 자료** 탭의 방향키 이동. 방문자 원문, 자료 버전, 연결 프로젝트 선택과 소유자 삭제 조작 부재 확인 | [연결 이전](baseline-1440-connect.png) · [연결 이후](candidate-1440-connect.png) |

생성·삭제 확인·공유 설정은 기존 콘텐츠에 따라 정해진 640px·416px·864px 너비를 사용한다. 390px 창의 바깥 폭은 358px이고, 생성 입력 칸은 324px를 확보한다. 자료 연결 프로젝트 선택에는 표준 504px를 사용한다. 숫자는 테두리를 포함한 대화상자의 CSS 너비 기준이다.

390px에서 새 Agent 대화상자의 내부 높이가 584px에서 534px로 줄었다. 입력 칸에는 같은 324px 너비를 확보했다. 자료 목록은 352px 안에 종류·자료판·공개 범위와 삭제 조작을 모두 표시했다. [390px 생성 비교 이전](baseline-390-create.png) · [이후](candidate-390-create.png)

홈의 실습 목록을 수정한 뒤 360·390·768·1024·1280·1440px에서 다시 열었다. 여섯 창에서 본문과 실습 목록의 표시 폭과 스크롤 폭이 같았다. 390px에서 본문은 390px, 실습 목록은 358px였고 브라우저 오류가 없었다. [홈 너비 측정](home-final-results.json)

390px에서 **새 Agent**를 열면 이름 입력 칸에 포커스가 갔다. 이전 시안이 없을 때는 해당 조작이 숨겨졌고, 읽을 수 없는 시안을 선택하면 한국어 오류가 표시됐다. 메뉴 열기, Tab·Escape, 설계 가져오기에서 포커스 복귀, 자료 삭제 확인에서 포커스 복귀, 1280px로 넓힐 때 측면 메뉴 표시는 연속 두 번 통과했다. [탐색과 삭제 포커스 회귀](../../../../tests/creation-sharing-browser.ts)

1280px와 1440px에서 본문 건너뛰기, 홈 로고, 탐색 항목, 로그아웃, **새 Agent**까지 Tab으로 이동했다. 마지막 두 조작 사이에서 Shift+Tab도 확인했다. 390px에서 메뉴를 연 뒤 항목을 지나 본문으로 이동하자 메뉴가 닫혔다. 세 너비에서 **설계 가져오기**의 대화상자를 Escape로 닫으면 버튼으로 포커스가 돌아왔다. 390px에서 열린 메뉴도 Escape로 닫아 **메뉴** 버튼으로 복귀했다. [키보드 순서와 포커스 복귀 기록](nav-keyboard-results.json)

## 권한별 화면

일반 계정에서는 **자료 등록 → MCP 연결**이 비활성 상태였다. 수정 전후의 격리 프로덕션 서버에 각각 운영자로 로그인해 390px와 1440px에서 키보드로 **MCP 연결**을 선택했다. 두 버전에서 서버 주소부터 자격증명 환경변수 이름까지 다섯 개의 필드에 포커스가 이동했다. 마지막 입력에서 Tab 두 번으로 **취소**, **등록**에 닿고 Shift+Tab으로 입력에 복귀했다.

390px 수정 전에는 본문 표시 폭이 200px이고 스크롤 폭이 480px였다. 마지막 입력 칸의 오른쪽 끝이 창 밖에 있었다. 수정 후 본문은 390px 안에 들어왔고 마지막 입력 칸 전체가 창 안에 표시됐다. 1440px에서는 수정 전후 모두 본문 표시 폭과 스크롤 폭이 1250px였다. [390px 이전](baseline-390-admin-mcp.png) · [390px 이후](candidate-390-admin-mcp.png) · [1440px 이전](baseline-1440-admin-mcp.png) · [1440px 이후](candidate-1440-admin-mcp.png) · [운영자 측정 이전](baseline-admin-results.json) · [이후](admin-results.json)

## 390×540px 자료 대화상자

수정 전 프로덕션 서버와 최종 빌드에서 밝은 시스템 설정과 어두운 시스템 설정으로 같은 상태를 열었다. 수정 전 대화상자의 배경은 두 설정에서 흰색이었다. 최종 빌드의 어두운 설정에서는 배경이 `#1c293a`로 표시됐다. 각 상태에서 Tab과 Shift+Tab으로 처음·마지막 조작 사이를 순환했다. 본문이 넘칠 때 마우스 휠로 끝까지 내려도 하단 버튼의 위치는 같았다.

| 상태 | 조작과 결과 | 밝은 설정 | 어두운 설정 |
| --- | --- | --- | --- |
| Skill 가져오기 확인 | 기존 파일 8개가 목록에서 제외되고 10개가 교체 후보인 ZIP을 골랐다. 이전에는 교체 영역의 표시 높이가 91px에서 잘렸고 영역 안에서 따로 스크롤해야 했다. 최종 빌드에서는 대화상자 본문이 521px를 스크롤하고 하단 버튼은 고정됐다. Escape로 닫으면 두 테마에서 ZIP 버튼에 포커스가 돌아왔다. 확인창을 다시 열어 Space로 한 파일을 골라 내용을 적용했다. | [전](rare-dialogs/before-light-skill-stage.png) · [후](rare-dialogs/after-light-skill-stage.png) | [전](rare-dialogs/before-dark-skill-stage.png) · [후](rare-dialogs/after-dark-skill-stage.png) |
| 최신판과 내 초안 비교 | 다른 탭에서 2판을 저장한 뒤 1판을 편집하던 탭에서 실제 HTTP 409를 받았다. 양쪽 원문과 판을 확인했다. 내부 본문을 스크롤할 때 **계속 편집**, **내 사본으로 저장**, **내 초안을 3판으로 저장**은 고정됐다. 최종 빌드에서 Escape로 닫으면 **최신판과 비교**로 초점이 돌아왔고, 다시 열어 내 초안을 별도 사본으로 저장했다. | [전](rare-dialogs/before-light-conflict.png) · [후](rare-dialogs/after-light-conflict.png) | [전](rare-dialogs/before-dark-conflict.png) · [후](rare-dialogs/after-dark-conflict.png) |
| 자료 영구 삭제 | 격리 휴지통의 자료 9개를 선택하고 **취소**에 초기 초점이 가는지 확인했다. Escape 후 **선택 항목 영구 삭제**로 복귀하고 다시 열어 삭제했다. 휴지통의 빈 상태를 확인했다. | [전](rare-dialogs/before-light-asset-purge.png) · [후](rare-dialogs/after-light-asset-purge.png) | [전](rare-dialogs/before-dark-asset-purge.png) · [후](rare-dialogs/after-dark-asset-purge.png) |
| 프로젝트 영구 삭제 | 프로젝트 9개로 같은 선택·취소·포커스 복귀·삭제와 빈 상태를 확인했다. 자료와 프로젝트 확인창 모두 408px 높이에서 하단 버튼을 사용할 수 있었다. | [전](rare-dialogs/before-light-project-purge.png) · [후](rare-dialogs/after-light-project-purge.png) | [전](rare-dialogs/before-dark-project-purge.png) · [후](rare-dialogs/after-dark-project-purge.png) |

수정 전에는 Skill 가져오기 확인을 닫았을 때 초점 복귀가 실행마다 달랐고 최신판 비교에서는 문서 본문으로 돌아갔다. 최종 프로덕션 검증에서 두 조작 모두 호출 버튼에 복귀했다. 각 빌드에서 의도한 409 응답 2건을 확인했다. 그 외 콘솔·런타임 오류는 0건이었다. [수정 전 측정](rare-dialogs/before.json) · [최종 측정](rare-dialogs/after.json) · [자료 편집 회귀](../../../../tests/resource-editing-browser.ts)

## 연속 점검 결과

프로덕션 후보에서 360·390·768·1024·1280·1440px 각각 21개 상태를 두 차례, 반대 순서로 확인했다. 각 차례의 126개 상태에서 조작 실패, 콘솔 및 런타임 오류, 문서와 작업실 본문의 가로 넘침이 모두 0건이었다. 390px와 1440px에서 각 차례 32개 화면·상태를 axe의 WCAG A·AA 규칙으로 검사했으며 자동 검출 위반은 0건이었다. 이후 390×540px의 자료 대화상자를 추가 확인하고 위의 두 문제를 수정했다. 비교 화면에는 일반 화면 30쌍, 운영자 양식 2쌍, 390×540px 대화상자 8쌍을 포함했다. [수정 전 DOM 측정](baseline-results.json) · [수정 후 1차](candidate-results.json) · [수정 후 2차](review-2-results.json)
