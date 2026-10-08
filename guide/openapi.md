# OpenAPI 대조

`openapi` extension이 제공한다. blueprint 단계가 서버의 OpenAPI 문서를 조회해 인터페이스 계약의 근거로 삼는다. 서버 API를 쓰는 프로젝트에만 필요하다.

```sh
npx mob-sdd init --extension openapi    # 처음 설치할 때
npx mob-sdd extension add openapi       # 이미 설치된 저장소에 더할 때
```

스킬은 없다. blueprint에 더하는 지시 파일 하나와 조회 스크립트 하나다.

## 출처 설정

`.mob-sdd/config.yaml`에 적는다. 커밋하는 파일이므로 팀이 같은 출처를 본다.

```yaml
openapi:
  sources:
    - name: api                                   # 소문자, 숫자, 하이픈
      url: https://api.example.com/v3/api-docs    # url이나 path 가운데 하나
    - name: auth
      path: contracts/auth-openapi.yaml           # 저장소 루트 기준
```

`check`가 형식과 `path`의 파일이 있는지를 본다. 네트워크는 쓰지 않는다.

## blueprint가 하는 일

출처가 설정되어 있으면 `/blueprint`가 다음을 한다.

- 조회 스크립트로 오퍼레이션 목록을 좁히고, 이 feature의 계약에 쓰는 것만 펼쳐 계약을 쓴다.
- 조회한 출처와 조회 시점을 `blueprint.md`의 인터페이스 계약 절에 적는다.
- 대응하는 API가 없는 요구사항과 spec과 어긋나는 API는 계약에 억지로 맞추지 않고 보고한다.
- 조회에 실패한 출처가 있으면 그 사실과 대조하지 못한 계약의 목록을 적는다.

출처가 없으면 "OpenAPI 출처가 설정되어 있지 않다"고 적고 넘어간다.

## 스크립트를 직접 돌릴 때

```sh
npx mob-sdd run openapi openapi.mjs list [--source <이름>] [--filter <텍스트>]
npx mob-sdd run openapi openapi.mjs show <operationId | "METHOD /path">… [--source <이름>]
```

- `list`는 출처마다 머리말(출처, 조회 시점, 제목과 버전)과 `METHOD /path operationId 요약 [태그]` 한 줄씩을 낸다.
- `show`는 파라미터, 요청 본문, 응답의 스키마를 `$ref`를 풀어 낸다. 필수 필드는 `*`, 배열은 `[타입]`, 열거는 `"a" | "b"`로 적는다.
- 조회 실패는 머리말에 적히고 종료 코드는 0이다. 캐시는 없어 실행마다 다시 받는다.
- JSON과 YAML 문서를 모두 읽는다. 스크립트는 의존성과 함께 파일 하나로 설치되므로 `node_modules`가 필요 없다.

`run`은 확장의 `scripts/` 아래 `.mjs`를 실행하는 코어 명령이다. 스킬이 허용하는 도구가 `Bash(sh *)`뿐이라 `node`를 직접 부르지 못하므로, 실행 스크립트가 찾은 `node`로 대신 돌린다. 인자는 그대로 넘기고, 작업 디렉터리는 저장소 루트이며, `MOB_SDD_ROOT` 환경 변수로 루트를 알려 준다.
