# Changelog

버전마다 사용하면서 달라지는 점을 적는다. `npx sdd-android@latest upgrade`로 올리면 설치된 버전 다음부터 새 버전까지의 항목을 보여 준다.

<!--
작성 규칙
- 제목은 `## [X.Y.Z] - YYYY-MM-DD`, 최신 버전이 위다. upgrade가 이 제목으로 항목을 고른다.
- 분류는 Added(새 기능), Changed(바뀐 동작), Removed(없앤 기능), Fixed(고친 문제) 순서로, 해당하는 것만 쓴다.
- 사용자가 보고 겪는 것을 쓴다. 내부 구현이나 코드 구조는 쓰지 않는다.
- 올린 뒤 사용자가 해야 할 일이 있으면 버전 제목 바로 아래에 인용으로 먼저 적는다.
-->

## [0.5.0] - 2026-11-10

> 올린 뒤: 구현 단계를 시작하려면 검사 명령을 한 번 정해야 한다. `npx sdd-android impl setup`을 인자 없이 실행하면 프로젝트에서 찾은 Lint 도구를 알려 주고, `--lint "<명령>"`(Lint 도구가 없으면 `--lint none`)으로 정한다.

### Added

- 구현 단계의 빌드, Lint, 테스트를 CLI가 직접 돌려 판정한다. AI가 결과를 잘못 보고해도 실패한 작업이 체크되지 않는다. 로그는 `.sdd-android/impl/{feature}/logs/`에서 볼 수 있다.
- `impl setup`: 구현 단계가 돌릴 검사 명령을 `config.yaml`에 적는다. 빌드와 테스트는 기본값이 있어 Lint만 정하면 된다.
- `impl setup`이 프로젝트의 Gradle 설정을 읽어, 쓰고 있는 Lint 도구(detekt, ktlint, kotlinter, spotless), Konsist, product flavor, Android가 아닌 Kotlin/JVM 모듈에 맞는 명령을 제안한다. 모듈마다 명령이 달라야 하면 `config.yaml`에 붙여 넣을 설정을 보여 준다. 제안은 저절로 적히지 않는다.
- 구현 스킬이 작업을 넘기기 전에 프로젝트에 정한 명령으로 스스로 확인한다. detekt를 쓰거나 flavor가 있는 프로젝트에서도 자체 확인과 판정이 같은 명령으로 돈다.
- `/fix`: 구현이 끝난 feature의 버그 수정과 작은 변경을 처리한다. 범위를 계산해 정식 단계가 필요한 변경이면 그쪽으로 안내하고, 구현은 `/impl-orchestrator {feature} --fix FIX-001`로 그 수정만 한다.
- constitution 원칙마다 지키는 방법을 적는다. 도구로 검사하면 `**검사**: 도구 \`규칙\` (설정 파일)`, 사람이나 AI가 살피면 `**검사**: 감사`. `check`가 도구 규칙이 설정 파일에 켜져 있는지 확인하고, `status`가 방법별 원칙 수를 보여 준다.
- `/sync-rules`: constitution 원칙을 detekt, ktlint, Konsist 규칙으로 옮긴다.
- 선택 검사 `rules`: Konsist처럼 Lint와 따로 도는 규칙 도구를 작업마다 돌린다. `impl setup --rules "<명령>"`으로 정한다.
- breakdown의 작업 줄 끝에 그 작업이 그리는 화면의 Figma 링크(`[화면 이름](Figma URL)`)를 적을 수 있다. 구현 단계가 그 화면을 디자인의 기준으로 쓴다.
- blueprint의 「인터페이스 계약」 섹션: API 계약을 서버의 OpenAPI 문서와 대조한 결과와, 대조하지 못한 계약을 적는다.

### Changed

- Android 전용이 됐다. `init` 한 번으로 문서 단계부터 구현 단계까지의 스킬이 모두 설치된다. 확장을 따로 더하지 않는다.
- OpenAPI 대조가 기본 기능이 됐다. `openapi add`로 출처를 등록하면 blueprint가 대조하고, 출처가 없으면 건너뛴다. 조회는 `openapi operations`와 `openapi show`로 한다.
- 검사 명령이 정해져 있지 않으면 구현 단계를 시작하지 않는다. 이미 진행 중이던 구현은 그대로 이어진다.
- Lint를 건너뛰려면 설정에 `lint: none`을 적는다. 검사 결과나 건너뜀을 명령 인자로 넘기는 방법은 없어졌다.
- 검사한 뒤 코드가 바뀌면 그 결과로 작업을 체크하지 않고 다시 검사하게 한다.
- breakdown에서 한 스토리의 작업이 다른 스토리 뒤에 다시 나오면 `check`가 오류로 알린다. 끝난 스토리에 작업을 더할 때는 그 스토리 섹션 안에 넣거나 `/fix`를 쓴다.
- 어느 작업에도 속하지 않는 파일에서 검사가 실패하면 구현 중에도 `failures.md`에 사람에게 넘긴 것으로 적는다. 전에는 마지막 확인에서만 적었다.
- `check`가 `config.local.yaml`을 읽지 못해도 멈추지 않고 그 문제를 알린 뒤 나머지를 점검한다. `figma show`도 이때 기본값으로 동작하며 이유를 알린다.
- `verify-principles`가 도구로 검사하지 않는 원칙만 살피고, 원칙마다 확인한 곳이나 확인하지 못한 이유를 보고한다.
- `impl.checks`의 모듈별 명령 안에는 `none`을 쓸 수 없다. 한 모듈에만 도구가 없으면 그 모듈에서 성공하는 명령을 적는다.

### Removed

- 확장 체계: `init --extension`, `extension`, `preset`, `directives`, `run` 명령과 `.sdd-android/extensions/` 디렉터리.

### Fixed

- 컴퓨터에서 `node`를 찾지 못할 때 Figma를 읽는 스킬이 로드되지 않던 문제.
- breakdown 템플릿의 주석에 남은 예시가 작업으로 읽히던 문제.
- `/fix`의 마지막 확인이 수정 범위 밖의 모듈까지 검사하던 문제.
- `/impl-orchestrator`가 UI 검증에 feature를 넘기지 않던 문제.
- 구현 스킬의 컴파일 명령이 모듈 경로에 콜론을 하나 더 붙여 실패하던 문제.
- `check`에 오류가 있으면 `/sync-rules`가 실행되지 않던 문제.
- 스킬 접두사를 설정한 저장소에서 안내에 나오는 스킬 이름에 접두사가 빠지던 문제.

## [0.4.0] - 2026-10-27

### Added

- 내장 확장 `openapi`: blueprint가 서버의 OpenAPI 문서를 조회해 API 계약의 근거로 삼는다.
- `openapi list|add|remove`: OpenAPI 출처를 등록하고 지운다. Swagger UI 페이지 주소를 주면 그 페이지가 읽는 문서의 주소를 찾아 저장한다. 설정 파일의 다른 내용과 주석은 그대로 둔다.
- `run <확장> <스크립트>`: 확장이 제공하는 스크립트를 실행한다.
- `check`가 OpenAPI 출처 설정의 형식을 점검한다.

## [0.3.0] - 2026-10-08

### Added

- 구현 단계: 내장 확장 `android`가 스킬 열한 개를 설치한다. `/impl-orchestrator`가 작업을 나눠 맡기고, `create-*`가 구현하고, `verify-*`가 검증하고, `heal-*`가 실패를 고친다. `init --extension android`로 함께 설치하거나, 이미 설치한 저장소에 `extension add android`로 더한다.
- 구현의 진행 상황을 `.sdd-android/impl/`에 저장해, 중단돼도 이어서 진행한다. 구현을 시작하기 전의 확인 `gate implement`.
- 구현 중 실패를 `docs/specs/{feature}/failures.md`에 기록한다.
- `figma show|setup`: 구현 단계가 쓸 Figma 서버를 설정한다. 개인 설정은 `.sdd-android/config.local.yaml`에 두고, `.claude/settings.local.json`에 읽기 도구 권한을 더한다.
- `status`가 feature의 구현 완료와 구현 중을 보여 준다.

### Changed

- breakdown을 개정해 작업이 더해지면 마지막 확인의 체크가 풀린다. `check`가 맞지 않는 마지막 확인을 오류로 알린다.

## [0.2.0] - 2026-10-07

### Added

- `upgrade`: 설치한 파일을 새 버전으로 올린다. 직접 고친 파일은 덮어쓰지 않고 새 버전을 `.new`로 옆에 둔다.
- clarify 단계: spec의 모호한 곳과 상위 문서와 어긋나는 곳을 찾아 묻는다. 파일을 고치지 않는다.
- analyze 단계: spec, blueprint, breakdown을 맞대어 요구사항이 설계와 작업에 빠짐없이 반영되었는지 본다. 파일을 고치지 않는다.
- `doc restore`: 브랜치를 병합한 뒤 문서를 정리하고, 번호가 겹친 항목을 가려낸다.
- 확장 체계: `extension`과 `preset`의 설치와 제거, 단계별 지시(`directives`).
- 실행 스크립트 `.sdd-android/bin/sdd-android`: IDE처럼 로그인 셸이 아닌 곳에서도 `node`를 찾는다.

### Changed

- 설치되는 파일의 줄바꿈이 LF로 통일된다.

## [0.1.0] - 2026-10-04

### Added

- 첫 버전. 문서 단계의 스킬 다섯 개(constitution, prd, spec, blueprint, breakdown)와 명령 `init`, `status`, `check`, `gate`, `doc`, `hook`.
- 문서 사이의 버전 연결을 판정해, 앞 단계 문서가 확정되지 않았거나 바뀌었으면 다음 단계를 시작하지 않는다. 확정한 문서를 고치는 개정 모드.
