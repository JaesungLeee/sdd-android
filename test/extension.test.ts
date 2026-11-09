import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { check } from "../src/commands/check.js";
import { addExtension, directives, listExtensions, removeExtension, resolveBundle } from "../src/commands/extension.js";
import { init } from "../src/commands/init.js";
import { upgrade } from "../src/commands/upgrade.js";
import { assetsFromDir } from "../src/core/assets.js";
import { readManifest } from "../src/core/manifest.js";
import { openRepo, Refusal, type Repo } from "../src/core/repo.js";

const CORE: Record<string, string> = {
  "ko/skills/spec/SKILL.md": "---\nname: {{skill:spec}}\n---\n코어 spec. 끝나면 `/{{skill:blueprint}}`.\n",
  "ko/skills/blueprint/SKILL.md": "---\nname: {{skill:blueprint}}\n---\n코어 blueprint.\n",
  "ko/templates/spec.md": "# 코어 스펙 템플릿\n",
  "ko/templates/checklist.md": "# 체크리스트\n\n- [ ] 하나\n",
};

const SAMPLE: Record<string, string> = {
  "extension.yaml": "name: sample\nkind: extension\nversion: 1.0.0\nrequires: \">=0.1.0\"\ndescription: 예시 확장\ndirectives:\n  spec: directives/spec.md\n",
  "skills/sample-ingest/SKILL.md": "---\nname: {{skill:sample-ingest}}\n---\n`/{{skill:spec}}` 뒤에 돈다.\n",
  "directives/spec.md": "spec을 쓸 때 용어집을 읽는다.\n",
  "scripts/lint.mjs": "console.log('lint');\n",
};

const PRESET: Record<string, string> = {
  "extension.yaml": "name: acme\nkind: preset\nversion: 2.0.0\n",
  "skills/spec/SKILL.md": "---\nname: {{skill:spec}}\n---\nacme의 spec. 끝나면 `/{{skill:blueprint}}`.\n",
  "templates/spec.md": "# acme 스펙 템플릿\n",
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

let repo: Repo;
let assetsDir: string;
let home: string;
const assets = () => assetsFromDir(assetsDir);
const read = (rel: string) => fs.readFileSync(path.join(repo.root, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(repo.root, rel));

beforeEach(() => {
  assetsDir = writeTree(tempDir("assets"), { ...CORE, ...Object.fromEntries(Object.entries(SAMPLE).map(([k, v]) => [`ko/extensions/sample/${k}`, v])) });
  const bundle = path.join(tempDir("pkg"), "mob-sdd.mjs");
  fs.writeFileSync(bundle, "// bundle\n");
  home = tempDir("home");
  const target = tempDir("repo");
  fs.mkdirSync(path.join(target, ".git"));
  init({ target, language: "ko", prefix: "sdd", assets: assets(), bundlePath: bundle, version: "0.2.0", homeDir: home });
  repo = openRepo(target);
});

describe("extension", () => {
  it("내장 확장을 목록에 보여 주고, 설치하면 스킬과 지시 파일이 제자리에 놓인다", () => {
    expect(listExtensions(repo, assets()).extensions).toMatchObject([{ name: "sample", kind: "extension", origin: "builtin", installed: false }]);

    const { bundle, origin } = resolveBundle(repo, assets(), "sample");
    const result = addExtension(repo, assets(), bundle, { origin, homeDir: home });
    expect(result).toMatchObject({ name: "sample", updated: false, skills: ["sdd-sample-ingest"] });
    expect(result.added).toEqual([
      ".mob-sdd/extensions/sample/directives/spec.md",
      ".mob-sdd/extensions/sample/extension.yaml",
      ".mob-sdd/extensions/sample/scripts/lint.mjs",
      ".claude/skills/sdd-sample-ingest/SKILL.md",
    ]);
    expect(read(".claude/skills/sdd-sample-ingest/SKILL.md")).toContain("`/sdd-spec` 뒤에");
    expect(readManifest(repo.root)?.extensions).toEqual({ sample: { kind: "extension", version: "1.0.0", origin: "builtin" } });
    expect(readManifest(repo.root)?.files[".mob-sdd/extensions/sample/scripts/lint.mjs"]?.source).toBe("sample");

    expect(directives(repo, "spec")).toEqual([{ extension: "sample", file: ".mob-sdd/extensions/sample/directives/spec.md" }]);
    expect(directives(repo, "blueprint")).toEqual([]);
    expect(listExtensions(repo, assets()).extensions[0]).toMatchObject({ installed: true, origin: "builtin" });
    expect(check(repo).ok).toBe(true);
  });

  it("같은 이름을 다시 설치하면 갱신이고, 고친 파일은 그대로 둔 채 새 버전을 옆에 둔다", () => {
    const first = resolveBundle(repo, assets(), "sample");
    addExtension(repo, assets(), first.bundle, { origin: "builtin", homeDir: home });
    fs.appendFileSync(path.join(repo.root, ".mob-sdd/extensions/sample/directives/spec.md"), "내가 더한 줄\n");

    const local = writeTree(tempDir("sample2"), {
      ...SAMPLE,
      "extension.yaml": SAMPLE["extension.yaml"]!.replace("1.0.0", "1.1.0"),
      "directives/spec.md": "새 지시\n",
      "scripts/lint.mjs": SAMPLE["scripts/lint.mjs"]!,
      "scripts/extra.mjs": "// extra\n",
    });
    const second = resolveBundle(repo, assets(), local);
    expect(second.origin).toBe("local");
    const result = addExtension(repo, assets(), second.bundle, { origin: second.origin, homeDir: home });
    expect(result.updated).toBe(true);
    expect(result.added).toEqual([".mob-sdd/extensions/sample/scripts/extra.mjs"]);
    expect(result.kept).toEqual([{ file: ".mob-sdd/extensions/sample/directives/spec.md", next: ".mob-sdd/extensions/sample/directives/spec.md.new" }]);
    expect(read(".mob-sdd/extensions/sample/directives/spec.md")).toContain("내가 더한 줄");
    expect(readManifest(repo.root)?.extensions?.sample).toEqual({ kind: "extension", version: "1.1.0", origin: "local" });
  });

  it("제거하면 고치지 않은 파일을 지우고 빈 디렉터리도 치운다", () => {
    addExtension(repo, assets(), resolveBundle(repo, assets(), "sample").bundle, { origin: "builtin", homeDir: home });
    fs.appendFileSync(path.join(repo.root, ".mob-sdd/extensions/sample/scripts/lint.mjs"), "// 내 수정\n");

    const result = removeExtension(repo, assets(), "sample");
    expect(result.removed).toContain(".claude/skills/sdd-sample-ingest/SKILL.md");
    expect(result.kept).toEqual([".mob-sdd/extensions/sample/scripts/lint.mjs"]);
    expect(exists(".claude/skills/sdd-sample-ingest")).toBe(false);
    expect(exists(".mob-sdd/extensions/sample/directives")).toBe(false);
    expect(exists(".mob-sdd/extensions/sample/scripts/lint.mjs")).toBe(true);
    expect(readManifest(repo.root)?.extensions).toEqual({});
    expect(directives(repo, "spec")).toEqual([]);
  });

  it("코어와 겹치는 스킬, 필요한 버전, 사용자 홈의 스킬을 거부한다", () => {
    const clash = writeTree(tempDir("clash"), { ...SAMPLE, "skills/spec/SKILL.md": "---\nname: {{skill:spec}}\n---\n", "extension.yaml": "name: clash\nkind: extension\nversion: 1.0.0\n" });
    expect(() => addExtension(repo, assets(), resolveBundle(repo, assets(), clash).bundle, { origin: "local", homeDir: home })).toThrow(/코어의 스킬과 이름이 겹친다: spec/);

    const future = writeTree(tempDir("future"), { ...SAMPLE, "extension.yaml": "name: future\nkind: extension\nversion: 1.0.0\nrequires: \">=9.0.0\"\n" });
    expect(() => addExtension(repo, assets(), resolveBundle(repo, assets(), future).bundle, { origin: "local", homeDir: home })).toThrow(/9\.0\.0 이상/);

    fs.mkdirSync(path.join(home, ".claude", "skills", "sdd-sample-ingest"), { recursive: true });
    expect(() => addExtension(repo, assets(), resolveBundle(repo, assets(), "sample").bundle, { origin: "builtin", homeDir: home })).toThrow(/사용자 홈/);

    expect(() => addExtension(repo, assets(), resolveBundle(repo, assets(), "sample").bundle, { origin: "builtin", homeDir: tempDir("h"), expectKind: "preset" })).toThrow(/extension 명령으로/);
    expect(() => resolveBundle(repo, assets(), "nope")).toThrow(Refusal);
  });

  it("선언 파일의 형식을 검사한다", () => {
    const bad = (yaml: string, extra: Record<string, string> = {}) => {
      const dir = writeTree(tempDir("bad"), { "extension.yaml": yaml, ...extra });
      return () => resolveBundle(repo, assets(), dir);
    };
    expect(bad("name: Bad Name\nkind: extension\nversion: 1.0.0\n")).toThrow(/name/);
    expect(bad("name: x\nkind: plugin\nversion: 1.0.0\n")).toThrow(/kind/);
    expect(bad("name: x\nkind: extension\nversion: 1\n")).toThrow(/version/);
    expect(bad("name: x\nkind: extension\nversion: 1.0.0\ndirectives:\n  spec: nope.md\n")).toThrow(/지시 파일이 묶음에 없다/);
    expect(bad("name: x\nkind: extension\nversion: 1.0.0\n", { "skills/loose.md": "x" })).toThrow(/skills\//);
  });
});

describe("preset", () => {
  const presetDir = () => writeTree(tempDir("preset"), PRESET);

  it("코어의 스킬과 템플릿을 같은 자리에서 교체하고, 교체한 코어의 해시를 기록한다", () => {
    const { bundle, origin } = resolveBundle(repo, assets(), presetDir());
    const result = addExtension(repo, assets(), bundle, { origin, homeDir: home, expectKind: "preset" });
    expect(result.replaced).toEqual([".claude/skills/sdd-spec/SKILL.md", ".mob-sdd/templates/spec.md"]);
    expect(result.added).toEqual([".mob-sdd/extensions/acme/extension.yaml"]);
    expect(read(".claude/skills/sdd-spec/SKILL.md")).toContain("acme의 spec. 끝나면 `/sdd-blueprint`");
    expect(read(".mob-sdd/templates/spec.md")).toBe("# acme 스펙 템플릿\n");

    const entry = readManifest(repo.root)?.files[".claude/skills/sdd-spec/SKILL.md"];
    expect(entry?.source).toBe("acme");
    expect(entry?.core).toBeDefined();
    expect(check(repo).ok).toBe(true);
    expect(listExtensions(repo, assets(), "preset").extensions).toMatchObject([{ name: "acme", installed: true, origin: "local" }]);
  });

  it("제거하면 코어의 파일을 번들에서 되살리고, 고친 preset 파일은 옆에 남긴다", () => {
    addExtension(repo, assets(), resolveBundle(repo, assets(), presetDir()).bundle, { origin: "local", homeDir: home });
    fs.appendFileSync(path.join(repo.root, ".claude/skills/sdd-spec/SKILL.md"), "내 수정\n");

    const result = removeExtension(repo, assets(), "acme", "preset");
    expect(result.restored).toEqual([".claude/skills/sdd-spec/SKILL.md", ".mob-sdd/templates/spec.md"]);
    expect(result.kept).toEqual([".claude/skills/sdd-spec/SKILL.md.removed"]);
    expect(read(".claude/skills/sdd-spec/SKILL.md")).toContain("코어 spec. 끝나면 `/sdd-blueprint`");
    expect(read(".mob-sdd/templates/spec.md")).toBe("# 코어 스펙 템플릿\n");
    expect(readManifest(repo.root)?.files[".claude/skills/sdd-spec/SKILL.md"]).toMatchObject({ source: "core" });
    expect(check(repo).ok).toBe(true);
  });

  it("코어에 없는 이름은 거부하고, 같은 파일을 두 preset이 교체하지 못한다", () => {
    const unknown = writeTree(tempDir("unknown"), { ...PRESET, "extension.yaml": "name: other\nkind: preset\nversion: 1.0.0\n", "skills/nope/SKILL.md": "---\nname: {{skill:nope}}\n---\n" });
    expect(() => addExtension(repo, assets(), resolveBundle(repo, assets(), unknown).bundle, { origin: "local", homeDir: home })).toThrow(/코어에 없는 이름: nope/);

    addExtension(repo, assets(), resolveBundle(repo, assets(), presetDir()).bundle, { origin: "local", homeDir: home });
    const second = writeTree(tempDir("second"), { ...PRESET, "extension.yaml": "name: other\nkind: preset\nversion: 1.0.0\n" });
    expect(() => addExtension(repo, assets(), resolveBundle(repo, assets(), second).bundle, { origin: "local", homeDir: home })).toThrow(/acme의 파일/);
  });
});

describe("upgrade와 확장", () => {
  it("코어가 바뀌면 preset이 교체한 파일 옆에 새 코어를 두고, 내장 확장은 함께 올리며, 로컬 확장은 알리기만 한다", () => {
    addExtension(repo, assets(), resolveBundle(repo, assets(), writeTree(tempDir("preset"), PRESET)).bundle, { origin: "local", homeDir: home });
    addExtension(repo, assets(), resolveBundle(repo, assets(), "sample").bundle, { origin: "builtin", homeDir: home });
    const local = writeTree(tempDir("local"), { "extension.yaml": "name: mine\nkind: extension\nversion: 1.0.0\n", "scripts/a.mjs": "// a\n" });
    addExtension(repo, assets(), resolveBundle(repo, assets(), local).bundle, { origin: "local", homeDir: home });

    // 새 버전: 코어 spec 스킬과 내장 확장의 지시가 바뀐다.
    fs.writeFileSync(path.join(assetsDir, "ko/skills/spec/SKILL.md"), CORE["ko/skills/spec/SKILL.md"]!.replace("코어 spec.", "코어 spec 2."));
    fs.writeFileSync(path.join(assetsDir, "ko/extensions/sample/directives/spec.md"), "새 지시\n");
    const bundle = path.join(tempDir("pkg2"), "mob-sdd.mjs");
    fs.writeFileSync(bundle, "// bundle 2\n");

    const result = upgrade({ target: repo.root, assets: assets(), bundlePath: bundle, version: "0.3.0" });
    expect(result.presetStale).toEqual([{ file: ".claude/skills/sdd-spec/SKILL.md", preset: "acme", next: ".claude/skills/sdd-spec/SKILL.md.new" }]);
    expect(read(".claude/skills/sdd-spec/SKILL.md")).toContain("acme의 spec");
    expect(read(".claude/skills/sdd-spec/SKILL.md.new")).toContain("코어 spec 2.");
    expect(result.extensions.map((e) => [e.name, e.replaced])).toEqual([["sample", [".mob-sdd/extensions/sample/directives/spec.md"]]]);
    // 로컬에서 설치한 preset도 손대지 않는다.
    expect(result.local).toEqual(["acme", "mine"]);
    expect(readManifest(repo.root)?.version).toBe("0.3.0");
    expect(readManifest(repo.root)?.extensions?.sample).toBeDefined();
    expect(check(repo).ok).toBe(true);
  });

  it("새 버전에 없는 내장 확장은 지우고, 고친 파일은 남긴다", () => {
    addExtension(repo, assets(), resolveBundle(repo, assets(), "sample").bundle, { origin: "builtin", homeDir: home });
    fs.appendFileSync(path.join(repo.root, ".mob-sdd/extensions/sample/directives/spec.md"), "내가 더한 줄\n");

    // 새 버전: 내장 확장 sample이 빠진다.
    fs.rmSync(path.join(assetsDir, "ko/extensions/sample"), { recursive: true });
    const bundle = path.join(tempDir("pkg2"), "mob-sdd.mjs");
    fs.writeFileSync(bundle, "// bundle 2\n");

    const result = upgrade({ target: repo.root, assets: assets(), bundlePath: bundle, version: "0.3.0" });
    expect(result.retired).toMatchObject([{ name: "sample", kept: [".mob-sdd/extensions/sample/directives/spec.md"] }]);
    expect(result.retired[0]?.removed).toContain(".claude/skills/sdd-sample-ingest/SKILL.md");
    expect(result.local).toEqual([]);
    expect(exists(".claude/skills/sdd-sample-ingest/SKILL.md")).toBe(false);
    expect(read(".mob-sdd/extensions/sample/directives/spec.md")).toContain("내가 더한 줄");
    expect(readManifest(repo.root)?.extensions?.sample).toBeUndefined();
    expect(Object.values(readManifest(repo.root)?.files ?? {}).some((file) => file.source === "sample")).toBe(false);
  });

  it("지시의 대상 단계가 설치되어 있지 않으면 check가 경고한다", () => {
    const odd = writeTree(tempDir("odd"), { "extension.yaml": "name: odd\nkind: extension\nversion: 1.0.0\ndirectives:\n  create-ui: d.md\n", "d.md": "x\n" });
    addExtension(repo, assets(), resolveBundle(repo, assets(), odd).bundle, { origin: "local", homeDir: home });
    expect(check(repo).problems.map((p) => p.message)).toContain("지시의 대상 단계가 설치되어 있지 않다: create-ui");
  });
});
