---
name: {{skill:create-logic}}
description: "구현 단계의 구현 스킬. breakdown의 작업 하나를 받아 도메인과 데이터 계층의 Kotlin 코드를 작업이 지정한 경로 안에 만든다"
argument-hint: "feature: 이름, 작업: T004, 경로: …, 스토리: US1"
allowed-tools: Bash(sh *), Bash(./gradlew *)
context: fork
---

# create-logic

breakdown의 작업 하나를 구현한다. 맡는 것은 도메인과 데이터 계층이다: 모델, 유스케이스, 리포지토리와 그 구현, 데이터 소스, 매퍼, 상태 로직. 화면과 Composable, 모듈 골격과 배선은 맡지 않는다.

{{> impl-input}}

인자에서 feature, 작업 ID, 경로, 스토리를 읽는다. 작업 ID가 없으면 시작하지 않고 보고한다.

{{> impl-scope}}

{{> cli}}

## 현재 상태

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" gate implement`

위에 판정 대신 명령이 글자 그대로 보이면 `mob-sdd gate implement`를 직접 불러 확인한다.

## 확장 지시의 목록

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" directives create-logic`

{{> directives}}

## 착수 게이트

「현재 상태」에서 대상 feature의 줄을 본다. 이것은 미리 알림이다. 뒤처진 breakdown으로 코드를 만들지 않기 위한 것이다.

- **통과**이거나 "체크포인트의 결정을 따른다"가 붙어 있으면 진행한다.
- **확인 필요**나 **중단**이면 시작하지 않는다. 격리된 실행이라 사용자에게 물을 수 없다. `/{{skill:impl-orchestrator}}`로 부르거나 뒤처진 문서의 단계를 먼저 실행하라고 보고하고 끝낸다.

## 읽는 것

- `docs/specs/{feature}/breakdown.md`에서 작업 줄. 설명과 줄 끝의 경로가 범위다.
- `docs/specs/{feature}/blueprint.md`와 있으면 `data-model.md`, `contracts/`. 설계가 정한 이름, 계층, 인터페이스를 그대로 쓴다.
- `docs/specs/{feature}/spec.md`에서 이 작업의 스토리에 해당하는 요구사항.
- `docs/constitution.md`가 있으면 읽는다. 원칙은 지켜야 하는 것이다.
- 작업과 같은 모듈의 기존 코드. 같은 계층의 비슷한 클래스 하나를 찾아 구조, 이름 붙이기, 에러 처리의 방식을 따른다. 광역 탐색이 필요하면 서브에이전트에 맡기고 요약만 받는다.

## 만드는 방법

- 전제하는 것은 Kotlin과 Gradle까지다. 아키텍처 패턴(MVI, MVVM)과 DI, 비동기 처리의 방식은 constitution, blueprint, 기존 코드에서 읽는다. 스킬이 정하지 않는다.
- 이 작업을 기다리는 테스트 작업이 있으면(`[until:{이 작업}]`) 그 테스트가 요구하는 인터페이스를 맞춘다. 테스트를 고치지 않는다. 테스트가 틀렸다고 판단하면 고치지 말고 보고에 적는다.
- 끝나면 해당 모듈을 컴파일한다: `./gradlew :{모듈}:compileDebugKotlin`(모듈이 Android 라이브러리가 아니면 `:compileKotlin`). 컴파일 오류는 이 작업의 파일 안에서 고친다. 다른 파일의 오류면 고치지 않고 보고에 적는다.
- 테스트는 돌리지 않는다. 테스트의 실행과 판정은 검증 스킬이 한다.
- 기존 코드를 지우거나 옮기지 않는다. 작업이 지우라고 명시한 경우만 예외다.

{{> impl-report}}

완료 근거에는 컴파일한 모듈과 결과를 적는다.
