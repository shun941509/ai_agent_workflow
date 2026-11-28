# 실습에 동봉하는 원본 Skill

이 폴더에는 웹 개발 실습을 다른 PC로 옮겨도 같은 원본을 사용할 수 있도록 다음 배포본을 보관한다.

| Skill | 배포본 | 함께 보관하는 파일 |
| --- | --- | --- |
| `find-docs` | Upstash Context7, 커밋 `e8d84b8ebcc82866703f7ea86a61c7261dbc07d4` | Skill 본문과 저장소의 MIT 라이선스 |
| `webhook-handler-patterns` | Hookdeck Webhook Skills, 커밋 `ac7294970071541ff6c3a59bb36cda9ac734075c` | Skill 본문, 참고 문서, 저장소의 MIT 라이선스 |
| `skill-creator` | 설치된 Codex 시스템 Skill의 사본. `SKILL.md` SHA-256은 `cccd291077ec57c6f50ca6529f0f3fb93212da09473effb2fcec808e81b21288` | 본문, 에이전트 설정, 아이콘, 참고 문서, Python 스크립트와 라이선스 |

`test-driven-development`, `frontend-design`, `web-artifacts-builder`는 프로젝트에 설치한 원본을 사용한다. 도구를 내보낼 때 Superpowers의 MIT 라이선스도 `test-driven-development/LICENSE`로 포함한다. Windows에서 Git이 줄바꿈을 바꾼 경우에도 Bash 스크립트 두 개는 저장소 원문의 LF로 보관하고 Git blob 해시를 시험한다. 작업실은 실습에 배정한 지침을 읽고, 패키지의 스크립트와 부속 파일은 개발 환경에서 사용할 수 있도록 보존한다.
