# 기능별 유지보수 가이드

개발 환경과 실행 흐름은 [개발자 가이드](DEVELOPER_GUIDE.ko.md)에 있습니다. 아래에서 바꾸려는 동작을 찾아 담당 함수와 그 동작을 재현하는 시험을 함께 열어 보세요.

## 블록·포트·수준별 템플릿

| 바꾸려는 것 | 구현과 확인할 동작 |
|---|---|
| 블록 이름, 속성, 기본값, 추천 수준 | `catalog`에서 블록의 `type`을 찾으세요. `palette`는 제작 메뉴를 추리고, 하나의 메뉴가 여러 실행 방식을 제공할 때는 `menuType`과 `modes`를 사용합니다. `createBlock`은 정의된 속성 기본값을 새 블록에 적용합니다. [블록 정의](../src/domain/catalog.ts) · [블록 생성](../src/domain/graph.ts) · [메뉴·기존 설계 시험](../tests/domain.test.ts) |
| 분기와 포트 연결 규칙 | `portsFor`가 설정에 따라 내놓은 포트를 `connectionOptions`가 비교하고 `connectBlocks`가 선을 만듭니다. 선에는 블록 ID와 `kind`, 출발 포트 `out`, 도착 포트 `input`이 저장됩니다. 이름이 같은 사용자 분류와 기본 ‘미분류’도 각자 포트 ID를 유지해야 합니다. [포트 정의](../src/domain/catalog.ts) · [그래프 타입](../src/domain/types.ts) · [연결·검증](../src/domain/graph.ts) · [포트 시험](../tests/domain.test.ts) |
| 블록이 실행한 결과나 다음 단계 | `evaluate`에서 해당 블록의 입력·출력값과 다음 진행 포트를 확인하세요. 새 시작·참조·종료 유형을 추가하면 `executeGraph`가 실행할 노드를 고르는 조건도 확인합니다. 예전 시안 가져오기는 `migrateGraph`를 거칩니다. [블록 실행](../src/engine/operations.ts) · [실행 순서](../src/engine/index.ts) · [이전 시안 변환](../src/domain/graph.ts) · [실행 결과 시험](../tests/engine.test.ts) |
| 실습의 원문, 그래프, 시험 질문 | `templates`에서 실습 ID를 찾아 `graph`, `question`, `steps`, `checks`를 함께 보세요. `createProject`는 새 사본에 그래프를 복제합니다. 기존 사본의 기능에 맞춘 안내는 `projectLesson`에 있습니다. 초급 실습 변경 시 답변과 인용이 내려받은 `대출안내.txt`에도 들어가는지 확인하세요. [실습 정의](../src/domain/templates.ts) · [사본 생성](../src/server/projects.ts) · [기존 사본 안내](../src/ui/Studio.tsx) · [실제 모델 실습 시험](../tests/live-service.ts) |

## 캔버스와 편집기

| 증상 | 처음 열 곳 |
|---|---|
| 선이 겹치거나 분기명이 가려집니다 | `groupEdges`가 같은 두 블록 사이의 연결을 화면용으로 묶고, `groupedWireGeometry`와 `branchCaptions`가 경로와 라벨 위치를 계산합니다. 카드의 크기는 `nodeLayout`, 자동 배치는 `arranged`가 정합니다. [연결 묶음·자동 배치](../src/ui/editor/graph.ts) · [경로·라벨 배치](../src/ui/editor/geometry.ts) · [카드 크기](../src/ui/editor/node-layout.ts) · [캔버스](../src/ui/editor/Canvas.tsx) · [배치 시험](../src/ui/editor/graph.test.ts) |
| 속성을 고쳤는데 다른 팀의 블록이 바뀝니다 | `Inspector`와 `ConnectionModal`에서 편집한 블록과 포트를 확인하세요. 같은 ID의 블록이 두 팀 안에 있을 수 있습니다. `Editor`의 `change`가 현재 팀 경로를 `updateSubgraph`에 넘기는지 확인합니다. [속성·연결 편집](../src/ui/editor/Panels.tsx) · [편집 상태](../src/ui/editor/Editor.tsx) · [하위 그래프 갱신](../src/ui/editor/graph.ts) · [중첩 팀 시험](../src/ui/editor/graph.test.ts) |
| 새로 열면 편집 내용이 사라집니다 | `Editor` 내부의 `flush`가 변경된 그래프와 제목을 `onSave`로 넘깁니다. `Studio`의 `save` → `project.save` → `saveProject` 순서로 따라가세요. 다른 화면에서 먼저 저장했다면 서버가 리비전 충돌(409)을 반환합니다. 미완성 초안도 저장할 수 있으며 실행·게시할 때 `runnable`이 필수값과 연결을 검사합니다. [편집기 저장](../src/ui/editor/Editor.tsx) · [저장 요청](../src/ui/Studio.tsx) · [API 분기](../src/app/api/studio/route.ts) · [저장·검증](../src/server/projects.ts) |

**자료 카드에는 5권인데 답변은 3권이라면** ‘변경 적용’ 또는 ‘프로젝트 메뉴 → 저장’ 후 사본을 다시 열어 원문을 확인하세요. 다음으로 ‘시험 실행’에서 현재 초안을 선택해 새 대화에 같은 질문을 보내세요. 기존 대화는 시작 당시 그래프를, 공유 주소에서 시작한 새 대화는 현재 게시판을 사용합니다. [원문 편집](../src/ui/editor/InlineSourceEditor.tsx) · [대화별 설계 선택](../src/server/runs.ts) · [원문 저장 시험](../tests/engine-run-browser.ts) · [모바일 편집·재실행 시험](../tests/browser-smoke.ts)

## 문서·Skill·MCP

| 작업 | 구현과 검증 |
|---|---|
| 자료 삭제·휴지통 | `asset.deleteImpact`는 내 프로젝트의 초안과 저장판에서 직접 연결한 자료를 찾습니다. `deleteAsset`은 원본의 접근과 공유를 끊고, `restoreAsset`은 같은 ID와 판으로 비공개 복구합니다. 1판을 연결한 설계가 최신판이 2판인 자료를 복구한 뒤에도 1판을 읽는지 확인하세요. [삭제 영향 조회](../src/server/projects.ts) · [자료 휴지통](../src/server/asset-trash.ts) · [공통 휴지통 화면](../src/ui/TrashList.tsx) · [자료판 복구·만료 시험](../tests/asset-trash.test.ts) |
| 자료판 본문과 카드 미리보기 | 사본에 직접 쓴 문서는 `config.content`에 있습니다. 등록 문서는 `assetId`와 `version`으로 자료함의 판을 참조합니다. `useMaterialPreviews`가 `asset.previews`를 요청하면 `documentPreviews`가 읽을 수 있는 판의 첫 문장을 반환합니다. 1판과 2판을 번갈아 선택해 카드와 원문 보기에 같은 판이 나오는지 확인하세요. [미리보기 요청](../src/ui/editor/use-material-previews.ts) · [서버 자료 처리](../src/server/assets.ts) · [자료함 브라우저 시험](../tests/resource-library-browser.ts) |
| Skill 업로드와 모델 지침 | 자료함은 파일·폴더·ZIP을 받습니다. 서버의 `skillFiles`는 경로와 크기를 검사하고 `cleanPayload`는 `SKILL.md` 본문을 읽습니다. `pins`가 스크립트 실행이 필수인 판을 제한하고, 실행기의 `evaluate`가 연결된 지침을 AI 작업에 전달합니다. [자료 등록 화면](../src/ui/ResourceLibrary.tsx) · [자료 검증](../src/server/assets.ts) · [블록 실행](../src/engine/operations.ts) · [부속 파일·필수 스크립트 시험](../tests/domain-assets.test.ts) · [모델 입력 시험](../tests/engine.test.ts) |
| 검색 자료집의 발행·인용 | `validateKnowledgePublication`은 게시 범위에서 원문을 읽을 수 있는지 검사합니다. `bindKnowledge`는 실행 중 자료집을 읽고, `authorizeKnowledgeHistory`는 기록 열기·실행 재개 시 이미 사용한 원문의 권한을 확인합니다. 다른 계정으로 게시된 판을 검색한 뒤 자료를 철회했을 때도 시험하세요. [자료집 저장·권한](../src/server/knowledge.ts) · [근거 판단 블록](../src/engine/operations.ts) · [검색 통합 시험](../tests/rag-integration.test.ts) |
| 도서관 예약 도구 | 도서관 서버의 `tools`와 `op`에서 입력 스키마와 처리를 맞추세요. 작업실 실행 서버에는 `builtin`, 읽기 전용 판정, 승인·영수증 처리가 있습니다. 예약 변경과 영수증은 도서관 DB의 한 트랜잭션에 기록됩니다. 응답 유실 뒤 같은 승인 건을 재시도해 실제 예약 건수를 확인하세요. [도서관 서버](../src/mcp/server.ts) · [호출 어댑터](../src/server/mcp.ts) · [실행 서버](../src/server/runs.ts) · [도서관 MCP 통합 시험](../tests/engine-mcp.test.ts) |
| 외부 MCP의 등록·호출 권한 | `McpToolPicker`는 화면에 후보 도구를 표시합니다. 등록 권한은 `cleanPayload`가 `STUDIO_ADMIN_IDS`와 대조합니다. 호출 때는 `bindRunAssets`가 연결한 판, 허용 도구, 상위 역할의 제한을 검사하고 `externalMcp`로 요청합니다. [선택 화면](../src/ui/editor/McpToolPicker.tsx) · [등록 검증](../src/server/assets.ts) · [사용 범위](../src/server/run-assets.ts) · [외부 호출](../src/server/mcp.ts) · [연결판·위임·승인 시험](../tests/sharing-releases.test.ts) |

## 프로젝트 권한·버전·공유·휴지통

`/api/studio`는 세션 쿠키로 사용자를 정합니다. 클라이언트의 `Project.mine`은 소유자용 버튼을 표시하는 값입니다. 서버에서는 `owned`, `canProject`, `canReadProjectEdition`이 수정·열람·특정 판 접근을 검사합니다. 권한 변경은 소유자와 방문자 양쪽에서 같은 API를 호출해 검증하세요. [화면 데이터 타입](../src/ui/studio-project.ts) · [세션](../src/server/auth.ts) · [API 동작 목록](../src/app/api/studio/route.ts) · [프로젝트 접근 검사](../src/server/projects.ts)

| 작업 | 코드에서 확인할 동작 |
|---|---|
| 버전 선택·저장·복원·게시 | 패널을 열 때 `readVersionInfo`가 버전 목록과 최초 선택값을 준비합니다. 서버에서 `versions.save`의 `snapshot`은 현재 초안과 자료판을 고정하고, `versions.restore`의 `restore`는 선택한 판을 **초안**에 저장합니다. `versions.publish`의 `publish`가 **공유 주소**에 적용할 판과 범위를 갱신합니다. 다른 탭에서 먼저 저장했을 때 복원이 충돌하는지, 복원 후 게시판과 새 대화가 어느 판을 사용하는지 확인하세요. [버전·공유 패널](../src/ui/ProjectVersionPanel.tsx) · [서버 처리](../src/server/projects.ts) · [복원 충돌·공유 화면 시험](../tests/browser-smoke.ts) · [새 대화·기존 대화 시험](../tests/sharing-releases.test.ts) |
| 게시 판단 실습 | 새 실습은 `createProject`가 기준판·후보판과 시험 사례 세 개를 준비합니다. `ReleaseDecisionForm`에서 판단을 입력하면 패널의 `recordDecision`이 `versions.decide`를 보냅니다. 서버의 `decideRelease`는 직전 판단 번호와 게시 상태를 비교하고, 판단 기록과 게시 변경을 한 트랜잭션에 저장합니다. [실습 정의](../src/domain/templates.ts) · [판단 양식](../src/ui/ReleaseDecisionForm.tsx) · [서버 처리](../src/server/projects.ts) · [보류·유지·게시·복구 시험](../tests/release-exercise.test.ts) |
| 비밀 링크 철회·사본 만들기 | `openProject`는 유효한 비밀 링크 방문을 기록합니다. `revoke`는 비공개로 전환하며 토큰을 교체합니다. `projectCopy`는 자료와 하위 Workflow를 별도 사본에 담습니다. 철회 뒤 이전 주소와 대화의 접근이 제한되고 이미 만든 사본은 계속 열리는지 확인하세요. [공유·복사](../src/server/projects.ts) · [하위 Workflow 참조](../src/server/workflow-refs.ts) · [공유 시험](../tests/sharing-releases.test.ts) · [두 브라우저 시험](../tests/browser-smoke.ts) |
| 삭제·휴지통 복구·영구 삭제 | `project.delete`의 `deleteProject`는 실행을 중지하고 공유·자동 시작을 해제합니다. `project.restore`는 비공개로 복구합니다. 선택 영구 삭제는 `purgeTrashedProjects`가 소유자와 각 항목의 리비전을 확인합니다. 72시간 보관 기한은 워커 정리와 휴지통 조회 시 모두 적용됩니다. [휴지통 화면](../src/ui/ProjectTrash.tsx) · [삭제·복구](../src/server/projects.ts) · [연관 데이터 정리](../src/server/project-purge.ts) · [워커 정리 작업](../src/server/worker.ts) · [삭제·복구 시험](../tests/project-deletion.test.ts) · [보관 기한·일괄 삭제 시험](../tests/project-purge.test.ts) |

위 표에서 찾은 시험만 실행하려면 개발자 가이드의 예제를 참고하세요. 전체 회귀 시험과 브라우저 시험 명령은 README에 있습니다. [시험 파일 지정 예제](DEVELOPER_GUIDE.ko.md#변경-후-확인하기) · [전체 검증 명령](../README.md#검증)
