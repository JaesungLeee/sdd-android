# Figma 설정

구현 단계의 `design-inspector`, `create-ui`, `verify-ui`가 Figma를 읽는다. spec에 Figma 줄이 없는 feature는 설정 없이 돈다. Figma 줄은 있는데 설정이 없으면 `check`가 경고하고, 기본값(desktop, `figma-desktop`)으로 동작한다.

## 서버 고르기

Claude Code에 Figma MCP 서버를 등록하는 방법은 두 가지이고, 어느 쪽이 맞는지는 환경마다 다르다.

| | `desktop` (기본) | `remote` |
|---|---|---|
| 서버 | Figma 데스크톱 앱의 Dev Mode MCP 서버 | `mcp.figma.com` |
| 전제 | 데스크톱 앱이 켜져 있고 대상 파일이 **활성 탭**으로 열려 있다 | 인증한 계정이 그 파일에 접근할 수 있다 |
| 호출 한도 | 없다 | 좌석에 따라 다르다. View·Collab 좌석은 월 6~20회라 화면 하나의 분석과 대조도 다 하지 못한다. Dev·Full 좌석은 하루 200회 이상 |
| 여러 파일 | 열린 파일만 | 파일 키로 지정 |

자동 전환은 없다. `design-inspector`가 착수 시점에 서버 상태를 한 번 확인하고, 맞지 않으면 설정을 바꾸거나 파일을 열라고 알린다.

## 설정

```sh
npx sdd-android figma setup --server desktop --name figma-desktop
npx sdd-android figma setup --server remote --name figma
npx sdd-android figma show
```

`--name`은 Claude Code에 등록한 서버의 이름이다. `claude mcp list`에 나오는 이름이고 사람마다 다르다(`figma`, `figma-desktop`, `plugin:figma:figma` 등).

`show`는 Figma를 읽는 스킬의 본문에도 주입된다. 두 개인 파일 가운데 읽지 못하는 것이 있으면(형식 오류 등) 거부하지 않고 기본값과 그 이유를 낸다. 파일을 고친 뒤 `setup`으로 다시 정한다. `setup`은 그런 파일이 있으면 거부한다.

`setup`은 개인 파일 두 개만 쓴다. 둘 다 커밋하지 않으므로 팀원마다 다르게 둘 수 있다.

| 파일 | 쓰는 것 |
|---|---|
| `.sdd-android/config.local.yaml` | 서버의 종류와 등록 이름 |
| `.claude/settings.local.json` | `permissions.allow`에 읽기 도구 네 개. 다른 권한은 보존한다 |

허용하는 도구는 `get_metadata`, `get_variable_defs`, `get_screenshot`, `get_design_context`뿐이다. 서버 전체를 허용하지 않는다. 원격 서버에는 파일과 디자인을 만드는 쓰기 도구가 많기 때문이다. 도구의 전체 이름은 `mcp__{등록 이름}__{도구}`이며 등록 이름의 콜론 같은 글자는 밑줄이 된다.

권한을 두지 않으면 대화형 실행에서는 Claude Code가 호출마다 승인을 묻고, 비대화형 실행에서는 조회가 거부된다.

## spec에 링크 적기

[문서 형식](documents.md)의 「spec」에 있다. 요점은 화면 프레임 단위로, 상태마다 하나씩, 섹션이나 페이지 링크는 쓰지 않는 것이다.

## 알아 둘 것

- 데스크톱 서버의 `get_design_context`는 큰 화면 프레임의 첫 호출에 몇 분이 걸릴 수 있고, Claude Code는 300초 동안 응답이 없으면 호출을 중단한다. 스킬은 이 경우 한 번 더 부른다.
- 디자인 분석 결과는 `.sdd-android/impl/{feature}/design.md`에 남고 다음 실행이 덮어쓴다. `create-ui`만 읽고 `verify-ui`는 Figma를 직접 다시 연다.
- 권한 오류와 한도 초과는 "열리지 않는 노드"와 구분해 보고된다. 값을 추측으로 채우지 않는다.

## 캡처의 대조에 필요한 환경

`verify-ui`는 Compose 프리뷰를 기기에 띄워 캡처하고 Figma의 스크린샷과 대조한다. 스토리가 끝날 때와 마지막 확인에서 돈다.

- **디버그 빌드**가 설치돼야 한다. 프리뷰를 띄우는 `PreviewActivity`는 `ui-tooling`을 디버그 의존성으로 넣은 빌드에만 있다.
- **빌드가 서야 한다.** `local.properties`의 SDK 경로, `google-services.json` 같은 빌드 전제가 없으면 설치에 실패하고 캡처는 건너뜀이 된다. 스킬은 이런 파일을 만들거나 우회하지 않는다.
- **기기**: 연결된 실기기를 먼저 쓴다. 없으면 이미 만들어진 가상 기기를 화면 없이 띄운다. 가상 기기를 새로 만들지는 않는다. 둘 다 없으면 캡처의 대조만 건너뛰고 값의 대조는 그대로 한다.
- **서명**: 같은 애플리케이션 ID의 다른 빌드가 기기에 있으면 설치가 실패할 수 있다. 기존 앱을 지우지 않고 건너뜀으로 적는다.
- 캡처는 `.sdd-android/impl/{feature}/captures/`에 남는다. 상태 표시줄과 내비게이션 바는 대조에서 뺀다.
- 판정은 항목별(구성요소, 문구, 색상 토큰, 타이포, 배치, 상태 표현)이고 픽셀 비교는 하지 않는다. spec이 Figma와 다르게 정한 것은 차이가 아니다.
