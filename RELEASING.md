# 릴리스

배포는 GitHub Actions가 한다. 사람은 CHANGELOG 초안을 확인하고 PR을 머지한다.

```
Prepare release (수동 실행)
  Claude가 CHANGELOG 항목을 쓰고 버전을 올린 "Release X.Y.Z" PR을 연다
      ↓  사람이 문구를 확인하고 머지
Release (main의 package.json 버전이 바뀌면 저절로)
  검증 → npm 배포 → vX.Y.Z 태그 → GitHub Release
```

| 워크플로 | 하는 일 |
|---|---|
| `ci.yml` | push와 PR마다 typecheck, test, build, 릴리스 검사, 스모크 테스트 (Ubuntu·macOS × Node 22·24) |
| `prepare-release.yml` | CHANGELOG 초안과 버전을 담은 릴리스 PR |
| `release.yml` | npm 배포, 태그, GitHub Release. 이미 된 단계는 건너뛴다 |

## 처음 한 번

### 1. 저장소 공개 여부

npm의 provenance(출처 증명)는 공개 저장소에서만 붙는다. 비공개면 배포는 되지만 provenance 없이 나간다.

### 2. 릴리스용 GitHub App

릴리스 PR을 열고 태그를 push하는 봇이다. `GITHUB_TOKEN`으로 연 PR에서는 CI가 돌지 않아서 따로 둔다.

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**
   - GitHub App name: `sdd-android-release` (전역에서 유일해야 한다)
   - Homepage URL: `https://github.com/JaesungLeee/sdd-android`
   - Webhook: **Active 해제**
   - Repository permissions: **Contents** Read and write, **Pull requests** Read and write
   - Where can this GitHub App be installed: **Only on this account**
2. **Create GitHub App** → 화면의 **Client ID**를 적어 둔다 → 아래쪽 **Generate a private key**로 `.pem` 파일을 받는다.
3. 왼쪽 **Install App** → 내 계정 → **Only select repositories** → `sdd-android` → Install.
4. 저장소 → Settings → Secrets and variables → Actions
   - **Variables** 탭 → New repository variable: `RELEASE_APP_CLIENT_ID` = Client ID
   - **Secrets** 탭 → New repository secret: `RELEASE_APP_PRIVATE_KEY` = `.pem` 파일 내용 전체(`-----BEGIN`부터 `-----END … KEY-----`까지)
5. 받은 `.pem` 파일은 secret에 넣은 뒤 지운다.

### 3. Claude 인증

둘 중 하나를 저장소 secret으로 등록한다(Settings → Secrets and variables → Actions → Secrets).

- Claude 구독(Pro/Max): 터미널에서 `claude setup-token` → 나온 토큰을 `CLAUDE_CODE_OAUTH_TOKEN`으로 등록
- API 키: console.anthropic.com → API Keys에서 만든 키를 `ANTHROPIC_API_KEY`로 등록

### 4. npm Trusted Publisher

토큰 없이 GitHub Actions에서만 배포되게 한다.

1. npmjs.com 로그인 → `sdd-android` 패키지 → **Settings** 탭
2. **Trusted Publisher** → **GitHub Actions**
   - Organization or user: `JaesungLeee`
   - Repository: `sdd-android`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
3. 같은 화면의 **Publishing access** → **Require two-factor authentication and disallow tokens** → Update Package Settings
4. 예전에 배포용으로 만든 Access Token이 있으면 프로필 → Access Tokens에서 지운다.

### 5. `npm` environment

저장소 → Settings → Environments → **New environment** → 이름 `npm`

- Deployment branches and tags: **Selected branches and tags** → `main`
- 배포 전에 승인을 누르고 싶으면 **Required reviewers**에 자신을 넣는다. 혼자 관리하면 비워 둬도 된다.

### 6. Rulesets

저장소 → Settings → Rules → Rulesets

- **New tag ruleset**: 이름 `release tags`, Enforcement **Active**
  - Target tags → Add target → Include by pattern: `v*`
  - **Restrict creations**, **Restrict updates**, **Restrict deletions** 체크
  - Bypass list → Add bypass → 2에서 만든 App(`sdd-android-release`)
  - 이제 태그는 릴리스 워크플로만 만든다.
- (선택) **New branch ruleset**: Target `Default branch`
  - **Require status checks to pass** → CI의 `verify (…)` 네 개를 추가한다. 검사 이름은 CI가 한 번 돈 뒤에 목록에 나온다.
  - 걸면 main에 직접 push할 수 없고 PR로만 들어간다.

### 7. 이 파이프라인의 PR 머지

PR의 CI가 통과하는지 본다. Ubuntu 러너에서 테스트가 도는 것은 이 PR이 처음이다.

## 릴리스할 때마다

1. GitHub → Actions → **Prepare release** → **Run workflow** (branch `main`)
   - version은 비워 두면 Claude가 정한다. 정해 두려면 `0.6.0`처럼 적는다.
2. 몇 분 뒤 `sdd-android-release`가 연 **Release X.Y.Z** PR을 확인한다.
   - Files changed에서 CHANGELOG 항목을 읽는다. `upgrade`에서 사용자에게 그대로 보이는 글이다.
   - PR 본문에서 Claude가 적지 않은 커밋과 그 이유를 본다. 빠진 사용자 변경이 없는지 확인한다.
   - 고칠 것은 `release-pr` 브랜치에 커밋한다(웹에서 파일 편집도 된다). **Prepare release를 다시 돌리면 이 브랜치를 새로 덮어써서 손으로 고친 것이 사라진다.**
3. CI가 통과하면 머지한다.
4. Actions → **Release** 실행을 본다. environment에 승인을 켰다면 **Review deployments** → `npm` → Approve.
5. 확인
   - npmjs.com/package/sdd-android 에 새 버전과 provenance 표시
   - GitHub Releases에 `vX.Y.Z`
   - `npx sdd-android@latest --version`

## 실패했을 때

| 상황 | 할 일 |
|---|---|
| Prepare release: "package.json의 버전과 마지막 태그가 다르다" | 앞 릴리스의 Release 실행이 끝나지 않았다. 아래 행대로 마무리한다 |
| Prepare release: "바뀐 것이 없다" | 마지막 릴리스 뒤로 커밋이 없다 |
| 릴리스 PR의 CI가 릴리스 검사에서 실패 | 오류에 적힌 대로 CHANGELOG 제목이나 위치를 고친다 |
| Release가 중간에 실패 | 원인을 고친 뒤 Actions → Release → **Run workflow** (`main`). npm 배포, 태그, Release 중 이미 된 것은 건너뛴다 |
| 잘못된 버전이 배포됨 | npm은 같은 버전을 다시 올릴 수 없다. `npm deprecate sdd-android@X.Y.Z "<이유>"`로 표시하고 patch 버전을 새로 낸다 |

## 하지 않는 것

- `v*` 태그를 직접 만들거나 push하지 않는다. 태그는 Release가 배포한 커밋에 붙인다.
- 로컬에서 `npm publish`하지 않는다. 4에서 토큰 배포를 막았다.
- CHANGELOG 항목 없이 package.json 버전만 올리지 않는다. CI의 릴리스 검사가 막는다.
- 버전은 `X.Y.Z`만 쓴다. `upgrade`가 `0.6.0-rc.1` 같은 프리릴리스 버전을 읽지 못해 릴리스 검사가 거부한다.
