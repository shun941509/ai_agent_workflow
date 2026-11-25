# Workflow Studio 개발자 가이드

버전·공유 화면을 고친다면 [기능별 수정 위치와 테스트](MAINTENANCE_TASKS.ko.md)에서 해당 작업을 찾으세요. 프로젝트를 처음 맡았다면 아래의 **질문 한 건이 답변이 되기까지**를 따라가 보세요. 화면 코드와 별도 프로세스에서 실행되는 코드를 함께 읽을 수 있습니다.

## 로컬 실행 프로세스

Windows에서 프로젝트를 설치하고 실행하려면 README의 절차를 따르세요. 시작 스크립트는 Next.js, 실행 워커, 도서관 MCP 서버를 각각 자식 프로세스로 시작합니다. 워커나 MCP 서버의 TypeScript를 바꿨다면 실행 중인 터미널에서 Ctrl+C로 종료하고 개발 서버를 다시 시작하세요. [설치 안내](../README.md#사전-요구사항-및-설치) · [로컬 실행](../README.md#로컬-실행-테스트-및-빌드) · [시작 스크립트](../scripts/start.mjs)

| 프로세스 | 처음 열 파일 | 맡은 일 |
| --- | --- | --- |
| Next.js 웹 서버 | [화면 진입점](../src/app/page.tsx), [Studio](../src/ui/Studio.tsx), [Studio API](../src/app/api/studio/route.ts) | 루트 페이지에서 계정 세션을 확인하고 [로그인 페이지](../src/app/login/page.tsx) 또는 작업실을 엽니다. Studio API는 작업실 요청마다 세션을 확인합니다. |
| 실행 워커 | [worker.ts](../src/server/worker.ts), [runs.ts](../src/server/runs.ts), [그래프 실행기](../src/engine/index.ts) | 대기열에서 실행할 작업을 가져와 블록을 실행하고 진행 상태와 결과를 저장합니다. |
| 도서관 MCP 서버 | [서버 쪽 MCP 클라이언트](../src/server/mcp.ts), [도서관 도구 구현](../src/mcp/server.ts) | 기본 `http://127.0.0.1:3101/mcp`에서 도서관 도구 요청을 받고 예약과 처리 영수증을 관리합니다. |

편집기의 화면 배치를 바꿀 때는 `src/ui/editor`에서 시작합니다. 비슷한 이름의 `src/app/prototype/library`는 개발 모드에서만 여는 도서관 시안입니다. [실제 편집기](../src/ui/editor/Editor.tsx) · [시안의 페이지 진입점](../src/app/prototype/library/page.tsx)

Next.js의 기본 산출물 경로는 `.next/`이며 `STUDIO_NEXT_DIR`로 바꿀 수 있습니다. 경로를 바꾸면 프로덕션 빌드와 실행에 같은 값을 사용하세요. `next-env.d.ts`는 Next.js가 생성하는 타입 선언이고, `tsconfig.tsbuildinfo`는 TypeScript의 증분 검사 캐시입니다. [Next.js 설정](../next.config.ts) · [타입 검사 설정](../tsconfig.json)

별도 초기화 명령 없이 작업실은 DB를 처음 열 때 `studio.sqlite`의 스키마를 준비하고, 해당되는 이전 저장 데이터에 호환 처리를 적용합니다. 도서관 MCP는 기동할 때 `library.sqlite`의 테이블을 준비합니다. 기존 DB에 대한 호환 변경을 확인할 때는 서비스가 종료된 상태에서 데이터 폴더를 복사한 뒤 사본을 가리키는 `STUDIO_DATA_DIR`로 실행하세요. [환경 변수 설정](../README.md#환경-변수-설정) · [작업실 DB](../src/server/db.ts) · [도서관 DB](../src/mcp/server.ts)

모델 요청은 작업실 서버에서 OpenAI Responses API로 보냅니다. 인증이 필요한 외부 MCP를 등록할 때는 자격 증명이 담긴 서버 환경 변수의 이름을 입력하세요. 이름은 `STUDIO_CONNECTOR_`로 시작하고 뒤에는 영문 대문자, 숫자, 밑줄만 쓸 수 있습니다. 외부 MCP 클라이언트는 호출할 때 해당 값을 읽고, 값이 비어 있으면 자격 증명 설정 오류를 반환합니다. [모델 호출](../src/server/model.ts) · [외부 MCP 등록](../src/server/assets.ts) · [외부 MCP 호출](../src/server/mcp.ts)

## 질문 한 건이 답변이 되기까지

예를 들어 도서관 자료를 수정한 후 같은 질문을 보냈다고 합시다. 답변에 예전 대출 한도가 보이면, 브라우저의 개발자 도구에서 `/api/studio` 요청의 `action`을 먼저 찾으세요. 이 엔드포인트는 JSON의 `{ action, data }`를 읽어 작업을 구분합니다. [브라우저의 api 함수](../src/ui/client.ts) · [서버의 action 분기](../src/app/api/studio/route.ts)

| 순서 | 따라갈 코드 | 확인할 값 |
| --- | --- | --- |
| 1. **변경 적용** 또는 **프로젝트 메뉴 → 저장** | [InlineSourceEditor](../src/ui/editor/InlineSourceEditor.tsx) → [Editor](../src/ui/editor/Editor.tsx) | 변경 적용은 해당 원문을 설계에 반영합니다. 프로젝트 저장은 편집 중인 원문도 반영해 `project.save`로 초안을 저장합니다. 자료 블록의 `config.content`와 카드의 미리보기를 확인하세요. |
| 2. **시험 실행 → 질문 실행** | [Editor의 launchRun](../src/ui/editor/Editor.tsx) → [RunPanel의 start](../src/ui/RunPanel.tsx) | 첫 버튼은 결과 탭을 엽니다. 질문을 보내면 `run.start`를 호출합니다. 새 초안을 시험하는지, 특정 버전이나 기존 대화로 보내는지 확인합니다. |
| 3. **작업 등록** | [startRun과 enqueueRun](../src/server/runs.ts) | 새 대화는 실행할 그래프를 `conversations`에 고정합니다. 질문 한 건은 `runs`에 `queued`로 들어갑니다. 같은 요청을 재전송했는지는 `requestKey`로 구별합니다. |
| 4. **블록 실행** | [워커의 loop](../src/server/worker.ts) → [workOne](../src/server/runs.ts) → [executeGraph](../src/engine/index.ts) | 워커가 작업을 확보하고 실행합니다. 어느 블록을 거쳤는지와 어디서 재개할지는 체크포인트에 기록합니다. |
| 5. **답변 또는 추가 질문 표시** | [runGet과 replyRun](../src/server/runs.ts) → [RunPanel](../src/ui/RunPanel.tsx) | 화면은 `run.get`으로 상태와 답변을 다시 읽습니다. `waiting`이면 사용자 입력이나 승인을 기다리는 블록을 확인합니다. 응답은 `run.reply`로 보냅니다. |

같은 대화는 시작할 때의 그래프를 사용합니다. 따라서 예전 답변을 조사할 때는 화면에 보이는 현재 초안과 **그 실행이 속한 대화**를 함께 확인해야 합니다. 이 동작을 모델 호출 없이 따라가는 예제는 실행 API 시험과 브라우저 시험에 있습니다. [큐 등록·대기·재개 시험](../tests/engine-api.test.ts) · [원문 변경 후 같은 질문을 보내는 시험](../tests/browser-smoke.ts)

## 버전과 공유에서 구분할 데이터

**내 Agent → 프로젝트별 공유 설정**은 목록에서 선택한 프로젝트의 저장된 초안을 사용합니다. 편집기의 **프로젝트 메뉴 → 버전 / 공유 설정**은 편집 중인 프로젝트와 원문을 사용합니다. 두 경로는 같은 버전·공유 컴포넌트를 엽니다. 게시 대상과 권한은 서버에서 확인합니다. [공유 대상을 정하는 작업실](../src/ui/Studio.tsx) · [버전·공유 화면](../src/ui/ProjectVersionPanel.tsx) · [서버의 프로젝트 권한](../src/server/projects.ts)

| 화면에서 하는 일 | API → 서버 함수 | 저장 결과 |
| --- | --- | --- |
| 편집한 초안 저장 | `project.save` → `saveProject` | `projects.graph`를 갱신하고 `revision`을 올립니다. 다른 편집이 먼저 저장되면 충돌을 반환합니다. |
| 현재 초안 버전 저장 | `versions.save` → `snapshot` | 현재 리비전의 그래프와 연결된 자료판을 번호가 있는 `versions` 행으로 저장합니다. |
| 선택한 버전 게시 | `versions.publish` → `publish` | 서버가 소유권, 게시할 그래프, 자료의 공유 범위를 확인한 뒤 게시 버전과 공개 범위를 갱신합니다. |
| 저장한 버전을 초안으로 복원 | `versions.restore` → `restore` | 선택한 버전의 이름과 그래프로 초안을 갱신합니다. 게시 버전 변경은 별도 작업입니다. |

코드에서 `revision`은 동시 편집 충돌을 검사하는 초안 번호입니다. 화면의 ‘대상 버전’은 저장된 판의 `number`, ‘현재 게시 버전’은 프로젝트의 `publicVersion`을 가리킵니다. 2판을 선택했는데 방문자에게 1판이 보인다면 선택값과 서버에 저장된 게시 버전을 각각 확인하세요. [화면의 프로젝트 타입](../src/ui/studio-project.ts) · [대상 버전 선택과 게시 요청](../src/ui/ProjectVersionPanel.tsx)

예를 들어 **초안 복원**은 이전 버전을 편집의 출발점으로 삼는 작업입니다. 전문가 실습에서 **게시 버전 복구**를 선택하면 `versions.decide`가 새 대화에 적용될 게시 버전을 되돌리고 사용자가 입력한 판단 근거를 기록합니다. [서버의 버전·게시 처리](../src/server/projects.ts) · [게시 판단 양식](../src/ui/ReleaseDecisionForm.tsx) · [판단 기록 시험](../tests/release-exercise.test.ts)

## 변경 후 확인하기

버전 공개 범위와 전문가 실습의 게시·복구 판단을 바꿨다면 프로젝트 루트에서 관련 시험 파일만 실행할 수 있습니다. 공유 회귀 시험의 MCP 사례는 루프백 HTTP 연결을 사용합니다. 전체 회귀 시험, 브라우저 시험에 필요한 격리 조건과 실제 모델 시험 설정은 README에서 확인하세요. [명령과 전제 조건](../README.md#검증)

```powershell
pnpm exec tsx --test tests/sharing-releases.test.ts tests/release-exercise.test.ts
```

화면 이름만 아는 경우에는 IDE의 ‘정의로 이동’과 아래 검색을 함께 쓰면 호출부, 서버 처리, 테스트를 찾을 수 있습니다.

```powershell
rg -n --fixed-strings '현재 초안 버전 저장' src/ui tests
rg -n --fixed-strings 'versions.save' src tests
```
