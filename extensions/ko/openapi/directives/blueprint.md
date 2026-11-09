# OpenAPI 대조의 지시: blueprint

서버 엔드포인트를 쓰는 인터페이스 계약은 서버의 OpenAPI 문서를 조회한 결과를 근거로 쓴다. 기억이나 추측으로 계약을 적지 않는다.

## 출처

출처는 `.sdd-android/config.yaml`의 `openapi.sources`다. 조회는 다음 명령으로 한다. 어느 디렉터리에서 불러도 된다.

```bash
sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" run openapi openapi.mjs list [--source <이름>] [--filter <텍스트>]
sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" run openapi openapi.mjs show <operationId | "METHOD /path">… [--source <이름>]
```

- `list`는 출처마다 머리말(출처, 조회 시점, 제목과 버전)과 오퍼레이션 목록을 낸다. `--filter`로 경로, ID, 요약, 태그를 좁힌다.
- `show`는 고른 오퍼레이션만 파라미터, 요청 본문, 응답의 스키마까지 펼친다. 목록 전체를 펼치지 않고 이 feature의 계약에 쓰는 것만 펼친다.
- 출력에 "출처가 없다"가 나오면 설정이 없는 것이다. 계약 절에 "OpenAPI 출처가 설정되어 있지 않다"고 적고 이 지시는 끝이다.

## 쓰기

- 조회한 **출처와 조회 시점**(머리말의 내용)을 `blueprint.md`의 인터페이스 계약 절에 적는다. 출처가 여럿이면 쓴 것마다 적는다.
- 계약은 `show`의 결과에 맞춘다. 경로, 메서드, 파라미터, 요청과 응답의 필드와 타입이 문서와 같아야 한다. 문서에 없는 필드를 더하지 않는다.
- **대응하는 API가 없는 요구사항**과 **spec과 어긋나는 API**(spec이 요구하는 값을 API가 주지 않거나, 형식이 다르다)는 계약에 억지로 맞추지 않고 보고에 적는다. spec을 고칠지 서버에 요청할지는 사용자가 정한다.
- 머리말이 `조회 실패`인 출처가 있으면 그 사실(출처와 오류)과 **대조하지 못한 계약**의 목록을 계약 절에 적는다. 그 계약은 조회 없이 쓴 것임을 표시한다.
- 이 지시는 읽을 것을 더할 뿐이다. 설정이나 다른 문서를 고치지 않는다.
