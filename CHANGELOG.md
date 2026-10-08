# 변경 내역

`upgrade`가 설치된 버전부터 새 버전까지의 항목을 보여 준다. 제목은 `## 버전` 형태로 쓴다.

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
