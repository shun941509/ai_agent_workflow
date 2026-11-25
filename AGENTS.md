<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Workflow Studio 개발 도구 선택

- 사용자가 지정한 스킬을 우선한다. 그 밖에는 [프로젝트 스킬 활용표](docs/PROJECT_SKILLS.md#개발할-때-무엇을-쓸까)에서 현재 작업에 맞는 스킬을 골라 `SKILL.md`를 읽는다.
- 구현·조사·검증을 나눌 때는 [하위 Agent와 플러그인 선택](docs/PROJECT_SKILLS.md#하위-agent와-플러그인-선택)을 따른다. 위임할 역할의 `.codex/agents/<역할>.toml`을 읽고 담당 범위와 확인할 결과를 전달한다. 플러그인은 해당 작업에 필요한 기능과 현재 세션의 연결 상태를 확인하고 사용한다.
- 작업실 이용자가 자신의 Workflow에 지침을 붙이려는 경우에는 [작업실 Agent에 지침 연결하기](docs/PROJECT_SKILLS.md#작업실-agent에-지침-연결하기)를 따른다.
