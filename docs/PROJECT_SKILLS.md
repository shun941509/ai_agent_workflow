# Workflow Studio 스킬 활용표

프로젝트를 개발하면서 Codex에서 쓸 스킬은 아래 표에서 고른다. 작업실 이용자가 직접 만든 Agent에 지침을 연결하는 방법은 [작업실 Agent에 지침 연결하기](#workspace-agent-skills)에 있다.

<a id="development-skills"></a>

## 개발할 때 무엇을 쓸까

| 요청 | 추천 스킬 | 이 프로젝트에서 확인할 것 |
|---|---|---|
| 블록을 합칠지, 어느 수준부터 추천할지 함께 결정하기 | [grilling](../.agents/skills/grilling/SKILL.md)을 `$grilling`으로 요청한다. 프로젝트에 설치된 [grill-me](../.agents/skills/grill-me/SKILL.md)도 `grilling`을 호출한다. 스킬 목록에 `mattpocock-skills:grill-me`처럼 플러그인 이름이 붙어 있으면 표시된 항목을 고른다. | [블록 가이드](WORKFLOW_BLOCK_GUIDE.md)에서 두 블록의 입력·출력·종료 상태를 비교한다. 같은 입력에서 두 블록의 결과가 달라지는 예를 보여 주고, 합쳤을 때 어떤 동작을 유지할지 묻는다. |
| Agent·하위 Agent·팀의 개념이나 블록 이름 정리하기 | [domain-modeling](../.agents/skills/domain-modeling/SKILL.md) | [도메인 정의](../src/domain/catalog.ts)의 용어가 편집기 속성과 템플릿 안내에서 같은 뜻으로 쓰이는지 확인한다. 설계 질문과 용어 기록을 함께 원하면 스킬 목록에서 [grill-with-docs](../.agents/skills/grill-with-docs/SKILL.md)를 고른다. 프로젝트에 설치된 이 스킬은 `grilling`과 `domain-modeling`을 차례로 호출한다. 목록에서 찾기 어려우면 `$grilling`과 `$domain-modeling`을 함께 요청한다. |
| 캔버스·블록·연결선·속성 패널 개선하기 | [frontend-design](../.agents/skills/frontend-design/SKILL.md) · 배치를 먼저 비교할 때 [prototype](../.agents/skills/prototype/SKILL.md) | PC에서 동료 검토 실습의 각 초안이 어느 검토자에게 전달되는지 [편집기](../src/ui/editor)의 연결선을 따라 확인한다. **목록으로 편집**에서도 키보드로 같은 속성을 바꿀 수 있는지 살핀다. |
| 예제 템플릿을 추가하거나 완료 기준을 변경하기 | [tdd](../.agents/skills/tdd/SKILL.md) | [템플릿](../src/domain/templates.ts)마다 시험 질문과 기대 결과를 함께 정한다. 도서관 초급 실습 **내 자료로 안내하기**에서는 대출 한도를 3권에서 5권으로 바꾼 뒤 화면과 내려받은 파일에 같은 답변과 인용이 담겼는지 확인한다. 실제 모델로 결과를 확인할 때는 [실습별 시험](../tests/live-service.ts)을 쓴다. |
| 도서관 MCP에 새 도구 추가하기 | [mcp-builder](../.agents/skills/mcp-builder/SKILL.md) | [도서관 서버](../src/mcp/server.ts)에 도구의 입력 형식과 처리 결과를 정의한다. [실행 서버](../src/server/runs.ts)에서 호출을 허용할 도구 목록과 승인 필요 여부를 확인한다. 예를 들어 예약 생성을 승인한 뒤 같은 요청을 재시도해도 예약이 한 건만 생기는지 확인한다. |
| 실행이 멈추거나 인용·공유 버전이 예상과 다를 때 | [diagnosing-bugs](../.agents/skills/diagnosing-bugs/SKILL.md) | 문제가 발생했을 때와 같은 질문과 자료 버전을 사용한다. 새 대화에서 시작했는지 기존 대화를 이어 갔는지도 맞춘다. 실제 결과가 예상과 처음 달라지는 블록을 찾아 수정한 뒤 같은 조건으로 다시 실행한다. |
| 화면·API·저장소에 걸친 기능을 수정할 때 | [codebase-design](../.agents/skills/codebase-design/SKILL.md) · [tdd](../.agents/skills/tdd/SKILL.md) | 자료 휴지통처럼 여러 계층을 지나는 기능은 화면에서 권한 검사와 저장까지 추적한다. 자료를 복구한 뒤 기존 Workflow가 삭제 전에 연결해 둔 자료 버전을 다시 읽는지도 확인한다. [기능별 수정 위치와 테스트](MAINTENANCE_TASKS.ko.md) |
| 개인 Agent가 참고할 사용자·동료 프로필을 만들거나 갱신할 때 | [distilly](../.agents/skills/distilly/SKILL.md) | 본인의 선호와 작업 방식을 정리할 때는 소유자 프로필(`owner`) 절차를 따른다. 동료 프로필을 처음 만들 때는 `create`, 기존 동료 프로필에 새 자료나 정정 사항을 반영할 때는 `evolve` 절차를 따른다. |
| 변경 결과 검증하기 | [verification-before-completion](../.agents/skills/verification-before-completion/SKILL.md) | 실행·저장, 화면 조작, 실제 모델 응답 중 이번 변경에서 확인할 동작을 정하고 그에 맞는 시험을 고른다. [프로젝트 검증 명령](../README.md#verification) |
| GitHub PR의 Actions 검사가 실패했을 때 | 사용자 스킬 `$gh-fix-ci` | 해당 PR에서 실패한 GitHub Actions 검사를 찾고, 작업 로그를 열어 어느 단계가 실패했는지 확인한다. |

“어느 담당자가 어떤 초안을 고쳤는지 연결선으로 파악하기 어렵습니다”라는 요청은 편집기 디자인부터 살핀다. 같은 화면이라도 “한 담당자의 교정 근거가 최종 답변에서 사라집니다”라는 제보는 실행 기록부터 확인한다.

<a id="agents-and-plugins"></a>

## 하위 Agent와 플러그인 선택

독립적으로 조사하거나 검증할 일이 있으면 아래 표에서 역할을 고른다. [역할 정의 폴더](../.codex/agents)에서 해당 TOML 파일의 지침(`developer_instructions`)과 권한(`sandbox_mode`)을 확인한다. 세션에서 그 역할을 선택할 수 있으면 담당 범위와 확인할 결과를 알려 준다. 일반 하위 Agent만 사용할 수 있으면 역할 지침도 함께 전달한다. 읽기 전용 역할에는 조사와 검토를 맡긴다.

| 작업 | 하위 Agent에 맡길 일 | 플러그인이 도움이 되는 경우 |
|---|---|---|
| Workflow 편집기 UI | [frontend-developer](../.codex/agents/frontend-developer.toml)가 PC 화면을 구현한다. [anti-ui-slop-reviewer](../.codex/agents/anti-ui-slop-reviewer.toml)는 블록·연결선에서 실행 순서를 읽을 수 있는지, [accessibility-tester](../.codex/agents/accessibility-tester.toml)는 키보드만으로 같은 작업을 마칠 수 있는지 검토한다. | **Figma**에 시안이 있으면 배치와 상태를 대조한다. **Build Web Apps**의 프런트엔드 테스트 스킬은 PC 브라우저에서 화면 문제를 재현할 때 쓴다. |
| 예제 템플릿·모델 응답 | [eval-engineer](../.codex/agents/eval-engineer.toml)가 실습 완료 기준을 정리한다. [prompt-regression-tester](../.codex/agents/prompt-regression-tester.toml)가 인용·도구 선택·실패 처리의 회귀 사례를 설계하고, [test-automator](../.codex/agents/test-automator.toml)가 이를 자동 테스트로 작성한다. | 모델 응답 차이가 OpenAI API 연동에서 발생하면 **OpenAI Developers**의 API 진단 스킬을 사용한다. |
| MCP 도구·자료 연결 | [mcp-developer](../.codex/agents/mcp-developer.toml)가 도구의 입력·출력과 허용 범위를 확인하고, 재시도했을 때 예약이 한 건만 생성되는지 검증한다. | 사용하는 SDK 버전의 API를 확인할 때 **Context7**에서 해당 라이브러리 문서를 조회한다. |
| 풀스택 기능·실행 오류 | [code-mapper](../.codex/agents/code-mapper.toml)는 화면에서 API와 SQLite까지의 호출 경로를 추적한다. [debugger](../.codex/agents/debugger.toml)는 실제 동작이 예상과 처음 달라지는 단계를 찾는다. 화면과 서버에 걸친 수정은 [fullstack-developer](../.codex/agents/fullstack-developer.toml), Next.js 라우팅·렌더링 수정은 [nextjs-developer](../.codex/agents/nextjs-developer.toml)에 맡긴다. | Next.js 동작은 먼저 프로젝트에 설치된 버전의 가이드를 읽는다. 다른 라이브러리의 사용법이 필요하면 **Context7**을 쓴다. |
| 코드 리뷰·PR 검사 | [code-reviewer](../.codex/agents/code-reviewer.toml)가 변경 경로의 회귀 위험과 빠진 테스트를 찾는다. | 대상 저장소와 PR이 있으면 **GitHub**에서 변경 사항과 검사 결과를 확인하고, 실패한 Actions 작업은 `gh-fix-ci`로 조사한다. |

2026-11-22 설치 확인 시 `codex plugin list --json`에서 설치·활성으로 표시된 항목은 52개였다. `visualize`가 두 출처에 있어 패키지 이름은 51종이다. 새 대화에서는 필요한 플러그인이 현재 도구나 스킬 목록에 보이는지 확인한다. GitHub 저장소나 Figma 파일을 다룰 때는 대상에 대한 계정 접근 권한도 확인한다.

<a id="workspace-agent-skills"></a>

## 작업실 Agent에 지침 연결하기

**웹 개발** 입문은 `frontend-design`으로 반납 목록에서 장비 번호·검수 상태·재대여 승인을 읽는 방식을 검토한다. 초급은 Hookdeck의 `webhook-handler-patterns`로 검수 알림 한 건과 그 알림이 남긴 처리 이력을 연결한다. 중급은 Superpowers의 `test-driven-development`로 수신 전후에 관찰할 값과 확인 결과를 대조한다. 실습마다 해당 원본 Skill을 담당 Agent에 연결하며, **내 사본으로 시작**과 Agent ZIP에서도 그 원문을 열 수 있다. [입문·초급·중급 사용법](../README.md#웹-개발-입문부터-중급까지-검수-알림-한-건-따라가기)

**웹 개발** 고급 실습은 여섯 원본 Skill을 담당별로 연결한다. 문서 담당은 `find-docs`, 디자인 담당은 `frontend-design`, 개발 담당은 `test-driven-development`, UI 담당은 `web-artifacts-builder`, 백엔드 담당은 `webhook-handler-patterns`, 도구 제작 담당은 `skill-creator`를 읽는다. 학습자는 검수 알림을 두 번 입력한 실제 기록을 여섯 역할에 제공한다. ZIP에서는 각 역할의 지침과 부속 파일을 열 수 있다. [검수 알림 실습](../README.md#웹-개발-실습에서-검수-알림을-두-번-보내기)

같은 주제의 전문가 실습에서는 고급 보고서와 학습자가 사용한 점검 Skill 본문을 직접 입력한다. 개발·백엔드 담당은 장비별 변경 순번과 저장 시점을 기준으로 여섯 번의 시도를 대조한다. 도구 제작 담당은 고급 점검 절차에 역순 도착과 재전송 확인 방법을 추가한다. 독립 실습 화면에서도 세 상황을 재현해 보고서와 갱신된 Skill을 받을 수 있다. [전문가 실습 사용법](../README.md#전문가-실습에서-역순-도착과-실패-후-재전송-확인하기)

**업무 용어와 판단 기준 정리**의 입문 예제는 메모 작성 단계에 Matt Pocock의 `domain-modeling` 원본을 연결한다. 초급의 첫 질문, 답변 확인, 담당자 질문 정리 단계는 `grilling` 원본을 함께 읽는다. 학습자가 먼저 확인하고 싶은 일과 수신인을 답하면 다음 질문과 중급에 전달할 본문이 그 답을 반영한다. [입문·초급 실습 사용법](../README.md#입문과-초급에서-담당자-확인-질문-준비하기)

**업무 용어와 판단 기준 정리**의 중급 예제에서는 질문지 작성 담당에게 Matt Pocock의 `to-questionnaire` 원본을 연결한다. 장비 담당자 회신이 도착하면 용어 정리 담당이 `domain-modeling` 원본을 사용해 확인된 용어와 판단 규칙을 정리한다. 다시 빌려줄 수 있는지 답변이 없다면 그 판단은 미확정으로 남긴다. [실습 사용법](../README.md#업무-용어와-판단-기준-정리)

같은 주제의 고급 예제에서는 사례 판정 담당과 회신 반영 담당이 `domain-modeling` 원본을 공유한다. 앞 담당자는 용어집과 판단 규칙표를 개별 사례에 적용하고, 뒤 담당자는 새로 확인한 사실과 공통 규칙이 각각 어느 사례에 적용되는지 확인한다. 미확정 항목이 있을 때만 재질문 담당이 `to-questionnaire` 원본으로 장비 담당자에게 전달할 질문지를 만든다. [고급 실습 사용법](../README.md#고급-실습에서-여러-반납-사례-판정하기)

전문가 예제에서는 합의 질문 담당이 `to-questionnaire` 원본으로 고급 판정표에서 남은 재대여 기준을 추려 담당자에게 묻는다. 기준 갱신 담당은 `domain-modeling` 원본으로 회신에서 합의된 뜻과 적용 조건을 각각 용어집과 판단 규칙표에 기록한다. 사례 재판정 담당도 같은 원본을 사용하며, 갱신한 두 문서의 조건을 기존 장비와 새 장비의 사실에 대조한다. [전문가 실습 사용법](../README.md#전문가-실습에서-재대여-기준-합의하기)

전문가 **리뷰 지적을 고치고 다시 검증하기**는 고급 예제의 기준과 두 검토 결과를 이어받는다. TDD 수정 담당은 `tdd` 원본으로 각 지적을 확인하고 최소한으로 수정한다. 코딩 규칙 재검토 담당과 개선 기준 재검토 담당은 같은 `code-review` 원본을 읽고 동일한 수정본에서 각자 맡은 지적의 해결 근거를 확인한다. [고급 검토 결과를 옮기는 방법](../README.md#리뷰-지적을-고치고-다시-검증하기)

고급 **개선 기준을 테스트로 옮겨 화면 고치기**에서는 TDD 개발 담당에게 Matt Pocock의 `tdd` 원본을 연결한다. 코딩 규칙 검토 담당과 개선 기준 검토 담당은 동일한 `code-review` 원본을 공유하며 같은 변경을 서로 다른 관점으로 읽는다. 중급의 최종 기준은 고급 사본의 첫 질문에 직접 입력한다. [테스트·리뷰 실습 사용법](../README.md#개선-기준을-테스트로-옮겨-화면-고치기)

중급 **질문으로 화면 개선 기준 정하기**는 Matt Pocock의 원본 두 개를 사용한다. 요구사항 확인 담당은 `grilling`으로 빠진 정보를 묻고, 용어 정리 담당은 `domain-modeling`으로 회신에서 확인된 용어를 정리한다. 새 사본에서 각 Skill 블록을 열어 원문을 읽을 수 있다. 내보낼 때 두 Skill을 포함하면 각 역할이 ZIP에서도 자신의 지침을 읽는다. [문답 실습 사용법](../README.md#질문으로-화면-개선-기준-정하기)

**예제 템플릿 → 웹 디자인 개선**에서 만든 초급 사본은 **대상 컴포넌트 개선** 단계에 **컴포넌트 개선 Skill**과 원본 `frontend-ui-engineering`을 연결한다. **적용되는 Skill**에서 두 이름을 확인하고 각각의 블록을 열어 지침을 읽는다. 한국어 실습 지침을 고치고 현재 초안으로 새 대화를 열면 수정한 지침과 연결된 원본 지침이 함께 쓰인다. [수준별 실습 사용법](../README.md#기존-웹-프로젝트의-디자인-개선하기)

고급 **한 화면을 여러 Agent로 개선하기**에서는 시각 디자인 담당이 `frontend-design`을, 접근성 검토 담당과 화면 검증 담당이 `frontend-ui-engineering`을 읽는다. 두 의견을 합치는 UI 개발 담당에게는 두 원본이 모두 연결된다. ZIP에 원본을 포함하면 `frontend-design`의 라이선스와 `frontend-ui-engineering`의 접근성 체크리스트가 각각 해당 Skill 폴더에 담긴다. [한 화면 협업 실습](../README.md#한-화면을-여러-agent로-개선하기)

초급 템플릿 **내 자료로 안내하기**에서 **내 사본으로 시작**을 누른다. 편집기에서 ‘도서관 안내 Agent’를 선택하면 연결된 ‘근거 인용 Skill’을 확인할 수 있다. 대출 한도를 묻고 답변 다음 줄에 인용된 문장을 도서관 규정과 대조해 본다.

내 지침을 쓰려면 **도구 및 자료 → 자료 등록 → Skill**에서 `SKILL.md` 파일, 폴더 또는 ZIP을 등록한다. 편집기에서 AI 작업 블록의 **속성 → 도구 및 자료 → 사용할 Skill**을 열어 등록한 Skill을 고른다. **미리 볼 자료판**에서 버전을 선택하고 지침을 확인한 뒤 **이 판 연결**을 누른다. 실행기는 그 버전의 `SKILL.md` 본문을 모델에 전달한다. 작업실은 Skill에 딸린 코드 파일을 보관하며 미리보기와 내보내기를 제공한다. 등록 시 **이 Skill은 작업에 스크립트 실행이 꼭 필요합니다**를 선택한 버전을 연결하면 서버가 새 실행, 프로젝트 버전 저장, 게시 요청을 거절한다. [자료 등록 화면](../src/ui/ResourceLibrary.tsx) · [블록 속성](../src/ui/editor/Panels.tsx)

<a id="codex-project-instructions"></a>

## Codex 프로젝트 지침 확인하기

프로젝트 루트에서 `codex`로 새 세션을 열고 “적용된 프로젝트 지침과 근거 파일을 요약해 주세요”라고 요청한다. CLI에서 `codex debug prompt-input`을 지원하면 입력 미리보기에서도 지침 본문을 확인할 수 있다.

예상한 지침이 보이지 않으면 세션의 작업 디렉터리와 파일 우선순위를 확인한다. Codex는 전역 지침을 읽은 뒤 프로젝트 루트에서 작업 디렉터리까지 탐색한다. 루트를 찾지 못하면 현재 디렉터리만 확인한다. 각 디렉터리에서는 내용이 있는 `AGENTS.override.md`, `AGENTS.md`, 설정한 대체 이름 순으로 최대 한 파일을 읽고, 충돌하면 작업 디렉터리에 가까운 지침을 우선한다. 파일을 바꿨다면 새 세션에서 확인한다. [OpenAI 공식 지침 탐색 문서](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

## 설치 목록

2026년 11월 25일 작업 폴더를 기준으로, [프로젝트 스킬 폴더](../.agents/skills)에서 `SKILL.md`를 확인한 스킬은 **72개**다. 이 중 71개는 [잠금 파일](../skills-lock.json)에 기록돼 있다. 별도로 설치된 `distilly` 1.0.0의 출처와 버전은 [패키지 정보](../.agents/skills/distilly/package.json)에서 확인할 수 있다.

| 설치 출처 | 수 | 스킬 |
|---|---:|---|
| mattpocock/skills | 39 | `ask-matt`, `chief-of-staff`, `claude-handoff`, `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `git-guardrails-claude-code`, `grill-me`, `grill-with-docs`, `grilling`, `handoff`, `implement`, `implement-spec`, `improve-codebase-architecture`, `loop-me`, `migrate-to-shoehorn`, `pr`, `prototype`, `research`, `retro`, `scaffold-exercises`, `setup-matt-pocock-skills`, `setup-pre-commit`, `setup-ts-deep-modules`, `software-factory`, `tdd`, `teach`, `to-questionnaire`, `to-spec`, `to-tickets`, `triage`, `wait-what`, `wayfinder`, `wizard`, `writing-beats`, `writing-for-agents`, `writing-fragments`, `writing-shape` |
| obra/superpowers | 15 | `brainstorming`, `diagnosing-superpowers`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills` |
| ConardLi/garden-skills | 6 | `beautiful-article`, `gpt-image-2`, `kb-retriever`, `motion-showreel`, `web-design-engineer`, `web-video-presentation` |
| anthropics/skills | 3 | `frontend-design`, `mcp-builder`, `web-artifacts-builder` |
| garrytan/gstack | 2 | `design-html`, `design-shotgun` |
| nextlevelbuilder/ui-ux-pro-max-skill | 2 | `ui-styling`, `ui-ux-pro-max` |
| addyosmani/agent-skills | 1 | `frontend-ui-engineering` |
| coleam00/excalidraw-diagram-skill | 1 | `excalidraw-diagram` |
| Leonxlnx/taste-skill | 1 | `design-taste-frontend` |
| shadcn-ui/ui | 1 | `shadcn` |
| titanwings/distilly | 1 | `distilly` |

[.claude/skills](../.claude/skills)에는 16개 항목이 있다. 15개는 위 프로젝트 스킬을 가리키는 Windows 디렉터리 연결이고, `kb-retriever` 한 개는 내용이 같은 사본이다. `gh-fix-ci`는 사용자 Codex 스킬 폴더에 별도로 설치되어 있다.

[하위 Agent 역할 정의](../.codex/agents)는 173개다. 이 가운데 101개는 읽기 전용이고 72개는 작업 공간 쓰기 권한을 선언한다.
