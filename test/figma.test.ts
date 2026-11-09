import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { check } from "../src/commands/check.js";
import { figmaSetup, figmaShow, SETTINGS_LOCAL } from "../src/commands/figma.js";
import { init } from "../src/commands/init.js";
import { promptInit } from "../src/commands/init-prompt.js";
import { assetsFromDir } from "../src/core/assets.js";
import { figmaConfig, mcpToolName, readLocalConfig } from "../src/core/local-config.js";
import { readManifest } from "../src/core/manifest.js";
import { openRepo, Refusal, type Repo } from "../src/core/repo.js";

const CORE: Record<string, string> = {
  "ko/skills/spec/SKILL.md": "---\nname: {{skill:spec}}\n---\n코어 spec.\n",
  "ko/templates/spec.md": "# 스펙\n",
  "ko/templates/checklist.md": "# 체크리스트\n\n- [ ] 하나\n",
};
const ANDROID: Record<string, string> = {
  "ko/extensions/android/extension.yaml": "name: android\nkind: extension\nversion: 0.1.0\nrequires: \">=0.3.0\"\n",
  "ko/extensions/android/skills/create-ui/SKILL.md": "---\nname: {{skill:create-ui}}\n---\n`/{{skill:spec}}` 뒤.\n",
};

function tempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdd-android-${name}-`));
}
function writeTree(dir: string, files: Record<string, string>): string {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return dir;
}
function gitRepo(): string {
  const dir = tempDir("repo");
  fs.mkdirSync(path.join(dir, ".git"));
  return dir;
}

let bundle: string;
beforeEach(() => {
  bundle = path.join(tempDir("pkg"), "sdd-android.mjs");
  fs.writeFileSync(bundle, "// bundle\n");
});

function options(target: string, files: Record<string, string>, extra: Partial<Parameters<typeof init>[0]> = {}) {
  return { target, language: "ko", prefix: "", assets: assetsFromDir(writeTree(tempDir("assets"), files)), bundlePath: bundle, version: "0.3.0", homeDir: tempDir("home"), ...extra };
}

describe("init과 android 확장", () => {
  it("기본은 코어만이고, 이름을 주면 내장 확장을 함께 설치한다", () => {
    expect(init(options(gitRepo(), { ...CORE, ...ANDROID })).extensions).toEqual([]);
    const target = gitRepo();
    const result = init(options(target, { ...CORE, ...ANDROID }, { extensions: ["android"] }));
    expect(result.extensions).toEqual(["android"]);
    expect(result.skills).toEqual(["spec", "create-ui"]);
    expect(fs.readFileSync(path.join(target, ".claude", "skills", "create-ui", "SKILL.md"), "utf8")).toContain("`/spec` 뒤");
    expect(readManifest(target)?.extensions?.android).toMatchObject({ kind: "extension", origin: "builtin" });
    expect(result.files).toContain(".sdd-android/extensions/android/extension.yaml");
  });

  it("내장에 없는 이름과 이 버전이 요건을 못 채우는 확장은 거부한다", () => {
    expect(() => init(options(gitRepo(), CORE, { extensions: ["android"] }))).toThrow(/내장 확장이 아니다/);
    expect(() => init(options(gitRepo(), { ...CORE, ...ANDROID }, { extensions: ["android"], version: "0.1.0" }))).toThrow(/0\.3\.0 이상이 필요하다/);
  });

  it("확장의 스킬이 겹치면 코어를 설치하기 전에 멈춘다", () => {
    const target = gitRepo();
    writeTree(target, { ".claude/skills/create-ui/SKILL.md": "# 기존\n" });
    expect(() => init(options(target, { ...CORE, ...ANDROID }, { extensions: ["android"] }))).toThrow(/create-ui/);
    expect(fs.existsSync(path.join(target, ".sdd-android"))).toBe(false);
  });

  it("묻는 흐름에서 구현 단계의 확장을 묻고 기본은 없음이다", async () => {
    const asked: string[] = [];
    const run = async (answers: string[]) => {
      const queue = [...answers];
      return promptInit(options(gitRepo(), { ...CORE, ...ANDROID }), {
        prefixGiven: true,
        ask: async (q) => {
          asked.push(q);
          return queue.shift() ?? "";
        },
        print: () => {},
      });
    };
    expect((await run(["", "y"]))?.extensions).toEqual([]);
    expect(asked.some((q) => q.includes("android"))).toBe(true);
    expect((await run(["android", "y"]))?.extensions).toEqual(["android"]);
    asked.length = 0;
    await promptInit(options(gitRepo(), { ...CORE, ...ANDROID }), { prefixGiven: true, extensionsGiven: true, ask: async () => "y", print: () => {} });
    expect(asked.some((q) => q.includes("android"))).toBe(false);
  });
});

describe("Figma 설정", () => {
  let repo: Repo;
  beforeEach(() => {
    const target = gitRepo();
    init(options(target, { ...CORE, ...ANDROID }, { extensions: ["android"] }));
    repo = openRepo(target);
  });

  it("도구 이름은 서버 이름의 하이픈을 남기고 콜론을 밑줄로 바꾼다", () => {
    expect(mcpToolName("figma-desktop", "get_metadata")).toBe("mcp__figma-desktop__get_metadata");
    expect(mcpToolName("plugin:figma:figma", "whoami")).toBe("mcp__plugin_figma_figma__whoami");
  });

  it("설정이 없으면 기본값이고 check가 알린다", () => {
    const shown = figmaShow(repo);
    expect(shown.configured).toBe(false);
    expect(shown.config).toEqual({ server: "desktop", desktop_name: "figma-desktop", remote_name: "figma" });
    expect(shown.tools).toEqual([
      "mcp__figma-desktop__get_metadata",
      "mcp__figma-desktop__get_variable_defs",
      "mcp__figma-desktop__get_screenshot",
      "mcp__figma-desktop__get_design_context",
    ]);
    expect(shown.missingPermissions).toHaveLength(4);
    // Figma를 쓰는 spec이 없으면 조용하고, 있으면 알린다
    expect(check(repo).problems.map((p) => p.message)).not.toContainEqual(expect.stringContaining("Figma 설정이 없다"));
    writeTree(repo.root, { "docs/specs/room/spec.md": "---\nversion: 1.0.0\nstatus: draft\n---\n# 스펙\n\n### US1. 화면\n\n**Figma**: [화면](https://www.figma.com/design/a?node-id=1-2)\n" });
    expect(check(repo).problems.map((p) => p.message)).toContainEqual(expect.stringContaining("room의 spec에 Figma 줄이 있는데 Figma 설정이 없다"));
  });

  it("setup이 개인 설정 파일 둘을 쓰고, 다른 내용은 보존하며, 두 번째에는 더할 것이 없다", () => {
    fs.mkdirSync(path.join(repo.root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(repo.root, SETTINGS_LOCAL), JSON.stringify({ permissions: { allow: ["Bash(ls *)"], deny: ["Bash(rm *)"] }, other: 1 }));
    fs.writeFileSync(path.join(repo.root, ".sdd-android", "config.local.yaml"), "team:\n  branch: x\n");

    const result = figmaSetup(repo, { server: "remote", name: "plugin:figma:figma" });
    expect(result.config).toEqual({ server: "remote", desktop_name: "figma-desktop", remote_name: "plugin:figma:figma" });
    expect(result.addedPermissions).toEqual([
      "mcp__plugin_figma_figma__get_metadata",
      "mcp__plugin_figma_figma__get_variable_defs",
      "mcp__plugin_figma_figma__get_screenshot",
      "mcp__plugin_figma_figma__get_design_context",
    ]);
    const settings = JSON.parse(fs.readFileSync(path.join(repo.root, SETTINGS_LOCAL), "utf8"));
    expect(settings.permissions.allow[0]).toBe("Bash(ls *)");
    expect(settings.permissions.deny).toEqual(["Bash(rm *)"]);
    expect(settings.other).toBe(1);
    expect(readLocalConfig(repo)).toEqual({ team: { branch: "x" }, figma: { server: "remote", desktop_name: "figma-desktop", remote_name: "plugin:figma:figma" } });
    expect(figmaShow(repo).missingPermissions).toEqual([]);
    expect(check(repo).problems.map((p) => p.message)).not.toContainEqual(expect.stringContaining("Figma 설정이 없다"));

    expect(figmaSetup(repo, {}).addedPermissions).toEqual([]);
    // 서버만 바꾸면 그 서버의 이름은 그대로고 권한은 그 서버의 것이 더해진다.
    const back = figmaSetup(repo, { server: "desktop" });
    expect(back.name).toBe("figma-desktop");
    expect(back.addedPermissions).toHaveLength(4);
  });

  it("서버와 이름의 형식을 검사한다", () => {
    expect(() => figmaSetup(repo, { server: "cloud" })).toThrow(Refusal);
    expect(() => figmaSetup(repo, { name: "bad name" })).toThrow(Refusal);
    fs.writeFileSync(path.join(repo.root, ".sdd-android", "config.local.yaml"), "figma:\n  server: nope\n");
    expect(figmaConfig(readLocalConfig(repo)).server).toBe("desktop");
  });
});
