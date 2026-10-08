# mob-sdd

문서 확정에서 구현까지를 버전 체인으로 이어 주는 SDD(Spec-Driven Development) 워크플로 CLI다. Claude Code를 쓰는 저장소에 명령 한 줄로 설치한다. 문서 단계는 스택을 가리지 않고, 구현 단계는 v1에서 Android(Kotlin, Gradle, Jetpack Compose)를 지원한다.

## 무엇을 하나

- 기능을 바로 만들지 않고 constitution → prd → spec → blueprint → breakdown 순서로 문서를 확정한 뒤, 그 문서를 따라 구현한다. 앞 단계의 산출물이 다음 단계의 유일한 입력이다.
- 문서마다 frontmatter에 상위 문서의 기준 버전을 적는다(버전 체인). 상위 문서가 개정되면 하위 문서는 뒤처진 것으로 판정되고, 뒤처진 문서로는 다음 단계를 시작할 수 없다(착수 게이트).
- 같은 단계를 다시 실행하면 기존 문서 위에서 개정한다. 개정 등급(MAJOR, MINOR, PATCH)은 사용자가 승인한다.
- 템플릿 복사, 버전 대조, 변경 감지, 체크 집계처럼 계산으로 끝나는 일은 CLI가 한다. LLM은 읽고 쓰고 판단하는 일만 한다.

## 요구 사항

- Node.js 22 이상, git
- Claude Code
- 설치 대상은 git 저장소의 루트다. 모노레포의 하위 프로젝트에만 설치하는 것은 지원하지 않는다.

## 설치

```sh
npx mob-sdd init                                     # 코어: constitution부터 analyze까지
npx mob-sdd init --extension android --extension wiki  # Android 구현 단계와 위키를 함께
npx mob-sdd@latest upgrade                           # 새 버전으로 올린다
```

설치되는 곳은 두 군데다. 둘 다 커밋한다.

| 위치 | 내용 |
|---|---|
| `.claude/skills/` | 단계 스킬. 슬래시 커맨드가 된다 |
| `.mob-sdd/` | CLI 번들, 템플릿, 설정, 설치 기록, 본문 해시 |

`init`은 이미 있는 파일을 덮어쓰지 않는다. 겹치는 스킬이 있으면 접두사를 붙이거나 백업한 뒤 설치하거나 그만두는 것 가운데 고른다. `--prefix sdd`로 설치하면 모든 스킬이 `/sdd-spec`처럼 접두사를 갖는다.

## 단계

| 순서 | 슬래시 커맨드 | 산출물 | 하는 일 |
|---|---|---|---|
| 1 | `/constitution` | `docs/constitution.md` | 프로젝트의 타협 불가한 원칙 |
| 2 | `/prd` | `docs/prd.md` | 제품의 목표, 범위, 항목별 요구 |
| 3 | `/spec` | `docs/specs/{feature}/spec.md`, `checklist.md` | 기능 하나의 요구사항과 검증 체크리스트 |
| 4 | `/clarify` (선택) | 없음 | spec의 모호성과 상위 문서와의 정합성을 보고 |
| 5 | `/blueprint` | `docs/specs/{feature}/blueprint.md`, `research.md` | 설계와 리서치 기록 |
| 6 | `/breakdown` | `docs/specs/{feature}/breakdown.md` | 순서가 정해진 작업 목록 |
| 7 | `/analyze` (선택) | 없음 | spec, blueprint, breakdown 사이의 누락과 모순을 보고 |
| 8 | `/impl-orchestrator` | 코드, `failures.md` | breakdown의 작업을 구현, 검증, 치유 (`android` extension) |

feature는 `docs/specs/` 아래의 디렉터리 하나다. `/spec 로그인`처럼 입력을 주면 그 feature를 대상으로 하고, 입력이 없으면 목록에서 고른다.

## 확장

코어는 스택을 전제하지 않는다. 구현 단계와 지식 계층은 내장 확장으로 더한다.

| 확장 | 하는 일 |
|---|---|
| `android` | Kotlin, Gradle, Jetpack Compose 프로젝트의 구현 단계. `/impl-orchestrator` |
| `wiki` | 코드베이스의 서술을 담는 위키. `/wiki-ingest`, `/wiki-lint`. 단계들이 읽기 전용 힌트로 읽는다 |

## 사람이 치는 명령

```sh
npx mob-sdd status [feature]   # 진행 상태와 버전 체인 판정
npx mob-sdd check              # 설치와 문서의 깨진 곳. CI에서 종료 코드로 쓴다
```

그 밖의 명령(`doc`, `gate`, `impl` 등)은 스킬이 부른다. 전체 목록은 [CLI와 설정 파일](guide/cli.md)에 있다.

## Figma (선택)

`android` extension을 설치했고 spec에 Figma 화면 링크를 적을 때만 필요하다.

```sh
npx mob-sdd figma setup --server desktop --name figma-desktop
```

이 명령은 개인 설정 파일 두 개(`.mob-sdd/config.local.yaml`, `.claude/settings.local.json`)만 고친다. 자세한 것은 [Figma 설정](guide/figma.md)에 있다.

## 가이드

- [워크플로](guide/workflow.md): 단계의 흐름, 착수 게이트, 개정, 병합 뒤 정리, 갱신
- [문서 형식](guide/documents.md): frontmatter, 항목 ID, 변경의 판정, breakdown 작업 줄
- [CLI와 설정 파일](guide/cli.md): 명령 전체와 `.mob-sdd/`의 파일
- [구현 단계](guide/implementation.md): `android` extension의 스킬과 흐름
- [위키](guide/wiki.md): `wiki` extension의 지식 계층, 수집과 점검
- [Figma 설정](guide/figma.md): 서버 선택, 권한, 캡처 환경
- [확장 만들기](guide/extensions.md): extension과 preset의 형식

변경 내역은 [CHANGELOG.md](CHANGELOG.md)에 있다.

## 라이선스

Apache-2.0
