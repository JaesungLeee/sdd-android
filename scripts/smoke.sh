#!/bin/sh
# 스모크 테스트: 패키지를 빈 디렉터리에 설치해 사용자처럼 실행한다.
# 번들의 banner나 define 주입이 깨진 것은 단위 테스트가 아니라 여기서 드러난다.
# 사용: scripts/smoke.sh <sdd-android-X.Y.Z.tgz>
set -eu

tarball=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
version=$(node -p "require('./package.json').version")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cd "$work"
npm init -y >/dev/null
npm install --no-audit --no-fund --silent "$tarball"
bin="$work/node_modules/.bin/sdd-android"

actual=$("$bin" --version)
if [ "$actual" != "$version" ]; then
  echo "설치한 패키지의 버전이 $actual이다. $version이어야 한다." >&2
  exit 1
fi

mkdir repo
cd repo
git init -q
"$bin" init --yes
"$bin" check
echo "스모크 테스트 통과: $version"
