# 기능별 유지보수 가이드

개발 환경과 실행 흐름은 [개발자 가이드](DEVELOPER_GUIDE.ko.md)에 있습니다. 아래에서 바꾸려는 동작을 찾아 담당 함수와 그 동작을 재현하는 시험을 함께 열어 보세요.

## 블록·포트·수준별 템플릿

| 바꾸려는 것 | 구현과 확인할 동작 |
|---|---|
| 블록 이름, 속성, 기본값, 추천 수준 | 제작 메뉴 항목은 `palette`, 추천 수준은 블록 정의의 `level`에서 확인하세요. 여러 실행 방식이 한 메뉴에 속하면 같은 `menuType`을 사용합니다. `modes`에 실행 방식 선택지가 있습니다. `createBlock`은 새 블록에 정의된 속성 기본값을 적용합니다. [블록 정의](../src/domain/catalog.ts) · [블록 생성](../src/domain/graph.ts) · [메뉴·기존 설계 시험](../tests/domain.test.ts) |
| 분기와 포트 연결 규칙 | `portsFor`는 블록 설정에 따라 입출력 포트를 만듭니다. `connectionOptions`는 연결 가능한 포트 조합을 찾습니다. `connectBlocks`는 출발·도착 블록 ID와 연결 종류(`kind`), 출발 포트(`out`), 도착 포트(`input`)를 담은 연결 배열을 반환합니다. 편집기의 `connect`는 반환된 연결을 `graph.edges`에 추가합니다. 사용자가 분류 이름을 ‘미분류’로 정해도 기본 ‘미분류’와 포트 ID가 달라야 합니다. [포트 정의](../src/domain/catalog.ts) · [그래프 타입](../src/domain/types.ts) · [연결·검증](../src/domain/graph.ts) · [편집기의 연결 처리](../src/ui/editor/Editor.tsx) · [포트 시험](../tests/domain.test.ts) |
| 블록의 실행 결과와 다음 실행 경로 | `evaluate`에서 블록의 입력·출력 값과 실행 결과에 따라 선택하는 포트를 확인하세요. 새 시작·참조·종료 유형을 추가하면 `executeGraph`가 실행할 노드를 고르는 조건도 확인합니다. 이전 형식의 설계 JSON을 가져올 때는 `migrateGraph`가 변환합니다. [블록 실행](../src/engine/operations.ts) · [실행 순서](../src/engine/index.ts) · [이전 설계 변환](../src/domain/graph.ts) · [실행 결과 시험](../tests/engine.test.ts) |
| 실습의 원문, 그래프, 시험 질문 | `templates`에서 실습 ID를 찾아 `graph`, `question`, `steps`, `checks`를 함께 보세요. `createProject`는 새 사본에 그래프를 복제합니다. `projectLesson`은 이전 사본의 설계를 보고 그 사본에서 수행할 수 있는 실습 안내를 적용합니다. 도서관 초급 템플릿 **내 자료로 안내하기**를 수정했다면 새 사본에서 `대출안내.txt`를 내려받아 화면의 답변·인용과 대조하세요. 파일 생성 블록이 없는 이전 사본에서는 수정 전후의 답변과 인용을 화면에서 비교하세요. [실습 정의](../src/domain/templates.ts) · [사본 생성](../src/server/projects.ts) · [기존 사본 안내](../src/ui/Studio.tsx) · [실제 모델 실습 시험](../tests/live-service.ts) |

## 캔버스와 편집기

**Agent ZIP에서 자료나 단계가 빠집니다.** 편집기의 **Agent 내보내기 → ZIP 내려받기**로 받은 파일을 열어 `AGENTS.md`에서 단계별 입력·분기·승인 조건과 자료 경로를 확인하세요. `project.exportPreview`는 현재 캔버스에서 자료의 버전과 사용 위치를 찾습니다. `project.exportAgent`는 다운로드 시 선택한 자료의 권한과 버전을 다시 확인합니다. 선택 자료의 원본 크기 합계는 중복을 제외하고 32 MiB까지입니다. Skill 원문과 부속 파일은 `.agents/skills/<id>/`에 있고, Claude Code는 `.claude/skills/<id>/SKILL.md`에서 원문을 참조합니다. [자료 선택 화면](../src/ui/editor/AgentExportDialog.tsx) · [자료 확인](../src/server/agent-export.ts) · [Skill 경로 생성](../src/server/agent-skill-export.ts) · [ZIP 시험](../tests/agent-zip.test.ts)

**큰 설계에서 특정 단계 찾기.** 내보내기는 먼저 전체 지침의 UTF-8 바이트와 빈 줄을 포함한 줄 수를 계산합니다. 16 KiB 또는 200줄을 초과하면 `AGENTS.md`에 시작점과 분기·승인 안내를 두고, 각 블록의 지침을 `workflow/step-*.md`에 기록합니다. 단계 파일의 실행 경로는 다음 블록으로, 값·자료 연결은 입력을 제공하는 블록으로 이어집니다. 하위 설계는 호출 단계에서 시작 링크를 확인하세요. 연결되지 않은 블록도 `workflow/index.md`에서 찾을 수 있습니다. [분리 기준과 단계 링크](../src/server/agent-instruction-layout.ts)

**병렬 역할을 호출하거나 결과를 모을 수 없습니다.** ZIP의 `README.md`에서 역할 이름을 찾아, 해당 도구의 프로젝트 역할 목록에 등록됐는지 확인하세요. Codex는 `.codex/agents/*.toml`, Claude Code는 `.claude/agents/*.md`, OpenCode는 `.opencode/agents/*.md`를 읽습니다. 역할마다 `agents/`의 원문에 입력·자료·Skill과 맡길 일이 있습니다. 같은 팀에서 이름과 자료·도구 범위가 같은 역할을 여러 번 호출하면 작업 번호로 해당 지침을 선택합니다. 합류 단계에서는 시작한 각 호출의 결과나 실패 사유가 도착했는지 확인하고, 연결 순서·합치기 형식·실패 시 처리 설정에 따라 다음 단계로 전달하세요. [역할 원문](../src/server/agent-delegation.ts) · [클라이언트별 등록](../src/server/agent-role-files.ts) · [병렬 및 합류 지침](../src/server/agent-parallel-instructions.ts)

**압축을 푼 폴더에서 MCP를 찾을 수 없습니다.** 내보내기에서 해당 연결을 선택했는지 확인하세요. 선택한 원격 서버는 Codex의 `.codex/config.toml`, Claude Code의 `.mcp.json`, OpenCode의 `opencode.json`에 등록됩니다. ZIP의 `README.md`에서 수동 연결이 필요한 서버와 인증에 사용할 환경 변수 이름을 확인하세요. 압축을 푼 뒤의 연결 승인과 작업 중의 사람 검토는 수신자가 사용하는 도구에서 진행합니다. [MCP 설정 생성](../src/server/agent-mcp-export.ts) · [지침 생성](../src/server/agent-zip.ts)

| 증상 | 처음 열 곳 |
|---|---|
| 선이 겹치거나 분기명이 가려집니다 | `groupEdges`는 출발 블록과 도착 블록이 같은 연결을 화면에 표시할 때 한 묶음으로 모읍니다. `groupedWireGeometry`는 선의 경로를 계산하고, `wireCaptions`는 분기 이름 등 연결선에 표시할 문구의 위치를 정합니다. 카드의 크기는 `nodeLayout`, 자동 배치는 `arranged`가 정합니다. [연결 묶음·자동 배치](../src/ui/editor/graph.ts) · [경로·라벨 배치](../src/ui/editor/geometry.ts) · [카드 크기](../src/ui/editor/node-layout.ts) · [캔버스](../src/ui/editor/Canvas.tsx) · [배치 시험](../src/ui/editor/graph.test.ts) |
| 속성을 고쳤는데 다른 팀의 블록이 바뀝니다 | `Inspector`와 `ConnectionModal`에서 편집한 블록과 포트를 확인하세요. 서로 다른 팀의 하위 그래프에는 ID가 같은 별개 블록이 있을 수 있습니다. `Editor`의 `change`가 현재 팀까지의 경로를 `updateSubgraph`에 넘기는지 확인하세요. [속성·연결 편집](../src/ui/editor/Panels.tsx) · [편집 상태](../src/ui/editor/Editor.tsx) · [하위 그래프 갱신](../src/ui/editor/graph.ts) · [중첩 팀 시험](../src/ui/editor/graph.test.ts) |
| 새로 열면 편집 내용이 사라집니다 | 자료 원문이 저장되지 않았다면 초안에 적용했는지 먼저 확인하세요. 속성이나 제목이 누락됐다면 `Editor`의 `flush`가 그래프와 제목을 `onSave`에 넘기는 곳부터 `Studio`의 `save` → `project.save` → 서버의 `saveProject` 순서로 따라가세요. 요청의 리비전이 최신 초안과 다르면 서버는 409를 반환합니다. 미완성 초안도 저장할 수 있으며, 실행·게시할 때 `runnable`이 필수값과 연결을 검사합니다. [편집기 저장](../src/ui/editor/Editor.tsx) · [저장 요청](../src/ui/Studio.tsx) · [API 분기](../src/app/api/studio/route.ts) · [저장·검증](../src/server/projects.ts) |

**자료 카드에는 5권인데 답변은 3권이라면** **프로젝트 메뉴 → 저장**에서 원문 변경을 적용하세요. 이전 시험의 답변 아래에서 **같은 질문·첨부·시험 자료로 현재 초안 다시 시험**을 누르면 새 대화에서 현재 설계를 실행합니다. 시험 사례가 별도 원문을 지정했다면 그 원문도 다시 사용합니다. 하위 팀과 재사용 Workflow에 이름이 같은 자료 블록이 있을 때는 시험 초기 데이터의 `documents`에서 블록 경로를 키로 지정할 수 있습니다. 예를 들어 `{"documents":{"[\"team\",\"rules\"]":"대출 한도는 7권입니다."}}`는 `team` 안의 `rules`만 바꿉니다. [대화별 설계와 시험 자료](../src/server/runs.ts) · [편집기 브라우저 시험](../tests/editor-contracts-browser.ts)

## 문서·Skill·MCP

| 작업 | 구현과 검증 |
|---|---|
| 자료 삭제·휴지통 | `asset.deleteImpact`는 삭제할 자료를 초안이나 저장 버전에서 직접 참조하는 내 프로젝트의 제목을 반환합니다. 휴지통의 프로젝트는 조회 범위에서 제외합니다. `deleteAsset`은 원본 자료에 대한 접근과 공유를 차단합니다. `restoreAsset`은 자료 ID와 버전 이력을 유지한 채 비공개 상태로 복구합니다. 최신 버전이 2판인 자료를 복구한 뒤, 1판을 연결해 둔 설계가 계속 1판을 읽는지 확인하세요. [삭제 영향 조회](../src/server/projects.ts) · [자료 휴지통](../src/server/asset-trash.ts) · [공통 휴지통 화면](../src/ui/TrashList.tsx) · [자료판 복구·만료 시험](../tests/asset-trash.test.ts) |
| 자료판 본문과 카드 미리보기 | 사본에 직접 쓴 문서는 `config.content`에 있습니다. 자료함 문서를 연결한 블록은 `assetId`와 `version`으로 자료 버전을 참조합니다. `useMaterialPreviews`가 `asset.previews`를 요청하면 `documentPreviews`가 접근할 수 있는 해당 버전 본문의 앞 512자에서 첫 문장에 해당하는 부분을 반환합니다. 연결한 자료 블록의 속성에서 **고정할 자료 버전**을 1판, 2판 순서로 바꾸세요. 판을 바꿀 때마다 카드에 표시된 첫 문장과 **연결한 자료 원문 열기**로 연 본문의 첫 문장을 비교하세요. [미리보기 요청](../src/ui/editor/use-material-previews.ts) · [서버 자료 처리](../src/server/assets.ts) · [자료함 브라우저 시험](../tests/resource-library-browser.ts) |
| Skill 업로드와 모델 지침 | 자료함은 파일·폴더·ZIP을 받습니다. 서버의 `skillFiles`는 경로와 크기를 검사하고 `cleanPayload`는 `SKILL.md` 본문을 읽습니다. 새 실행을 시작하거나 프로젝트 버전을 저장·게시할 때 서버가 `pins`를 호출합니다. 연결한 Skill 버전에 스크립트 실행이 필수라고 표시돼 있으면 서버가 요청을 거절합니다. 사용할 수 있는 Skill의 `SKILL.md` 본문은 실행기의 `evaluate`가 AI 작업의 지침으로 전달합니다. [자료 등록 화면](../src/ui/ResourceLibrary.tsx) · [자료 검증](../src/server/assets.ts) · [블록 실행](../src/engine/operations.ts) · [부속 파일·필수 스크립트 시험](../tests/domain-assets.test.ts) · [모델 입력 시험](../tests/engine.test.ts) |
| 검색 자료집의 발행·인용 | `validateKnowledgePublication`은 게시 범위에서 원문을 읽을 수 있는지 검사합니다. `bindKnowledge`는 블록을 자료집에 연결하고 읽기 작업을 제공합니다. `authorizeKnowledgeHistory`는 기록 조회나 재개 시 이미 읽은 원문에 대한 권한을 다시 확인합니다. 자료집을 발행한 뒤 방문자 계정으로 검색해 발췌문이 보이는지 확인하세요. 검색을 마치고 회신을 기다리는 실행을 열어 둔 채 원문 소유자 계정에서 공유를 철회하세요. 다시 방문자 계정으로 회신해 요청이 거절되는지, 실행 기록에서도 발췌문이 사라졌는지 확인하세요. [자료집 저장·권한](../src/server/knowledge.ts) · [근거 판단 블록](../src/engine/operations.ts) · [검색 통합 시험](../tests/rag-integration.test.ts) |
| 도서관 예약 도구 | 도서관 서버의 `tools`와 `op`에서 입력 스키마와 처리를 맞추세요. 작업실 실행 서버의 기본 도구 목록 `builtin`, 읽기 전용 판정, 승인·영수증 처리도 확인하세요. 도서관 서버는 예약 변경과 처리 영수증을 한 DB 트랜잭션에 기록합니다. 예약을 저장한 뒤 응답만 유실되는 상황에서 같은 실행을 재시도해 예약이 한 건만 남는지 확인하세요. [도서관 서버](../src/mcp/server.ts) · [호출 어댑터](../src/server/mcp.ts) · [실행 서버](../src/server/runs.ts) · [도서관 MCP 통합 시험](../tests/engine-mcp.test.ts) |
| 외부 MCP의 등록·호출 권한 | `McpToolPicker`는 선택할 수 있는 도구를 표시합니다. `cleanPayload`는 로그인 계정의 내부 ID가 `STUDIO_ADMIN_IDS`에 있는지 확인합니다. `bindRunAssets`는 실행 전에 지정한 MCP 버전과 도구가 상위 역할의 허용 범위에 드는지 검사합니다. 호출 시에는 선택한 MCP 버전이 해당 도구를 허용하는지 다시 확인하고 `externalMcp`로 요청을 보냅니다. [선택 화면](../src/ui/editor/McpToolPicker.tsx) · [등록 검증](../src/server/assets.ts) · [사용 범위](../src/server/run-assets.ts) · [외부 호출](../src/server/mcp.ts) · [연결판·위임·승인 시험](../tests/sharing-releases.test.ts) |

## 프로젝트 권한·버전·공유·휴지통

`/api/studio`는 세션 쿠키로 요청한 계정을 확인합니다. 클라이언트는 `Project.mine` 값으로 소유자용 버튼을 표시합니다. 서버에서는 `owned`, `canProject`, `canReadProjectEdition`이 수정·열람·특정 버전 접근을 검사합니다. 권한 검사 코드를 바꿀 때는 소유자와 방문자로 같은 API를 호출해 각각 기대한 응답이 나오는지 확인하세요. [화면 데이터 타입](../src/ui/studio-project.ts) · [세션](../src/server/auth.ts) · [API 동작 목록](../src/app/api/studio/route.ts) · [프로젝트 접근 검사](../src/server/projects.ts)

| 작업 | 코드에서 확인할 동작 |
|---|---|
| 버전 선택·저장·복원·게시 | 버전 패널을 열면 최신 저장 버전이 선택됩니다. 목록이나 프로젝트 메뉴에서 공유 설정을 바로 열면 현재 게시 버전을, 게시 버전이 없으면 최신 저장 버전을 선택합니다. 버전 패널에서 공유 설정으로 이동할 때는 이미 고른 대상 버전을 이어서 사용합니다. 서버에서 `versions.save`의 `snapshot`은 현재 초안을 저장하고 자료의 참조 버전을 고정합니다. `versions.restore`의 `restore`는 선택한 버전을 초안으로 복원합니다. `versions.publish`의 `publish`는 공유 주소에서 사용할 버전과 범위를 갱신합니다. 다른 탭에서 먼저 저장한 뒤 이전 리비전으로 복원 요청을 보내면 409가 반환되는지, 초안을 복원한 뒤 공유 주소에서 새로 시작한 대화가 기존 게시 버전을 사용하는지 확인하세요. [버전·공유 패널](../src/ui/ProjectVersionPanel.tsx) · [서버 처리](../src/server/projects.ts) · [복원 충돌·공유 화면 시험](../tests/browser-smoke.ts) · [새 대화·기존 대화 시험](../tests/sharing-releases.test.ts) |
| 게시 판단 실습 | **규정 변경 검증·게시·복구** 템플릿에서 새 실습 사본을 만들면 `createProject`가 기준 버전과 후보 버전, 시험 사례 세 개를 준비합니다. `ReleaseDecisionForm`에서 판단을 입력하면 패널의 `recordDecision`이 `versions.decide`를 보냅니다. `decideRelease`는 요청에 포함된 직전 판단 번호와 게시 상태가 서버의 현재 값과 일치하는지 확인합니다. 판단 기록과 게시 변경은 한 트랜잭션에 저장합니다. [실습 정의](../src/domain/templates.ts) · [판단 양식](../src/ui/ReleaseDecisionForm.tsx) · [서버 처리](../src/server/projects.ts) · [보류·유지·게시·복구 시험](../tests/release-exercise.test.ts) |
| 비밀 링크 철회·사본 만들기 | `openProject`는 유효한 비밀 링크로 연 사용자에게 프로젝트 접근 권한을 기록합니다. `revoke`는 비공개로 전환하며 토큰을 교체합니다. `projectCopy`는 자료와 하위 Workflow를 별도 사본에 담습니다. 철회한 주소로 프로젝트를 열거나 기존 대화의 대기 요청에 회신하면 거절되는지 확인하세요. 방문자가 `run.get`에 자신의 이전 실행 ID만 보내면 답변(`output`)과 이벤트 목록(`events`)이 비어 있어야 합니다. 철회 전에 만든 독립 사본은 계속 열고 실행할 수 있어야 합니다. [공유·복사](../src/server/projects.ts) · [하위 Workflow 참조](../src/server/workflow-refs.ts) · [공유 시험](../tests/sharing-releases.test.ts) · [두 브라우저 시험](../tests/browser-smoke.ts) |
| 삭제·휴지통 복구·영구 삭제 | `project.delete`의 `deleteProject`는 진행 중이거나 대기 중인 실행을 중지하고 공유와 자동 시작을 해제합니다. `project.restore`는 프로젝트를 비공개로 복구합니다. 선택 항목을 영구 삭제할 때 `purgeTrashedProjects`가 소유자와 각 항목의 리비전을 확인합니다. 삭제 후 72시간이 지나면 복구할 수 없습니다. 워커 정리와 휴지통 조회에서 만료된 프로젝트를 영구 삭제합니다. [휴지통 화면](../src/ui/ProjectTrash.tsx) · [삭제·복구](../src/server/projects.ts) · [연관 데이터 정리](../src/server/project-purge.ts) · [워커 정리 작업](../src/server/worker.ts) · [삭제·복구 시험](../tests/project-deletion.test.ts) · [보관 기한·일괄 삭제 시험](../tests/project-purge.test.ts) |

표에 있는 `*.test.ts` 파일만 실행할 때는 개발자 가이드의 예제를 따르세요. 브라우저 시험은 `pnpm test:browser`, 실제 모델 시험은 `pnpm test:live`로 실행하세요. 특정 실습만 실제 모델로 시험하는 방법은 [검증 기록의 재현 명령](VERIFICATION.md#reproduction-commands)에 있습니다. [시험 파일 지정 예제](DEVELOPER_GUIDE.ko.md#verify-changes) · [전체 검증 명령](../README.md#verification)
