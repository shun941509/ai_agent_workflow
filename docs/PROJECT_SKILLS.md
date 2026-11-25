# Workflow Studio 스킬 활용표

## 개발할 때 무엇을 쓸까

| 요청 | 추천 스킬 | 이 프로젝트에서 확인할 것 |
|---|---|---|
| 블록을 합칠지, 어느 수준부터 추천할지 함께 결정하기 | [grilling](../.agents/skills/grilling/SKILL.md) · 직접 호출할 때 `$grill-me` | [블록 가이드](WORKFLOW_BLOCK_GUIDE.md)에서 두 블록의 입력·출력·종료 상태를 비교한다. 같은 예시에서 결과가 달라지는 지점이 있으면 선택지로 제시한다. |
| Agent·하위 Agent·팀의 개념이나 블록 이름 정리하기 | [domain-modeling](../.agents/skills/domain-modeling/SKILL.md) | [도메인 정의](../src/domain/catalog.ts)의 용어가 편집기 속성과 템플릿 안내에서 같은 뜻으로 쓰이는지 확인한다. 설계 질문과 용어 기록을 함께 원하면 `$grill-with-docs`를 호출한다. |
| 캔버스·블록·연결선·속성 패널 개선하기 | [frontend-design](../.agents/skills/frontend-design/SKILL.md) · 배치를 먼저 비교할 때 [prototype](../.agents/skills/prototype/SKILL.md) | [편집기](../src/ui/editor)에서 상대 초안으로 가는 선을 사용자가 따라갈 수 있는지, 모바일 목록에서도 같은 속성을 수정할 수 있는지 확인한다. |
| 수준별 템플릿을 추가하거나 완료 기준을 변경하기 | [tdd](../.agents/skills/tdd/SKILL.md) | [템플릿](../src/domain/templates.ts)의 시험 질문과 관찰할 결과를 한 쌍으로 정한다. 예를 들어 초급에서는 3권을 5권으로 바꾸면 화면의 인용과 내려받은 파일 내용이 일치해야 한다. 실제 모델 비교에는 [실습별 시험](../tests/live-service.ts)을 쓴다. |
| 도서관 MCP에 새 도구 추가하기 | [mcp-builder](../.agents/skills/mcp-builder/SKILL.md) | [도서관 서버](../src/mcp/server.ts)의 TypeScript 도구 입력·출력과 호출 권한을 정의한다. 예약처럼 상태를 바꾸는 도구는 승인과 재시도 후 실제 처리 건수도 확인한다. |
| 실행이 멈추거나 인용·공유 버전이 예상과 다를 때 | [diagnosing-bugs](../.agents/skills/diagnosing-bugs/SKILL.md) | 같은 질문, 자료판, 대화 조건으로 재현한다. 실행 경로에서 처음으로 기대와 달라진 블록을 찾아 수정하고 그 조건으로 다시 실행한다. |
| 화면·API·저장소에 걸친 기능을 수정할 때 | [codebase-design](../.agents/skills/codebase-design/SKILL.md) · [tdd](../.agents/skills/tdd/SKILL.md) | 자료 휴지통처럼 여러 계층을 지나는 기능은 화면에서 시작해 권한 검사와 저장까지 추적한다. 복구한 자료를 기존 Workflow가 원래 판으로 다시 읽는지도 확인한다. [기능별 수정 위치와 테스트](MAINTENANCE_TASKS.ko.md) |
| 개인 Agent가 참고할 사용자·동료 프로필을 만들거나 갱신할 때 | [distilly](../.agents/skills/distilly/SKILL.md) | 본인의 선호와 작업 방식을 정리할 때는 소유자 프로필 절차를, 제공받은 동료 자료를 정리할 때는 인물 프로필 생성 절차를 따른다. |
| 변경 결과 검증하기 | [verification-before-completion](../.agents/skills/verification-before-completion/SKILL.md) | [프로젝트 검증 명령](../README.md#검증) 중 해당 동작을 관찰할 수 있는 시험을 고른다. 실행·저장에는 `pnpm test`, 화면 조작에는 `pnpm test:browser`, 실제 OpenAI 응답이 기준일 때는 `pnpm test:live`를 사용한다. 실제 모델 시험은 사용량이 발생한다. |
| GitHub PR의 Actions 검사가 실패했을 때 | 사용자 스킬 `$gh-fix-ci` | 설치 확인 당시 이 폴더는 Git 작업 트리 밖에 있었다. 이 프로젝트의 GitHub 저장소와 PR이 준비되면 해당 체크아웃에서 실패한 검사와 로그를 확인한다. |

예를 들어 “동료 검토에서 어느 담당자가 어떤 초안을 고쳤는지 연결선을 따라가기 어렵습니다”는 편집기 디자인 작업이다. “실행했더니 한 담당자의 교정 근거가 답변에서 사라집니다”는 같은 화면에서 발견했더라도 실행 오류 진단으로 시작한다.

## 하위 Agent와 플러그인 선택

독립적으로 조사하거나 검증할 일이 있으면 아래 표에서 그 일을 맡을 역할을 고른다. [역할 정의 폴더](../.codex/agents)에는 176개 정의가 있으며 101개는 읽기 전용, 75개는 작업 공간 쓰기 권한을 선언한다. 새 대화에서는 선택한 TOML의 `developer_instructions`와 `sandbox_mode`를 확인한다. 역할을 이름으로 호출할 수 있으면 그 역할로 위임한다. 일반 하위 Agent만 제공되는 세션에서는 TOML의 관련 지침과 작업 범위를 위임문에 명시하고, 읽기 전용 역할에는 조사·검토를 맡긴다.

| 작업 | 하위 Agent에 맡길 일 | 플러그인이 도움이 되는 경우 |
|---|---|---|
| Workflow 편집기 UI | [frontend-developer](../.codex/agents/frontend-developer.toml)가 화면을 구현한다. [anti-ui-slop-reviewer](../.codex/agents/anti-ui-slop-reviewer.toml)는 블록·연결선에서 실행 순서를 읽을 수 있는지, [accessibility-tester](../.codex/agents/accessibility-tester.toml)는 키보드와 모바일에서 같은 작업을 마칠 수 있는지 검토한다. | **Figma**에 시안이 있으면 배치와 상태를 대조한다. **Build Web Apps**의 프런트엔드 테스트 스킬은 브라우저에서 화면 문제를 재현할 때 쓴다. |
| 수준별 템플릿·모델 응답 | [eval-engineer](../.codex/agents/eval-engineer.toml)가 실습 완료 기준을 정리하고, [prompt-regression-tester](../.codex/agents/prompt-regression-tester.toml)가 인용·도구 선택·실패 처리의 회귀 사례를 설계한다. 자동화할 사례 구현은 [test-automator](../.codex/agents/test-automator.toml)에 맡긴다. | 모델 응답 차이가 OpenAI API 연동에서 발생하면 **OpenAI Developers**의 API 진단 스킬을 사용한다. |
| MCP 도구·자료 연결 | [mcp-developer](../.codex/agents/mcp-developer.toml)가 도구의 입력·출력과 허용 범위를 확인하고, 재시도했을 때 예약이 한 건만 생성되는지 검증한다. | 사용하는 SDK 버전의 API를 확인할 때 **Context7**에서 해당 라이브러리 문서를 조회한다. |
| 풀스택 기능·실행 오류 | [code-mapper](../.codex/agents/code-mapper.toml)는 화면에서 API와 SQLite까지의 호출 경로를 찾고, [debugger](../.codex/agents/debugger.toml)는 기대와 달라지는 첫 단계를 좁힌다. 화면과 서버에 걸친 수정은 [fullstack-developer](../.codex/agents/fullstack-developer.toml), Next.js 라우팅·렌더링 수정은 [nextjs-developer](../.codex/agents/nextjs-developer.toml)에 맡긴다. | Next.js 동작은 먼저 프로젝트에 설치된 버전의 가이드를 읽는다. 다른 라이브러리의 사용법이 필요하면 **Context7**을 쓴다. |
| 코드 리뷰·PR 검사 | [code-reviewer](../.codex/agents/code-reviewer.toml)가 변경 경로의 회귀 위험과 빠진 테스트를 찾는다. | 대상 저장소와 PR이 있으면 **GitHub**에서 변경 사항과 검사 결과를 확인하고, 실패한 Actions 작업은 `gh-fix-ci`로 조사한다. |

2026-11-22 설치 확인 시 `codex plugin list --json`에서 설치·활성으로 표시된 항목은 52개였다. `visualize`가 두 출처에 있어 패키지 이름은 51종이다. 새 대화에서는 필요한 플러그인이 현재 도구나 스킬 목록에 보이는지 확인한다. GitHub 저장소나 Figma 파일을 다룰 때는 대상에 대한 계정 접근 권한도 확인한다.

## 작업실 Agent에 지침 연결하기

초급 템플릿 **내 자료로 안내하기 → 내 사본으로 시작**을 열면 ‘근거 인용 Skill’이 ‘도서관 안내 Agent’에 연결되어 있다. 대출 질문을 보내면 그 지침이 답변과 원문 인용에 어떻게 반영되는지 볼 수 있다.

내 지침을 쓰려면 **도구 및 자료 → 자료 등록 → Skill**에서 `SKILL.md` 파일, 폴더 또는 ZIP을 등록한다. 편집기에서 AI 작업 블록을 선택하고 **도구 및 자료 → 사용할 Skill**에서 등록한 판을 고른다. 실행기는 그 판의 `SKILL.md` 본문을 모델에 전달한다. 부속 코드 파일은 보관·미리보기·내보내기를 지원하며, 스크립트 실행이 필수인 판은 실행·게시가 제한된다. [자료 등록 화면](../src/ui/ResourceLibrary.tsx) · [블록 속성](../src/ui/editor/Panels.tsx)

## 설치 목록

프로젝트의 [스킬 폴더](../.agents/skills)에서 `SKILL.md`를 확인한 고유 스킬은 **64개**다. [설치 기록](../skills-lock.json)에 63개가 있고, 추가된 `distilly` 1.0.0의 버전과 출처는 [패키지 정보](../.agents/skills/distilly/package.json)에서 확인했다.

| 설치 출처 | 수 | 스킬 |
|---|---:|---|
| mattpocock/skills | 39 | `ask-matt`, `chief-of-staff`, `claude-handoff`, `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `git-guardrails-claude-code`, `grill-me`, `grill-with-docs`, `grilling`, `handoff`, `implement`, `implement-spec`, `improve-codebase-architecture`, `loop-me`, `migrate-to-shoehorn`, `pr`, `prototype`, `research`, `retro`, `scaffold-exercises`, `setup-matt-pocock-skills`, `setup-pre-commit`, `setup-ts-deep-modules`, `software-factory`, `tdd`, `teach`, `to-questionnaire`, `to-spec`, `to-tickets`, `triage`, `wait-what`, `wayfinder`, `wizard`, `writing-beats`, `writing-for-agents`, `writing-fragments`, `writing-shape` |
| obra/superpowers | 15 | `brainstorming`, `diagnosing-superpowers`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills` |
| ConardLi/garden-skills | 6 | `beautiful-article`, `gpt-image-2`, `kb-retriever`, `motion-showreel`, `web-design-engineer`, `web-video-presentation` |
| anthropics/skills | 2 | `frontend-design`, `mcp-builder` |
| coleam00/excalidraw-diagram-skill | 1 | `excalidraw-diagram` |
| titanwings/distilly | 1 | `distilly` |

[.claude/skills](../.claude/skills)의 16개 항목도 확인했다. 15개는 위 프로젝트 스킬을 가리키는 Windows 디렉터리 연결이고, `kb-retriever` 한 개는 내용이 같은 사본이다. `gh-fix-ci`는 사용자 Codex 스킬 폴더에 별도로 설치되어 있다.
