---
name: {{skill:verify-principles}}
description: "구현 단계의 검증 스킬. 변경된 코드가 constitution의 원칙을 어기는지, 작업에 없는 변경이 들어갔는지 감사한다. 고치지 않는다"
argument-hint: "feature: 이름, 단위: US1 또는 전체, 파일: 바꾼 파일들, 모듈: :core:domain"
allowed-tools: Bash(sh *), Bash(git status *), Bash(git diff *)
context: fork
agent: Explore
model: sonnet
---

# verify-principles

변경된 코드를 읽어 constitution의 원칙에 어긋나는 곳과 작업에 없는 변경을 찾는다. **고치지 않는다.** 이 스킬은 쓰기 도구가 없는 에이전트로 돈다. 셸로 파일을 쓰는 것도 하지 않는다.

구현 스킬이 constitution을 읽고 따르는 것은 자기 판정이다. blueprint의 헌법 준수 확인은 설계까지만 보고, Lint는 기계로 잡히는 규칙만 본다. 코드가 설계에서 벗어난 경우와 Lint가 잡지 못하는 원칙(계층 경계, 의존 방향, 금지된 API)을 따로 읽어 확인하는 것이 이 스킬이다.

{{> impl-input}}

인자에서 feature, 단위(스토리 이름이거나 `전체`), 바꾼 파일, 바꾼 모듈을 읽는다. 파일이 없으면 breakdown에서 그 단위의 작업이 지정한 경로를 모두 대상으로 삼는다.

{{> read-only}}

{{> cli}}

## 확장 지시의 목록

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" directives verify-principles`

{{> directives}}

## 규칙

- **감사 기준은 constitution뿐이다.** `docs/constitution.md`의 원칙만 위반의 근거다. `docs/wiki/conventions/`와 `adr/`은 힌트라서 읽어도 위반의 근거로 삼지 않는다. constitution이 없으면 원칙 감사는 `skip`이고 작업 밖의 변경만 본다.
- **spec 일치는 감사하지 않는다.** 그것은 테스트와 디자인 대조의 몫이다.
- **Lint가 잡는 것은 보지 않는다.** 포맷, 이름 규칙, 미사용 import는 `verify-build`의 Lint가 본다.
- **근거 없는 지적은 하지 않는다.** 원칙의 ID와 문장, 코드의 파일과 줄을 함께 지목할 수 있는 것만 위반이다. "권장", "일반적으로"는 위반이 아니다. 원칙이 반드시 지켜야 하는 것과 권장을 구분해 적었으면 반드시 지켜야 하는 것만 위반이다.
- **심각도를 매기지 않는다.** 어긋난 것은 모두 위반 목록에 올린다. 하나라도 있으면 `fail`이다.
- **게이트는 좁게 둔다.** 인자의 파일과 모듈만 본다. 기존 코드의 위반은 이번 변경이 만든 것이 아니면 「이전부터 있던 것」으로 따로 적고 `fail`의 근거로 삼지 않는다.

## 실행

1. `docs/constitution.md`를 읽고 원칙을 ID별로 정리한다. 코드로 판정할 수 있는 규칙(의존해도 되는 모듈과 안 되는 모듈, 쓰면 안 되는 API, 계층의 책임, 필수 구조)만 추린다.
2. `docs/specs/{feature}/breakdown.md`에서 단위의 작업과 그 경로를 읽는다. `전체`면 모든 작업이다. `docs/specs/{feature}/blueprint.md`의 구조와 의존 방향도 읽는다. 설계가 정한 구조에서 벗어난 코드는 그 구조를 요구하는 원칙이 constitution에 있을 때만 위반이다.
3. 바꾼 파일을 하나씩 읽고 원칙마다 대조한다. import, 의존하는 모듈, 호출하는 API, 클래스의 책임을 본다.
4. **작업에 없는 변경**을 찾는다. `git status --porcelain`과 `git diff --name-only`로 작업 트리에서 바뀐 파일을 얻어, 인자의 모듈 안에 있는데 단위(`전체`면 feature)의 어느 작업 경로에도 맞지 않는 파일을 고른다. 모듈 밖의 변경은 사람의 다른 작업일 수 있으므로 위반으로 올리지 않고 「참고」에 적는다.

## 보고의 형식

마지막 메시지가 보고다. `{{skill:impl-orchestrator}}`가 이 보고를 그대로 CLI에 넘긴다.

```text
결과: principles=pass|fail|skip
위반: (없으면 없음)
- {원칙 ID} · {파일}:{줄} · 원칙: "{원칙의 문장}" · 어긋남: {무엇이} · 고칠 방향: {한 줄}
위반 파일: 저장소 루트 기준 경로를 쉼표로. 없으면 없음
작업 밖의 변경: 모듈 안에서 어느 작업에도 맞지 않는 파일. 없으면 없음
이전부터 있던 것: 이번 변경이 만들지 않은 위반. 없으면 없음
참고: 모듈 밖의 변경, 힌트(위키)와 어긋나는 곳. 없으면 없음
증상: 실패를 한 줄로 (CLI의 --symptom에 들어간다)
```

통과를 꾸미지 않는다. constitution을 읽지 못했거나 파일을 열지 못했으면 `skip`과 사유를 적는다.
