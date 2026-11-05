# 문서 형식

CLI가 읽는 문서의 형식이다. 템플릿이 이 형식으로 만들어지므로 보통은 신경 쓸 일이 없지만, 손으로 고칠 때와 `check`의 메시지를 읽을 때 필요하다.

## 파일 배치

```text
docs/
  constitution.md
  prd.md
  specs/
    {feature}/
      spec.md
      checklist.md       # spec의 검증 체크리스트
      blueprint.md
      research.md        # blueprint의 리서치 기록
      breakdown.md
      failures.md        # 구현 단계의 실패 기록. 구현에서 처음 실패가 남을 때 생긴다
.mob-sdd/
  hashes/                # 문서마다 본문 해시 파일. CLI만 쓴다
    prd.md.hash
    specs/{feature}/spec.md.hash
```

`docs`는 `.mob-sdd/config.yaml`의 `docs_dir`로 바꿀 수 있다. feature의 이름은 `specs/` 아래의 디렉터리 이름이다.

## frontmatter

prd와 constitution은 항목별 개정 기록을 갖는다.

```yaml
---
version: 1.2.0
status: created
created: 2026-10-04
updated: 2026-10-10
revisions:
  - version: 1.0.0
    date: 2026-10-04
  - version: 1.1.0
    date: 2026-10-07
    items: { CLI-001: minor }
  - version: 1.2.0
    date: 2026-10-10
    items: { SYS-003: patch, "*": patch }
---
```

spec, blueprint, breakdown은 상위 문서의 기준 버전을 갖는다.

```yaml
---
version: 1.0.0
status: created
based_on:
  prd: { version: 1.2.0, items: [CLI-001, SYS-003] }
created: 2026-10-11
updated: 2026-10-11
---
```

| 키 | 뜻 |
|---|---|
| `status` | `draft`(작성 중)이거나 `created`(완료). checklist는 `draft`, `pass`, `failed` |
| `version` | 완료를 기록할 때 `1.0.0`이 된다. `draft`에는 이 키가 없다 |
| `revisions` | prd와 constitution의 개정 기록. `items`는 항목별 등급이고 `*`는 항목 밖의 본문이다 |
| `based_on` | 상위 문서의 이름을 키로 둔다. spec은 `prd`, blueprint는 `spec`과 `constitution`, breakdown은 `blueprint`다 |
| `based_on.*.items` | spec이 의존하는 prd 항목. 이 항목의 개정만 spec의 뒤처짐이 된다 |

frontmatter는 CLI가 쓴다. 손으로 버전을 올리거나 `based_on`을 고치지 않는다. 본문을 손으로 고친 뒤에는 그 단계의 스킬을 다시 불러 개정을 기록한다. 그러지 않으면 `check`와 다음 단계의 게이트가 미기록 변경으로 잡는다.

## 항목 ID

prd와 constitution의 본문은 항목으로 나뉘고, 항목마다 해시를 따로 둔다. 개정 등급과 spec의 의존이 항목 단위로 돌아간다.

- ID는 대문자 1~5자, 하이픈, 숫자 세 자리다. `CLI-001`, `SYS-006`, `P-001`.
- 항목은 `### [CLI-001] 이름` 형태의 제목으로 시작한다. 제목부터 같은 수준이거나 더 높은 수준의 다음 제목 전까지가 그 항목이다. `###` 항목은 다음 `###`뿐 아니라 그 뒤의 `##`에서도 끝난다.
- 코드 블록 안의 제목은 제목으로 보지 않는다.
- 항목 끝의 빈 줄과 구분선(`---`)은 항목 밖이다.
- 번호는 한 번 주면 바꾸지 않고, 지운 번호를 다시 쓰지 않는다.
- 항목 밖의 본문(개요, 용어, 항목을 가로지르는 규칙)은 `*` 하나로 묶인다.

## constitution 원칙의 검사 줄

원칙마다 `**검사**:` 줄로 그 원칙을 무엇이 판정하는지 적는다.

```markdown
### [P-001] 로그는 공용 로거로 남긴다

`android.util.Log`를 직접 쓰지 않는다.

**근거**: 사람의 결정
**검사**: detekt `ForbiddenImport` (config/detekt.yml)

### [P-003] 화면 상태는 단방향으로 흐른다

**근거**: 사람의 결정
**검사**: 감사
```

- 도구 줄은 `도구 \`규칙 이름\` (설정 파일)`이다. 한 원칙에 여럿 둘 수 있다. 도구의 이름은 스택을 가리지 않는다.
- `check`가 규칙이 설정 파일에 실제로 있는지 대조한다. 도구는 돌리지 않는다.
    - YAML 파일(detekt 등)은 규칙 이름이 키로 있어야 하고, `active: false`면 꺼진 것으로 오류다.
    - 그 밖의 파일(Konsist 테스트, `.editorconfig`)은 규칙 이름이 글자로 들어 있어야 하고, `규칙 = disabled` 줄이 있으면 꺼진 것이다.
    - 형식에 맞지 않는 검사 줄, 없는 파일, 없는 규칙은 오류다.
- `감사`와 검사 줄이 없는 원칙은 구현 단계의 원칙 감사(`verify-principles`, LLM)가 본다. 도구 줄이 있는 원칙은 감사하지 않는다.
- `status`가 원칙의 수를 도구 검사, 감사, 검사 미지정으로 나눠 보여 준다.
- 검사 줄을 더하거나 바꾸는 것은 원칙이 요구하는 바를 바꾸지 않으므로 PATCH다.

## 변경의 판정

CLI는 본문의 SHA-256 해시로 바뀌었는지를 판정한다. 해시 전에 다음을 정규화하므로 이것들만 바뀐 것은 변경이 아니다.

| 무시하는 것 | 이유 |
|---|---|
| 줄바꿈의 종류(CRLF, LF) | 체크아웃 설정에 따라 달라진다 |
| 줄 끝의 공백 | 편집기가 지우거나 남긴다 |
| 구간 끝의 빈 줄 | 항목 사이의 빈 줄 수 |
| 유니코드 정규화 형태(NFC) | macOS에서 한글이 자모 분리 형태로 저장되는 경우가 있다 |
| breakdown의 체크 표시 | 체크 상태는 개정이 아니다 |

줄 안의 공백과 빈 줄의 수는 그대로 비교한다. 마크다운에서 뜻이 달라질 수 있기 때문이다.

## 해시 파일

`.mob-sdd/hashes/` 아래에 문서마다 하나씩 있다. 커밋하고, 손대지 않는다.

```text
version 1.2.0
* 9f2c…
CLI-001 41ab…
```

| 문서 | 줄 |
|---|---|
| prd, constitution | `version`, 항목 밖(`*`), 항목마다 한 줄 |
| spec, blueprint, breakdown | `version`, `body` |
| checklist | `verified-spec`: 검증 당시의 spec 본문 해시 |

`version` 줄은 해시가 어느 버전의 것인지다. 병합으로 frontmatter와 해시 파일이 다른 쪽의 것이 되면 `check`가 이 줄로 잡는다.

## spec

- 사용자 스토리의 제목은 `### US1. 제목`이다. breakdown의 작업이 `[US1]`로 이 스토리를 가리키므로 ID는 바꾸지 않는다.
- 미정 항목은 모든 문서에서 `TBD:`로 적는다. 스킬이 이것을 모아 사용자에게 묻는다.
- Figma 줄은 디자인이 Figma에 있을 때만 스토리 아래에 둔다.

  ```text
  **Figma**: [마이페이지 메인](노드 URL) · [마이페이지 메인 - 알림 OFF](노드 URL)
  ```

  - 링크는 **화면 프레임** 단위다. 같은 화면이라도 상태가 다르면 상태마다 하나씩 적는다.
  - 섹션이나 페이지 링크는 쓰지 않는다. 구현 단계가 그 안의 어느 프레임이 어느 화면인지 추정하지 않는다.
  - 문서에서 처음 한 번만 전체 URL을 적고 이후는 노드 ID만 써도 된다.
  - 디자인과 다르게 만들어야 할 것은 요구사항에 적는다. spec이 Figma와 다르게 정한 것은 검증에서 차이로 잡지 않는다.

## breakdown의 작업 줄

```text
- [ ] T010 [P] [US1] [until:T014] 로그인 유스케이스의 테스트를 작성한다 `domain/src/test/LoginUseCaseTest.kt`
- [ ] T012 [P] [US1] 사용자 모델을 만든다 `domain/src/main/model/User.kt`
- [ ] T014 [US1] 로그인 유스케이스를 구현한다 `domain/src/main/usecase/`
- [x] T009 [US1] [dropped] 토큰 저장소를 만든다 `data/src/main/TokenStore.kt`
- [ ] FINAL 마지막 확인
```

| 표시 | 뜻 |
|---|---|
| `T010` | 작업 ID. `T`와 세 자리 번호. 바꾸지 않고 지운 번호를 다시 쓰지 않는다 |
| `[P]` | 병렬로 할 수 있다. 사람을 위한 정보이고 v1의 CLI는 무시한다 |
| `[US1]` | 속한 사용자 스토리. 한 스토리의 작업은 한곳에 모은다. 다른 스토리를 사이에 두고 다시 나오면 오류다 |
| `[FIX-001]` | 구현이 끝난 뒤 `/fix`가 더한 수정 단위. 「수정」 섹션에만 있고 `[US…]`와 함께 달지 않는다. [워크플로](workflow.md#구현이-끝난-뒤의-수정) |
| `[until:T014]` | 테스트 작업에 단다. 이 테스트를 통과시키는 마지막 구현 작업이다. 테스트는 T014가 끝난 뒤에 돌고 그때 함께 체크된다 |
| `[dropped]` | 개정으로 무효가 된 완료 작업. 폐기 사유와 조치를 아래에 적는다 |
| 줄 끝의 백틱 | 이 작업이 만들거나 고치는 경로. 여러 개를 적을 수 있고 `/`로 끝나면 그 아래 전체다. **작업마다 하나 이상 있어야 한다** |
| `FINAL` | 마지막 확인 줄. 문서의 마지막 작업 줄이고 CLI만 올리고 내린다 |

- 표시의 순서는 체크, ID, `[P]`, `[US…]`나 `[FIX-…]`, `[until:…]`, `[dropped]`, 설명, 경로다.
- 설명 안의 백틱은 경로가 아니다. 경로는 줄 끝에 이어 적힌 백틱만이다.
- 실행 순서는 문서에 적힌 순서다. 「의존성과 실행 순서」 섹션은 사람이 읽는 설명이다.
- 테스트 작업은 대응하는 구현 작업보다 앞에 둔다.
- 체크는 CLI가 올린다. 손으로 체크하면 `check`가 잡지는 않지만 검증을 거치지 않은 완료가 된다. 마지막 확인 줄이 체크됐는데 체크되지 않은 작업이 있으면 오류다.

구현 단계가 breakdown에 요구하는 것은 [구현 단계](implementation.md)에 더 있다.

## failures.md

구현 단계의 실패를 CLI가 덧붙이는 파일이다. 버전과 `based_on`이 없고 사슬에 들어가지 않는다. 추가만 하고 지우지 않으며, 사람에게 넘긴 실패가 나중에 해결되어도 고치지 않는다. 내용은 [구현 단계](implementation.md)의 「실패 기록」에 있다.
