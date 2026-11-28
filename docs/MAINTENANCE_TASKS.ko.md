# 기능별 유지보수 가이드

개발 환경과 실행 흐름은 [개발자 가이드](DEVELOPER_GUIDE.ko.md)에 있습니다. 아래에서 바꾸려는 동작을 찾아 담당 함수와 그 동작을 재현하는 시험을 함께 열어 보세요.

## 블록·포트·예제 템플릿

**웹 개발 입문·초급·중급**은 독립 화면과 작업실에 같은 반납 목록 및 단건 수신 기록을 입력한다. 목록을 고쳐 새로 만든 뒤 이전 결과가 섞이지 않는지 확인하고, 대상 이외 장비의 승인 값이나 이력의 알림 ID만 바꾼 기록으로 중급 검증이 실패하는지 확인한다. ZIP의 README에서 여는 실습 단계와 담당자의 원본 Skill도 사본과 일치해야 한다. [실습 정의](../src/domain/equipment-inspection-starter-templates.ts) · [단건 수신과 검증](../src/domain/inspection-starters.mjs) · [Windows 브라우저 시험](../tests/equipment-inspection-starters-browser.ts)

**웹 개발 → 검수 알림이 뒤늦게 오거나 다시 오면 무엇이 남아야 할까?**의 독립 HTML과 ZIP의 HTTP 수신기는 같은 장비 상태와 처리 이력 규칙을 사용합니다. 두 입력 문서와 장비를 바꾸고 세 시나리오를 독립적으로 실행하세요. 저장 전 실패와 응답 유실은 첫 시도 직후의 이력 건수로 구별합니다. 실습을 다시 실행하면 원래 점검 Skill의 개별 조항이 보존되고 복구 점검 절은 한 번만 들어가야 합니다. [전문가 실습 정의](../src/domain/equipment-inspection-recovery-template.ts) · [공통 처리 규칙](../src/domain/inspection-recovery.mjs) · [HTTP 재전송 시험](../src/domain/inspection-recovery-webhook.test.mjs) · [작업실 시험](../tests/equipment-inspection-recovery-catalog-browser.ts)

**웹 개발 → 검수가 끝나면 장비 반납 목록은 어떻게 바뀔까?**는 독립 HTML과 ZIP의 로컬 HTTP 수신기가 같은 검수 처리 코드를 사용합니다. 학습자 화면에서 같은 알림을 두 번 입력하고, 장비 세 대의 검수·재대여 상태와 수신 두 건·이력 한 건을 대조하세요. 템플릿을 바꿀 때는 검증 기록이 여섯 담당에게 전달되고 결과 파일 두 개를 받을 수 있는지도 확인하세요. [실습 정의](../src/domain/equipment-inspection-web-template.ts) · [공통 처리 코드](../src/domain/inspection-receiver.mjs) · [원본 패키지 검증](../tests/equipment-inspection-skills.test.ts) · [Windows 브라우저 시험](../tests/equipment-inspection-example-browser.ts)

**업무 용어와 판단 기준 정리**의 입문·초급은 사용자가 실습 간에 결과 본문을 직접 옮깁니다. 기본 예시와 다른 창구 기록을 넣고, 초급의 두 번째 답변에서 수신인이나 질문 순서를 바꾸세요. 원문 표현과 변경한 우선순위가 최종 Markdown과 중급의 담당자 질문지까지 이어지는지 확인하세요. [두 실습 정의](../src/domain/equipment-return-starter-templates.ts) · [실행과 답변 검증](../tests/equipment-return-starters.test.ts) · [브라우저 시험](../tests/equipment-return-starters-browser.ts)

전문가 **재대여 기준을 합의하면 어떤 판정이 달라질까?**는 중급 문서 두 개, 고급 최종 판정표, 새 장비 사례를 별도 입력으로 받습니다. 고급에서 미확정으로 남긴 항목 중 정책에 관한 질문만 만들고, 담당자가 한 장비에만 허용한 예외는 해당 장비에만 적용하는지 확인하세요. 재대여 조건이 이미 확정됐을 때는 원래 문서 두 개가 그대로 전달되고 같은 기준으로 기존·신규 판정표가 작성돼야 합니다. [전문가 실습 정의](../src/domain/equipment-relending-agreement-template.ts) · [회신과 재판정 시험](../tests/equipment-relending-agreement.test.ts) · [브라우저 시험](../tests/equipment-relending-agreement-browser.ts)

고급 **이 장비는 반납 완료일까, 다시 물어봐야 할까?**는 같은 주제의 중급에서 만든 문서 두 개를 별도의 필수 입력으로 받습니다. 중급 문서의 줄바꿈이 유지되는지, 이미 판정한 항목이 재질문에 섞이지 않는지 확인하세요. 미확정 목록이 비면 회신 대기 없이 최종 판정표를 전달합니다. 회신 경로에서는 한 장비에 대한 답과 여러 장비에 적용할 규칙을 구별하고, 부분 회신 뒤에도 최초 판정과 근거를 읽을 수 있어야 합니다. [고급 실습 정의](../src/domain/equipment-return-cases-template.ts) · [분기와 회신 시험](../tests/equipment-return-cases.test.ts)

중급 **장비를 돌려받으면 반납이 끝난 걸까?**는 질문지 작성 후 회신 양식에서 대기합니다. 대기 화면의 **질문지 내려받기**와 완료 후 같은 이름의 결과 파일에 동일한 원문이 들어가는지 확인하세요. 충전기가 빠져도 다음 대여가 가능한지 정하지 않은 회신과, 재대여 보류를 명시한 회신을 각각 입력해 규칙표를 대조하세요. [장비 반납 실습](../src/domain/equipment-return-template.ts) · [회신별 실행 시험](../tests/equipment-return.test.ts) · [작업실과 ZIP 시험](../tests/equipment-return-browser.ts)

전문가 **리뷰 지적을 고치고 다시 검증하기**는 고급의 원래 기준과 두 축의 검토 결과를 입력받습니다. 수정 범위 회신 후 같은 수정 기록이 두 재검토 담당에게 전달되는지, 한쪽의 미검증 지적과 양쪽의 지적 없음이 구별되는지 확인하세요. [전문가 실습 정의](../src/domain/web-design-review-followup-template.ts) · [후속 수정 실행 시험](../tests/web-design-review-followup.test.ts)

고급 **개선 기준을 테스트로 옮겨 화면 고치기**는 처음 입력한 개선 기준과 사용자가 회신한 테스트 범위를 개발 단계에 전달합니다. 개발 기록을 받은 두 검토 담당이 병렬로 실행되고, 최종 답변에서 각각의 판정을 읽을 수 있어야 합니다. 내보내기 지침을 바꿀 때는 실패와 통과가 같은 테스트에서 관찰됐는지, 두 담당자가 같은 변경을 읽었는지 확인하세요. [고급 실습 정의](../src/domain/web-design-tdd-review-template.ts) · [단계별 실행 시험](../tests/web-design-tdd-review.test.ts) · [실제 프로젝트 작업 지침](../src/domain/web-project-work.ts)

예제 템플릿을 추가할 때는 실습의 `level`과 `topic`을 함께 지정하세요. 목록에서 **실습 수준**과 **실습 주제**를 차례로 선택해 새 실습이 표시되는지 확인하세요. 주제 선택지는 `lessonTopics`에서 관리합니다. [실습 타입과 선택지](../src/domain/types.ts) · [템플릿 목록 브라우저 시험](../tests/home-lesson-browser.ts)

웹 디자인 개선 예제의 필터나 데이터를 바꾸면 내려받는 HTML과 코드 발췌의 공통 원본을 고치고, 고급 **한 화면을 여러 Agent로 개선하기**의 **주문 목록 동작 설명**도 실제 화면과 대조하세요. 이 실습은 설명 하나를 네 담당자의 참고 자료에 연결합니다. 설명을 편집한 뒤 네 역할이 새 본문을 받는지, 개발자가 두 검토 의견을 받아 다음 단계로 넘기는지 확인하세요. [주문 관리 예제 원본](../src/domain/web-design-example.ts) · [입문~중급](../src/domain/web-design-starter-templates.ts) · [고급 한 화면 협업](../src/domain/web-design-single-screen-template.ts) · [한 화면 실행 시험](../tests/web-design-single-screen.test.ts) · [공통 UI·단계별 개편](../src/domain/web-design-team-templates.ts)

중급 **질문으로 화면 개선 기준 정하기**는 요구사항 확인 담당의 출력을 회신 양식에 표시합니다. 사용자가 답하면 용어 정리 담당에게 최초 요청, 확인 질문, 사용자 답변, 화면 동작 설명이 전달됩니다. 이 흐름을 수정할 때는 서로 다른 답변으로 같은 예시를 실행해 개선 기준이 달라지는지 확인하세요. [질문 실습 정의](../src/domain/web-design-questions-template.ts) · [질문·회신 실행 시험](../tests/web-design-questions.test.ts)

한국어 실습 지침과 원본 Skill의 역할별 연결은 템플릿에서 관리합니다. 예제 사본을 만들면 서버가 해당 템플릿이 참조한 원본 패키지를 소유자의 자료판에 연결합니다. 원본 패키지의 파일 구성이 바뀌면 서버에서 읽는 파일 목록과 ZIP의 바이트 대조 시험을 함께 확인하세요. 예전 사본은 저장 당시의 연결과 지침으로 열립니다. [템플릿의 역할별 Skill 연결](../src/domain/lesson-skills.ts) · [원본 자료판 설치](../src/server/lesson-original-skills.ts) · [사본·ZIP 시험](../tests/agent-export-data.test.ts)

웹 디자인 템플릿의 해당 작업 블록에서 **속성 → 고급 설정 → 내보낸 Agent의 프로젝트 작업**을 바꾸면 ZIP에서 대표 Agent가 맡을 조사·수정·검증 범위가 달라집니다. 작업실 시험은 연결된 자료와 코드 예시를 사용합니다. [코딩 도구의 작업 정의](../src/domain/web-project-work.ts) · [템플릿 사본·ZIP 브라우저 시험](../tests/web-design-catalog-browser.ts) · [수준별 실제 모델 시험](../tests/live-web-design.ts)

| 바꾸려는 것 | 구현과 확인할 동작 |
|---|---|
| 블록 이름, 속성, 기본값, 추천 수준 | 제작 메뉴 항목은 `palette`, 추천 수준은 블록 정의의 `level`에서 확인하세요. 여러 실행 방식이 한 메뉴에 속하면 같은 `menuType`을 사용합니다. `modes`에 실행 방식 선택지가 있습니다. `createBlock`은 새 블록에 정의된 속성 기본값을 적용합니다. [블록 정의](../src/domain/catalog.ts) · [블록 생성](../src/domain/graph.ts) · [메뉴·기존 설계 시험](../tests/domain.test.ts) |
| 분기와 포트 연결 규칙 | `portsFor`는 블록 설정에 따라 입출력 포트를 만듭니다. `connectionOptions`는 연결 가능한 포트 조합을 찾습니다. `connectBlocks`는 출발·도착 블록 ID와 연결 종류(`kind`), 출발 포트(`out`), 도착 포트(`input`)를 담은 연결 배열을 반환합니다. 편집기의 `connect`는 반환된 연결을 `graph.edges`에 추가합니다. 사용자가 분류 이름을 ‘미분류’로 정해도 기본 ‘미분류’와 포트 ID가 달라야 합니다. [포트 정의](../src/domain/catalog.ts) · [그래프 타입](../src/domain/types.ts) · [연결·검증](../src/domain/graph.ts) · [편집기의 연결 처리](../src/ui/editor/Editor.tsx) · [포트 시험](../tests/domain.test.ts) |
| 블록의 실행 결과와 다음 실행 경로 | `evaluate`에서 블록의 입력·출력 값과 실행 결과에 따라 선택하는 포트를 확인하세요. 새 시작·참조·종료 유형을 추가하면 `executeGraph`가 실행할 노드를 고르는 조건도 확인합니다. 이전 형식의 설계 JSON을 가져올 때는 `migrateGraph`가 변환합니다. [블록 실행](../src/engine/operations.ts) · [실행 순서](../src/engine/index.ts) · [이전 설계 변환](../src/domain/graph.ts) · [실행 결과 시험](../tests/engine.test.ts) |
| 실습의 원문, 그래프, 시험 질문 | `templates`에서 실습 ID를 찾아 `graph`, `question`, `steps`, `checks`를 함께 보세요. `createProject`는 새 사본에 그래프를 복제합니다. `projectLesson`은 이전 사본의 설계를 보고 그 사본에서 수행할 수 있는 실습 안내를 적용합니다. 도서관 초급 템플릿 **내 자료로 안내하기**를 수정했다면 새 사본에서 `대출안내.txt`를 내려받아 화면의 답변·인용과 대조하세요. 파일 생성 블록이 없는 이전 사본에서는 수정 전후의 답변과 인용을 화면에서 비교하세요. [실습 정의](../src/domain/templates.ts) · [사본 생성](../src/server/projects.ts) · [기존 사본 안내](../src/ui/Studio.tsx) · [실제 모델 실습 시험](../tests/live-service.ts) |

## 캔버스와 편집기

**Agent ZIP에서 자료나 단계가 빠집니다.** 편집기의 **Agent 내보내기 → ZIP 내려받기**로 받은 파일을 열어 `AGENTS.md`에서 단계별 입력·분기·승인 조건과 자료 경로를 확인하세요. `project.exportPreview`는 현재 캔버스에서 자료의 버전과 사용 위치를 찾습니다. `project.exportAgent`는 다운로드 시 선택한 자료의 권한과 버전을 다시 확인합니다. 선택 자료의 원본 크기 합계는 중복을 제외하고 32 MiB까지입니다. Skill 원문과 부속 파일은 `.agents/skills/<id>/`에 있고, Claude Code는 `.claude/skills/<id>/SKILL.md`에서 원문을 참조합니다. [자료 선택 화면](../src/ui/editor/AgentExportDialog.tsx) · [자료 확인](../src/server/agent-export.ts) · [Skill 경로 생성](../src/server/agent-skill-export.ts) · [ZIP 시험](../tests/agent-zip.test.ts)

**같은 하위 설계를 여러 곳에서 호출합니다.** 각 호출의 저장판이 같으면 ZIP에는 `workflow/edition-*.md` 한 벌이 들어갑니다. 다른 판을 지정하면 별도 지침을 사용합니다. 단계 호출의 결과는 그 호출의 다음 경로로, Agent가 도구로 호출한 결과는 해당 Agent의 다음 판단으로 돌아갑니다. 고유한 단계를 펼쳐도 깊이·크기 한도를 넘는 호출은 **실행 준비**와 README에서 확인하세요. [저장판 확인](../src/server/workflow-refs.ts) · [호출·복귀 시험](../tests/agent-export-shared-editions.test.ts)

**근거 있음 경로에서 어떤 원문을 대조했는지 확인합니다.** **원문 대조 필수** 단계와 원문 근거를 요구하는 동적 배정은 채택한 인용의 판을 먼저 확인합니다. 판이 비어 있으면 **판 번호**에 회신하고, 같은 판의 연결 원문이 없으면 요청받은 파일을 첨부하세요. 같은 실행에서 판·행·인용과 연결 또는 회신 원문 표시를 확인할 수 있습니다. [근거 판정](../src/engine/evidence.ts) · [원문 회신 시험](../tests/evidence-original.test.ts)

자료 검색 결과의 `version`은 원문 판이고, 자료집에서 찾은 결과의 `indexVersion`은 색인 판입니다. 예를 들어 1판 문서를 자료집 7판에 색인하면 두 값은 각각 `"1"`, `"7"`입니다. `assetId`는 자료함에 등록한 원문에 있습니다. 같은 원문에서 같은 행과 인용을 두 번 찾으면 한 후보로 세고, LF·CRLF·CR로 나뉜 행의 번호는 1부터 셉니다. 발행할 때는 색인한 스냅숏의 원문을, 철회할 때는 현재 발행 중인 원문을 확인하세요. [검색·원문 대조 시험](../tests/evidence-original.test.ts) · [원문 선택·발행판 시험](../tests/agent-export-data.test.ts)

**Agent 내보내기**에서 같은 이름의 자료는 체크 항목의 단계 번호로 구분합니다. 같은 프로젝트에서 이름과 상대경로가 고유한 파일을 함께 담으면 `Guide.md`에서 `appendix.md` 같은 문서 링크를 열 수 있습니다. 필요한 링크 대상이 빠졌다면 **실행 준비**에서 사용할 단계와 경로를 확인하세요. 같은 설계를 다시 내보낼 때 Skill의 폴더 이름은 선택을 바꿔도 유지됩니다. [자료 배치와 링크 확인](../src/server/agent-material-files.ts) · [자료 선택·다운로드 시험](../tests/agent-export-browser.ts)

**압축을 푼 뒤 실행을 재개할 때** 대표와 하위 역할이 한 실행 기록에서 모델 호출 수와 동시 실행 자리를 관리하는지 확인하세요. 민감정보를 가리거나 차단했다면 양식·변환으로 저장한 값, 원래 질문과 이전 답변도 처리된 상태로 다음 모델에 전달해야 합니다. [ZIP 한도 시험](../tests/agent-budget-export.test.ts) · [워커의 문답·재개 시험](../tests/model-history-privacy.test.ts)

**초안에서 빠진 단계나 실행 환경 확인하기.** **Agent 내보내기**에서 **실행 준비**를 열고 단계·준비할 내용·이유를 확인하세요. **ZIP 내려받기**로 받은 단일 지침·분할 단계·위임 역할에는 최종 선택에 맞춰 `README.md`의 해당 준비 항목으로 가는 링크가 생깁니다. 준비 항목은 내보낸 설계 안의 단계 위치로 연결하므로 이름이 같은 하위 작업도 구분됩니다. 회신을 기다리는 병렬 경로는 합류 시 대기하고, 준비할 수 없다고 확인된 경우에는 설계한 실패 정책을 따릅니다. [설계·환경 검사](../src/domain/export-design-preparation.ts) · [연결 자료별 준비](../src/domain/export-resource-preparation.ts) · [단계별 준비 시험](../tests/agent-stage-preparation-export.test.ts)

**받은 ZIP에서 만든 결과 파일 찾기.** 후속 단계는 메모리에서 생성한 파일명·형식·본문을 받습니다. 전체 실행이 성공하면 최종 답변에 전달된 생성 파일만 처리된 이름과 본문으로 `outputs/`에 저장합니다. 서로 다른 호출의 파일은 이름이 같아도 각각 저장하며 확장자 앞에 번호를 붙입니다. [결과 저장 지침](../src/server/agent-output-instructions.ts) · [ZIP 지침 시험](../tests/agent-output-export.test.ts) · [구조화 입력과 파일 전달 시험](../tests/structured-file-privacy.test.ts)

**큰 설계에서 특정 단계 찾기.** 내보내기는 먼저 전체 지침의 UTF-8 바이트와 빈 줄을 포함한 줄 수를 계산합니다. 16 KiB 또는 200줄을 초과하면 `AGENTS.md`에 시작점과 분기·승인 안내를 두고, 각 블록의 지침을 `workflow/step-*.md`에 기록합니다. 단계 파일의 실행 경로는 다음 블록으로, 값·자료 연결은 입력을 제공하는 블록으로 이어집니다. 하위 설계는 호출 단계에서 시작 링크를 확인하세요. 연결되지 않은 블록도 `workflow/index.md`에서 찾을 수 있습니다. 한 역할의 원문이 같은 기준을 넘으면 `agents/`의 역할 파일에서 작업 번호를 골라 `workflow/assignment-step-*.md`의 배정을 엽니다. [분리 기준과 단계 링크](../src/server/agent-instruction-layout.ts) · [역할별 배정 문서](../src/server/agent-delegation.ts)

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
