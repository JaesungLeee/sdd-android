---
name: {{skill:create-structure}}
description: "구현 단계의 구현 스킬. breakdown의 작업 하나를 받아 모듈 골격, 빌드 구성, 화면 전환 배선, 모듈 간 DI, 에러 경로 배선을 만든다"
argument-hint: "feature: 이름, 작업: T001, 경로: …"
allowed-tools: Bash(sh *), Bash(./gradlew *)
context: fork
---

# create-structure

breakdown의 작업 하나를 구현한다. 맡는 것은 feature의 내용이 아니라 **프로젝트의 구조**다: 모듈 골격과 빌드 구성, 화면 전환(내비게이션) 배선, 모듈 간 DI 등록, 에러 경로 배선. 여러 작업이 함께 건드리는 공용 파일을 고치며, 확인은 유닛 테스트가 아니라 빌드로 한다.

{{> impl-input}}

인자에서 feature, 작업 ID, 경로를 읽는다.

{{> impl-scope}}

- 공용 파일(`settings.gradle.kts`, 내비게이션 그래프, DI 모듈)을 고칠 때는 이 작업이 더하는 줄만 더한다. 다른 feature의 등록을 옮기거나 정리하지 않는다.
- 의존성의 추가가 작업에 명시되어 있으면 한다. 명시되지 않은 라이브러리를 더하지 않는다. 버전 카탈로그에 없는 라이브러리가 필요하면 `blocked`로 보고한다.

{{> cli}}

## 현재 상태

!`sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" gate implement`

위에 판정 대신 명령이 글자 그대로 보이면 `sdd-android gate implement`를 직접 불러 확인한다.

## 착수 게이트

「현재 상태」에서 대상 feature의 줄을 본다. 이것은 미리 알림이다.

- **통과**이거나 "체크포인트의 결정을 따른다"가 붙어 있으면 진행한다.
- **확인 필요**나 **중단**이면 시작하지 않는다. `/{{skill:impl-orchestrator}}`로 부르거나 뒤처진 문서의 단계를 먼저 실행하라고 보고하고 끝낸다.

## 읽는 것

- `docs/specs/{feature}/breakdown.md`에서 작업 줄.
- `docs/specs/{feature}/blueprint.md`에서 모듈 구조, 의존 방향, 화면 전환, DI의 설계. 있으면 `quickstart.md`.
- `docs/constitution.md`가 있으면 모듈과 의존 방향의 원칙.
- 기존의 같은 종류 모듈 하나(빌드 스크립트, 패키지 구조, 등록 방식). 새 모듈은 그것을 본뜬다. 프로젝트의 빌드 로직 플러그인(convention plugin)이 있으면 그것을 쓴다.

## 만드는 방법

- 골격은 설계가 정한 모듈 이름과 패키지로 만든다. 비어 있는 모듈이라도 빌드가 서야 한다.
- 배선은 등록 누락 없이 연결한다: 내비게이션 그래프의 경로, DI의 바인딩, 에러를 받는 곳. 등록할 대상이 아직 없으면(앞의 작업이 안 끝남) `blocked`로 보고한다.
- 끝나면 빌드로 확인한다: 골격이면 `./gradlew {모듈}:compileDebugKotlin`, 배선이면 그 배선을 포함하는 앱 모듈의 `assembleDebug`가 무거우면 `compileDebugKotlin`까지. 실패는 이 작업의 파일 안에서 고친다.
- 테스트는 돌리지 않는다.

{{> impl-report}}

완료 근거에는 어느 Gradle 태스크가 성공했는지와 등록한 항목의 목록을 적는다.
