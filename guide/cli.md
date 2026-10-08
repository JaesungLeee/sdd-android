# CLI와 설정 파일

## 실행하는 방법

- 설치와 갱신은 npm 패키지로 실행한다: `npx mob-sdd init`, `npx mob-sdd@latest upgrade`.
- 그 밖의 명령은 저장소에 설치된 번들이 한다. `npx mob-sdd status`처럼 불러도 패키지가 저장소의 번들에 넘기므로, 설치된 버전과 같은 판정을 받는다. 네트워크 없이 `.mob-sdd/bin/mob-sdd status`로 직접 불러도 된다.
- 스킬은 `.mob-sdd/bin/mob-sdd` 스크립트를 통해 CLI를 부른다. 이 스크립트는 고치지 않는다.

## 명령

사람이 치는 명령은 다섯 묶음이다.

| 명령 | 하는 일 |
|---|---|
| `init` | 설치. `--language ko`, `--prefix <접두사>`, `--extension <내장 확장>`, `--yes`(묻지 않고 기본값) |
| `upgrade` | 설치된 파일을 실행한 패키지의 버전으로 올린다 |
| `status [feature]` | 문서의 상태, 체크리스트와 작업의 집계, 버전 체인 판정. feature의 구현 중과 구현 완료를 알린다 |
| `check` | 설치 점검과 문서의 형식·일관성 검사. 문제가 있으면 0이 아닌 코드로 끝난다. CI에 둔다 |
| `extension list\|add\|remove`, `preset list\|add\|remove` | 확장의 목록, 설치(내장 이름이나 로컬 경로), 제거 |
| `figma show\|setup` | Figma 서버 설정과 읽기 도구의 권한 |

나머지는 스킬이 부른다. 직접 칠 일은 없지만 스킬의 보고에 이름이 나온다.

| 명령 | 부르는 스킬 | 하는 일 |
|---|---|---|
| `gate <단계>` | 단계 스킬의 본문 주입 | 그 단계에서 본 feature별 판정 |
| `directives <단계>` | 단계 스킬의 본문 주입 | 그 단계에 적용되는 확장 지시 파일 |
| `doc new <단계> [feature]` | 단계 스킬 | 템플릿을 복사해 `draft`로 만든다 |
| `doc changes <단계> [feature]` | 단계 스킬 | 기록된 해시와 비교해 바뀐 곳 |
| `doc complete <단계> [feature]` | 단계 스킬 | 신규 문서의 완료 기록. `created`, `1.0.0` |
| `doc revise <단계> [feature] --grade …` | 단계 스킬 | 개정 기록. 인자의 항목이 CLI가 계산한 바뀐 곳과 다르면 거부한다 |
| `doc confirm <단계> [feature]` | 단계 스킬 | 영향 없음 확인. 기준 버전만 올린다 |
| `doc restore <단계> [feature] [--from <커밋>]` | 단계 스킬 | 병합 뒤 메타데이터와 해시를 `HEAD` 쪽으로 되돌린다 |
| `doc checklist <feature>` | spec | 체크리스트의 상태를 기록한다 |
| `hook write` | 스킬의 hook | 쓰려는 파일을 받아 막을지 답한다 |
| `impl …` | `impl-orchestrator` | 구현 단계의 기록. [구현 단계](implementation.md) |
| `wiki index\|record\|lint\|sources\|category add` | `wiki-ingest`, `wiki-lint` | 위키의 색인, 원본 해시 기록, 점검 계산, 미수집 원본, 갈래 추가 |

공통 옵션은 다음과 같다.

| 옵션 | 뜻 |
|---|---|
| `--json` | 기계가 읽는 출력. `init`에 주면 묻지 않는다 |
| `--acknowledged` | 확인 필요 판정을 사용자가 계속하기로 했다는 표시. 중단 판정에서는 이 옵션이 있어도 거부한다 |
| `--grade <등급>`, `--grade <항목=등급>` | 개정 등급. prd와 constitution은 항목마다(`--grade CLI-001=minor --grade '*'=patch`), 그 밖은 하나(`--grade minor`) |
| `--depends <ID,ID>` | spec이 의존하는 prd 항목 |
| `--root <경로>` | 저장소 루트를 지정한다 |

## `.mob-sdd/`의 파일

| 파일 | 커밋 | 손으로 고치는가 |
|---|---|---|
| `bin/mob-sdd.mjs` | 한다 | 아니다. `upgrade`가 바꾼다 |
| `bin/mob-sdd` | 한다 | 아니다. `node`를 찾아 번들을 실행하는 셸 스크립트 |
| `config.yaml` | 한다 | `docs_dir`는 된다. `language`와 `prefix`는 설치 뒤 바꿀 수 없다 |
| `config.local.yaml` | 안 한다 | `figma setup`이 쓴다. 손으로 고쳐도 된다 |
| `manifest.json` | 한다 | 아니다. 설치한 파일의 해시와 버전. `upgrade`와 `check`의 근거 |
| `templates/*.md` | 한다 | 된다. 고친 파일은 `upgrade`가 보존한다 |
| `hashes/` | 한다 | 아니다. 문서의 본문 해시 |
| `extensions/{이름}/` | 한다 | 확장의 스킬이 아닌 파일(선언, 지시, 스크립트) |
| `impl/{feature}/` | 안 한다 | 아니다. 구현 단계의 체크포인트, 디자인 분석, 캡처 |
| `backup/{날짜}/` | 한다 | `init`에서 백업을 고른 경우에만 생긴다 |
| `.gitignore`, `.gitattributes` | 한다 | 아니다. `config.local.yaml`을 무시하고 실행 스크립트를 LF로 고정한다 |

`.claude/skills/{이름}/SKILL.md`는 커밋하며 고쳐도 된다. `check`가 "설치한 뒤 바뀐 파일"로 경고하고, `upgrade`가 보존한다.

### `config.yaml`

```yaml
language: ko          # 설치 언어. 1.0부터 en
agent: claude-code
docs_dir: docs        # 산출물의 자리
prefix: ""            # 스킬 이름 접두사
wiki:                 # 위키 갈래 가운데 사용자가 더한 것. 기본 네 갈래는 CLI가 안다
  categories:
    domain: 도메인 용어와 업무 규칙
```

### `config.local.yaml`

```yaml
figma:
  server: desktop            # desktop | remote
  desktop_name: figma-desktop
  remote_name: figma
```

없으면 기본값으로 동작한다. [Figma 설정](figma.md)을 본다.

### `manifest.json`

```json
{
  "version": "0.3.0",
  "files": {
    ".claude/skills/spec/SKILL.md": { "sha256": "…", "source": "core" },
    ".mob-sdd/templates/spec.md": { "sha256": "…", "source": "core" }
  },
  "extensions": {
    "android": { "kind": "extension", "version": "0.1.0", "origin": "builtin" }
  }
}
```

날짜를 적지 않고 경로를 정렬해, 같은 설치면 같은 파일이 나온다.

## `check`가 보는 것

- 환경: Node.js 22 이상.
- 설치: 설치 기록이 있는지, 기록된 파일이 모두 있는지(없으면 오류), 설치한 뒤 바뀌었는지(경고), 확장의 선언 파일과 지시의 대상 단계.
- 문서: frontmatter 형식, `status`와 `version`, 개정 기록의 순서, 기준 버전이 상위의 개정 기록에 있는지, 의존 항목의 ID, 항목 ID의 중복, 미기록 변경, 해시 파일의 버전.
- spec: 완료된 spec의 checklist가 `pass`이고 지금의 본문을 검증한 것인지.
- breakdown: 작업 줄의 형식, 작업마다 경로가 있는지, `until`이 가리키는 작업이 있고 테스트 작업이 그보다 앞에 있는지, 마지막 확인 줄의 상태.
- Figma: spec에 Figma 줄이 있는 feature가 있는데 개인 설정이 없으면 경고.
