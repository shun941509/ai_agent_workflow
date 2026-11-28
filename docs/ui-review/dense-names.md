# 편집기 헤더와 추천 블록

[1440px에서 촬영한 편집기 상단 전후 비교](dense-names.html)

Workflow 편집기 상단에서 수준 선택기를 제거했다. 실습 사본을 열면 해당 실습 수준으로 **추천** 블록을 보여주며 빈 프로젝트의 기본값은 입문이다. 다른 종류의 블록은 팔레트의 **블록 추가 → 전체 32종**에서 선택할 수 있다. 가이드의 편집기 사진을 다시 촬영하고 **도서관 안내 Agent**와 **시험 실행**의 강조 위치를 확인했다. [편집기 헤더](../../src/ui/editor/Editor.tsx) · [가이드에 표시되는 사진](../../public/guide/captures/02-editor.png)

1440px 헤더에서 수정 전 수준 선택기 1개, 수정 후 0개를 확인했다.

### 검증 범위와 변경 파일

최종 프로덕션 빌드는 `WM8RtZ_kb7vvwBZ_BBS-u`다. 작업 폴더의 소스·테스트·정적 자산·설정 365개를 이 빌드에 사용한 파일과 대조했다. 표에는 편집기 헤더와 가이드 사진에 쓰인 파일을 적었다. [파일 대조 결과](../../.local/ui-name-review/release-sources.json)

| 변경 | 파일 |
|---|---|
| 편집기 헤더, 수준 상태와 추천 팔레트, 조작 안내 | [Editor.tsx](../../src/ui/editor/Editor.tsx), [Studio.tsx](../../src/ui/Studio.tsx), [editor.css](../../src/ui/editor/editor.css), [practice-steps.tsx](../../src/ui/editor/practice-steps.tsx) |
| 가이드 사진과 강조 영역 | [02-editor.png](../../public/guide/captures/02-editor.png), [captures.ts](../../src/ui/guide/captures.ts) |

| 최종 검증 | 결과 |
|---|---|
| 타입·빌드 | `pnpm typecheck`, `pnpm exec tsc --noEmit --incremental false`, `pnpm build` 모두 종료 코드 0. 패키지에 독립 lint 명령은 없다. [타입 검사](../../.local/ui-name-review/release-typecheck.log) · [프로덕션 빌드](../../.local/ui-name-review/release-build.log) |
| 단위 테스트 | `pnpm test` 395개 통과, 실패·건너뜀 0개. [단위 테스트 출력](../../.local/ui-name-review/release-unit.log) |
| 정규 브라우저 회귀 | 프로젝트에 등록된 스크립트 35개를 격리 DB와 워커 3쌍으로 나눠 실행해 35개 모두 통과했다. 편집기 조작·연결 편집·시험 실행·자료함·공유를 포함한다. 외부 모델 호출은 꺼 두었다. [1그룹](../../.local/ui-name-review/release-suite-1.json) · [2그룹](../../.local/ui-name-review/release-suite-2.json) · [3그룹](../../.local/ui-name-review/release-suite-3.json) |
| 비교 화면 | 1440px에서 편집기 상단의 이미지와 원본 크기 전환을 확인했다. [비교 화면](dense-names.html) |
