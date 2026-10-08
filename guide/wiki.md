# 위키

`wiki` extension이 제공하는 지식 계층이다. 코드베이스가 실제로 어떤지(구조, 관찰된 규약, 과거 결정, 실패)를 LLM이 마크다운 페이지로 수집하고 점검한다. 단계들은 이것을 읽기 전용 힌트로 읽는다.

```sh
npx mob-sdd init --extension wiki       # 처음 설치할 때
npx mob-sdd extension add wiki          # 이미 설치된 저장소에 더할 때
```

## 위키와 constitution

| | constitution | 위키 |
|---|---|---|
| 담는 것 | 지켜야 하는 규범 | 관찰한 것의 서술 |
| 고치는 주체 | 사람이 승인해 개정 | LLM이 수집과 점검으로 유지 |
| 버전 체인 | 안에 있다. 단계의 근거이자 게이트 | 밖에 있다. 어떤 문서도 위키를 기준으로 삼지 않는다 |
| 어긋나면 | constitution을 따른다 | |

위키의 내용을 강제하려면 `/constitution`을 다시 실행해 원칙으로 올린다. 위키가 없는 저장소에서도 모든 단계가 그대로 동작한다.

## 구조

```text
docs/wiki/
  index.md            # CLI가 만든다. 손으로 고치지 않는다
  architecture/       # 계층, 모듈, 의존 방향, 흐름, 데이터 모델
  conventions/        # 관찰된 규약
  adr/                # 결정 기록. 파일 이름은 YYYY-MM-DD-제목.md
  failures/           # 실패 기록
  raw/                # 저장소 밖 자료 전용. 색인에 넣지 않는다
```

- 갈래 하나가 디렉터리 하나다. 기본 네 갈래는 CLI가 알고, 더한 갈래는 `.mob-sdd/config.yaml`의 `wiki.categories`에 적힌다. 갈래는 `/wiki-ingest`가 제안하고 사용자가 승인하면 더해진다.
- `raw/`에는 기획 문서, 회의록처럼 저장소 밖의 자료를 넣는다. 대화에서 알려 준 지식도 `/wiki-ingest`가 먼저 여기에 메모로 적은 뒤 페이지로 만든다. 추가만 하고 고치지 않는다.

## 페이지

```yaml
---
title: 모듈 구조
summary: app, feature, core 세 계층의 모듈과 의존 방향
sources:
  - path: core/
    sha256: 9f2c…
commit: 3f2a9c1
---
```

- 한 페이지에 주제 하나. 본문의 문장마다 근거가 된 원본의 경로를 적는다.
- `sources.path`는 저장소 루트 기준이다. `/`로 끝나면 디렉터리 전체다. `sha256`과 `commit`은 CLI가 적는다.
- `sources`의 해시와 지금 원본의 해시가 다르면 **낡음 후보**다. 커밋이 아니라 내용으로 판정하므로 squash 병합이나 rebase 뒤에도 최신 페이지가 낡았다고 나오지 않는다. 디렉터리 원본은 git이 보는 파일 전체로 해시를 내므로 파일 하나만 바뀌어도 낡음 후보다.
- adr 페이지는 `status: accepted | superseded`를 더 갖는다. 뒤집힌 결정은 고치지 않고 새 페이지를 만들며, 옛 페이지에 `status: superseded`와 `superseded_by: adr/….md`를 단다.

## 스킬

| 스킬 | 하는 일 |
|---|---|
| `/wiki-ingest [대상]` | 원본을 읽어 페이지를 만들거나 고친다. 대상은 경로, `research <feature>`, `failures <feature>`, `raw`, `전체`. 없으면 미수집 원본과 낡음 후보를 보여 주고 고르게 한다 |
| `/wiki-lint [갈래나 페이지]` | CLI가 찾은 오류(형식, 깨진 링크, 사라진 원본)와 낡음 후보를 고치고, 페이지 사이의 모순과 빠진 주제를 찾는다 |

- 두 스킬은 `docs/wiki/` 아래만 쓴다. 그 밖의 문서와 설정의 쓰기는 hook이 거부한다.
- 페이지마다 승인을 받지 않는다. 위키는 힌트이고 커밋 리뷰로 본다. 새 갈래를 만들 때와 페이지를 지울 때만 묻는다.
- 첫 수집은 `architecture/overview.md` 하나부터 만든다. 전체를 한 번에 수집하지 않는다.
- 자동 실행은 없다. `init`이 기존 저장소에서 첫 수집을 권하고, `status`가 낡음 후보와 미수집 원본의 수를 보여 주며, blueprint의 완료 보고가 리서치 기록의 수집을 안내한다.

## 단계가 읽는 것

위키 extension은 단계 지시로 다음을 더한다. 코어 스킬 파일은 바뀌지 않는다.

| 단계 | 읽는 것 |
|---|---|
| `constitution` | `conventions/`를 원칙 후보로. 서술을 규범으로 바꿔 쓰고 사용자가 확정한다 |
| `blueprint` | 설계에 닿는 `architecture/`, `conventions/`, `adr/`. 완료 보고에 `research.md`의 수집을 안내한다 |
| `create-*` (android) | 해당 계층의 `conventions/`와 `failures/` |
| `heal-*` (android) | 같은 종류나 같은 모듈의 `failures/` |

## 수집 원본

| 원본 | 가는 갈래 | 비고 |
|---|---|---|
| 코드 | `architecture/`, `conventions/` | 사용자가 경로로 지목한다 |
| 저장소의 기존 문서(README, 설계 문서) | 해당 갈래 | 사용자가 경로로 지목한다 |
| `docs/specs/{feature}/research.md` | `adr/` | 결정 하나에 페이지 하나. 원본은 그대로 남는다 |
| `docs/specs/{feature}/failures.md` | `failures/` | 수집할 때 원인과 해결을 사용자와 확인한다 |
| `raw/`의 자료 | 해당 갈래 | |

`status`와 `/wiki-ingest`가 세는 **미수집 원본**은 리서치 기록, 실패 기록, `raw/`의 자료다. 코드는 세지 않는다.

## 점검이 찾는 것

| 종류 | 뜻 | 수준 |
|---|---|---|
| 형식 오류 | frontmatter가 없거나 `title`, `summary`가 없거나 adr의 `status`가 어긋난다 | 오류 |
| 깨진 링크 | 본문의 상대 링크나 `superseded_by`가 가리키는 파일이 없다 | 오류 |
| 원본이 사라진 페이지 | `sources.path`가 없다 | 오류 |
| 낡음 후보 | 원본의 해시가 다르다 | 후보 |
| 원본 없는 페이지 | `sources`가 비어 있다 | 경고 |
| 고아 페이지 | 어떤 페이지도 링크하지 않는다 | 경고 |
| 색인 | `index.md`가 없거나 페이지 목록과 다르다 | 경고 |

모순과 빠진 주제는 계산으로 찾을 수 없으므로 `/wiki-lint`가 읽어서 찾는다. `check`는 위키를 보지 않는다.
