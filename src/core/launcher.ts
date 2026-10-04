/**
 * 저장소에 설치하는 실행 스크립트(`.sdd-first/bin/sdd-first`).
 * 스킬의 본문 주입과 hook은 로그인 셸이 아닌 셸에서 돌아, Homebrew나 nvm처럼 셸 설정 파일로
 * PATH에 넣은 `node`를 찾지 못한다. 이 스크립트가 흔한 설치 위치에서 `node`를 찾아 번들을 실행한다.
 * 끝내 찾지 못해도 `gate`와 `status`는 오류로 끝내지 않는다. 주입이 실패하면 스킬이 로드되지 않아
 * 에이전트가 사용자에게 알릴 기회조차 없기 때문이다. hook은 통과시킨다. 쓰기 명령이 따로 판정한다.
 */
export const LAUNCHER = `#!/bin/sh
# sdd-first: node를 찾아 CLI 번들을 실행한다. 직접 고치지 않는다.
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  for candidate in \\
    /opt/homebrew/bin/node \\
    /usr/local/bin/node \\
    "$HOME/.volta/bin/node" \\
    "$HOME/.local/share/mise/shims/node" \\
    "$HOME/.asdf/shims/node" \\
    "$HOME/.local/bin/node"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  for versions in \\
    "$HOME/.nvm/versions/node" \\
    "$HOME/.local/share/fnm/node-versions" \\
    "$HOME/Library/Application Support/fnm/node-versions"; do
    [ -d "$versions" ] || continue
    candidate=$(ls -1d "$versions"/*/bin/node "$versions"/*/installation/bin/node 2>/dev/null | sort -V | tail -1)
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
}

node=$(find_node)
if [ -z "$node" ]; then
  [ "$1" = "hook" ] && exit 0
  message="sdd-first: Node.js를 찾지 못했다. 이 단계를 진행할 수 없다. Node.js 22 이상을 설치하거나, node가 있는 디렉터리를 로그인하지 않은 셸에서도 PATH에 들어가게 한다(zsh라면 ~/.zshenv). 그런 뒤 Claude Code를 다시 시작한다."
  case "$1" in
    gate|status) echo "$message"; exit 0 ;;
    *) echo "$message" >&2; exit 127 ;;
  esac
fi
exec "$node" "$dir/sdd-first.mjs" "$@"
`;
