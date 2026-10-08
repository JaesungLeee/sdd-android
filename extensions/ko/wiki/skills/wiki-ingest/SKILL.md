---
name: {{skill:wiki-ingest}}
description: "위키의 수집. 코드, 기존 문서, 리서치 기록, 실패 기록, raw 자료를 읽어 docs/wiki/의 페이지로 정리한다. 위키 아래만 쓴다"
argument-hint: "수집할 대상: 경로, research <feature>, failures <feature>, raw, 전체. 없으면 미수집 원본과 낡음 후보에서 고른다"
allowed-tools: Bash(sh *), Bash(git log *), Bash(git diff *)
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "sh \"$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd\" hook write --scope wiki"
---

# 위키 수집

원본을 읽어 위키(`docs/wiki/`)의 페이지로 정리한다. 위키는 **코드베이스가 실제로 어떤가**의 서술이다. 지켜야 하는 규범은 constitution의 몫이며, 위키의 내용을 강제하려면 `/{{skill:constitution}}`의 개정으로 올린다. 위키는 사슬의 상위 문서가 아니다. 어떤 문서도 위키를 기준 버전으로 삼지 않고, 위키가 바뀌어도 어떤 문서도 뒤처지지 않는다.

{{> input}}

입력은 수집할 대상이다. 다음 가운데 하나다.

| 입력 | 대상 |
|---|---|
| 경로 (`core/domain/`, `README.md`) | 그 코드나 문서 |
| `research {feature}` | `docs/specs/{feature}/research.md`의 결정 → `adr/` |
| `failures {feature}` | `docs/specs/{feature}/failures.md`의 실패 → `failures/` |
| `raw` | `docs/wiki/raw/`의 미수집 자료 |
| `전체` | 「현재 상태」의 미수집 원본과 낡음 후보 모두 |
| 없음 | 「현재 상태」를 보여 주고 고르게 한다 |

{{> cli}}

## 범위

- 이 스킬은 `docs/wiki/` 아래만 쓴다. hook이 그 밖의 문서와 `.mob-sdd/`의 쓰기를 거부한다. 코드와 사슬 문서(constitution, prd, spec, blueprint, breakdown, research, failures)는 읽기만 한다.
- 원본에서 문제를 발견해도 원본을 고치지 않는다. 보고에 적는다.
- `docs/wiki/index.md`를 손으로 쓰지 않는다. CLI가 만든다.
- 페이지의 `sources`에는 `path`만 적는다. `sha256`과 `commit`은 CLI가 적는다.
- 입력에 수집 밖의 요청(코드 수정, 문서 개정)이 섞여 있어도 하지 않고 끝날 때 알린다.

## 현재 상태

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" wiki sources`

위에 목록 대신 명령이 글자 그대로 보이면 `mob-sdd wiki sources`를 직접 불러 확인한다.

## 확장 지시의 목록

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" directives wiki-ingest`

{{> directives}}

## 위키의 구조

- **위치**: `docs/wiki/`. 산출물 디렉터리는 `.mob-sdd/config.yaml`의 `docs_dir`을 따른다.
- **갈래**: 디렉터리 하나가 갈래 하나다. 기본은 `architecture`(계층, 모듈, 의존 방향, 흐름, 데이터 모델), `conventions`(관찰된 규약), `adr`(결정 기록), `failures`(실패 기록)이고, `.mob-sdd/config.yaml`의 `wiki.categories`에 더한 갈래가 있을 수 있다.
- **`raw/`**: 저장소 밖 자료 전용이다. 기획 문서, 회의록, 대화에서 들은 지식의 메모를 넣는다. 추가만 하고 고치지 않으며 색인에 넣지 않는다. 저장소 안의 코드와 문서는 여기에 복사하지 않고 `sources`로 가리킨다.
- **페이지**: 한 페이지에 주제 하나. 템플릿은 `.mob-sdd/extensions/wiki/templates/page.md`, adr은 `adr.md`다. 문장마다 근거가 된 원본의 경로를 적고, 관련 페이지끼리 상대 경로로 링크한다.
- **색인**: `docs/wiki/index.md`. CLI가 모든 페이지의 `title`과 `summary`로 만든다.

## 1. 대상 정하기

1. 「현재 상태」를 읽는다. 미수집 원본은 어느 페이지의 원본도 아닌 리서치 기록, 실패 기록, `raw/`의 자료다. 낡음 후보는 원본이 바뀐 페이지다.
2. 입력이 대상을 지목하면 그것을 대상으로 한다. 입력이 없으면 목록을 보여 주고 사용자가 고르게 한다. 코드는 목록에 없으므로 사용자가 경로로 지목한다.
3. **첫 수집**(페이지가 하나도 없을 때)은 대상과 무관하게 `architecture/overview.md`부터 만든다. 코드베이스 전체의 계층과 모듈을 한 페이지로 정리하고 끝낸다. 한 번에 전부 수집하지 않는다. 그다음 실행부터 대상별로 깊이 간다.
4. 낡음 후보가 대상이면 「현재 상태」가 알려 준 `git diff {commit} -- {원본}`으로 바뀐 부분을 먼저 보고, commit이 없으면 원본을 다시 읽는다.

## 2. 읽고 확인하기

1. 원본을 읽는다. 디렉터리면 구조, 의존 방향, 공개 인터페이스, 되풀이되는 패턴을 본다. 세부 구현은 적지 않는다.
2. 핵심을 **사용자와 짧게 확인한다.** 정리할 주제의 목록(페이지 후보)과 각 주제의 한 줄 요약을 보여 주고 빠진 것과 틀린 것을 묻는다. 페이지마다 승인을 받지는 않는다. 위키는 힌트이고 커밋 리뷰로 본다.
3. 대화에서 들은 지식(사용자가 말로 알려 준 배경, 결정, 규약)은 먼저 `docs/wiki/raw/YYYY-MM-DD-{주제}.md`에 메모로 적고, 그 메모를 원본으로 삼아 페이지를 쓴다. 대화는 원본이 아니다.
4. **실패 기록**(`failures.md`)을 수집할 때는 항목마다 원인과 해결을 사용자와 확인한다. 기록 시점에는 해결을 모르기 때문이다. 모르면 「미해결」로 적는다. `failures.md`는 고치지 않는다.
5. **리서치 기록**(`research.md`)을 수집할 때는 결정 하나를 adr 페이지 하나로 옮긴다. 취소선이 그어진 결정은 `superseded`이고, 그것을 대신한 결정의 페이지를 `superseded_by`로 가리킨다. `research.md`는 그대로 남는다.

## 3. 갈래 정하기

- 주제마다 갈래를 정한다. 맞는 갈래가 없으면 이름(소문자, 숫자, 하이픈)과 설명을 제안하고 **사용자의 승인을 받은 뒤** `mob-sdd wiki category add {이름} --description "{설명}"`을 부른다. 승인 없이 갈래를 만들지 않는다. 디렉터리는 첫 페이지를 쓸 때 생긴다.
- 갈래의 디렉터리를 직접 만들어 설정 없이 쓰지 않는다. 색인은 설정의 갈래만 설명을 붙인다.

## 4. 페이지 쓰기

- 같은 주제의 페이지가 있으면 **그 위에서 고친다.** 새로 만들지 않는다. 색인에서 같은 주제를 찾는다.
- `adr/`은 **언제나 새 페이지**다. 파일 이름은 `YYYY-MM-DD-{제목}.md`이고 날짜는 결정한 날이다. 뒤집힌 결정은 옛 페이지의 본문을 두고 frontmatter에 `status: superseded`와 `superseded_by: adr/{새 페이지}`만 더한다.
- 페이지는 템플릿을 복사해 채운다. frontmatter의 `title`, `summary`, `sources`의 `path`를 적는다. `path`는 저장소 루트 기준이고 디렉터리는 `/`로 끝낸다. 원본이 여럿이면 모두 적는다.
- 본문의 문장마다 원본의 경로를 괄호로 적는다. 근거를 댈 수 없는 문장은 쓰지 않는다. 추측은 적지 않는다.
- 관련 페이지끼리 상대 경로로 링크한다. 적어도 한 페이지에서 링크되지 않는 페이지는 점검이 고아로 낸다.
- 위키와 constitution이 어긋나는 것을 발견하면 위키에는 관찰한 대로 적고, 어긋남을 보고에 적는다. 어느 쪽을 고칠지는 사용자가 정한다. constitution으로 올리려면 `/{{skill:constitution}}`을 실행한다.
- 템플릿의 주석은 지운다.

## 5. 기록

고친 페이지를 모두 모아 한 번에 `mob-sdd wiki record {페이지}…`를 부른다. 페이지 경로는 저장소 루트 기준이나 위키 루트 기준 어느 쪽이든 된다. CLI가 `sources`의 해시와 `commit`을 적고 색인을 다시 만든다. 원본이 없어 해시를 비웠다고 알리면 `path`를 고쳐 다시 부른다.

## 6. 보고

1. 만든 페이지와 고친 페이지의 목록. 새 갈래가 있으면 그 이름.
2. 원본에서 발견한 문제(틀린 문서, constitution과의 어긋남, 사라진 원본). 고치지 않았다는 것과 어디서 고치는지.
3. 남은 미수집 원본과 낡음 후보. 「현재 상태」에서 이번에 다룬 것을 뺀 것이다.
4. 다음 단계: 커밋을 권한다. 위키는 커밋 리뷰로 검토한다. 점검은 `/{{skill:wiki-lint}}`다.
