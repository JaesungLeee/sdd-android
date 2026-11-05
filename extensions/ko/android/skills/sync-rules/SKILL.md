---
name: {{skill:sync-rules}}
description: "constitution 원칙의 검사를 도구의 규칙으로 옮긴다. detekt, ktlint, Konsist의 설정과 테스트를 만들거나 고쳐 원칙의 검사 줄이 가리키는 규칙이 실제로 돌게 한다. constitution은 고치지 않는다"
argument-hint: "옮길 원칙의 ID들(P-001 P-003). 비워 두면 check가 알린 빠진 규칙과 감사로 둔 원칙에서 후보를 찾는다"
allowed-tools: Bash(sh *), Bash(./gradlew *)
---

# sync-rules

constitution 원칙의 판정을 LLM의 감사에서 도구로 옮긴다. 원칙을 정하는 것은 constitution 단계이고, 이 스킬은 **원칙이 가리키는 도구의 규칙을 설정에 만든다.** 규칙은 에이전트가 제안하고 사용자가 확정한다. 검사는 그 뒤 구현 단계에서 CLI가 도구로 돌린다.

{{> input}}

입력에서 원칙의 ID를 읽는다. 없으면 「후보」를 따른다.

{{> cli}}

## 범위

- 고치는 것은 **도구의 설정과 규칙 파일**뿐이다: detekt 설정(`detekt.yml` 등), `.editorconfig`의 ktlint 항목, Konsist 테스트 파일, `.mob-sdd/config.yaml`의 `impl.checks`는 고치지 않고 명령을 안내한다.
- `docs/` 아래 문서를 고치지 않는다. 원칙의 **검사** 줄을 바꾸는 것은 `/{{skill:constitution}}`의 개정이다. 이 스킬이 끝난 뒤 그 단계를 다시 실행하라고 안내한다.
- 프로덕션 코드를 고치지 않는다. 새 규칙이 기존 코드에서 위반을 찾아도 고치지 않고 보고한다.
- 빌드 스크립트에 플러그인이나 의존성(detekt 플러그인, Konsist 라이브러리)을 더해야 하면 **쓰기 전에 사용자에게 묻는다.** 버전 카탈로그에 없는 라이브러리를 임의의 버전으로 넣지 않는다.
- 커밋하지 않는다.

## 현재 상태

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" check`

위에 결과 대신 명령이 글자 그대로 보이면 `mob-sdd check`를 직접 불러 확인한다. `P-…의 … 검사:`로 시작하는 줄이 원칙의 검사 줄과 설정이 어긋난 곳이다.

## 확장 지시의 목록

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" directives sync-rules`

{{> directives}}

## 후보

1. **빠진 규칙**: 「현재 상태」에서 원칙의 검사 줄이 가리키는데 설정에 없거나 꺼진 규칙. 이미 원칙이 도구를 정했으므로 설정만 맞추면 된다. 먼저 한다.
2. **도구로 옮길 수 있는 감사**: `docs/constitution.md`에서 `**검사**: 감사`이거나 검사 줄이 없는 원칙 가운데, 코드만 보고 기계로 가릴 수 있는 것. 쓰면 안 되는 API와 import, 계층과 패키지의 의존 방향, 클래스의 위치와 이름, 파일 이름. 책임의 나눔이나 상태의 흐름처럼 판단이 필요한 원칙은 후보가 아니다.

후보를 한 번에 보여 주고 사용자가 고르게 한다.

```markdown
| 원칙 | 도구 | 규칙 | 설정 파일 | 비고 |
|---|---|---|---|---|
| P-001 | detekt | `ForbiddenImport` (`android.util.Log`) | config/detekt.yml | 빠진 규칙 |
| P-004 | konsist | `ui does not import data` | konsist/src/test/kotlin/LayerTest.kt | 감사에서 옮김 |
```

## 도구 고르기

| 원칙의 모양 | 도구 | 규칙의 자리 |
|---|---|---|
| 쓰면 안 되는 API, import, 클래스 | detekt `ForbiddenImport`, `ForbiddenMethodCall` 등 | 프로젝트의 detekt 설정 파일 |
| 계층·패키지의 의존 방향, 클래스의 위치·이름·상속 | Konsist | 아키텍처 테스트 파일의 테스트 함수. 규칙 이름은 함수 이름 |
| 형식, 파일 이름 | ktlint | `.editorconfig`의 `ktlint_…` 항목 |

- 프로젝트에 이미 있는 도구와 설정 파일을 먼저 쓴다. 같은 일을 하는 도구를 새로 더하지 않는다.
- 규칙 하나가 원칙의 뜻을 다 담지 못하면 그렇다고 보고하고 원칙을 나눌지 constitution 단계에서 정하게 한다. 일부만 담는 규칙을 원칙 전체의 검사로 적지 않게 한다.

## 실행

1. 고른 후보마다 규칙을 쓴다. detekt는 그 규칙을 `active: true`로 켜고 원칙이 금지하는 것을 값으로 적는다. Konsist는 원칙 하나에 테스트 함수 하나를 쓰고, 함수 이름이 constitution의 검사 줄에 적힐 규칙 이름이다. ktlint는 `.editorconfig`의 항목을 켠다.
2. 그 도구를 한 번 돌린다(`./gradlew detekt`, Konsist 테스트, `./gradlew ktlintCheck` 가운데 해당하는 것). 목적은 두 가지다.
    - 규칙이 실제로 읽혔는지: 설정 오류나 테스트 컴파일 오류가 없어야 한다. 있으면 고친다.
    - 기존 코드의 위반: 위반이 나오면 고치지 않고 파일과 줄을 모은다. 구현 단계의 검사는 모듈 단위로 돌기 때문에, 기존 위반이 남아 있으면 그 모듈의 모든 작업이 실패한다. baseline(detekt의 `baseline.xml` 등)으로 기존 위반을 뺄지 사용자에게 묻는다. 만들면 그 사실을 보고에 적는다.
3. `mob-sdd check`를 다시 부른다. 1의 결과로 「빠진 규칙」이 사라졌는지 본다. 감사에서 옮긴 원칙은 아직 검사 줄이 `감사`라서 check에 나오지 않는다.
4. 구현 단계가 그 규칙을 돌리는지 본다. `.mob-sdd/config.yaml`의 `impl.checks`에서 Lint 명령이 그 도구를 돌리는지(detekt, ktlint), 규칙 명령(`rules`)이 Konsist 테스트를 돌리는지 확인한다. 돌리지 않으면 사용자가 칠 명령을 안내한다. 예: `mob-sdd impl setup --rules "./gradlew :konsist:test"`.

## 보고

- 원칙마다 만든 규칙: 도구, 규칙 이름, 설정 파일. constitution의 검사 줄에 그대로 붙일 수 있는 꼴로 적는다: `**검사**: konsist \`ui does not import data\` (konsist/src/test/kotlin/LayerTest.kt)`.
- 다음 단계: 감사에서 옮긴 원칙이 있으면 `/{{skill:constitution}}`을 다시 실행해 그 원칙의 검사 줄을 위의 꼴로 바꾸라고 안내한다. 검사 줄만 바꾸는 개정은 PATCH다.
- 기존 코드의 위반과 baseline을 만들었는지.
- 빌드 스크립트에 더한 플러그인과 의존성, 또는 사용자가 거절해 하지 못한 것.
- 구현 단계가 그 규칙을 돌리게 하려고 사용자가 칠 명령.
- 바꾼 파일의 목록. 검토하고 커밋하라고 권한다.
