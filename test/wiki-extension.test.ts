import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/commands/check.js";
import { directives } from "../src/commands/extension.js";
import { hookWriteScoped } from "../src/commands/hook.js";
import { init } from "../src/commands/init.js";
import { assetsFromDir } from "../src/core/assets.js";
import { openRepo } from "../src/core/repo.js";

const CORE: Record<string, string> = {
  "ko/skills/spec/SKILL.md": "---\nname: {{skill:spec}}\n---\n코어 spec.\n",
  "ko/skills/blueprint/SKILL.md": "---\nname: {{skill:blueprint}}\n---\n코어 blueprint.\n",
  "ko/templates/spec.md": "# 스펙\n",
};
const ANDROID: Record<string, string> = {
  "ko/extensions/android/extension.yaml": "name: android\nkind: extension\nversion: 0.1.0\n",
  "ko/extensions/android/skills/create-ui/SKILL.md": "---\nname: {{skill:create-ui}}\n---\nUI.\n",
};
const WIKI: Record<string, string> = {
  "ko/extensions/wiki/extension.yaml": "name: wiki\nkind: extension\nversion: 0.1.0\ndirectives:\n  blueprint: directives/blueprint.md\n  create-ui: directives/create.md\n",
  "ko/extensions/wiki/skills/wiki-ingest/SKILL.md": "---\nname: {{skill:wiki-ingest}}\n---\n`/{{skill:blueprint}}` 뒤.\n",
  "ko/extensions/wiki/directives/blueprint.md": "위키를 읽는다.\n",
  "ko/extensions/wiki/directives/create.md": "failures를 읽는다.\n",
  "ko/extensions/wiki/templates/page.md": "---\ntitle: x\n---\n",
};

function tempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mob-sdd-${name}-`));
}
function writeTree(dir: string, files: Record<string, string>): string {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return dir;
}
function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
}
function gitRepo(tracked = false): string {
  const dir = tempDir("repo");
  git(dir, "init", "-q");
  if (tracked) {
    fs.writeFileSync(path.join(dir, "A.kt"), "class A\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
  }
  return dir;
}
function setup(target: string, files: Record<string, string>, extensions: string[]) {
  const bundle = path.join(tempDir("pkg"), "mob-sdd.mjs");
  fs.writeFileSync(bundle, "// bundle\n");
  const assets = assetsFromDir(writeTree(tempDir("assets"), files));
  const result = init({ target, language: "ko", prefix: "", assets, bundlePath: bundle, version: "0.4.0", homeDir: tempDir("home"), extensions });
  return { assets, result };
}

describe("위키 확장", () => {
  it("템플릿은 확장의 자리에 놓이고, 지시는 대상 단계에 전달되며, android가 없어도 그 스킬을 가리키는 지시는 경고하지 않는다", () => {
    const target = gitRepo();
    const { assets } = setup(target, { ...CORE, ...ANDROID, ...WIKI }, ["wiki"]);
    const repo = openRepo(target);
    expect(fs.existsSync(path.join(target, ".mob-sdd/extensions/wiki/templates/page.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, ".mob-sdd/templates/page.md"))).toBe(false);
    expect(directives(repo, "blueprint")).toEqual([{ extension: "wiki", file: ".mob-sdd/extensions/wiki/directives/blueprint.md" }]);
    expect(directives(repo, "create-ui")).toEqual([{ extension: "wiki", file: ".mob-sdd/extensions/wiki/directives/create.md" }]);
    const warnings = (result: ReturnType<typeof check>) => result.problems.filter((p) => p.message.includes("지시의 대상 단계")).map((p) => p.message);
    expect(warnings(check(repo, undefined, assets))).toEqual([]);
    // 내장 확장을 모르면(자산 없이) 설치되지 않은 스킬이라 경고한다. 로컬 확장의 오타는 이 길로 잡힌다.
    expect(warnings(check(repo))).toEqual(["지시의 대상 단계가 설치되어 있지 않다: create-ui"]);
  });

  it("init은 추적하는 파일이 있는 저장소를 알린다", () => {
    expect(setup(gitRepo(), CORE, []).result.existingCode).toBe(false);
    expect(setup(gitRepo(true), CORE, []).result.existingCode).toBe(true);
  });

  it("쓰기 hook의 wiki 범위는 위키 아래만 허용하고 다른 문서와 설정을 거부하며 코드는 막지 않는다", () => {
    const target = gitRepo();
    setup(target, CORE, []);
    const repo = openRepo(target);
    const at = (rel: string) => path.join(target, rel);
    expect(hookWriteScoped(repo, at("docs/wiki/architecture/overview.md"), "wiki")).toEqual({ allow: true });
    expect(hookWriteScoped(repo, at("docs/wiki/raw/memo.md"), "wiki")).toEqual({ allow: true });
    expect(hookWriteScoped(repo, at("docs/wiki/index.md"), "wiki")).toEqual({ allow: true });
    expect(hookWriteScoped(repo, at("docs/prd.md"), "wiki")).toMatchObject({ allow: false });
    expect(hookWriteScoped(repo, at("docs/specs/login/research.md"), "wiki")).toMatchObject({ allow: false });
    expect(hookWriteScoped(repo, at(".mob-sdd/config.yaml"), "wiki")).toMatchObject({ allow: false });
    expect(hookWriteScoped(repo, at("docs/wikipedia.md"), "wiki")).toMatchObject({ allow: false });
    expect(hookWriteScoped(repo, at("src/A.kt"), "wiki")).toEqual({ allow: true });
    expect(hookWriteScoped(repo, at("README.md"), "wiki")).toEqual({ allow: true });
  });
});
