---
name: {{skill:fix}}
description: "구현이 끝난 feature의 버그 수정과 작은 변경. 정책을 먼저 확인하고, 범위를 CLI가 판정한 뒤 spec과 breakdown에 수정 단위를 최소로 기록한다. 범위를 넘으면 정식 경로로 돌려보낸다"
argument-hint: "feature의 이름과 고칠 것(QA 티켓의 증상이나 바꿀 문구)"
allowed-tools: Bash(sh *)
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "sh \"$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd\" hook write"
---

# fix

구현이 끝난 feature에 대한 버그 수정과 작은 변경을 받는다. 문서를 건너뛰는 경로가 아니라 **문서의 수정을 작게 하는 경로**다. spec이 개정되면 그대로 기록하고, breakdown에 수정 단위(`[FIX-001]`)를 더한 뒤 구현 단계에 넘긴다. 검증은 줄이지 않는다.

작은지 아닌지는 사용자나 에이전트가 고르지 않는다. `mob-sdd fix check`가 계산으로 정하고, 넘으면 정식 경로로 간다.

{{> input}}

입력에서 대상 feature와 고칠 것을 읽는다.

{{> scope-guard}}

{{> cli}}

## 범위

- 고치는 것은 `docs/specs/{feature}/spec.md`(PATCH 개정일 때만), `checklist.md`의 상태, `breakdown.md`의 수정 단위뿐이다. 코드는 고치지 않는다. 코드는 구현 단계가 고친다.
- prd, constitution, blueprint는 고치지 않는다. 그것을 고쳐야 하는 수정이면 작은 수정이 아니다.
- 받지 않는 것: feature에 속하지 않는 코드의 수정(그 코드를 다루는 spec이 없다), 구현이 끝나지 않은 feature의 수정(평소처럼 breakdown을 개정한다). 그때는 그 사실과 정식 경로를 알리고 끝낸다.

## 현재 상태

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" gate breakdown`

위에 판정 대신 명령이 글자 그대로 보이면 `mob-sdd gate breakdown`을 직접 불러 확인한다.

## 확장 지시의 목록

!`sh "$(git rev-parse --show-toplevel)/.mob-sdd/bin/mob-sdd" directives fix`

{{> directives}}

{{> feature-target}}

대상 feature의 줄이 **중단**이면 시작하지 않는다. 사유와 먼저 다시 실행할 단계를 알리고 끝낸다. `mob-sdd status {feature}`에서 작업이 "구현 완료"가 아니면 이 경로의 대상이 아니다.

## 흐름

### 1. 정책 확인

코드를 보기 전에 고칠 것이 이미 정해진 정책인지 확인한다. 정책을 모르고 고치면, 일부러 막아 둔 동작을 버그로 보고 뒤집는다.

1. `docs/specs/{feature}/spec.md`에서 고칠 것에 닿는 요구사항과 사용자 스토리를 찾는다. spec이 의존하는 `docs/prd.md`의 항목도 읽는다.
2. 「확장 지시의 목록」에 지시가 있으면 따른다.
3. 판정은 셋 가운데 하나다.
    - **정책과 충돌한다**: 고칠 것이 문서가 정한 동작을 뒤집는다. 고치지 않는다. 근거(문서와 줄)를 보여 주고 사용자에게 묻는다: 정책을 유지할지(반려), 정책을 바꿀지. 바꾸기로 하면 작은 수정이 아니다. `/{{skill:spec}}`의 개정으로 안내하고 끝낸다.
    - **문서가 이미 맞는 동작을 정한다**: 코드가 문서와 어긋난 버그다. spec은 고치지 않는다. 3으로 간다.
    - **문서에 없거나 바뀌는 것이 표현뿐이다**: 문구, 여백처럼 뜻이 바뀌지 않는 변경이다. 2로 간다.

### 2. spec의 PATCH 개정 (필요할 때만)

1. spec에서 그 부분만 고친다.
2. `mob-sdd doc changes spec {feature}`로 바뀐 곳을 보고 등급을 근거와 함께 제안한다. **PATCH가 아니면** 작은 수정이 아니다. 고친 것을 되돌리고 `/{{skill:spec}}`의 개정으로 안내하고 끝낸다.
3. `docs/specs/{feature}/checklist.md`를 바뀐 spec으로 다시 확인하고 `mob-sdd doc checklist {feature}`를 부른다.
4. 사용자가 PATCH를 승인하면 `mob-sdd doc revise spec {feature} --grade patch`로 기록한다.

### 3. 수정 단위 쓰기

1. breakdown에서 지금까지 쓴 가장 큰 작업 번호와 `FIX-` 번호를 확인한다. 새 수정에는 다음 번호를 준다.
2. 고칠 파일을 정한다. breakdown의 기존 작업이 맡은 경로에서 찾는다. 기존 작업이 맡지 않은 곳을 고쳐야 하면 작은 수정이 아니다.
3. `## 마지막 확인` 바로 앞에 수정 단위를 더한다.

    ```markdown
    ## 수정: FIX-001 날짜를 바꿔도 예약 화면에 예전 날짜가 나온다

    **증상**: [QA 티켓이나 입력의 증상]
    **근거**: [1의 판정. 문서가 정한 동작이면 그 위치, PATCH 개정이면 그 버전]

    - [ ] T012 [FIX-001] [until:T013] 날짜를 바꾼 뒤 예약 요청에 새 날짜가 실리는지 `domain/src/test/BookingDateTest.kt`
    - [ ] T013 [FIX-001] 날짜 변경을 예약 요청에 넘긴다 `domain/src/main/usecase/BookBooking.kt`
    ```

    - 작업은 두 개까지다: 재현 테스트 하나와 수정 하나.
    - **버그**(1에서 "문서가 이미 맞는 동작을 정한다")는 재현 테스트가 필수다. 테스트 작업을 앞에 두고 `[until:]`로 수정 작업을 가리킨다. 구현 단계가 그 테스트가 먼저 실패하는지 확인한다.
    - **문구나 화면의 변경**은 유닛 테스트로 재현할 동작이 없을 수 있다. 그때만 테스트 없이 수정 작업 하나를 두고, 4에서 사유를 적는다. 화면은 구현 단계의 디자인 대조가 본다.
    - 경로는 파일 하나씩 적는다. 디렉터리를 적지 않는다.

### 4. 범위 판정

```bash
mob-sdd fix check {feature} FIX-001                       # 재현 테스트가 있을 때
mob-sdd fix check {feature} FIX-001 --no-test "문구만 바꾼다"  # 테스트로 재현할 동작이 없을 때
```

- **통과**: 5로 간다.
- **거부**: 무엇이 범위를 넘었는지 그대로 사용자에게 보여 준다. 3에서 더한 수정 단위를 breakdown에서 지운다(2의 spec 개정은 남는다. 정식 경로가 그 위에서 이어 간다). 그리고 정식 경로를 안내하고 끝낸다. 거부를 피해 작업을 쪼개 다른 ID로 나누거나 경로를 바꿔 다시 부르지 않는다.

### 5. 기록

1. `mob-sdd doc changes breakdown {feature}`로 바뀐 곳이 수정 단위뿐인지 본다.
2. `mob-sdd doc revise breakdown {feature} --grade minor`로 기록한다. 작업을 더하는 개정은 MINOR이다. 이 기록으로 마지막 확인 줄이 내려간다.

## 보고

- 1의 판정과 근거. 반려했으면 그 사실과 근거만 보고한다.
- spec을 개정했으면 그 버전.
- 더한 수정 단위의 ID, 작업, 재현 테스트(또는 없는 사유).
- 다음: 구현 단계로 `/impl-orchestrator {feature} --fix FIX-001`. 구현 단계(`android` 확장)가 없는 저장소면 사람이 구현한 뒤 breakdown의 체크를 올려야 한다는 것.
- 범위를 넘어 거부됐으면 그 사유와, 정식 경로에서 먼저 실행할 단계.
