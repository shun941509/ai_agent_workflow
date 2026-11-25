# Workflow Studio 개발자 가이드

버전·공유 화면을 고친다면 [기능별 수정 위치와 테스트](MAINTENANCE_TASKS.ko.md)에서 해당 작업을 찾으세요. 프로젝트를 처음 맡았다면 아래의 **질문 한 건이 답변이 되기까지**를 따라가 보세요. 브라우저에서 보낸 질문이 API와 실행 워커를 거쳐 결과 화면에 표시되는 경로를 살펴봅니다.

## 로컬 실행 프로세스

Windows에서 프로젝트를 설치하고 실행하려면 README의 절차를 따르세요. 시작 스크립트는 Next.js 웹 서버, 실행 워커, 도서관 MCP 서버를 각각 자식 프로세스로 시작합니다. 워커나 도서관 MCP 서버의 TypeScript를 수정했다면 `pnpm dev`를 실행한 터미널에서 `Ctrl+C`를 누른 뒤 `pnpm dev`를 다시 실행하세요. [설치 안내](../README.md#installation) · [로컬 실행](../README.md#running-locally) · [시작 스크립트](../scripts/start.mjs)

| 프로세스 | 처음 열 파일 | 맡은 일 |
| --- | --- | --- |
| Next.js 웹 서버 | [화면 진입점](../src/app/page.tsx), [Studio](../src/ui/Studio.tsx), [Studio API](../src/app/api/studio/route.ts) | 루트 페이지는 계정 세션을 확인합니다. 로그인하지 않았다면 [로그인 페이지](../src/app/login/page.tsx)로 이동하고, 로그인했다면 작업실을 표시합니다. Studio API는 작업실 요청마다 세션을 확인합니다. |
| 실행 워커 | [worker.ts](../src/server/worker.ts), [runs.ts](../src/server/runs.ts), [그래프 실행기](../src/engine/index.ts) | 대기열에서 실행할 작업을 가져와 블록을 실행하고 진행 상태와 결과를 저장합니다. |
| 도서관 MCP 서버 | [작업실에서 도서관 MCP를 호출하는 코드](../src/server/mcp.ts), [도서관 MCP 서버의 요청 처리](../src/mcp/server.ts) | 기본 주소 `http://127.0.0.1:3101/mcp`에서 도서관 도구 요청을 받아 예약을 조회·생성·취소합니다. 예약을 변경할 때는 처리 결과도 함께 저장해 같은 요청을 재시도해도 예약이 중복되지 않도록 합니다. |

작업실 편집기의 배치를 바꿀 때는 `src/ui/editor`에서 시작합니다. `src/app/prototype/library`의 도서관 시안은 개발 모드에서 로그인한 뒤 열 수 있습니다. [실제 편집기](../src/ui/editor/Editor.tsx) · [시안의 페이지 진입점](../src/app/prototype/library/page.tsx)

Next.js의 기본 산출물 경로는 `.next/`이며 `STUDIO_NEXT_DIR`로 바꿀 수 있습니다. 경로를 바꾸면 프로덕션 빌드와 실행에 같은 값을 사용하세요. `next-env.d.ts`는 Next.js가 생성하는 타입 선언이고, `tsconfig.tsbuildinfo`는 TypeScript의 증분 검사 캐시입니다. [Next.js 설정](../next.config.ts) · [타입 검사 설정](../tsconfig.json)

별도 초기화 명령은 필요 없습니다. 작업실은 `studio.sqlite`를 처음 열 때 스키마를 준비하고 기존 DB에 필요한 호환 처리를 적용합니다. 도서관 MCP는 시작할 때 `library.sqlite`의 테이블을 준비합니다. 기존 DB의 호환성을 확인하려면 서비스를 모두 종료하고 데이터 폴더를 복사하세요. `STUDIO_DATA_DIR`에 복사한 폴더 경로를 지정한 뒤 서비스를 시작하세요. [환경 변수 설정](../README.md#environment) · [작업실 DB](../src/server/db.ts) · [도서관 DB](../src/mcp/server.ts)

작업실 서버는 모델 요청을 OpenAI Responses API로 보냅니다. [모델 호출](../src/server/model.ts)

외부 MCP를 등록하려면 로그인한 계정의 내부 ID를 `STUDIO_ADMIN_IDS`에 포함해야 합니다. Bearer 인증이 필요하면 **서버 자격증명 환경변수 이름** 칸에 토큰을 저장한 환경 변수의 이름을 입력하세요. 이름은 `STUDIO_CONNECTOR_` 뒤에 영문 대문자, 숫자, 밑줄 중 하나 이상의 문자를 붙여 만듭니다. 외부 MCP 클라이언트는 호출할 때 환경 변수의 값을 읽습니다. 값이 비어 있으면 자격 증명 설정 오류를 반환합니다. [외부 MCP 등록](../src/server/assets.ts) · [외부 MCP 호출](../src/server/mcp.ts)

## 질문 한 건이 답변이 되기까지

도서관 자료를 수정하고 같은 질문을 했는데 예전 대출 한도가 보인다면 브라우저 개발자 도구의 네트워크 탭에서 `/api/studio` 요청을 찾으세요. 요청 본문은 JSON의 `{ action, data }` 형식입니다. 블록에서 직접 고친 규정은 `project.save` 요청의 `data.graph`에서 원문을 확인하세요. 자료함에서 고쳤다면 `asset.save` 응답에서 자료 ID와 새 버전 번호를 확인하세요. 블록의 `config.assetId`와 `config.version`이 그 값과 일치하는지도 살펴보세요. 이어서 `run.start` 요청에서 시험할 설계 버전과 대화가 어떻게 지정됐는지 확인하세요. [브라우저의 api 함수](../src/ui/client.ts) · [서버의 action 분기](../src/app/api/studio/route.ts)

| 순서 | 따라갈 코드 | 확인할 값 |
| --- | --- | --- |
| 1. **변경 적용** 또는 **프로젝트 메뉴 → 저장** | [InlineSourceEditor](../src/ui/editor/InlineSourceEditor.tsx) → [Editor](../src/ui/editor/Editor.tsx) | **변경 적용**은 해당 원문을 자료 블록의 `config.content`에 반영해 자동 저장 대상으로 만듭니다. **프로젝트 메뉴 → 저장**은 편집 중인 원문도 적용한 뒤 `project.save`로 초안을 저장합니다. 적용할 원문이 비어 있으면 입력 안내를 표시하고 저장을 멈춥니다. 자료 블록의 `config.content`와 카드 미리보기를 확인하세요. |
| 2. **시험 실행 → 질문 실행** | [Editor의 launchRun](../src/ui/editor/Editor.tsx) → [RunPanel의 start](../src/ui/RunPanel.tsx) | **시험 실행**은 결과 탭을 엽니다. 아직 적용하지 않은 원문이 있으면 시험에 사용할 원문을 먼저 고릅니다. 새 대화에서는 **실행 설정 → 실행 환경**을 확인하세요. **시험 데이터**에서는 **설계**에서 현재 초안이나 저장 버전을 고릅니다. **실제 사용 · 게시 버전**에서는 서버가 현재 게시 버전을 사용합니다. 기존 대화를 이어갈 때는 어느 대화를 열었는지 확인하세요. **질문 실행**을 누르면 `run.start`를 호출합니다. |
| 3. **작업 등록** | [startRun과 enqueueRun](../src/server/runs.ts) | 서버는 새 대화에서 사용할 그래프를 `conversations`에 저장합니다. 질문 한 건은 `runs`에 `queued` 상태로 등록합니다. 같은 사용자가 같은 `requestKey`와 같은 내용으로 요청을 다시 보내면 기존 실행을 반환합니다. 같은 키로 다른 요청을 보내면 409를 반환합니다. |
| 4. **블록 실행** | [워커의 loop](../src/server/worker.ts) → [workOne](../src/server/runs.ts) → [executeGraph](../src/engine/index.ts) | 워커는 대기열에서 작업을 확보해 `running`으로 바꾸고 실행권(`lease`)의 만료 시각을 기록한 뒤 그래프를 실행합니다. 실행한 블록과 이어서 실행하는 데 필요한 상태는 체크포인트에 저장됩니다. |
| 5. **결과 표시와 회신** | [runGet과 replyRun](../src/server/runs.ts) → [RunPanel](../src/ui/RunPanel.tsx) | 화면은 `run.get`으로 실행 상태와 결과를 조회합니다. 상태가 `waiting`이면 `prompt.kind`에 따라 추가 질문, 도구 승인, 항목 선택, 사람 검토, 이벤트 회신 또는 파일 첨부 양식을 표시합니다. `run.reply`가 응답을 저장하고 해당 실행을 다시 대기열에 넣습니다. |

같은 대화는 시작 당시의 그래프를 사용합니다. 예전 답변의 규정이 현재 초안과 다르면 기존 대화를 이어서 실행했는지 확인하세요. 수정한 원문은 **시험 데이터 → 현재 초안**으로 새 대화를 열어 시험하세요. 실행 API 시험은 모델 없이 작업 등록과 대기·재개를 확인합니다. 브라우저 시험은 자료 블록을 답변 블록에 직접 연결해 새 실행에 바뀐 대출 한도가 표시되는지 확인합니다. 도서관 안내 Agent가 생성한 답변과 인용은 실제 모델 실습 시험에서 확인하세요. [실행 API 시험](../tests/engine-api.test.ts) · [원문 변경 브라우저 시험](../tests/browser-smoke.ts) · [실제 모델 실습 시험](../tests/live-service.ts)

업무 전용 Agent의 수동 실행에서는 모델을 사용하는 Workflow의 첫 블록을 실행하기 전에 요청과 `graph.agentScope.purpose`를 비교합니다. 전부 범위 밖이면 담당 업무를 안내하고 실행을 마칩니다. 혼합 요청에서는 모델이 지목한 범위 밖 문구가 원문과 일치하는지 검사한 뒤 해당 문구를 제외하고 실행합니다. 범용 Agent는 바로 블록 실행을 시작합니다. 공유된 Agent의 업무 범위를 바꾸려면 변경한 초안을 새 버전으로 저장하고 게시하세요. [범위 판정](../src/engine/request-scope.ts) · [범위별 실행 시험](../tests/agent-scope-run.test.ts)

새 실습 사본과 업무 문서 가이드는 담당 업무가 지정된 상태로 열립니다. 예전 작업실을 열면 원래 용도를 확인할 수 있는 템플릿 초안에만 기본 업무를 채웁니다. 용도를 바꿔 쓰던 초안이나 직접 가져온 설계는 편집기의 **프로젝트 메뉴 → Agent 업무 범위**에서 지정할 수 있습니다. [기존 초안의 전환 기준](../src/server/migrate-agent-scopes.ts)

후속 질문이 실패하거나 중지되면 **같은 입력으로 새 실행**으로 다시 시험할 수 있습니다. 새 실행은 원래 설계와 입력, 해당 질문을 보낸 시점까지 완료된 대화를 사용합니다. 예를 들어 금요일 회의 결정을 정리한 뒤 “그 결정의 담당자도 적어 줘”가 실패했다면, 재시도한 Agent도 앞선 금요일 회의 내용을 참조할 수 있습니다. [대화와 재시도 처리](../src/server/runs.ts)

<a id="버전과-공유에서-구분할-데이터"></a>

## 초안 저장, 버전 저장, 게시

**내 Agent** 목록에서 각 프로젝트의 **공유 설정**을 열면 서버에 저장된 초안으로 새 버전을 만들 수 있습니다. 편집기에서 **프로젝트 메뉴 → 버전** 또는 **프로젝트 메뉴 → 공유 설정**을 열면 새 버전에 편집 중인 원문을 포함할지 선택할 수 있습니다. 두 경로는 같은 버전·공유 컴포넌트를 사용합니다. 저장 버전이 있으면 **대상 버전**에서 게시할 버전을 고르세요. 저장 버전이 없는 일반 프로젝트에서는 공유 범위를 고르고 **선택한 버전 게시**를 누르면 현재 초안을 첫 버전으로 저장한 뒤 게시합니다. 서버는 게시 대상과 권한을 확인합니다. [공유 대상을 정하는 작업실](../src/ui/Studio.tsx) · [버전·공유 화면](../src/ui/ProjectVersionPanel.tsx) · [서버의 프로젝트 권한](../src/server/projects.ts)

| 화면에서 하는 일 | API → 서버 함수 | 저장 결과 |
| --- | --- | --- |
| 편집한 초안 저장 | `project.save` → `saveProject` | `projects`에 초안의 제목과 그래프를 저장하고 `revision`을 올립니다. 요청의 리비전이 현재 리비전과 다르면 409를 반환합니다. |
| 현재 초안 버전 저장 | `versions.save` → `snapshot` | 현재 초안의 제목과 그래프를 새 버전 번호로 `versions`에 저장합니다. 그래프에 연결한 자료와 하위 Workflow의 참조 버전을 고정합니다. |
| 선택한 버전 게시 | `versions.publish` → `publish` | 서버가 소유권, 게시할 그래프, 자료의 공유 범위를 확인한 뒤 게시 버전과 공개 범위를 갱신합니다. |
| 저장 버전이나 보관된 초안을 복원 | `versions.restore` → `restore` | 저장 버전이나 보관된 초안의 제목과 그래프를 현재 초안으로 복원합니다. 내용이 달라지면 복원 직전 초안을 별도로 보관합니다. 공유 주소에는 기존 게시 버전이 계속 적용됩니다. |

코드에서 `revision`은 초안 저장 시 증가하는 값입니다. 서버는 동시 편집 충돌을 확인하는 데 이 값을 씁니다. 화면의 **대상 버전**은 선택한 저장 버전의 `number`이고, **현재 게시 버전**은 서버에 반영된 `publicVersion`입니다. 2판을 선택했는데 방문자에게 1판이 보인다면 서버에 2판이 실제로 게시됐는지 먼저 확인한 뒤, 방문자 화면에서 새 대화를 시작해 비교하세요. 기존 대화는 시작 당시의 버전을 사용합니다. [화면의 프로젝트 타입](../src/ui/studio-project.ts) · [대상 버전 선택과 게시 요청](../src/ui/ProjectVersionPanel.tsx)

**초안으로 복원**하면 선택한 버전을 편집의 출발점으로 삼습니다. 전문가 게시 판단 실습에서는 **대상 버전**에서 되돌릴 버전을 고르고 **게시 판단**에서 **이전 판으로 복구**를 선택하세요. 근거를 적고 **판단 적용 및 기록**을 누르면 `versions.decide`가 게시 버전을 되돌리고 근거를 저장합니다. 이후 시작한 새 대화에는 복구한 버전이 적용됩니다. [서버의 버전·게시 처리](../src/server/projects.ts) · [게시 판단 양식](../src/ui/ReleaseDecisionForm.tsx) · [판단 기록 시험](../tests/release-exercise.test.ts)

<a id="verify-changes"></a>

## 변경 후 확인하기

버전의 공개 범위나 전문가 실습의 게시·복구 판단을 바꿨다면 프로젝트 루트에서 아래 시험 파일을 실행하세요. 공유 회귀 시험의 MCP 사례는 루프백 HTTP 연결을 사용합니다. 전체 회귀 시험 명령과 브라우저·실제 모델 시험의 실행 조건은 README의 **검증**에서 확인하세요. [명령과 전제 조건](../README.md#verification)

```powershell
pnpm exec tsx --test tests/sharing-releases.test.ts tests/release-exercise.test.ts
```

버튼 이름만 알면 첫 번째 명령으로 화면 코드와 테스트를 찾으세요. 두 번째 명령으로 API 처리와 테스트를 찾고, 함수 호출은 IDE의 **정의로 이동**으로 따라가세요.

```powershell
rg -n --fixed-strings '현재 초안 버전 저장' src/ui tests
rg -n --fixed-strings 'versions.save' src tests
```
