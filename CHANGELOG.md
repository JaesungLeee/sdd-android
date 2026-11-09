# 변경 내역

`upgrade`가 설치된 버전부터 새 버전까지의 항목을 보여 준다. 제목은 `## 버전` 형태로 쓴다.

## 0.5.0

- 구현 단계의 빌드, Lint, 테스트를 CLI가 돌린다. 새 명령 `impl check <feature> <작업>`과 `impl check <feature> --final`이 `config.yaml`의 `impl.checks` 명령을 실행해 종료 코드로 적고, 로그를 `.sdd-android/impl/{feature}/logs/`에 남긴다. `verify-build`는 명령을 직접 돌리지 않고 이 결과의 실패를 분류한다.
- **동작 변경**: `impl verify`와 `impl final`이 빌드, Lint, 테스트의 통과(`--check build=pass` 등)와 Lint의 건너뜀을 인자로 받지 않는다. 실패의 지목과 빌드·테스트의 건너뜀은 받는다. Lint를 건너뛰려면 설정에 `lint: none`을 명시한다.
- **동작 변경**: `impl start`가 `impl.checks`가 없으면 거부한다. 올린 뒤 `npx sdd-android impl setup --lint <명령|none>`으로 정한다. 빌드와 테스트는 기본값(`compileDebugKotlin`, `testDebugUnitTest`)이 있다. 진행 중인 체크포인트는 그대로 이어지며, 다음 검증부터 CLI가 검사를 돌린다.
- 결과의 신선도: `impl check`가 작업 경로의 내용 해시를 함께 적고, `impl verify`와 `impl final`이 지금의 해시와 다르면 그 결과를 버리고 거부한다. 앞서 적힌 빌드·Lint의 통과도 그 사이 코드가 바뀌었으면 체크를 올리는 데 쓰지 않는다.
- constitution 원칙의 검사 줄 `**검사**: 도구 \`규칙\` (설정 파일)` 또는 `**검사**: 감사`. 템플릿과 `/constitution`이 원칙마다 적게 하고, 검사 줄만 바꾸는 개정은 PATCH다. `check`가 도구 줄의 규칙이 설정 파일에 켜져 있는지 대조하고, `status`가 도구 검사·감사·미지정의 수를 보여 준다.
- 선택 검사 `impl.checks.rules`: Lint 밖의 규칙 도구(Konsist 등)를 CLI가 작업마다와 마지막 확인에서 돌린다. 실패 종류 `rules`.
- `verify-principles`는 도구 줄이 없는 원칙만 감사하고, 원칙마다 확인한 곳이나 닿지 않는 이유를 보고한다.
- `android`의 새 스킬 `sync-rules`: 원칙의 검사를 detekt, ktlint, Konsist의 규칙으로 옮긴다. constitution은 고치지 않는다.
- 새 단계 `/fix`: 구현이 끝난 feature의 버그 수정과 작은 변경. 정책을 먼저 확인하고, spec은 PATCH 개정일 때만 고치며, breakdown에 수정 단위(`## 수정: FIX-001`, 작업 `[FIX-001]`)를 더한다. 범위는 새 명령 `fix check <feature> <FIX-001>`이 계산하고, 넘으면 정식 경로로 돌려보낸다.
- `impl start --fix FIX-001`: 수정 단위만 구현한다. 배정은 그 단위의 작업만이고, 마지막 확인은 그 단위가 바꾼 모듈만 돈다. `/impl-orchestrator {feature} --fix FIX-001`.
- **동작 변경**: breakdown에서 한 스토리의 작업이 다른 스토리를 사이에 두고 다시 나오면 `check`가 오류로 본다. 같은 이름의 단위가 둘 생겨 단위 검증의 기록이 섞이던 문제다. 끝난 스토리에 작업을 더할 때는 그 스토리 섹션 안에 넣거나 `/fix`의 수정 단위를 쓴다.
- `impl setup`: 검사 명령을 설정에 적는다. 모듈마다 다른 명령은 `"*"`를 기본으로 하는 묶음으로 손으로 적는다.
- `check`가 `impl.checks`의 형식을 보고, `android`가 설치됐는데 없으면 경고한다.
- `upgrade`가 새 버전에 없는 내장 확장을 지운다. 고친 파일은 남기고 알린다.

## 0.4.0

- 내장 확장 `openapi`: blueprint가 서버의 OpenAPI 문서를 조회해 계약의 근거로 삼는다. 출처는 `config.yaml`의 `openapi.sources`. 조회 스크립트는 `run openapi openapi.mjs list|show`.
- `run <확장> <스크립트> [인자…]`: 확장의 `scripts/` 아래 `.mjs`를 실행 스크립트가 찾은 `node`로 돌린다.
- `check`가 `openapi.sources`의 형식을 본다.

## 0.3.0

- 이름을 `sdd-android`로 바꿨다. 명령 `sdd-android`, 설치 디렉터리 `.sdd-android/`, 환경 변수 `SDD_ANDROID_ROOT`. 이전 이름으로 설치한 저장소는 없다(공개 전).
- 구현용 명령 `impl start|assign|next|report|verify|attempt|final|reset|show`와 착수 게이트 `gate implement`. 체크포인트는 `.sdd-android/impl/`에 둔다. `impl final --result pass`는 마지막 확인의 검사 결과(`--check`)를 요구한다.
- 실패 기록 `docs/specs/{feature}/failures.md`.
- 내장 확장 `android`의 스킬 열한 개: `impl-orchestrator`, `design-inspector`, `create-test|logic|ui|structure`, `verify-build|ui|principles`, `heal-build|test`. `init --extension android`로 코어와 함께 설치하거나, 이미 설치된 저장소에 `extension add android`로 더한다. 코어만으로는 analyze까지다.
- Figma 서버 설정 `figma show|setup`. `.sdd-android/config.local.yaml`과 `.claude/settings.local.json`의 읽기 도구 권한.
- `doc revise breakdown`이 작업이 더해지면 마지막 확인 줄을 내리고, `check`가 어긋난 마지막 확인 줄을 오류로 본다.
- `status`가 feature의 구현 완료와 구현 중을 알린다.

## 0.2.0

- `upgrade`: 설치된 파일을 새 버전으로 올린다. 고친 파일은 그대로 두고 새 버전을 `.new`로 옆에 둔다.
- 읽기 전용 단계 clarify와 analyze.
- 병합 뒤 정리 `doc restore`. 번호가 겹친 항목의 판별.
- 확장 체계: `extension`과 `preset`의 설치와 제거, 단계 지시(`directives`). 코어의 원본을 번들에 싣는다.
- 실행 스크립트 `.sdd-android/bin/sdd-android`: 로그인 셸이 아닌 곳에서도 `node`를 찾는다.
- 빌드가 원본의 줄바꿈을 LF로 통일한다.

## 0.1.0

- 첫 버전. `init`, `status`, `check`, `gate`, `doc`, `hook`, `upgrade` 명령.
- 단계 스킬 다섯 개: constitution, prd, spec, blueprint, breakdown.
- 버전 체인의 판정과 착수 게이트, 개정 모드.
