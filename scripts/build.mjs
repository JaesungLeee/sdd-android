// 빌드: CLI를 파일 하나로 묶고, 스킬 원본의 포함 표기를 조각으로 채워 dist/assets에 낸다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INCLUDE = /^[ \t]*\{\{> ([a-z0-9][a-z0-9-]*)\}\}[ \t]*$/gm;

/**
 * 포함 표기 `{{> name}}`을 조각 파일의 내용으로 바꾼다. 표기는 한 줄을 통째로 차지해야 한다.
 * 스킬 참조 표기 `{{skill:…}}`는 설치할 때 채우므로 그대로 둔다.
 */
export function composeSkill(source, fragments) {
  return source.replace(INCLUDE, (_, name) => {
    if (!(name in fragments)) throw new Error(`없는 조각이다: ${name}`);
    return fragments[name].replace(/\n+$/, "");
  });
}

/** 스킬이 포함하는 조각의 이름. 적힌 순서대로다. */
export function includedFragments(source) {
  return [...source.matchAll(INCLUDE)].map((match) => match[1]);
}

/**
 * 원본을 읽을 때 줄바꿈을 LF로 통일한다. 빌드하는 사람의 git 설정(core.autocrlf)에 따라
 * 작업 트리의 파일이 CRLF일 수 있는데, 그대로 실으면 같은 버전의 패키지가 빌드한 사람마다 달라진다.
 */
export function readText(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

function readDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
}

function languages() {
  return readDir(path.join(ROOT, "skills"))
    .filter((entry) => entry.isDirectory() && entry.name !== "fragments")
    .map((entry) => entry.name)
    .sort();
}

function loadFragments(language) {
  const dir = path.join(ROOT, "skills", "fragments", language);
  const fragments = {};
  for (const entry of readDir(dir)) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      fragments[entry.name.slice(0, -3)] = readText(path.join(dir, entry.name));
    }
  }
  return fragments;
}

function skillNames(language) {
  return readDir(path.join(ROOT, "skills", language))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * 언어 사이의 구조 검사. 번역이 같은 뜻인지는 기계가 확인할 수 없으므로 구조만 본다.
 * 같은 스킬과 조각이 있는지, 같은 스킬이 같은 조각을 같은 순서로 포함하는지, 같은 스킬 참조를 갖는지.
 */
export function compareLanguages(structures) {
  const problems = [];
  const [base, ...others] = Object.keys(structures);
  if (!base) return problems;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const other of others) {
    const a = structures[base];
    const b = structures[other];
    if (!same(Object.keys(a.fragments).sort(), Object.keys(b.fragments).sort())) {
      problems.push(`${base}와 ${other}의 조각 목록이 다르다`);
    }
    if (!same(Object.keys(a.skills).sort(), Object.keys(b.skills).sort())) {
      problems.push(`${base}와 ${other}의 스킬 목록이 다르다`);
    }
    for (const name of Object.keys(a.skills)) {
      if (!(name in b.skills)) continue;
      if (!same(a.skills[name].includes, b.skills[name].includes)) {
        problems.push(`${name}: ${base}와 ${other}가 포함하는 조각이 다르다`);
      }
      if (!same(a.skills[name].refs, b.skills[name].refs)) {
        problems.push(`${name}: ${base}와 ${other}의 스킬 참조가 다르다`);
      }
    }
  }
  return problems;
}

/**
 * 스킬과 템플릿을 `outDir`에 내고, 같은 내용을 `ko/skills/prd/SKILL.md` 꼴의 키로 모아 돌려준다.
 * 돌려준 것은 번들 안에 넣는다. 디렉터리는 검토용이다.
 */
export function buildAssets(outDir) {
  const built = {};
  const emit = (key, text) => {
    const target = path.join(outDir, ...key.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    built[key] = text;
  };
  const structures = {};
  for (const language of languages()) {
    const fragments = loadFragments(language);
    const structure = { fragments, skills: {} };
    for (const name of skillNames(language)) {
      const source = readText(path.join(ROOT, "skills", language, name, "SKILL.md"));
      emit(`${language}/skills/${name}/SKILL.md`, composeSkill(source, fragments));
      structure.skills[name] = {
        includes: includedFragments(source),
        refs: [...source.matchAll(/\{\{skill:([a-z0-9][a-z0-9-]*)\}\}/g)].map((match) => match[1]),
      };
    }
    const templates = path.join(ROOT, "templates", language);
    for (const entry of readDir(templates)) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      emit(`${language}/templates/${entry.name}`, readText(path.join(templates, entry.name)));
    }
    structures[language] = structure;
  }
  const problems = compareLanguages(structures);
  if (problems.length > 0) throw new Error(`언어 사이의 구조가 어긋난다:\n- ${problems.join("\n- ")}`);
  return built;
}

async function main() {
  const { build } = await import("esbuild");
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const dist = path.join(ROOT, "dist");
  fs.rmSync(path.join(dist, "assets"), { recursive: true, force: true });

  const assets = buildAssets(path.join(dist, "assets"));
  await build({
    entryPoints: [path.join(ROOT, "src", "cli.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: path.join(dist, "sdd-android.mjs"),
    // 스킬과 템플릿을 번들 안에 넣는다. 저장소의 번들이 자기 버전의 원본을 갖는다(PRD CLI-004).
    define: { __VERSION__: JSON.stringify(version), __ASSETS__: JSON.stringify(assets) },
    // yaml 패키지가 번들 안에서 require를 쓴다. ESM 번들에는 require가 없어 만들어 준다.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  const languages = [...new Set(Object.keys(assets).map((key) => key.split("/")[0]))].sort();
  // upgrade가 설치된 버전부터 새 버전까지의 변경 내역을 보여 준다.
  fs.writeFileSync(path.join(dist, "CHANGELOG.md"), readText(path.join(ROOT, "CHANGELOG.md")));
  console.log(`dist/sdd-android.mjs ${version}, assets: ${languages.join(", ") || "없음"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
