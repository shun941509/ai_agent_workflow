# Workflow 블록 실행·내보내기 최종 검증

2026-11-27 · Windows · 편집기 블록 32종 / 내부 실행 유형 41개

**두 검증기가 같은 최종 소스에서 32종 전체를 통과했다.** 작업 큐를 거친 워커 실행과 별도 SQLite에 저장했다가 다시 연 엔진 실행을 사용했다. 아래 블록별 표에서 각 블록의 결과, ZIP의 지침과 해당 ZIP을 함께 확인할 수 있다. [최종 워커 측정](../artifacts/agent-zip-audit/worker-results.json) · [독립 엔진 측정](../artifacts/agent-zip-audit/independent-results.json)

## 검증 기록

| 회차 | 검증 대상 | 관찰 및 조치 |
|---|---|---|
| 1 · 기준 확인 | 편집기 32종과 내부 유형 41개. 기존 Studio 실행, 단일·분할 ZIP과 준비·역할 문서 | 이전 대조에서 확인한 검색 후보 중복, 위임 문맥, 객체 일부만 검사, 조기 파일 저장, 승인 인자 재평가, 점수 표시, 합류·복귀와 자료 선택 등으로 수정 범위를 정했다. [이전 실행별 근거](AGENT_ZIP_BLOCK_AUDIT.ko.md) |
| 2 · 원문과 연결 자료 | 직접 연결한 원문과 발행 자료집의 중복 인용, 원문 판·색인 판, 같은 이름의 자료와 Skill, 중첩 MCP | 검색 상한을 적용하기 전에 중복을 제거하고 CR·LF·CRLF의 행 번호를 맞췄다. 발행과 철회에서 각각 실제 대상 스냅숏을 선택한다. 같은 이름의 자료는 선택 전에 구분하고, 누락된 상대 파일과 MCP 판은 실제 소비 단계에 표시한다. [검색·근거 시험](../tests/evidence-original.test.ts) · [ZIP 자료 시험](../tests/agent-export-data.test.ts) · [호출별 판 시험](../tests/agent-export-shared-editions.test.ts) |
| 3 · 값·승인·파일 | 도구에 보낸 인자, 중첩 필드·배열, 점수 미달 결과, 가림 전후의 파일·대화 | 승인 식을 다시 쓴 경우에도 확인했던 인자를 보냈다. 서로 다른 값이면 다시 승인을 받는다. 검증과 변환이 같은 필드를 읽고, 업무 객체 전체를 검사한 뒤 최종 결과에 남은 생성 파일을 전달한다. [승인·값·판정 시험](../tests/block-contract-parity.test.ts) · [파일·민감정보 시험](../tests/structured-file-privacy.test.ts) |
| 4 · 하위 역할과 복귀 | 위임 질문, 팀 Skill, 공유 저장판, 반복 중 회신, 병렬 인계 후 합류 | 하위 역할의 모델에 실제로 전달된 질문·Skill·도구를 배정 문서와 대조했다. 항목 종료는 반복 제어기로 복귀하고, 병렬 인계의 담당자가 다르면 합류에서 팀 담당자가 이어받는다. [역할 범위 시험](../tests/agent-behavior.test.ts) · [역할 ZIP 시험](../tests/agent-role-export.test.ts) · [합류·복귀 시험](../tests/agent-parallel-export.test.ts) |
| 5 · 복합 설계 재실행 | 같은 설계에서 만든 ZIP과 SQLite 작업 큐로 실행한 결과 | 회신은 원래 실행에 접수하고 워커를 다시 호출한다. 블록별 출력·선택한 출구·실제 파일·도구 결과를 사례별로 검사한다. ZIP을 해제해 단계 본문, 로컬 링크와 준비 항목도 검사한다. [복합 설계와 기대값](../scripts/verify-agent-export/worker-cases.mjs) · [워커·ZIP 대조](../scripts/verify-agent-export/worker.mjs) |

복합 설계는 임시 SQLite 저장소에서 실행했다. 모델 응답은 고정된 시험 응답을 사용했고 도서 예약 생성·취소는 임시 포트로 띄운 로컬 도서관 MCP에 전송했다. 아래 표에서 **Studio 실행**은 워커 결과와 해당 행의 회귀 시험에서 확인한 값이다. **ZIP 지침**은 압축을 풀어 확인한 동작 안내다. [실행 코드](../scripts/verify-agent-export/worker.mjs)

## 32종 블록별 실행 결과와 ZIP 지침

번호는 이전 감사와 같은 편집기 안내서의 순서다. 마지막 열의 ZIP에서 `AGENTS.md`를 열면 해당 블록이 포함된 복합 설계를 읽을 수 있다. 옆의 시험은 대기·실패·자료 선택 등 그 행에서 다룬 조건을 재현한다. [블록 사용 안내서](WORKFLOW_BLOCK_GUIDE.md) · [워커의 블록·사례 대응표](../artifacts/agent-zip-audit/worker-results.json)

| 번호 | 블록 | Studio 실행 | ZIP 지침 | 복합 설계 · 시험 |
|---:|---|---|---|---|
| 01 | 사용자 입력 | 분류 표본에서 입력 문자열 `분류 입력`이 후속 단계까지 유지됐다. 최상위 실제 첨부에서는 질문을 꺼내고, 하위 호출에서는 전달받은 값을 사용한다. | 직접 붙인 JSON, 첨부에 딸린 질문, 하위 Workflow의 호출 입력을 구분한다. | [분류 ZIP](../artifacts/agent-zip-audit/classify.zip) · [입력 처리](../src/engine/operations.ts) |
| 02 | AI 작업 | 단발 작업은 `확인됨`을 반환했다. 목표형 작업은 내부 검토 Workflow 도구를 호출한 뒤 완료 판정을 받았다. | 단발에서 호출할 도구는 0개다. 목표형의 초안과 완료 판정은 전체 모델 호출 한도를 함께 소비한다. | [내부 도구 ZIP](../artifacts/agent-zip-audit/agent-workflow-tool.zip) · [호출 한도 시험](../tests/agent-budget-export.test.ts) |
| 03 | 답변 전달 | 성공 종료의 최종 문구는 `마침`이었다. 하위 호출은 JSON 객체나 여러 종료값을 반환할 수 있고, 변경 도구가 성공한 뒤 실패하면 확인된 처리 결과가 남는다. | 활성 경로가 끝나면 결과를 한 번 전달한다. 후속 실패·중단 시 이미 처리된 작업과 처리 번호를 사용자에게 알린다. | [종료 ZIP](../artifacts/agent-zip-audit/evaluation.zip) · [영수증 시험](../tests/agent-behavior.test.ts) · [복수 종료 시험](../tests/agent-parallel-export.test.ts) |
| 04 | 자료 가져오기 | 원문의 2행 `연장 2회`가 근거로 전달됐다. 이름과 판이 같은 자료도 서로 다른 선택 항목으로 표시된다. | 포함한 원문의 식별자와 판을 표시한다. 고유한 파일명의 상대 링크는 바이트를 유지해 배치하고, 빠진 부속 파일은 해당 자료를 쓰는 단계에서 요청한다. | [원문 ZIP](../artifacts/agent-zip-audit/evidence.zip) · [동명 자료·상대 링크 시험](../tests/agent-export-data.test.ts) |
| 05 | 입력 양식·추가 질문 | 도시 입력과 회신 대기를 같은 실행에서 재개했다. 필수값이 공백이면 같은 양식에서 보완한다. 마감 1ms 전 접수는 늦게 처리해도 유효했고, 정각 접수는 만료됐다. | 기한을 쓰면 최초 요청에서 마감 시각을 표시하고 재개·보완 중에도 회신 번호와 기한을 유지한다. 마감 전 유효 회신이 없으면 오류 경로로 간다. 기한 없는 양식은 계속 기다린다. 숫자 입력은 문자열로 전달한다. | [회신 ZIP](../artifacts/agent-zip-audit/waits.zip) · [접수 경계 시험](../tests/engine-api.test.ts) · [단일·분할 지침](../tests/agent-zip.test.ts) |
| 06 | 파일 입력 | 실제 `input.JSON` 첨부를 받았다. 별도 파일 요청 모드에서는 최초 첨부와 확장자가 같아도 새 파일을 기다렸다. | 최초 요청의 첨부를 쓰는 조건, 이 단계에서 새 첨부를 받는 조건과 시험용 예시 파일을 구분한다. | [첨부 ZIP](../artifacts/agent-zip-audit/file-transform.zip) · [첨부 모드 시험](../tests/run-material-contracts.test.ts) |
| 07 | 문서 내용 읽기 | 대문자 JSON 확장자를 자동 인식해 숫자 필드를 유지했다. CSV의 빈 셀, 따옴표와 셀 내부 줄바꿈을 읽고 빈 줄을 포함한 원문 행을 따로 제공했다. | 파싱한 JSON 또는 CSV 행·셀 배열을 전달한다. 원문 위치는 CR·LF·CRLF로 구분한 물리적 행 번호를 쓴다. | [문서 읽기 ZIP](../artifacts/agent-zip-audit/file-transform.zip) · [CSV 왕복 시험](../tests/structured-file-privacy.test.ts) |
| 08 | 파일 만들기 | 생성한 `id.json`의 본문은 `7`이었다. CSV를 다시 썼을 때 빈 셀과 인용된 셀 내용이 보존됐다. 가린 파일은 처리된 이름과 본문으로 전달됐고 차단·실패 표본의 다운로드는 0개였다. | JSON은 두 칸 들여쓰기를 쓴다. CSV는 열·행 순서, 빈 셀과 셀 안 따옴표·개행을 보존한다. 다음 단계에 파일 객체를 전달하고 전체 성공 후 최종 결과에 포함된 파일을 `outputs/`에 저장한다. | [파일 생성 ZIP](../artifacts/agent-zip-audit/file-transform.zip) · [형식·저장 시점 시험](../tests/agent-output-export.test.ts) |
| 09 | AI 분류 | `일정` 출구를 골랐고 `value`에는 원래 입력 문자열이 남았다. | `category` 데이터선에는 선택한 범주를 보낸다. 미분류에서는 `other` 출구를 사용하고 해당 필드는 `null`이다. | [분류 ZIP](../artifacts/agent-zip-audit/classify.zip) · [범주 출력 시험](../tests/block-contract-parity.test.ts) |
| 10 | 조건 분기 | `맞음`과 다른 입력에서 `no` 출구가 선택됐다. 조건의 원문을 합류에 직접 연결하면 선택한 분기의 결과와 함께 전달될 수 있다. | 실행 출구는 하나를 선택한다. 값이 있음 조건에서는 `false`, `0`, 빈 목록이 거짓이고 문자열 `"false"`, `"0"`, 빈 객체는 참이다. | [조건 ZIP](../artifacts/agent-zip-audit/condition.zip) · [분기와 값 연결](../src/server/agent-parallel-instructions.ts) |
| 11 | 자료 검색 | 같은 3일 규정을 발행본과 직접 참조로 두 번 공급했다. 상위 2건에 3일·5일이 모두 남았고, 문구 일치와 관련도 검색 결과가 같았다. | 원문 식별자·판·위치·인용이 같은 구절은 한 건으로 센다. 결과에 원문 판 `version`, 색인에서 찾은 판 `indexVersion`, 등록 자료에만 `assetId`를 기록한다. | [검색 ZIP](../artifacts/agent-zip-audit/evidence.zip) · [중복·물리 행 시험](../tests/evidence-original.test.ts) |
| 12 | 근거·출처 확인 | 원문 2행을 검증해 `sourceLines`로 반환했다. 3일·5일 규정은 `conflicting`이 됐다. 판이 비어 있는 필수 검증은 판 회신 후 같은 판의 원문을 대조했다. | 후보 일치, 연결 원문 검증, 회신 원문 검증, 근거 부족과 상충을 구분한다. 요구한 판과 위치를 확인해야 원문 대조를 마친다. | [근거 ZIP](../artifacts/agent-zip-audit/evidence.zip) · [판 확인·회신 시험](../tests/evidence-original.test.ts) |
| 13 | 도구 사용 | 로컬 도서관에 예약을 생성하고 반환된 예약 번호로 보상 취소해 `cancelled`를 받았다. | 연결판의 읽기 전용 여부와 변경 승인, 수동 서버의 인증 준비를 표시한다. 응답을 잃었으면 호출 ID로 처리 상태를 확인한다. | [보상 취소 ZIP](../artifacts/agent-zip-audit/compensate.zip) · [MCP 연동 시험](../tests/engine-mcp.test.ts) |
| 14 | 행동 승인 | 승인한 `book` 값 `샘플`이 실제 예약에 전달됐다. 같은 인자 식은 승인값을 재사용하고 다른 식으로 값이 달라지면 다시 승인받았다. | 승인 회신의 `approved`, `approvalId`, `args`와 한 번의 사용 범위를 적는다. 고정한 비밀값은 필드·형식을 남기고 실행 환경에서 채운다. | [승인 ZIP](../artifacts/agent-zip-audit/approval.zip) · [실제 전송 인자 시험](../tests/block-contract-parity.test.ts) |
| 15 | 값 변환 | 첨부 객체에서 숫자 `id`를 선택했다. 배열 경로 `0.id`와 이름에 점을 포함한 실제 키도 읽었다. | 경로 선택, 이름 전체를 키로 쓰는 변환, 누락 시 실패와 첨부 선택값의 문답 보존을 설명한다. | [변환 ZIP](../artifacts/agent-zip-audit/file-transform.zip) · [경로 시험](../tests/block-contract-parity.test.ts) |
| 16 | 데이터 검증 | 첨부의 숫자 `id=7` 검사를 통과했다. 경로 검사에서 공백 문자열과 빈 목록은 필수값 누락으로 처리됐다. | 변환과 같은 객체·배열 경로를 검사한다. 숫자와 숫자 문자열을 구분하고 `0`과 `false`를 유효한 값으로 전달한다. | [검증 ZIP](../artifacts/agent-zip-audit/file-transform.zip) · [필수값·형식 시험](../tests/block-contract-parity.test.ts) |
| 17 | 오류 처리 | 변환에서 찾지 못한 `missing`이 오류 처리기의 안내에 들어갔다. 두 단계가 실패한 표본에서는 두 실패 사유가 모두 남았다. | 실패 단계별 사유를 모으고 계속·중단 전략을 따른다. 하위 병렬의 전체 중단은 호출 부모의 처리기까지 건너뛴다. | [오류 처리 ZIP](../artifacts/agent-zip-audit/errors.zip) · [복수 실패 시험](../tests/block-contract-parity.test.ts) |
| 18 | 민감정보 검사·처리 | 이메일을 가린 뒤 결과를 전달했다. 본문 밖의 `caseId`, 중첩 객체, 파일 이름과 내용도 검사했으며 가림 뒤 구조가 유지됐다. | 후속 단계·하위 역할·다음 문답에 처리된 값을 전달한다. 기존 대화를 자동으로 붙이는 클라이언트는 처리된 문맥으로 새 세션에 인계한다. | [가림 ZIP](../artifacts/agent-zip-audit/privacy.zip) · [파일·업무 객체 시험](../tests/structured-file-privacy.test.ts) · [이력 시험](../tests/model-history-privacy.test.ts) |
| 19 | Agent 팀 | 두 하위 담당자의 결과를 부모에게 반환했다. 팀이 가진 Skill A·B 중 A를 선택한 하위 작업은 A만 받았다. | 팀이 보유한 Skill 후보와 배정이 선택한 지침을 구분한다. 같은 설계에서 Skill의 포함 여부가 바뀌어도 원문 폴더 이름이 유지된다. | [팀 ZIP](../artifacts/agent-zip-audit/parallel-team.zip) · [팀 Skill 시험](../tests/agent-role-export.test.ts) |
| 20 | Agent에게 작업 전달 | 위임·인계 역할을 호출해 각각 결과를 받았다. 업무 전용 역할에서는 범위 밖 요청을 주 입력과 참조용 원래 질문 양쪽에서 제외했다. | 배정 번호에 맞는 공통 역할 지침을 사용한다. 서로 다른 담당 경로가 합류하면 현재 팀 또는 Workflow 담당자가 이어받는다. | [위임·인계 ZIP](../artifacts/agent-zip-audit/parallel-team.zip) · [질문 범위 시험](../tests/agent-behavior.test.ts) |
| 21 | 병렬 작업 | 두 담당자를 시작해 결과를 모았다. 상한 10인 블록에 독립 작업 6개를 주어도 기본 모델 동시 실행은 4개였다. | 활성 분기에 작업을 배정하고 공유 한도를 적용한다. 전체 중단이면 이미 끝난 결과·처리 번호를 남기고 대기와 후속 호출을 끝낸다. | [병렬 ZIP](../artifacts/agent-zip-audit/parallel-team.zip) · [공유 한도 시험](../tests/agent-budget-export.test.ts) |
| 22 | 결과 모으기 | 두 역할의 결과가 연결 순서의 목록으로 반환됐다. 단일 데이터 경로의 `0`, `false`, 빈 문자열, `null`도 각각 한 항목으로 남았다. | 선택된 실행 출구와 합류로 들어오는 직접 데이터선을 구분한다. 실제 단계 실패와 정상 업무 객체의 `error` 필드를 구별한다. | [합류 ZIP](../artifacts/agent-zip-audit/parallel-team.zip) · [합류 결과 시험](../tests/agent-parallel-export.test.ts) |
| 23 | Workflow 재사용 | 직접 호출이 목록 `["A","B"]`를 반환했다. 두 바깥 호출의 안쪽 역할 A·B가 실제로 사용한 MCP 판은 차례로 1·2·1·2였다. | 공통 저장판은 한 벌이며 직접 호출은 해당 단계로, 도구 호출은 호출한 Agent의 다음 판단으로 돌아간다. 1판만 담으면 README는 두 바깥 호출 각각에서 안쪽 B가 필요한 2판을 표시한다. | [하위 호출 ZIP](../artifacts/agent-zip-audit/iterations.zip) · [공유 저장판·호출 경로 시험](../tests/agent-export-shared-editions.test.ts) |
| 24 | 사람 검토 | 검토 회신 `좋습니다`가 다음 값이 됐다. 검토 문구에 공백이 든 입력 치환을 써도 초안은 한 번 표시됐다. | 병렬 검토의 회신을 요청 번호별로 해당 초안에 연결한다. 다른 경로가 실패하면 계속 진행 정책에서는 회신을 기다리고, 전체 중단 정책에서는 남은 검토도 종료한다. | [검토 ZIP](../artifacts/agent-zip-audit/waits.zip) · [초안·검토 회신 시험](../tests/block-contract-parity.test.ts) · [병렬 검토 지침](../tests/agent-zip.test.ts) |
| 25 | 기억 읽기·쓰기 | 같은 키에서 저장한 문자열을 읽었다. CSV를 기억에 썼다가 다시 파일로 만들어도 행·열, 빈 셀, 셀 내부 개행이 보존됐다. | 객체·배열·스칼라의 자료형을 유지하고 기존 텍스트 기억을 읽는다. 시험 대화와 실사용 이용자·Workflow의 저장 범위를 표시한다. | [기억 ZIP](../artifacts/agent-zip-audit/storage.zip) · [구조화 기억 시험](../tests/structured-file-privacy.test.ts) |
| 26 | 시작 조건 | 수동 시작에서 단발 응답을 받았다. 지원하지 않는 cron 식 `0 9 * * *`은 설계 검증에서 지적됐다. | 수동·예약·이벤트 시작 원인과 매일 일정의 한국 표준시를 명시한다. 지원하지 않는 예약식은 해당 단계에서 고치도록 안내한다. | [시작 조건 ZIP](../artifacts/agent-zip-audit/basic-trigger.zip) · [일정 검증 시험](../tests/block-contract-parity.test.ts) |
| 27 | 반복 처리 | 첨부 목록의 A·B를 순서대로 처리하고 반환했다. 회신을 기다리는 반복에서는 모든 항목을 마쳐야 다음 단계가 실행된다. | 각 항목의 종료는 반복 제어기로 돌아간다. 모든 항목의 결과 목록을 구성한 뒤 부모의 다음 경로를 한 번만 진행한다. | [반복 ZIP](../artifacts/agent-zip-audit/iterations.zip) · [분할 단계의 복귀 시험](../tests/agent-parallel-export.test.ts) |
| 28 | 담당자·작업 선택 | 작업 순서 목록과 한 명 선택을 연달아 실행해 B를 다음 배정 대상으로 전달했다. | 등록 후보만 응답 순서로 남긴다. 한 명 선택은 첫 유효 이름, 작업 순서 선택은 중복 제거 후 한도 내의 목록을 반환하고 유효 후보가 없으면 실패한다. | [선택 ZIP](../artifacts/agent-zip-audit/selection.zip) · [구형·현재 후보 시험](../tests/agent-behavior.test.ts) |
| 29 | 결과 평가 | 72점에 기준 75로 `passed=false`였다. 69.5점 표본에서 모델이 기준 20과 통과를 제시해도 텍스트·JSON 양쪽에 설정값 `threshold=70`과 미달 판정이 표시됐다. | 입력·점수·설정 기준·이유·판정을 전달한다. 숫자 점수와 공백이 아닌 이유를 확인하고, 실제 점수·기준·판정·이유를 텍스트와 JSON에 표시한다. | [평가 ZIP](../artifacts/agent-zip-audit/evaluation.zip) · [두 형식의 점수 표시 시험](../tests/block-contract-parity.test.ts) |
| 30 | 필요한 Agent 만들기 | B의 역할과 결과가 `results`에 남았다. 생성 한도를 넘은 경우 사용자 선택을 기다리며, 원문 필수 배정은 후보 문구만으로 완료되지 않는다. | 대상별 결과와 제외 대상, 한도에 따른 선택 사유·요청 수·선택 수를 기록한다. 필수 원문은 해당 판과 위치를 대조한 뒤 배정을 마친다. | [동적 배정 ZIP](../artifacts/agent-zip-audit/selection.zip) · [배정별 근거 시험](../tests/agent-original-evidence-export.test.ts) |
| 31 | 지식 저장소 관리 | 등록·직접 입력 1판 문서를 자료집 7판으로 색인해 두 판을 따로 확인했다. 철회 표본에서 현재 발행본과 다음 초안의 내용이 달랐다. | 발행은 현재 색인, 철회는 발행 중인 스냅숏을 사용한다. 뒤쪽 발행 단계는 앞선 검색의 준비 안내를 없애지 않는다. 같은 판의 기존 발행 내용과 다른 색인은 새 판을 준비한다. | [색인 ZIP](../artifacts/agent-zip-audit/knowledge.zip) · [발행·철회 시험](../tests/agent-export-data.test.ts) |
| 32 | 문맥 정리·압축 | 평가 뒤 요약과 성공 종료까지 진행했다. 별도 시험에서 지정한 파일명·원문 위치와 글자 수 상한을 검사했다. | 한글 조합 자소처럼 함께 표시되는 묶음을 한 글자로 센다. 빈 요약, 지정한 참조 누락, 길이 초과는 실패 경로를 따른다. | [압축 ZIP](../artifacts/agent-zip-audit/evaluation.zip) · [길이·보존 시험](../tests/run-material-contracts.test.ts) |

## 전수 검사 횟수와 최종 대조

같은 제품 소스에 대해 워커와 독립 엔진의 32종 전수 대조를 차례로 끝낸 것은 **두 쌍, 총 4회**다. 앞 표의 1~5는 발견과 수정의 순서를 기록한 것이다. 아래 횟수에는 표본 재실행, 이전 감사, 전체 단위 시험에 포함된 엔진 검사의 중복 실행을 더하지 않았다.

| 시점 | 결과 |
|---|---|
| 1~2회 · 중간 워커와 독립 엔진 | 소스 식별값 `362059b49eee`에서 모두 통과했다. 전체 자동 시험 387건도 통과했다. 이후 인수 기준과 문장을 다시 대조하면서 평가 결과의 실제 통과 기준, 회신 마감 정각과 지연 처리, 병렬 검토 대기, CSV·JSON 생성 규칙을 보완했다. 앞선 통과 기록은 최종 연속 횟수에서 제외했다. |
| 3회 · 최종 워커 | 설계 17개를 단일·분할 두 형식으로 실행해 34건 모두 완료했다. 최초 실행·재개 46회, 회신 12건, 시험용 모델 호출 26회를 관찰했다. 이 34개와 유형별 내보내기 82개, 기본 실습 13개 × 자료 선택 3가지의 ZIP을 합쳐 **155개**를 대조했다. Markdown 링크 2,683개와 단계별 준비 안내 169건이 일치했다. 자료·Skill 파일은 변환 후 예상 바이트와 해제한 바이트를 비교했다. [워커 결과와 ZIP 해시](../artifacts/agent-zip-audit/worker-results.json) |
| 4회 · 최종 독립 엔진 | 워커의 설계 모음·기대값을 재사용하지 않고 별도 SQLite에서 **서로 다른 86개 설계**를 다시 열었다. 엔진 진입·회신 재개 129회 각각의 ZIP을 해제했다. 단일 123개·분할 6개에서 단계 본문 650개, 실행 결과 이벤트 540개, 연결 목적지 994개, 링크·앵커 867개를 대조했다. 일부 표본의 미등록 자료·Skill은 예상한 준비 안내로 검증했다. [독립 결과](../artifacts/agent-zip-audit/independent-results.json) · [독립 검증기](../tests/engine-export-matrix.ts) |

마지막 두 회차는 같은 실행·내보내기 소스 SHA-256 `2718a4304ad5e11fd2a9934030dd5ab5f6f74389bca27a5e22f4bb3d62b4050e`에서 연속 통과했다. 두 검사 모두 실행 전후의 식별값을 확인한다. 두 회차에서 추가로 발견한 불일치는 0건이었다. 앞선 통합 시험에서는 361건 중 5건이 실패해 역할 지침·자료 준비·예약식 기대값을 제품 동작과 대조해 고쳤다. 마지막 전체 자동 시험은 **390/390**, 실패·건너뜀 0건이었다. TypeScript 검사와 격리 프로덕션 빌드도 통과했다. [소스 식별 범위](../scripts/verify-agent-export/source.mjs) · [두 번째 검사 재실행](../scripts/verify-agent-export/independent.mjs)

## 실행 화면과 산출물

공식 Studio 화면 회귀 35개가 2026-11-27 02:19 KST에 종료 코드 0으로 끝났다. 독립 프로덕션 빌드, 임시 SQLite와 Chrome 157을 사용했다. 첫 재시험에서 실습 안내의 일반 목록과 현재 사본의 목록을 구분하도록 선택자를 고쳤고, 분류 연결에서는 새 데이터선의 기본 선택 상태와 실제 적용을 확인했다. 최종 순차 실행은 공유 MCP의 인증, 예약·이벤트 트리거까지 통과했다. 보충 실행은 35개에 중복 합산하지 않았다. [시험 35개의 이름·종료 상태·재시도 이력](../artifacts/agent-zip-audit/browser-results.json)

Chrome에서 1440px로 실제 에디터를 열었다. 적용한 초안, 같은 이름의 자료 두 개 중 한 개만 선택하기, 선택한 MCP만 포함하기, 분할 단계 찾기, 하위 역할 두 개와 공유 저장판을 실제 다운로드 파일과 대조했다. 원문 판이 없는 후보에는 판 번호를 회신하고 해당 판의 원문 파일을 첨부했다. 같은 실행에서 원문을 확인한 뒤 답변이 나왔으며 모델 호출은 1회였다. 동적 담당자의 준비 조치·이유도 내보내기 화면과 다운로드 README에 함께 나타났다. [브라우저 다운로드 시험](../tests/agent-export-browser.ts)

- **단계별로 나눈 실사용 예시**는 기본 실습 ‘개발자와 QA가 코드 변경 함께 검토하기’를 내보낸 ZIP이다. 압축을 한 번 풀고 그 폴더를 클라이언트에서 연다. 26개 파일 중 단계 문서가 12개, 공통 역할 원문이 2개다. 진입점은 `AGENTS.md`이고 `CLAUDE.md`는 이를 참조한다. [단계별 프로젝트 ZIP](../artifacts/agent-zip-audit/step-workflow.zip)
- **32종 전체의 워커 표본**은 설계별 ZIP 17개를 묶어 제공한다. 모음을 해제한 다음 확인할 설계의 ZIP을 한 번 더 풀어 그 폴더를 연다. 위 표의 개별 ZIP 링크를 사용하면 한 번만 풀면 된다. 묶음 안 17개 파일을 각각의 원본 ZIP과 바이트 단위로 대조했다. 묶음의 SHA-256은 `60e42dcd6bb594728a137808ce436e2466ae30a5d3b869bced4fe2e5ac22bf3d`다. [17개 설계 ZIP 모음](../artifacts/agent-zip-audit/verified-workflows.zip)
- **준비가 필요한 설계**도 같은 메뉴에서 다운로드할 수 있다. `README.md`에 단계별로 필요한 원문, 회신 또는 외부 연결과 그 이유가 표시된다. 클라이언트는 자기 모델과 권한을 사용한다. 내장 도서관 연결을 사용하는 표본은 실행할 환경의 MCP가 필요하다. 검증용 서버와 계정은 제품 ZIP에 들어 있지 않다. [준비 항목과 ZIP 대조](../src/domain/export-resource-preparation.ts)

## 주요 변경 파일

| 범위 | 변경한 내용과 소스 |
|---|---|
| 블록·준비 상태 | 분류의 선택 범주 데이터선, 일정 문법과 미완성 설계의 단계별 준비 조치. [블록 포트](../src/domain/catalog.ts) · [설계 검사](../src/domain/graph.ts) · [시간 계산](../src/domain/schedule.ts) · [설계 준비](../src/domain/export-design-preparation.ts) |
| 실행·재개 | 승인한 실제 인자와 구형 체크포인트, 복수 실패 원인, 배열·자료형·평가 결과, 위임 범위, 병렬 복귀, 가림·차단과 최종 파일을 수정했다. [단계 실행](../src/engine/operations.ts) · [워크플로 실행](../src/engine/index.ts) · [값·검색](../src/engine/values.ts) · [민감정보 처리](../src/engine/model-privacy.ts) · [실행 저장](../src/server/runs.ts) |
| 원문·준비 자료 | 원문 판과 색인 판, 발행·철회 대상, 중첩 MCP의 호출자별 판, Skill 부속 파일과 자료 선택 정보를 맞췄다. [지식 저장소](../src/server/knowledge.ts) · [자료 선택](../src/server/agent-export.ts) · [Skill ZIP](../src/server/agent-skill-export.ts) · [MCP ZIP](../src/server/agent-mcp-export.ts) · [내보내기 화면](../src/ui/editor/AgentExportDialog.tsx) |
| 생성 지침 | 단일·분할 진입점, 하위 역할 배정과 호출 한도, 여러 종료·중단·합류 시점, 성공한 최종 파일의 형식과 저장 시점을 맞췄다. [ZIP 생성](../src/server/agent-zip.ts) · [단계 문서](../src/server/agent-instruction-layout.ts) · [역할](../src/server/agent-delegation.ts) · [합류](../src/server/agent-parallel-instructions.ts) · [파일 출력](../src/server/agent-output-instructions.ts) |
| 회신·이력·이전 기록 | 검토의 입력 표시, 실제 사용자 질문, 필드별 이력 보존, 회신 기한과 예전 체크포인트의 파일 처리를 현재 실행과 맞췄다. [양식](../src/domain/reply-form.ts) · [질문 범위](../src/engine/request-scope.ts) · [세션](../src/engine/session.ts) · [이전 파일 기록](../src/engine/legacy-files.ts) · [예약 실행](../src/server/triggers.ts) |
| 근거·역할·실행 화면 | 자료판 원문을 회신으로 받는 경로, 근거 대조 수준 표시, 팀 문맥·한도를 역할 문서와 연결했다. [원문 대조](../src/engine/evidence.ts) · [근거 표시](../src/ui/evidence-result.ts) · [실행 패널](../src/ui/RunPanel.tsx) · [팀 문맥](../src/domain/agent-context.ts) · [실행 상한](../src/engine/limits.ts) · [ZIP 한도 안내](../src/server/agent-budget-instructions.ts) |
| 공유 설계·첨부 원문 | 호출 위치별 공유 설계 판과 실제 ZIP에 포함할 참고 파일을 결정한다. [공유 Workflow 해석](../src/server/workflow-refs.ts) · [ZIP 자료 파일](../src/server/agent-material-files.ts) · [내보내기 데이터 형식](../src/domain/agent-export.ts) |
| 검증·안내 | 워커·독립 SQLite·세 CLI에서 같은 산출물을 확인할 수 있게 했다. 블록별 회귀 시험은 위 32행에 연결했다. [워커](../scripts/verify-agent-export/worker.mjs) · [별도 엔진과 ZIP](../tests/engine-export-matrix.ts) · [세 CLI](../tests/agent-export-native.ts) · [사용 안내](WORKFLOW_BLOCK_GUIDE.md) · [유지보수 안내](MAINTENANCE_TASKS.ko.md) |

## 검증 범위

사용자가 선택한 로컬 범위에서 모델 호출은 고정 응답이나 로컬 HTTP 모델 대역을 사용했다. Studio 계정·SQLite·작업 큐·워커·체크포인트·도서관 MCP·브라우저·ZIP 생성 및 해제는 실제 구현을 실행했다. 실제 OpenAI API 시험은 외부 전송·비용 승인 검토에서 보류됐고, 사용자가 로컬 결과로 마무리하도록 선택했다. 상용 모델의 자연어 판단 품질과 사용자가 연결한 외부 MCP의 자격 증명·가용성은 이번 합격 범위 밖이다.

원문 판이 옛 색인에 덮어써져 남아 있지 않으면 당시의 원문 판을 복원할 수 없다. ZIP은 실행한 경로에서 이미 발행이 보장되는 자료를 기준으로 준비를 안내한다. 글자 수·명시한 파일명·원문 위치는 Studio에서 검사한다. 자유문장으로 지정한 보존 요구와 외부 클라이언트에서의 지침 준수는 선택한 모델과 도구에 달려 있다.

### 실제 클라이언트에서 압축을 푼 결과

세 CLI가 워커에서 저장한 동일한 `parallel-team.zip`과 `agent-workflow-tool.zip`을 수정 없이 읽었다. 각 CLI를 빈 임시 프로필로 시작하고 외부 계정 대신 로컬 HTTP 모델 대역에 연결했다. 최종 ZIP 해시, 호출 수, 실제 등록된 역할 이름과 결과 회수는 [클라이언트별 실행 기록](../artifacts/agent-zip-audit/native-results.json)에서 확인할 수 있다. [네이티브 시험](../tests/agent-export-native.ts)

| 클라이언트 | 프로젝트·Skill | 실제 하위 호출과 결과 | 역할 원문 읽기 |
|---|---|---|---|
| Codex CLI 0.171.0 | 공통 진입점과 Skill 등록 확인 | 검토·편집 두 세션을 생성하고 두 결과를 회수했다. 로컬 모델 요청 8회 | 읽기 전용 Windows 시험 환경이 두 `Get-Content` 프로세스의 시작을 `blocked by policy`로 거부했다. 두 역할이 본문까지 읽고 작성한 결과는 미확인이다. |
| Claude Code 2.1.87 | `CLAUDE.md` 경유 진입점과 Skill 등록 확인 | 두 하위 역할을 호출해 배정별 결과 2개를 회수했다. 로컬 모델 요청 6회 | 두 역할 모두 해당 Markdown을 읽었다. Node.js 24.20.0에서 확인했다. |
| OpenCode 1.19.6 | 공통 진입점과 Skill 등록 확인 | 네이티브 `task`로 두 역할을 호출해 결과 2개를 회수했다. 로컬 모델 요청 7회 | 두 역할 모두 네이티브 `read`로 해당 Markdown을 읽었다. |

네이티브 조합 6건 중 5건은 통과했고 Codex의 병렬 역할 조합 1건은 부분 검증이다. 검증기는 읽기를 시도한 파일과 정책 거부가 확인되면 부분 검증(종료 코드 2)으로 표시한다. 다른 원인으로 읽지 못하면 실패 처리한다. Codex의 원문 읽기까지 확인하려면 해당 프로젝트의 Markdown 읽기 명령이 허용된 Codex 환경에서 같은 시험을 실행하면 된다. 현재 실패 기록에는 숫자 Windows 오류 코드가 없다.

## 종료 조건별 근거

| 종료 조건 | 최종 측정 |
|---|---|
| 32종 전수 및 Studio 실행 | 32/32, 내부 유형 41/41. 두 검증기 모두 실제 실행 결과 이벤트에서 모든 유형을 관찰했다. 워커는 대기 후 같은 실행의 회신, 완료 상태, 실제 MCP 결과도 검사했다. |
| Studio와 ZIP의 파일·지침 일치 | 두 최종 전수 시험의 단일·분할·자료 선택·연결·준비 안내 대조에서 불일치 0건. 전체 설계의 가능한 모든 설정 조합을 열거한 수치는 아니다. |
| 확인한 오류·누락·충돌 및 미해결 개선 | 위 수정 목록의 사례를 재현한 시험이 모두 통과했다. 두 마지막 로컬 전수 시험에서 발견한 새 제품 문제 0건. Codex 자식의 역할 원문 읽기는 위 환경 제약으로 별도 기록했다. |
| 기존 기능 회귀 | 자동 회귀 390/390, 공식 Studio 브라우저 시험 35/35. 실패·건너뜀 0건. 실제 다운로드와 원문 회신도 통과했다. |
| 최종 ZIP과 제품 소스의 동기화 | 최종 워커가 생성한 단일 예시 17개와 단계별 예시 1개의 해시를 저장했다. 두 네이티브 표본은 세 클라이언트에서 각각 최종 파일 해시가 일치했다. |
| 마지막 수정 후 독립 전수 2회 연속 | 워커와 별도 엔진 검증기에서 같은 소스 해시로 통과. 각 회차의 새 실패·불일치 0건. |
