---
name: {{skill:design-inspector}}
description: "구현 단계의 디자인 분석 스킬. spec의 Figma 노드를 열어 구성요소, 구조, 토큰과 치수, 문구, 상태를 뽑아 feature의 분석 파일에 적는다"
argument-hint: "feature: 이름, 노드: [화면 이름](URL) · …, 출력: .sdd-android/impl/{feature}/design.md"
allowed-tools: Bash(sh *)
context: fork
---

# design-inspector

feature의 Figma 노드를 한 번 열어 구현에 필요한 값을 뽑는다. 결과는 `.sdd-android/impl/{feature}/design.md` 하나에 적는다. 이 파일은 `{{skill:create-ui}}`만 읽는다. `{{skill:verify-ui}}`는 읽지 않고 Figma를 직접 다시 연다. 같은 출처로 구현하고 판정하면 분석의 오류가 검증을 그대로 통과하기 때문이다.

{{> impl-input}}

인자에서 feature, 노드 목록(화면 이름과 URL), 출력 파일의 경로를 읽는다. 노드는 spec의 Figma 줄에서 `{{skill:impl-orchestrator}}`가 뽑아 넘긴 것이다. 사용자에게 링크를 받지 않는다.

## 범위

- 쓰는 파일은 인자의 출력 파일 하나뿐이다. 코드, 문서, 그 밖의 파일을 만들거나 고치지 않는다.
- Figma는 읽기만 한다. 쓰기 도구(파일 생성, 디자인 생성, 에셋 업로드)가 같은 서버에 있어도 부르지 않는다.
- 추측으로 값을 채우지 않는다. 열리지 않는 노드는 열리지 않았다고 적는다.

{{> cli}}

## Figma 서버

!`sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" figma show`

위에 적힌 도구 이름을 그대로 쓴다. 도구 목록에 그 이름이 지연 로드 상태로만 있으면 ToolSearch로 불러온 뒤 쓴다. "권한이 없는 도구"가 적혀 있으면 호출이 거부될 수 있다. 거부되면 그 사실과 `sdd-android figma setup`을 보고에 적고 끝낸다.

## 확장 지시의 목록

!`sh "$(git rev-parse --show-toplevel)/.sdd-android/bin/sdd-android" directives design-inspector`

{{> directives}}

## 1. 서버의 상태

분석하기 전에 한 번 확인한다. 자동으로 다른 서버로 넘어가지 않는다.

- **remote**: `whoami`로 좌석과 호출 한도를 본다. View나 Collab 좌석은 월 한도가 작아 화면 하나의 분석도 다 하지 못할 수 있다. 한도 초과나 권한 오류는 오류 문구를 그대로 보고에 적는다.
- **desktop**: 첫 노드의 `get_metadata`를 부른다. `No node could be found`가 나오면 대상 파일이 데스크톱 앱의 활성 탭이 아니다. 분석하지 않고 그 파일을 열어 두라고 보고한다.

## 2. 노드의 종류

노드마다 `get_metadata`로 종류를 본다.

- **화면 프레임이나 컴포넌트**: 분석한다.
- **페이지, 섹션, 직계 자식이 수십 개인 컨테이너**: 분석하지 않는다. 그 안의 어느 프레임이 어느 화면인지 추정해 대응시키지 않는다. 추정이 틀리면 틀린 화면을 기준으로 구현하고 검증까지 통과한다. 「열리지 않은 노드」와 함께 보고해, `{{skill:impl-orchestrator}}`가 사용자에게 화면 프레임의 링크를 묻게 한다.
- **열리지 않는 노드**: 오류 문구를 그대로 적는다. 권한 오류(`invalid node selection`, 접근 권한), 한도 초과, 없는 노드(`not found`)를 구분한다.
- **응답 없음으로 중단된 호출**(`sent no response or progress`): 화면 프레임의 첫 `get_design_context`는 큰 이미지가 있으면 몇 분이 걸리고, 서버는 호출을 차례로 처리한다. 중단돼도 서버는 일을 이어 가므로 같은 호출을 한 번 더 한다. 두 번째도 중단되면 그 노드의 직계 자식(이미지 노드는 제외)으로 나눠 부르고, 분석 파일에 그렇게 읽었다고 적는다.

## 3. 뽑는 것

화면(상태)마다 다음을 뽑는다. 값은 Figma에서 읽은 것만 적고, 읽지 못한 것은 "읽지 못함"이라고 적는다.

- **구조**: 구성요소의 트리. 이름, 종류(프레임, 텍스트, 인스턴스), 순서.
- **토큰과 치수**: `get_variable_defs`의 변수 이름과 값. 변수가 붙지 않은 값은 `get_design_context`의 실측값. 색, 타이포, 간격, 크기, 모서리.
- **문구**: 텍스트 노드의 내용 그대로.
- **상태**: 같은 화면의 다른 상태 노드, 인스턴스의 variant 이름과 값.
- **컴포넌트 인스턴스**: 디자인 시스템의 어느 컴포넌트인지와 variant.

`get_screenshot`은 구조를 읽는 데 참고만 하고 값을 눈대중으로 옮기지 않는다.

## 4. spec과의 대조

Figma에서 읽은 동작이나 문구가 `docs/specs/{feature}/spec.md`와 다르면 **채택하지 않고** 「spec과 어긋남」에 적는다. spec이 기준이고, 고치는 것은 spec 단계의 재실행이다.

## 5. 출력 파일

인자의 출력 파일에 쓴다. 디렉터리가 없으면 만든다. 형식:

```markdown
# 디자인 분석: {feature}

읽은 시각: {ISO 시각} · 서버: {desktop|remote} ({등록 이름})

## {화면 이름} ({노드 ID})

### 구조
- …

### 토큰과 값
| 요소 | 속성 | 변수 | 값 |
|---|---|---|---|

### 문구
- …

### 상태
- …

## 열리지 않은 노드
- {이름} ({노드 ID}): {오류 문구 그대로}

## spec과 어긋남
- …
```

## 보고의 형식

마지막 메시지가 보고다.

```text
상태: done | blocked
분석한 노드: 이름과 노드 ID를 쉼표로
열리지 않은 노드: 이름, 노드 ID, 오류 문구. 없으면 없음
화면이 아닌 노드: 페이지나 섹션을 가리킨 것. 화면 프레임의 링크가 필요하다. 없으면 없음
spec과 어긋남: 요약. 없으면 없음
출력: 쓴 파일의 경로
```

`blocked`는 서버에 닿지 못했거나(파일이 열려 있지 않음, 권한, 한도) 노드가 하나도 열리지 않은 경우다.
