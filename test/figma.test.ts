import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { check } from "../src/commands/check.js";
import { figmaSetup, figmaShow, formatFigmaShow, SETTINGS_LOCAL } from "../src/commands/figma.js";
import { init } from "../src/commands/init.js";
import { promptInit } from "../src/commands/init-prompt.js";
import { assetsFromDir } from "../src/core/assets.js";
import { figmaConfig, mcpToolName, readLocalConfig } from "../src/core/local-config.js";
import { openRepo, Refusal, type Repo } from "../src/core/repo.js";

const CORE: Record<string, string> = {
  "ko/skills/spec/SKILL.md": "---\nname: {{skill:spec}}\n---\n코어 spec.\n",
  "ko/templates/spec.md": "# 스펙\n",
  "ko/templates/checklist.md": "# 체크리스트\n\n- [ ] 하나\n",
};
const ANDROID: Record<string, string> = {
  "ko/skills/create-ui/SKILL.md": "---\nname: {{skill:create-ui}}\n---\n`/{{skill:spec}}` 뒤.\n",
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

describe("init과 구현 단계", () => {
  it("구현 스킬을 문서 단계와 함께 설치하고 스킬 참조에 접두사를 붙인다", () => {
    const target = gitRepo();
    const result = init(options(target, { ...CORE, ...ANDROID }, { prefix: "sdd" }));
    expect(result.skills).toEqual(["sdd-create-ui", "sdd-spec"]);
    expect(fs.readFileSync(path.join(target, ".claude", "skills", "sdd-create-ui", "SKILL.md"), "utf8")).toContain("`/sdd-spec` 뒤");
    expect(fs.existsSync(path.join(target, ".sdd-android", "extensions"))).toBe(false);
  });

  it("묻는 흐름은 접두사를 받았으면 진행 여부만 묻는다", async () => {
    const asked: string[] = [];
    const result = await promptInit(options(gitRepo(), { ...CORE, ...ANDROID }), {
      prefixGiven: true,
      ask: async (q) => {
        asked.push(q);
        return "y";
      },
      print: () => {},
    });
    expect(result).toBeDefined();
    expect(asked).toEqual(["진행할까? (Y/n): "]);
  });
});

describe("Figma 설정", () => {
  let repo: Repo;
  beforeEach(() => {
    const target = gitRepo();
    init(options(target, { ...CORE, ...ANDROID }));
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

  it("개인 설정 파일이 깨져 있으면 show는 기본값과 이유를 내고, setup은 거부한다", () => {
    fs.mkdirSync(path.join(repo.root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(repo.root, SETTINGS_LOCAL), "{ 깨진");
    fs.writeFileSync(path.join(repo.root, ".sdd-android", "config.local.yaml"), "- 목록\n");
    const shown = figmaShow(repo);
    expect(shown).toMatchObject({ configured: false, name: "figma-desktop" });
    expect(shown.missingPermissions).toHaveLength(4);
    expect(shown.unreadable).toHaveLength(2);
    expect(formatFigmaShow(shown)).toContain("개인 설정을 읽지 못해 기본값으로 냈다");
    expect(() => figmaSetup(repo, { server: "remote" })).toThrow(Refusal);
  });
});
