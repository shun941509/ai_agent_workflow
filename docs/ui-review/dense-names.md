# 320px 편집기에서 블록 이름 읽기

[실제 화면 전후 비교 5쌍](dense-names.html) · [전체 보기 비교 이미지](dense-names-320.webp)

직전 전달 빌드 `5GJ4v1RvdnbnfWCIj9I_i`를 수정 전 기준으로 삼았다. Windows Chrome에서 320×740px 뷰포트에 카탈로그 41종을 다섯 열로 배치하고 **전체 보기**를 눌렀다. 기본 도면과, 같은 도면에 **내 자료로 안내하기** 실습의 저장된 연결 8개를 배치한 경우를 각각 확인했다. [수정 전 실측](../../.local/ui-name-review/before/report.json)

### 이름과 헤더

기존 축소 화면에서는 **입력 양식·추가 질문**, **담당자 한 명 선택**, **Agent에게 작업 전달**, **필요한 Agent 만들기**, **담당 Agent 바꾸기**, **자료 가져오기**, **지식 저장소 관리**, **호출 가능한 Workflow**의 마지막 줄이 잘렸다. 비교 시 글자 크기와 화면 배율을 동일하게 두고 실제 렌더링된 글자와 카드·캔버스의 경계를 대조했다.

Workflow 편집기 상단에서 수준 선택기를 제거했다. 실습 사본을 열면 해당 실습 수준으로 **추천** 블록을 보여주며 빈 프로젝트의 기본값은 입문이다. 다른 종류의 블록은 팔레트의 **블록 추가 → 전체 32종**에서 선택할 수 있다. 가이드의 편집기 사진을 다시 촬영하고 **도서관 안내 Agent**와 **시험 실행**의 강조 위치를 확인했다. [편집기 헤더](../../src/ui/editor/Editor.tsx) · [가이드에 표시되는 사진](../../public/guide/captures/02-editor.png)

### 도면과 직접 터치

| 측정 항목 | 수정 전 | 수정 후 |
|---|---:|---:|
| 320×740px, 이름이 모두 보이는 카드 | 33/41 | 41/41 |
| 320×568px, 이름이 모두 보이는 카드 | 30/41 | 41/41 |
| 320×568px, 캔버스 높이와 전체 보기 배율 | 254px · 15.3% | 410px · 26.8% |
| 320×568px, axe가 지적한 작은 조작 표적 | 77개 | 0개 |
| 320×740px, 저장 연결 8개를 추가한 도면의 작은 표적 | 1개 | 0개 |
| 320px·1440px, 헤더의 수준 선택기 | 각 1개 | 각 0개 |

이름이 긴 카드에서는 본체와 출력점이 카드 사이의 빈 공간을 나눠 쓰고, 실제로 잘리는 이름에만 줄바꿈을 조정했다. **자료 가져오기**처럼 같은 행에서 가장자리만 겹친 카드는 위아래 여백도 터치에 쓸 수 있다. 높이가 짧은 휴대폰에서는 도면 크기와 가로 폭을 이용해 캔버스에 세로 공간을 확보했다. 하단 컨트롤은 작업 영역을 스크롤해 접근한다. [글자와 포트 배치](../../src/ui/editor/workspace-editor.css) · [인접 카드 여백](../../src/ui/editor/node-layout.ts)

- 320×740px에서 기존에 잘리던 8개 이름의 중앙, 마지막 글자, 키보드 Enter로 각각 8/8회 올바른 블록 속성이 열렸다. 별도의 분류·분기·자료·출력점 중심 및 가장자리 직접 터치도 22/22회 통과했다. 두 검사에서 저장된 블록과 연결을 대조했다. [수정 전](../../.local/ui-name-review/before/report.json) · [수정 후](../../.local/ui-name-review/release/report.json)
- 320×568px에서도 첫 행부터 마지막 카드까지 이름 41개가 모두 보였다. 화면을 위로 쓸거나 휠을 굴려 하단으로 이동했고, 키보드로 마지막 블록의 속성을 열었다. 페이지 가로 넘침과 자동 접근성 위반은 0건이었다. [수정 전](../../.local/ui-name-review/before/320x568.json) · [수정 후와 스크롤 위치](../../.local/ui-name-review/release/320x568.json)
- 별도 기본 실습 **내 자료로 안내하기**의 320×568px 전체 보기에서는 블록·출력 중심 11회, 주변 44회, 보이는 출력 원 5회 모두 의도한 대상을 열었다. 연결선 5묶음 선택과 범례 3종 전환도 통과했다. [60회 직접 터치와 저장 그래프 대조](../../.local/ui-touch-review/after-dense-names/report.json)

- 두 화면 높이에서 41개 이름에 포함된 공백 제외 249글자의 중심을 검사했다. 수정 후 249/249개가 각각 해당 블록의 터치 영역 안에 있었다. 320×740px의 수정 전 수치는 225/249개였다. [글자별 전후 집계](../../.local/ui-name-review/name-verification.json)
- 연결이 있는 밀집 도면에서도 41개 이름이 전부 표시됐다. C안의 실행 경로·데이터 전달·참조 범례 3개를 전환하고, 저장 연결 8개에 해당하는 선 5묶음을 직접 눌러 열린 속성을 확인했다. 다섯 SVG 경로는 수정 전과 같았고, 선 끝과 포트 중심의 최대 차이는 0.00002 CSS px 미만이었다. 한 번 선택한 뒤 캔버스 위치가 바뀌므로 탭 직전에 현재 화면 좌표를 다시 측정했다. [연결선별 터치 이벤트와 열린 속성](../../.local/ui-name-review/wire-release-events.json)

### 검증 범위와 변경 파일

최종 프로덕션 빌드는 `WM8RtZ_kb7vvwBZ_BBS-u`다. 작업 폴더의 소스·테스트·정적 자산·설정 365개를 이 빌드에 사용한 파일과 대조했다. 직전 전달 빌드에서 바뀐 12개는 다음과 같다. [파일 대조 결과](../../.local/ui-name-review/release-sources.json)

| 변경 | 파일 |
|---|---|
| 전체 보기, 이름 줄바꿈과 터치 영역 | [Canvas.tsx](../../src/ui/editor/Canvas.tsx), [node-layout.ts](../../src/ui/editor/node-layout.ts), [workspace-editor.css](../../src/ui/editor/workspace-editor.css) |
| 편집기 헤더, 수준 상태와 추천 팔레트, 조작 안내 | [Editor.tsx](../../src/ui/editor/Editor.tsx), [Studio.tsx](../../src/ui/Studio.tsx), [editor.css](../../src/ui/editor/editor.css), [practice-steps.tsx](../../src/ui/editor/practice-steps.tsx) |
| 가이드 사진과 강조 영역 | [02-editor.png](../../public/guide/captures/02-editor.png), [captures.ts](../../src/ui/guide/captures.ts) |
| 카드 여백 경계, 이름·포트 터치, 팔레트 접근 회귀 | [graph.test.ts](../../src/ui/editor/graph.test.ts), [canvas-gesture-browser.ts](../../tests/canvas-gesture-browser.ts), [browser-smoke.ts](../../tests/browser-smoke.ts) |

| 최종 검증 | 결과 |
|---|---|
| 타입·빌드 | `pnpm typecheck`, `pnpm exec tsc --noEmit --incremental false`, `pnpm build` 모두 종료 코드 0. 패키지에 독립 lint 명령은 없다. [타입 검사](../../.local/ui-name-review/release-typecheck.log) · [프로덕션 빌드](../../.local/ui-name-review/release-build.log) |
| 단위 테스트 | `pnpm test` 395개 통과, 실패·건너뜀 0개. [단위 테스트 출력](../../.local/ui-name-review/release-unit.log) |
| 정규 브라우저 회귀 | 프로젝트에 등록된 스크립트 35개를 격리 DB와 워커 3쌍으로 나눠 실행해 35개 모두 통과했다. 편집기 조작·연결 편집·시험 실행·자료함·공유를 포함한다. 외부 모델 호출은 꺼 두었다. [1그룹](../../.local/ui-name-review/release-suite-1.json) · [2그룹](../../.local/ui-name-review/release-suite-2.json) · [3그룹](../../.local/ui-name-review/release-suite-3.json) |
| 비교 화면 | 갤러리의 실제 화면 5쌍을 320·768·1440px에서 열었다. 이미지 디코딩과 키보드 원본 크기 전환이 통과했고, 외부 요청·가로 넘침·axe 위반·런타임 오류가 없었다. [갤러리 검증](../../.local/ui-name-review/gallery.json) · [검증 집계](../../.local/ui-name-review/verification.json) |

이 변경에는 `frontend-design`의 타이포그래피·조작 상태 지침과 `verification-before-completion`의 최종 빌드 검증 절차를 적용했다. Windows Chrome의 터치 에뮬레이션과 실제 키보드 이벤트로 조작을 검증했다. 자동 접근성 검사는 axe-core의 WCAG 2 A·AA, 2.1 A·AA, 2.2 AA 규칙을 사용했다. 실물 스마트폰과 화면 낭독기의 음성 출력은 시험하지 않았다.
