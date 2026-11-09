# 확장 만들기

extension은 코어에 없는 것을 더하고, preset은 코어의 스킬이나 템플릿을 같은 자리의 파일로 교체한다. 둘 다 파일 묶음이며 같은 형식을 쓴다. 확장이 CLI에 명령을 더하는 구조는 없다. 계산이 필요하면 스크립트를 함께 넣어 스킬이 실행하게 한다.

## 명령

```sh
npx mob-sdd extension list                 # 내장 확장과 설치된 확장
npx mob-sdd extension add android          # 내장 확장
npx mob-sdd extension add ../team-glossary # 로컬 경로
npx mob-sdd extension remove team-glossary
npx mob-sdd preset add ../acme-preset
npx mob-sdd preset remove acme
npx mob-sdd directives spec                # spec 단계에 적용되는 지시 파일
```

- 같은 이름을 다시 `add`하면 갱신이다. 파일의 처리는 `upgrade`와 같다.
- 로컬 확장의 원본 경로는 기억하지 않는다. 코어를 `upgrade`해도 로컬 확장은 올라가지 않으므로 같은 경로로 다시 `add`한다. 내장 확장은 코어와 함께 올라가고, 새 버전에 없는 내장 확장은 `remove`처럼 지워진다.
- `remove`는 고치지 않은 파일을 지우고, 고친 파일은 남기고 알린다. preset을 제거하면 코어 파일을 번들에서 되살린다.

## 묶음의 형식

```text
team-glossary/
  extension.yaml
  skills/
    glossary-sync/SKILL.md
  directives/
    blueprint.md
  scripts/
    lint.mjs
```

```yaml
name: team-glossary
kind: extension            # extension | preset
version: 1.0.0
requires: ">=0.3.0"        # 필요한 mob-sdd의 최소 버전. 이 꼴만 받는다
description: 팀 용어집의 정리와 대조
directives:                # 단계 이름 → 묶음 안의 파일 경로
  blueprint: directives/blueprint.md
```

| 파일 | 설치되는 곳 |
|---|---|
| `skills/{이름}/SKILL.md` | `.claude/skills/{접두사+이름}/SKILL.md`. `skills/` 아래에는 이 형태만 둘 수 있다 |
| `templates/*.md` (preset만) | `.mob-sdd/templates/`. 코어의 템플릿을 교체한다 |
| 그 밖의 파일 | `.mob-sdd/extensions/{이름}/` |

## 스크립트

계산이 필요한 확장은 `scripts/` 아래에 `.mjs`를 두고, 스킬이나 지시가 `mob-sdd run <확장> <스크립트> [인자…]`로 부르게 한다. 코어 스킬이 허용하는 도구가 `Bash(sh *)`뿐이라 `node`를 직접 부를 수 없기 때문이다. 스크립트는 저장소 루트에서 실행되고 `MOB_SDD_ROOT`로 루트를 받는다. 설치된 저장소에는 `node_modules`가 없으므로 의존성은 스크립트 안에 묶는다.

## 스킬 참조 표기

스킬 안에서 다른 스킬을 가리킬 때는 이름을 직접 쓰지 않고 `{{skill:이름}}`으로 적는다. 설치할 때 CLI가 `init`에서 정한 접두사를 붙인다.

```markdown
---
name: {{skill:glossary-sync}}
---
끝나면 `/{{skill:blueprint}}`를 안내한다.
```

접두사 없이 설치한 저장소에서는 그대로 `glossary-sync`, `blueprint`가 된다. `--prefix sdd`로 설치한 저장소에서는 `sdd-glossary-sync`, `sdd-blueprint`가 된다. 이 표기를 쓰지 않으면 접두사가 있는 저장소에서 다른 스킬을 부르지 못한다.

frontmatter의 `allowed-tools`에 적는 `Skill(…)`에도 같은 표기를 쓴다. Claude Code의 `$ARGUMENTS`나 `${…}`와는 겹치지 않는다.

코어와 내장 확장의 스킬은 빌드할 때 공유 조각을 합성하지만, 로컬 묶음의 스킬은 합성하지 않는다. 파일 하나로 완결되게 쓴다.

## 단계 지시

확장이 코어 단계에 끼어드는 방법은 "단계에 지시를 더한다" 하나다. 단계 스킬은 시작할 때 자기 단계에 적용되는 지시 파일의 경로를 받아 읽고 단계 내내 따른다.

- 단계의 이름은 접두사를 뺀 스킬 이름이다. 코어 단계뿐 아니라 다른 확장의 스킬(`create-ui` 등)에도 지시를 더할 수 있다. 대상이 설치되어 있지 않으면 `check`가 경고한다.
- 여러 확장이 같은 단계에 지시를 더하면 모두 전달되며 순서는 확장 이름순이다.
- 지시가 코어의 규칙과 어긋나면 코어가 우선이고 스킬이 그 사실을 보고한다.
- 지시는 단계의 범위 가드를 넓히지 못한다. 더 읽게 하거나 자기 산출물에 더 적게 할 수는 있어도 다른 문서를 고치게 할 수는 없다.
- 코어 스킬 파일은 확장을 설치하거나 제거해도 바뀌지 않는다.

## preset

- 코어의 스킬이나 템플릿과 같은 경로의 파일을 둔다. `skills/spec/SKILL.md`는 코어의 spec 스킬을, `templates/spec.md`는 코어의 spec 템플릿을 교체한다.
- 교체한 파일은 코어의 `upgrade`가 건드리지 않는다. 새 버전에서 그 코어 파일이 바뀌었으면 `.new`로 옆에 두어 알린다.
- 두 preset이 같은 파일을 교체하면 두 번째를 거부한다.

## 이름이 겹칠 때

확장의 스킬이 코어, 다른 확장, 프로젝트의 `.claude/skills/`, 사용자 홈의 `~/.claude/skills/`와 겹치면 설치하지 않고 목록을 보여 준다. 접두사는 `init`에서 정한 값이 자동으로 붙으므로 따로 고르지 않는다.

## 버전 체인과의 관계

확장의 문서는 버전 체인과 착수 게이트에 들어가지 않는다. 확장의 스킬이 코어 문서의 판정을 읽는 것은 된다. `android`의 `impl-orchestrator`가 그렇게 한다.
