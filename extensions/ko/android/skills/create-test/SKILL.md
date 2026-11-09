---
name: {{skill:create-test}}
description: "구현 단계의 구현 스킬. breakdown의 테스트 작업 하나를 받아 spec의 요구사항과 계약에서 유닛 테스트를 구현보다 먼저 쓴다"
argument-hint: "feature: 이름, 작업: T002, 경로: …, 스토리: US1, 연결: T004"
allowed-tools: Bash(sh *), Bash(./gradlew *)
context: fork
---

# create-test

breakdown의 테스트 작업 하나를 쓴다. 대응하는 구현보다 **먼저** 쓴다. 테스트의 근거는 구현이 아니라 spec의 요구사항과 blueprint의 인터페이스 계약이다. 테스트를 쓰는 쪽과 통과시키는 쪽을 분리하기 위한 스킬이다.

{{> impl-input}}

인자에서 feature, 작업 ID, 경로, 스토리, 연결된 구현 작업의 ID를 읽는다.

{{> impl-scope}}

- **프로덕션 코드를 건드리지 않는다.** 테스트 소스 세트(`src/test/`, `src/androidTest/`) 밖의 파일은 읽기만 한다. 테스트가 필요로 하는 인터페이스가 아직 없으면 그것은 구현 작업의 몫이다. 만들지 않는다.
- 테스트용 가짜 데이터와 더블(fake, stub)은 작업의 경로 안에 둔다.

{{> cli}}

## 현재 상태

!`sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" gate implement`

위에 판정 대신 명령이 글자 그대로 보이면 `sdd-android gate implement`를 직접 불러 확인한다.

## 확장 지시의 목록

!`sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" directives create-test`

{{> directives}}

## 착수 게이트

「현재 상태」에서 대상 feature의 줄을 본다. 이것은 미리 알림이다.

- **통과**이거나 "체크포인트의 결정을 따른다"가 붙어 있으면 진행한다.
- **확인 필요**나 **중단**이면 시작하지 않는다. `/{{skill:impl-orchestrator}}`로 부르거나 뒤처진 문서의 단계를 먼저 실행하라고 보고하고 끝낸다.

## 읽는 것

- `docs/specs/{feature}/spec.md`에서 이 스토리의 요구사항, 테스트 시나리오, 엣지 케이스. 테스트의 이름과 단정은 여기서 나온다.
- `docs/specs/{feature}/blueprint.md`와 있으면 `contracts/`, `data-model.md`. 테스트가 부를 인터페이스의 이름과 시그니처는 여기서 나온다. 설계에 없는 이름을 지어내지 않는다.
- `docs/specs/{feature}/breakdown.md`에서 작업 줄과 연결된 구현 작업의 경로. 그 구현이 만들 것에 대한 테스트다.
- `docs/constitution.md`가 있으면 테스트에 관한 원칙(프레임워크, 범위)을 읽는다.
- 같은 모듈의 기존 테스트 하나. 테스트 프레임워크, 더블의 방식, 코루틴 테스트 규칙을 따른다.

## 쓰는 방법

- 적용 범위는 도메인·데이터 계층과 화면의 상태 로직이다. Composable 화면과 구조 작업의 테스트는 쓰지 않는다. 작업이 그것을 요구하면 `blocked`로 보고한다.
- 요구사항 하나에 테스트 하나 이상. 테스트 이름에 요구사항의 ID나 시나리오를 드러낸다.
- 통과와 실패만 판정하는 테스트를 쓴다. 커버리지를 채우려는 테스트는 쓰지 않는다.
- 구현이 아직 없으므로 테스트 소스는 **컴파일되지 않는 것이 정상이다.** 컴파일을 맞추려고 프로덕션 코드를 만들지 않는다.
- 연결된 구현 작업이 이미 끝나 있으면(이어서 실행하는 경우) 테스트를 돌려 본다. 실패(red)하면 정상이고, 통과하면 테스트가 아무것도 확인하지 않는 것일 수 있으니 단정을 다시 본다.

{{> impl-report}}

완료 근거에는 어느 요구사항을 어느 테스트가 확인하는지 한 줄씩 적는다. 돌려 보지 않았으면 "구현 전이라 돌리지 않음"이라고 적는다.
