# AI Agent Workflow Studio

한국어 블록 편집기에서 AI Agent의 작업 순서, 참고할 자료, 사용할 도구를 연결하는 Windows용 로컬 웹앱입니다. 도서관 안내 Agent를 예로 들면, 이용 규정을 수정한 뒤 같은 질문을 다시 보내 답변과 인용이 어떻게 달라졌는지 확인하고 검토한 버전을 공유할 수 있습니다.

## 주요 기능

- **설계** — 빈 캔버스에서 블록을 연결하거나 도서관·소프트웨어 개발 템플릿을 내 사본으로 열어 편집합니다. 모델을 설정하면 자연어로 설계 변경을 제안받을 수 있습니다.
- **자료와 도구** — 참고 문서, 지식 저장소, 작업 지침(Skill), MCP 도구를 블록에 연결합니다. 자료의 특정 버전을 고정해 실행에 사용할 수 있습니다.
- **실행과 검토** — 조건 분기와 병렬 작업을 실행하고 블록별 기록을 확인합니다. 추가 질문이나 승인이 필요한 단계는 사용자 응답을 받아 재개합니다. 게시한 버전에는 예약·이벤트 시작 조건을 연결할 수 있습니다. [자동 시작 안내](docs/triggers.md)
- **버전과 공유** — 초안을 버전으로 저장하거나 이전 버전을 초안으로 복원합니다. 게시할 버전을 선택해 작업실에 공개하거나 비밀 링크로 공유합니다.

## 기술 스택 및 폴더 구조

작업실 패키지 `ai-agent-workflow-studio`는 Next.js 16.4.6(App Router), React 19.3.1, TypeScript 6.0.3을 사용합니다. 개발 서버와 프로덕션 빌드는 webpack을 사용합니다. 자료함은 fflate로 Skill ZIP을 읽고 쓰며 lucide-react로 아이콘을 표시합니다. [패키지 선언](package.json) · [설치 버전](pnpm-lock.yaml)

서버는 Node.js 내장 `node:sqlite`로 데이터를 저장합니다. `tsx`는 워커와 도서관 MCP 서버 기동, Node.js 회귀 테스트 실행에 사용합니다. 브라우저 테스트는 Playwright로 실행합니다. [기동 스크립트](scripts/start.mjs)

| 경로 | 역할 |
| --- | --- |
| `src/app/` | 페이지와 API 라우트. 작업실 요청의 서버 진입점은 `src/app/api/studio/route.ts` |
| `src/ui/` | 작업실 화면, 자료함, 실행 기록. 블록 편집기는 `src/ui/editor/` |
| `src/domain/` | 블록·연결 규칙, 그래프 검증, 실습 템플릿 |
| `src/engine/` | 블록 그래프 실행, 분기·병렬 처리, 대기 후 재개 |
| `src/server/` | 계정·권한, SQLite 저장, 모델·MCP 호출. `worker.ts`가 대기 중인 실행을 처리 |
| `src/mcp/` | 도서관 조회·예약 도구를 제공하는 독립 서버 |
| `scripts/`, `tests/` | 서비스 기동·테스트 실행 스크립트와 회귀·브라우저·실제 모델 테스트. 편집기 단위 테스트는 `src/ui/editor/`에도 있습니다. |
| `docs/`, `public/guide/captures/`, `design/` | 사용·개발 문서, 앱 가이드의 화면 캡처, 참고용 디자인 시안 |

기본 데이터 폴더는 `.studio-data/`입니다. 프로젝트·버전·대화·실행 기록은 `studio.sqlite`에, 도서관 예약과 처리 영수증은 `library.sqlite`에 저장됩니다. 질문이 화면에서 워커를 거쳐 답변이 되기까지의 경로는 개발자 가이드에서 따라갈 수 있습니다. [개발자 가이드](docs/DEVELOPER_GUIDE.ko.md) · [기능별 수정 위치와 테스트](docs/MAINTENANCE_TASKS.ko.md)

## 사전 요구사항 및 설치

Windows에 **Node.js 24 이상**과 **pnpm 12.16.1**을 준비한 뒤 프로젝트 루트의 PowerShell에서 의존성을 설치합니다.

```powershell
pnpm install --frozen-lockfile
```

Windows에서 설치와 개발 서버 실행을 한 번에 하려면 프로젝트 루트의 `start.cmd`를 실행하세요. 이 파일은 Next.js 패키지가 없으면 위 설치 명령부터 실행합니다.

## 환경 변수 설정

기본 포트에서 편집기와 도서관 MCP를 사용하려면 환경 파일 없이 시작할 수 있습니다. 설정을 바꾸려면 프로젝트 루트의 `.env.example`을 `.env.local`로 복사해 편집하세요. 이미 `.env.local`이 있으면 해당 파일에서 필요한 값만 수정합니다. [설정 예시](.env.example) · [환경 파일 로딩 방식](scripts/runtime-env.mjs)

```dotenv
PORT=3100
STUDIO_MCP_PORT=3101
OPENAI_API_KEY=
OPENAI_MODEL=
STUDIO_ADMIN_IDS=
```

- `PORT`는 웹 서버 포트, `STUDIO_MCP_PORT`는 내부 도서관 MCP 서버 포트입니다.
- AI 응답과 설계 제안에는 서버의 `OPENAI_API_KEY`와 해당 계정에서 사용할 수 있는 모델 ID인 `OPENAI_MODEL`이 모두 필요합니다. 비워 두어도 직접 편집, 자료 등록, 모델 호출이 없는 Workflow 실행은 가능합니다.
- 외부 HTTP MCP 서버를 등록할 운영자가 있으면 `STUDIO_ADMIN_IDS`에 작업실 계정의 내부 ID를 쉼표로 구분해 지정합니다.
- 데이터 저장 위치를 바꾸려면 `STUDIO_DATA_DIR`에 원하는 폴더를 지정합니다. 설정 변경 후에는 실행 중인 서비스를 다시 시작합니다.

## 로컬 실행, 테스트 및 빌드

### 개발 서버

```powershell
pnpm dev
```

이 명령은 웹 서버, 실행 워커, 도서관 MCP 서버를 함께 시작합니다. 기본 주소를 열어 **계정 만들기** 또는 로그인을 선택하세요. 종료할 때는 터미널에서 `Ctrl+C`를 누릅니다. [http://127.0.0.1:3100](http://127.0.0.1:3100)

**가이드 → 처음 시작하기 → 예제로 시작하기**를 누르면 도서관 안내 예제가 내 사본으로 열립니다. 모델을 설정했다면 **시험 실행 → 질문 실행**에서 회원증 준비물을 묻고, 답변을 이용 규정 원문과 비교해 보세요. [첫 실습 가이드](docs/FIRST_WORKFLOW_GUIDE.md) · [업무별 입력과 출력 예시](docs/WORKFLOW_USE_CASES.ko.md)

### 검증

| 명령 | 확인하는 내용 |
| --- | --- |
| `pnpm typecheck` | TypeScript 타입 오류 |
| `pnpm test` | 도메인, 편집기, 실행기, 저장소와 MCP 연동 회귀 테스트. MCP 시험에는 로컬 HTTP 연결 필요 |
| `pnpm test:browser` | 브라우저에서 편집·실행·공유 동작 확인. 자동으로 기동한 시험 서버에서는 모델 호출을 끔 |
| `pnpm test:live` | 실제 OpenAI 모델로 설계 제안과 Workflow 실행 확인. 서버 모델 설정이 필요하며 API 사용량 발생 |

`test:browser`와 `test:live`를 기존 작업실과 분리해 실행하려면 `STUDIO_TEST_URL`을 비워 두세요. 두 명령은 프로덕션 빌드 후 임시 데이터 폴더와 별도 포트로 시험 서버를 시작합니다. URL을 지정하면 해당 서버의 데이터와 모델 설정을 사용합니다. 브라우저 테스트에는 Windows에 설치한 Chrome을 사용할 수 있습니다. 다른 경로의 Chromium을 쓰려면 PowerShell 환경 변수 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`에 실행 파일 경로를 지정하세요. [테스트 실행 스크립트](scripts/test-browser.mjs)

### 프로덕션 빌드 및 실행

개발 서버를 종료한 뒤 프로젝트 루트에서 순서대로 실행합니다.

```powershell
pnpm build
pnpm start
```
