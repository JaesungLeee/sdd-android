# 변경 내역

`upgrade`가 설치된 버전부터 새 버전까지의 항목을 보여 준다. 제목은 `## 버전` 형태로 쓴다.

## 0.5.0

- 구현 단계의 빌드, Lint, 테스트를 CLI가 돌린다. 새 명령 `impl check <feature> <작업>`과 `impl check <feature> --final`이 `config.yaml`의 `impl.checks` 명령을 실행해 종료 코드로 적고, 로그를 `.mob-sdd/impl/{feature}/logs/`에 남긴다. `verify-build`는 명령을 직접 돌리지 않고 이 결과의 실패를 분류한다.
- **동작 변경**: `impl verify`와 `impl final`이 빌드, Lint, 테스트의 통과(`--check build=pass` 등)와 Lint의 건너뜀을 인자로 받지 않는다. 실패의 지목과 빌드·테스트의 건너뜀은 받는다. Lint를 건너뛰려면 설정에 `lint: none`을 명시한다.
- **동작 변경**: `impl start`가 `impl.checks`가 없으면 거부한다. 올린 뒤 `npx mob-sdd impl setup --lint <명령|none>`으로 정한다. 빌드와 테스트는 기본값(`compileDebugKotlin`, `testDebugUnitTest`)이 있다. 진행 중인 체크포인트는 그대로 이어지며, 다음 검증부터 CLI가 검사를 돌린다.
- 결과의 신선도: `impl check`가 작업 경로의 내용 해시를 함께 적고, `impl verify`와 `impl final`이 지금의 해시와 다르면 그 결과를 버리고 거부한다. 앞서 적힌 빌드·Lint의 통과도 그 사이 코드가 바뀌었으면 체크를 올리는 데 쓰지 않는다.
- `impl setup`: 검사 명령을 설정에 적는다. 모듈마다 다른 명령은 `"*"`를 기본으로 하는 묶음으로 손으로 적는다.
- `check`가 `impl.checks`의 형식을 보고, `android`가 설치됐는데 없으면 경고한다.

## 0.4.0

- 내장 확장 `wiki`: 지식 계층의 위키(`docs/wiki/`). 스킬 `wiki-ingest`(수집)와 `wiki-lint`(점검). constitution, blueprint, `android`의 `create-*`와 `heal-*`에 위키를 읽는 지시를 더한다. 두 스킬은 위키 아래만 쓰며 `hook write --scope wiki`가 그 밖의 문서 쓰기를 막는다.
- 위키의 계산 명령 `wiki index|record|lint|sources|category add`. 낡음은 원본의 내용 해시로 판정한다. `status`가 위키가 있으면 페이지, 낡음 후보, 미수집 원본의 수를 한 줄 더한다.
- 내장 확장 `openapi`: blueprint가 서버의 OpenAPI 문서를 조회해 계약의 근거로 삼는다. 출처는 `config.yaml`의 `openapi.sources`. 조회 스크립트는 `run openapi openapi.mjs list|show`.
- `run <확장> <스크립트> [인자…]`: 확장의 `scripts/` 아래 `.mjs`를 실행 스크립트가 찾은 `node`로 돌린다.
- `check`가 `openapi.sources`의 형식을 보고, 지시의 대상으로 내장 확장의 스킬 이름을 안다. `init`이 기존 코드가 있는 저장소에서 위키를 권한다.

## 0.3.0

- 이름을 `mob-sdd`로 바꿨다. 명령 `mob-sdd`, 설치 디렉터리 `.mob-sdd/`, 환경 변수 `MOB_SDD_ROOT`. 이전 이름으로 설치한 저장소는 없다(공개 전).
- 구현용 명령 `impl start|assign|next|report|verify|attempt|final|reset|show`와 착수 게이트 `gate implement`. 체크포인트는 `.mob-sdd/impl/`에 둔다. `impl final --result pass`는 마지막 확인의 검사 결과(`--check`)를 요구한다.
- 실패 기록 `docs/specs/{feature}/failures.md`.
- 내장 확장 `android`의 스킬 열한 개: `impl-orchestrator`, `design-inspector`, `create-test|logic|ui|structure`, `verify-build|ui|principles`, `heal-build|test`. `init --extension android`로 코어와 함께 설치하거나, 이미 설치된 저장소에 `extension add android`로 더한다. 코어만으로는 analyze까지다.
- Figma 서버 설정 `figma show|setup`. `.mob-sdd/config.local.yaml`과 `.claude/settings.local.json`의 읽기 도구 권한.
- `doc revise breakdown`이 작업이 더해지면 마지막 확인 줄을 내리고, `check`가 어긋난 마지막 확인 줄을 오류로 본다.
- `status`가 feature의 구현 완료와 구현 중을 알린다.

## 0.2.0

- `upgrade`: 설치된 파일을 새 버전으로 올린다. 고친 파일은 그대로 두고 새 버전을 `.new`로 옆에 둔다.
- 읽기 전용 단계 clarify와 analyze.
- 병합 뒤 정리 `doc restore`. 번호가 겹친 항목의 판별.
- 확장 체계: `extension`과 `preset`의 설치와 제거, 단계 지시(`directives`). 코어의 원본을 번들에 싣는다.
- 실행 스크립트 `.mob-sdd/bin/mob-sdd`: 로그인 셸이 아닌 곳에서도 `node`를 찾는다.
- 빌드가 원본의 줄바꿈을 LF로 통일한다.

## 0.1.0

- 첫 버전. `init`, `status`, `check`, `gate`, `doc`, `hook`, `upgrade` 명령.
- 단계 스킬 다섯 개: constitution, prd, spec, blueprint, breakdown.
- 버전 체인의 판정과 착수 게이트, 개정 모드.
