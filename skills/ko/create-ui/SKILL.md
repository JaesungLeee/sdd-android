---
name: {{skill:create-ui}}
description: "구현 단계의 구현 스킬. breakdown의 UI 작업 하나를 받아 Jetpack Compose 화면, 상태(Contract), 디자인 토큰, 공용 컴포넌트를 작업이 지정한 경로 안에 만들고 화면과 상태마다 프리뷰를 둔다"
argument-hint: "feature: 이름, 작업: T005, 경로: …, 스토리: US1, 노드: [화면 이름](URL) 또는 없음, 분석: .sdd-android/impl/{feature}/design.md 또는 없음, 차이: (되돌림일 때 차이 목록)"
allowed-tools: Bash(sh *), Bash(./gradlew *)
context: fork
---

# create-ui

breakdown의 UI 작업 하나를 구현한다. 맡는 것은 화면(Composable), 화면의 상태(Contract, UiState), 디자인 토큰, 공용 컴포넌트다. 화면의 골격을 만드는 일과 그 안을 채우는 일을 나누지 않는다. 도메인과 데이터 계층, 모듈 골격과 배선은 맡지 않는다.

{{> impl-input}}

인자에서 feature, 작업 ID, 경로, 스토리, Figma 노드, 분석 파일, 되돌림이면 차이 목록을 읽는다.

{{> impl-scope}}

{{> cli}}

## 현재 상태

!`sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" gate implement`

위에 판정 대신 명령이 글자 그대로 보이면 `sdd-android gate implement`를 직접 불러 확인한다.

## Figma 서버

!`sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" figma show`

위에 적힌 도구 이름을 그대로 쓴다. 도구 목록에 지연 로드 상태로만 있으면 ToolSearch로 불러온 뒤 쓴다. 읽기 도구만 쓴다.

## 착수 게이트

「현재 상태」에서 대상 feature의 줄을 본다. 이것은 미리 알림이다.

- **통과**이거나 "체크포인트의 결정을 따른다"가 붙어 있으면 진행한다.
- **확인 필요**나 **중단**이면 시작하지 않는다. `/{{skill:impl-orchestrator}}`로 부르거나 뒤처진 문서의 단계를 먼저 실행하라고 보고하고 끝낸다.

## 읽는 것

- `docs/specs/{feature}/breakdown.md`에서 작업 줄. 설명과 줄 끝의 경로가 범위다.
- `docs/specs/{feature}/spec.md`에서 이 스토리의 요구사항, UX 규칙, 화면의 상태.
- `docs/specs/{feature}/blueprint.md`에서 화면의 구조, 상태의 설계, 컴포넌트의 소속 모듈.
- **디자인 원본**: 인자의 분석 파일(있으면)과 Figma 노드. 화면 프레임만 주어진 컴포넌트 작업은 화면의 `get_metadata`에서 해당 자식 노드로 내려간다. 분석 파일에 없는 값이 필요하면 Figma를 직접 읽는다.
- `docs/constitution.md`의 디자인 토큰과 컴포넌트 소속에 관한 원칙.
- 같은 모듈의 기존 화면 하나. 상태 홀더의 패턴(MVI, MVVM), 내비게이션 인자의 전달, 프리뷰의 작성 방식을 따른다.

## 만드는 방법

- 전제하는 것은 Kotlin, Gradle, Jetpack Compose까지다. 아키텍처 패턴과 DI는 constitution, blueprint, 기존 코드에서 읽는다.
- **토큰이냐 실측값이냐**: constitution이나 규약 문서가 정한 판정을 따른다. 정한 것이 없으면, 값이 같은 토큰이 디자인 시스템에 있으면 토큰을 쓰고 없으면 Figma의 실측값을 그대로 쓴다. 값의 출처를 주석으로 복사해 두지 않는다. 눈대중으로 옮기지 않는다.
- **문구**는 Figma와 spec이 같을 때 그대로 쓴다. 다르면 spec을 따르고 보고에 적는다.
- **프리뷰**: 화면과 상태마다 `@Preview` 함수를 하나씩 만든다. 로딩, 빈 화면, 오류 같은 상태별 화면을 각각 띄울 수 있어야 캡처의 대조가 된다. 프리뷰는 `private`이어도 된다. 만든 프리뷰 함수의 **전체 이름**(`패키지.파일이름Kt.함수이름`)을 보고에 적는다. `{{skill:verify-ui}}`가 그대로 쓴다.
- **Figma 노드가 없는 작업**: spec과 blueprint만으로 만들고, 보고에 "디자인 원본 없음"을 적는다. 디자인 대조는 건너뛰게 된다.
- **되돌림**(인자에 차이 목록이 있다): 차이 목록의 항목만 고친다. 다른 것을 함께 손보지 않는다.
- 끝나면 해당 모듈을 컴파일한다: `./gradlew :{모듈}:compileDebugKotlin`. 컴파일 오류는 이 작업의 파일 안에서 고친다.
- 테스트와 Lint는 돌리지 않는다. 검증 스킬의 몫이다.

{{> impl-report}}

보고에 다음 줄을 더한다.

```text
프리뷰: 전체 이름을 쉼표로. 없으면 없음
디자인 원본: 쓴 노드 ID, 또는 없음
spec과 어긋남: Figma와 spec이 달라 spec을 따른 곳. 없으면 없음
```
