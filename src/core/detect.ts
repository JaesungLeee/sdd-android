import fs from "node:fs";
import path from "node:path";

/**
 * Gradle 설정에서 검사 명령을 고르는 데 필요한 것을 찾는다(구현 설계 「0.5 구현의 진행」). 읽기만 한다.
 * 빌드 스크립트는 코드라 찾은 것은 추정이다. 판정에 쓰지 않고 `impl setup`이 제안으로만 보여 주며, 적는 것은 사람이 정한다.
 */
export interface Found {
  tool: string;
  /** 저장소 루트 기준의 근거 파일. */
  file: string;
  /** 제안하는 명령. */
  command: string;
}

export interface FlavorModule {
  /** Gradle 모듈 경로(`:app`). 컨벤션 플러그인에서 찾았으면 비어 있다. */
  module: string;
  file: string;
  names: string[];
}

export interface Detected {
  lint: Found[];
  rules: Found[];
  flavors: FlavorModule[];
}

const SKIP = new Set(["build", ".gradle", ".git", ".idea", ".sdd-android", ".claude", "node_modules", "docs"]);
const MAX_DEPTH = 5;

const LINT_TOOLS: { tool: string; pattern: RegExp; command: string }[] = [
  { tool: "detekt", pattern: /io\.gitlab\.arturbosch\.detekt|["']dev\.detekt["']|plugins\.detekt\b/, command: "./gradlew {module}:detekt" },
  { tool: "ktlint", pattern: /org\.jlleitschuh\.gradle\.ktlint|plugins\.ktlint\b/, command: "./gradlew {module}:ktlintCheck" },
  { tool: "kotlinter", pattern: /org\.jmailen\.kotlinter|plugins\.kotlinter\b/, command: "./gradlew {module}:lintKotlin" },
  { tool: "spotless", pattern: /com\.diffplug\.spotless|plugins\.spotless\b/, command: "./gradlew {module}:spotlessCheck" },
];

const KONSIST = /com\.lemonappdev:konsist|libs\.konsist\b/;

function isGradleFile(name: string, inBuildLogic: boolean): boolean {
  return /\.gradle(\.kts)?$/.test(name) || (inBuildLogic && /\.kts?$/.test(name));
}

/** Gradle 스크립트와 컨벤션 플러그인(`build-logic`, `buildSrc`)의 파일. 저장소 루트 기준의 경로다. */
function gradleFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number, inBuildLogic: boolean) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || depth >= MAX_DEPTH) continue;
        walk(rel, depth + 1, inBuildLogic || entry.name === "build-logic" || entry.name === "buildSrc");
      } else if (entry.isFile() && isGradleFile(entry.name, inBuildLogic)) {
        found.push(rel);
      }
    }
  };
  walk("", 0, false);
  return found.sort();
}

/** 빌드 스크립트가 있는 디렉터리의 모듈 경로. 루트면 비어 있다. 컨벤션 플러그인의 파일이면 모듈을 알 수 없다. */
function moduleOf(file: string): string | undefined {
  if (/(^|\/)(build-logic|buildSrc)\//.test(file)) return undefined;
  if (!/(^|\/)build\.gradle(\.kts)?$/.test(file)) return undefined;
  const dir = path.posix.dirname(file);
  return dir === "." ? "" : `:${dir.split("/").join(":")}`;
}

/** `{` 다음부터 짝이 맞는 `}`까지. */
function block(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

function flavorNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/productFlavors\s*\{/g)) {
    const inner = block(text, (match.index ?? 0) + match[0].length - 1);
    for (const call of inner.matchAll(/(?:create|register|maybeCreate)\(\s*"([A-Za-z][A-Za-z0-9_]*)"/g)) names.add(call[1] as string);
    // Groovy: `prod { … }`. 블록 안의 첫 수준만 본다.
    let depth = 0;
    for (const line of inner.split("\n")) {
      const groovy = depth === 0 ? /^\s*([a-z][A-Za-z0-9_]*)\s*\{/.exec(line) : null;
      if (groovy && !["all", "configureEach", "named"].includes(groovy[1] as string)) names.add(groovy[1] as string);
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    }
  }
  return [...names];
}

export function detectProject(root: string): Detected {
  const detected: Detected = { lint: [], rules: [], flavors: [] };
  for (const file of gradleFiles(root)) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const tool of LINT_TOOLS) {
      if (tool.pattern.test(text) && !detected.lint.some((found) => found.tool === tool.tool)) {
        detected.lint.push({ tool: tool.tool, file, command: tool.command });
      }
    }
    const module = moduleOf(file);
    if (KONSIST.test(text) && module) detected.rules.push({ tool: "konsist", file, command: `./gradlew ${module}:test` });
    const names = flavorNames(text);
    if (names.length > 0) detected.flavors.push({ module: module ?? "", file, names });
  }
  return detected;
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** flavor가 있는 모듈의 빌드·테스트 명령 제안. 첫 flavor의 디버그 variant다. 차원이 여럿이면 이름을 조합해야 한다. */
export function flavorCommands(flavor: string): { build: string; test: string } {
  const name = capitalize(flavor);
  return { build: `./gradlew {module}:compile${name}DebugKotlin`, test: `./gradlew {module}:test${name}DebugUnitTest {tests}` };
}
