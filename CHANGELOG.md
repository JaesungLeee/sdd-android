# 변경 내역

`upgrade`가 설치된 버전부터 새 버전까지의 항목을 보여 준다. 제목은 `## 버전` 형태로 쓴다.

## 0.2.0

- `upgrade`: 설치된 파일을 새 버전으로 올린다. 고친 파일은 그대로 두고 새 버전을 `.new`로 옆에 둔다.
- 읽기 전용 단계 clarify와 analyze.
- 병합 뒤 정리 `doc restore`. 번호가 겹친 항목의 판별.
- 확장 체계: `extension`과 `preset`의 설치와 제거, 단계 지시(`directives`). 코어의 원본을 번들에 싣는다.
- 실행 스크립트 `.sdd-first/bin/sdd-first`: 로그인 셸이 아닌 곳에서도 `node`를 찾는다.
- 빌드가 원본의 줄바꿈을 LF로 통일한다.

## 0.1.0

- 첫 버전. `init`, `status`, `check`, `gate`, `doc`, `hook`, `upgrade` 명령.
- 단계 스킬 다섯 개: constitution, prd, spec, blueprint, breakdown.
- 버전 체인의 판정과 착수 게이트, 개정 모드.
