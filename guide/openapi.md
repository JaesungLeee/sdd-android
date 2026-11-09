# OpenAPI 대조

blueprint 단계가 서버의 OpenAPI 문서를 조회해 인터페이스 계약의 근거로 삼는다. 서버 API를 쓰는 프로젝트에만 필요하다. 따로 설치하지 않는다. 출처를 설정하면 동작하고, 없으면 건너뛴다.

## 출처 설정

```sh
npx sdd-android openapi add mino --url https://api.example.com/v3/api-docs
npx sdd-android openapi add auth --path contracts/auth-openapi.yaml    # 저장소 루트 기준. 파일이 있어야 한다
npx sdd-android openapi list
npx sdd-android openapi remove auth
```

Swagger UI 페이지의 주소(`…/api-docs`, `…/swagger-ui`)를 주면 그 페이지가 읽는 문서의 주소를 찾아 저장한다. 초기화 스크립트에 적힌 주소, NestJS의 `…-json`, `/v3/api-docs` 같은 흔한 자리, 페이지 안에 든 문서의 순서로 본다. 찾지 못하거나 네트워크가 없으면 받은 대로 저장하고 알린다. 같은 이름으로 다시 `add`하면 바꾼다. 결과는 `.sdd-android/config.yaml`의 `openapi.sources`에 적히며, 커밋하는 파일이므로 팀이 같은 출처를 본다. 손으로 고쳐도 된다.

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

- `openapi operations`로 오퍼레이션 목록을 좁히고, `openapi show`로 이 feature의 계약에 쓰는 것만 펼쳐 계약을 쓴다.
- 조회한 출처와 조회 시점을 `blueprint.md`의 「인터페이스 계약」 섹션에 적는다.
- 대응하는 API가 없는 요구사항과 spec과 어긋나는 API는 계약에 억지로 맞추지 않고 보고한다.
- 조회에 실패한 출처가 있으면 그 사실과 대조하지 못한 계약의 목록을 적는다.

출처가 없으면 "OpenAPI 출처가 설정되어 있지 않다"고 적고 넘어간다.

## 조회 명령

```sh
npx sdd-android openapi operations [--source <이름>] [--filter <텍스트>]
npx sdd-android openapi show <operationId | "METHOD /path">… [--source <이름>]
```

blueprint가 부르지만 사람이 쳐도 된다.

- `operations`는 출처마다 머리말(출처, 조회 시점, 제목과 버전)과 `METHOD /path operationId 요약 [태그]` 한 줄씩을 낸다.
- `show`는 파라미터, 요청 본문, 응답의 스키마를 `$ref`를 풀어 낸다. 필수 필드는 `*`, 배열은 `[타입]`, 열거는 `"a" | "b"`로 적는다.
- 조회 실패는 머리말에 적히고 거부하지 않는다(종료 코드 0). 캐시는 없어 실행마다 다시 받는다.
- 설정에 Swagger UI 페이지의 주소가 적혀 있으면 조회도 같은 방법으로 문서를 찾아 읽고, 머리말에 `페이지 주소 → 문서 주소`로 적는다.
- JSON과 YAML 문서를 모두 읽는다.
