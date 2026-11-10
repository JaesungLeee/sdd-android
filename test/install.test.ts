import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildAssets, compareLanguages, composeSkill, includedFragments, readText } from "../scripts/build.mjs";
import { assetsFromDir } from "../src/core/assets.js";
import { check } from "../src/commands/check.js";
import { docChecklist, docComplete, docNew } from "../src/commands/doc.js";
import { init } from "../src/commands/init.js";
import { promptInit } from "../src/commands/init-prompt.js";
import { changelogBetween, upgrade } from "../src/commands/upgrade.js";
import { parseTasks, setChecked, validateTasks, countTasks } from "../src/core/breakdown.js";
import { readManifest } from "../src/core/manifest.js";
import { docPath, openRepo, Refusal } from "../src/core/repo.js";
import { splitItems } from "../src/core/items.js";
import { applyPrefix } from "../src/core/skilltext.js";
import { implSetup } from "../src/core/impl-config.js";
import { LAUNCHER } from "../src/core/launcher.js";

const PROJECT = path.dirname(path.dirname(new URL(import.meta.url).pathname));

const SKILLS: Record<string, string> = {
  spec: "---\nname: {{skill:spec}}\n---\n끝나면 `/{{skill:blueprint}}`를 실행한다.\n",
  blueprint: "---\nname: {{skill:blueprint}}\n---\n먼저 `/{{skill:spec}}`이 끝나야 한다.\n",
};

const TEMPLATES: Record<string, string> = {
  prd: "# PRD\n\n### [CLI-001] 설치\n\n설치한다.\n",
  spec: "# 스펙\n",
  checklist: "# 체크리스트\n\n- [ ] 하나\n",
  blueprint: "# 설계\n",
  research: "# 리서치\n",
  breakdown: "# 작업 목록\n\n- [ ] T001 [US1] 만든다 `src/a.ts`\n- [ ] FINAL 마지막 확인\n",
};

function tempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdd-android-${name}-`));
}

/** 패키지의 dist 디렉터리 모양을 흉내 낸다. */
function makeAssets(dir: string): string {
  for (const [name, text] of Object.entries(SKILLS)) {
    fs.mkdirSync(path.join(dir, "assets", "ko", "skills", name), { recursive: true });
    fs.writeFileSync(path.join(dir, "assets", "ko", "skills", name, "SKILL.md"), text);
  }
  fs.mkdirSync(path.join(dir, "assets", "ko", "templates"), { recursive: true });
  for (const [name, text] of Object.entries(TEMPLATES)) {
    fs.writeFileSync(path.join(dir, "assets", "ko", "templates", `${name}.md`), text);
  }
  return path.join(dir, "assets");
}

function gitRepo(): string {
  const dir = tempDir("repo");
  fs.mkdirSync(path.join(dir, ".git"));
  return dir;
}

describe("스킬의 합성", () => {
  const fragments = { "revision-grade": "MAJOR, MINOR, PATCH\n\n" };

  it("포함 표기를 조각의 내용으로 바꾸고 스킬 참조 표기는 그대로 둔다", () => {
    const source = "머리말\n\n{{> revision-grade}}\n\n`/{{skill:spec}}`\n";
    expect(composeSkill(source, fragments)).toBe("머리말\n\nMAJOR, MINOR, PATCH\n\n`/{{skill:spec}}`\n");
    expect(includedFragments(source)).toEqual(["revision-grade"]);
  });

  it("없는 조각을 포함하면 빌드가 실패한다", () => {
    expect(() => composeSkill("{{> nope}}\n", fragments)).toThrow(/nope/);
  });

  it("언어 사이에 스킬, 조각, 포함 순서, 스킬 참조가 다르면 알린다", () => {
    const ko = { fragments: { a: "" }, skills: { spec: { includes: ["a"], refs: ["blueprint"] } } };
    expect(compareLanguages({ ko, en: structuredClone(ko) })).toEqual([]);
    const en = { fragments: { a: "", b: "" }, skills: { spec: { includes: [], refs: ["prd"] } } };
    expect(compareLanguages({ ko, en })).toHaveLength(3);
  });
});

describe("접두사", () => {
  it("스킬 참조 표기에만 접두사를 붙인다", () => {
    expect(applyPrefix("spec 문서를 쓴 뒤 `/{{skill:blueprint}}`", "sdd")).toBe("spec 문서를 쓴 뒤 `/sdd-blueprint`");
    expect(applyPrefix("`/{{skill:blueprint}}`", "")).toBe("`/blueprint`");
  });
});

describe("breakdown의 작업 줄", () => {
  const body = [
    "- [ ] T010 [P] [US1] [until:T014] 테스트를 쓴다 `domain/src/test/LoginTest.kt`",
    "- [x] T012 [US1] 모델을 만든다 `domain/src/main/User.kt` `domain/src/main/Token.kt`",
    "- [ ] T014 [US1] 유스케이스를 구현한다 `domain/src/main/usecase/`",
    "- [x] T009 [US1] [dropped] 저장소를 만든다 `data/src/main/TokenStore.kt`",
    "```text",
    "- [ ] T999 코드 블록 안의 줄",
    "```",
    "<!--",
    "    - [ ] T998 [FIX-001] 주석 안의 예시 `a.kt`",
    "-->",
    "<!-- 한 줄 주석 --> ",
    "- [ ] FINAL 마지막 확인",
  ].join("\n");
  const tasks = parseTasks(body);

  it("표시와 경로를 읽는다", () => {
    expect(tasks.map((task) => task.id)).toEqual(["T010", "T012", "T014", "T009", "FINAL"]);
    expect(tasks[0]).toMatchObject({ parallel: true, story: "US1", until: "T014", checked: false });
    expect(tasks[1]?.paths).toEqual(["domain/src/main/User.kt", "domain/src/main/Token.kt"]);
    const quoted = parseTasks("- [ ] T001 `todoz: …` 한 줄을 내는지 본다 `test/cli.test.mjs`, `src/cli.mjs`");
    expect(quoted[0]?.paths).toEqual(["test/cli.test.mjs", "src/cli.mjs"]);
    expect(parseTasks("- [ ] T001 `src/a.ts`를 만든다")[0]?.paths).toEqual([]);
    const node = parseTasks("- [ ] T016 [US1] 로그인 화면을 만든다 [로그인 - 기본](https://www.figma.com/design/a?node-id=12-34) `feature/login/LoginScreen.kt`")[0];
    expect(node).toMatchObject({ id: "T016", story: "US1", paths: ["feature/login/LoginScreen.kt"] });
    expect(tasks[3]).toMatchObject({ dropped: true, checked: true });
  });

  it("코드 블록과 HTML 주석 안의 줄은 작업이 아니고, 체크도 그 줄을 건드리지 않는다", () => {
    expect(tasks.map((task) => task.id)).not.toContain("T998");
    const commented = "<!--\n- [ ] T001 예시 `a.kt`\n-->\n- [ ] T001 실제 `a.kt`\n- [ ] FINAL 끝";
    expect(setChecked(commented, ["T001"], true)).toBe("<!--\n- [ ] T001 예시 `a.kt`\n-->\n- [x] T001 실제 `a.kt`\n- [ ] FINAL 끝");
  });

  it("형식이 맞으면 문제가 없다", () => {
    expect(validateTasks(tasks)).toEqual([]);
  });

  it("폐기된 작업과 마지막 확인 줄은 세지 않는다", () => {
    expect(countTasks(tasks)).toEqual({ done: 1, total: 3 });
  });

  it("경로가 없거나, 연결 표기가 틀리거나, 마지막 확인 줄이 없으면 알린다", () => {
    const broken = parseTasks(
      ["- [ ] T001 경로 없는 작업", "- [ ] T003 [until:T002] 테스트 `a`", "- [ ] T002 구현 `b`", "- [ ] T004 [until:T008] 테스트 `c`", "- [ ] T002 중복 `d`"].join("\n"),
    );
    const problems = validateTasks(broken).join("\n");
    expect(problems).toMatch(/T001에 백틱으로 감싼 경로가 없다/);
    expect(problems).toMatch(/없는 작업을 가리킨다: T008/);
    expect(problems).toMatch(/작업 ID가 중복됐다: T002/);
    expect(problems).toMatch(/FINAL\)이 없다/);
    expect(validateTasks(parseTasks("- [ ] T002 구현 `b`\n- [ ] T003 [until:T002] 테스트 `a`\n- [ ] FINAL 끝")).join()).toMatch(
      /T002보다 앞에/,
    );
  });
});

describe("init", () => {
  let pkg: string;
  let bundle: string;
  let home: string;
  const options = (target: string, prefix = "") => ({
    target,
    language: "ko",
    prefix,
    assets: assetsFromDir(path.join(pkg, "assets")),
    bundlePath: bundle,
    version: "0.1.0",
    homeDir: home,
  });

  beforeEach(() => {
    pkg = tempDir("pkg");
    makeAssets(pkg);
    bundle = path.join(pkg, "sdd-android.mjs");
    fs.writeFileSync(bundle, "// bundle\n");
    home = tempDir("home");
  });

  it("스킬, 템플릿, 번들, 설정, 설치 기록을 설치한다", () => {
    const target = gitRepo();
    const result = init(options(target));
    expect(result.skills).toEqual(["blueprint", "spec"]);
    expect(result.files).toContain(".claude/skills/spec/SKILL.md");
    expect(result.files).toContain(".sdd-android/bin/sdd-android.mjs");
    expect(fs.readFileSync(path.join(target, ".sdd-android", "config.yaml"), "utf8")).toContain('prefix: ""');

    const manifest = readManifest(target);
    expect(manifest?.version).toBe("0.1.0");
    expect(Object.keys(manifest?.files ?? {})).toEqual([...Object.keys(manifest?.files ?? {})].sort());
    expect(manifest?.files[".sdd-android/templates/prd.md"]).toEqual({ sha256: expect.any(String) });
  });

  it("실행 스크립트는 실행 비트를 갖는다", () => {
    const target = gitRepo();
    init(options(target));
    if (process.platform !== "win32") expect(fs.statSync(path.join(target, ".sdd-android/bin/sdd-android")).mode & 0o111).not.toBe(0);
  });

  it("node를 찾지 못하면 본문 주입이 부르는 명령만 안내를 내고 0으로 끝난다", () => {
    if (process.platform === "win32") return;
    // 기계마다 node의 자리가 달라, 찾는 함수를 비워 node가 없는 셸을 만든다.
    const script = path.join(tempDir("launcher"), "sdd-android");
    fs.writeFileSync(script, LAUNCHER.replace(/^find_node\(\) \{[\s\S]*?^\}$/m, "find_node() { :; }"));
    const run = (...args: string[]) => spawnSync("/bin/sh", [script, ...args], { encoding: "utf8" });
    for (const args of [["gate", "spec"], ["status"], ["figma", "show"]]) {
      const ran = run(...args);
      expect(ran.status, args.join(" ")).toBe(0);
      expect(ran.stdout, args.join(" ")).toContain("Node.js를 찾지 못했다");
    }
    for (const args of [["check"], ["figma", "setup"], ["doc", "new", "prd"]]) {
      const ran = run(...args);
      expect(ran.status, args.join(" ")).toBe(127);
      expect(ran.stderr, args.join(" ")).toContain("Node.js를 찾지 못했다");
    }
    expect(run("hook", "write").status).toBe(0);
  });

  it("접두사를 붙이면 스킬의 이름과 서로를 가리키는 이름이 모두 바뀐다", () => {
    const target = gitRepo();
    expect(init(options(target, "sdd")).skills).toEqual(["sdd-blueprint", "sdd-spec"]);
    const spec = fs.readFileSync(path.join(target, ".claude", "skills", "sdd-spec", "SKILL.md"), "utf8");
    expect(spec).toContain("name: sdd-spec");
    expect(spec).toContain("`/sdd-blueprint`");
    expect(openRepo(target).config.prefix).toBe("sdd");
  });

  it("git 저장소의 루트가 아니면 설치하지 않는다", () => {
    expect(() => init(options(tempDir("plain")))).toThrow(/git init/);
  });

  it("이미 있는 파일을 덮어쓰지 않고 충돌 목록을 보여 준다", () => {
    const target = gitRepo();
    const existing = path.join(target, ".claude", "skills", "spec", "SKILL.md");
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, "내 스킬\n");

    expect(() => init(options(target))).toThrow(/\.claude\/skills\/spec\/SKILL\.md/);
    expect(fs.readFileSync(existing, "utf8")).toBe("내 스킬\n");
    expect(fs.existsSync(path.join(target, ".sdd-android"))).toBe(false);
  });

  it("사용자 홈의 스킬과 이름이 같으면 멈춘다", () => {
    fs.mkdirSync(path.join(home, ".claude", "skills", "spec"), { recursive: true });
    expect(() => init(options(gitRepo()))).toThrow(/사용자 홈/);
    expect(init(options(gitRepo(), "sdd")).skills).toContain("sdd-spec");
  });

  it("두 번 설치하지 않는다", () => {
    const target = gitRepo();
    init(options(target));
    expect(() => init(options(target))).toThrow(Refusal);
  });

  it("백업을 고르면 겹치는 스킬을 스킬 디렉터리 밖으로 옮기고 설치한다", () => {
    const target = gitRepo();
    const existing = path.join(target, ".claude", "skills", "spec", "SKILL.md");
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, "내 스킬\n");

    const result = init({ ...options(target), backup: true, today: "2026-10-04" });
    expect(result.backedUp).toEqual([{ from: ".claude/skills/spec", to: ".sdd-android/backup/2026-10-04/skills/spec" }]);
    expect(fs.readFileSync(path.join(target, ".sdd-android/backup/2026-10-04/skills/spec/SKILL.md"), "utf8")).toBe("내 스킬\n");
    expect(fs.readFileSync(existing, "utf8")).toContain("name: spec");
  });

  it("백업을 골라도 사용자 홈의 스킬과 겹치면 설치하지 않는다", () => {
    fs.mkdirSync(path.join(home, ".claude", "skills", "spec"), { recursive: true });
    expect(() => init({ ...options(gitRepo()), backup: true })).toThrow(/사용자 홈/);
  });

  describe("묻는 흐름", () => {
    const scripted = (answers: string[]) => {
      const asked: string[] = [];
      const printed: string[] = [];
      return {
        asked,
        printed,
        prompt: (prefixGiven: boolean) => ({
          prefixGiven,
          ask: async (question: string) => {
            asked.push(question);
            const answer = answers.shift();
            if (answer === undefined) throw new Error(`답이 없는 질문: ${question}`);
            return answer;
          },
          print: (text: string) => void printed.push(text),
        }),
      };
    };

    it("접두사와 설치 확인만 묻는다", async () => {
      const script = scripted(["sdd", ""]);
      const chosen = await promptInit(options(gitRepo()), script.prompt(false));
      expect(chosen?.prefix).toBe("sdd");
      expect(script.asked).toHaveLength(2);
      expect(script.printed.join("\n")).toContain("/sdd-spec");
    });

    it("인자로 준 접두사는 묻지 않고, 확인에서 n이면 그만둔다", async () => {
      const script = scripted(["n"]);
      expect(await promptInit(options(gitRepo(), "sdd"), script.prompt(true))).toBeUndefined();
      expect(script.asked).toHaveLength(1);
    });

    it("잘못된 접두사는 다시 묻는다", async () => {
      const script = scripted(["My Prefix", "ok", "y"]);
      expect((await promptInit(options(gitRepo()), script.prompt(false)))?.prefix).toBe("ok");
    });

    it("스킬이 겹치면 접두사나 백업을 고르게 한다", async () => {
      const target = gitRepo();
      fs.mkdirSync(path.join(target, ".claude", "skills", "spec"), { recursive: true });
      fs.writeFileSync(path.join(target, ".claude", "skills", "spec", "SKILL.md"), "내 스킬\n");

      const byPrefix = await promptInit(options(target), scripted(["", "1", "sdd", "y"]).prompt(false));
      expect(byPrefix).toMatchObject({ prefix: "sdd" });
      expect(byPrefix?.backup).toBeUndefined();

      const byBackup = await promptInit(options(target), scripted(["", "2", "y"]).prompt(false));
      expect(byBackup).toMatchObject({ prefix: "", backup: true });

      expect(await promptInit(options(target), scripted(["", "q"]).prompt(false))).toBeUndefined();
    });

    it("사용자 홈의 스킬과 겹치면 백업을 고를 수 없다", async () => {
      fs.mkdirSync(path.join(home, ".claude", "skills", "spec"), { recursive: true });
      const script = scripted(["", "2", "1", "sdd", "y"]);
      expect((await promptInit(options(gitRepo()), script.prompt(false)))?.prefix).toBe("sdd");
      expect(script.printed.join("\n")).not.toContain("백업으로 옮기고");
      expect(script.asked.join("\n")).not.toContain("2)");
    });

    it("설치할 수 없는 곳이면 묻기 전에 멈춘다", async () => {
      const script = scripted([]);
      await expect(promptInit(options(tempDir("plain")), script.prompt(false))).rejects.toThrow(/git init/);
      expect(script.asked).toHaveLength(0);
    });
  });
});

describe("check", () => {
  let target: string;
  const today = { today: "2026-10-04" };

  beforeEach(() => {
    const pkg = tempDir("pkg");
    const bundle = path.join(pkg, "sdd-android.mjs");
    fs.writeFileSync(bundle, "// bundle\n");
    target = gitRepo();
    init({ target, language: "ko", prefix: "", assets: assetsFromDir(makeAssets(pkg)), bundlePath: bundle, version: "0.1.0", homeDir: tempDir("home") });
    implSetup(openRepo(target), { lint: "none" });
  });

  const errors = () => check(openRepo(target)).problems.filter((problem) => problem.level === "error").map((problem) => problem.message);

  it("방금 설치한 저장소에는 문제가 없다", () => {
    expect(check(openRepo(target))).toEqual({ ok: true, problems: [] });
  });

  it("사슬을 끝까지 만든 저장소에도 문제가 없다", () => {
    const repo = openRepo(target);
    docNew(repo, "prd", undefined, today);
    docComplete(repo, "prd", undefined, today);
    docNew(repo, "spec", "login", today);
    const checklist = docPath(repo, "checklist", "login");
    fs.writeFileSync(checklist, fs.readFileSync(checklist, "utf8").replace("- [ ]", "- [x]"));
    docChecklist(repo, "login");
    docComplete(repo, "spec", "login", { ...today, depends: ["CLI-001"] });
    docNew(repo, "blueprint", "login", today);
    docComplete(repo, "blueprint", "login", today);
    docNew(repo, "breakdown", "login", today);
    docComplete(repo, "breakdown", "login", today);
    expect(check(repo)).toEqual({ ok: true, problems: [] });
  });

  it("설치한 파일이 바뀌면 경고하고, 없어지면 오류로 알린다", () => {
    fs.appendFileSync(path.join(target, ".claude", "skills", "spec", "SKILL.md"), "고침\n");
    fs.rmSync(path.join(target, ".sdd-android", "templates", "prd.md"));
    const result = check(openRepo(target));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      { level: "warn", where: ".claude/skills/spec/SKILL.md", message: "설치한 뒤 바뀐 파일이다" },
      { level: "error", where: ".sdd-android/templates/prd.md", message: "설치된 파일이 없다" },
    ]);
  });

  it("Node.js 버전이 낮으면 오류로 알린다", () => {
    expect(check(openRepo(target), "20.11.0").problems[0]?.message).toMatch(/Node\.js 22 이상/);
  });

  it("미기록 변경, 충돌 표시, 항목 ID 중복을 잡는다", () => {
    const repo = openRepo(target);
    docNew(repo, "prd", undefined, today);
    docComplete(repo, "prd", undefined, today);
    const prd = docPath(repo, "prd");
    const original = fs.readFileSync(prd, "utf8");

    fs.writeFileSync(prd, original.replace("설치한다.", "몰래 바꿨다."));
    expect(errors().join()).toMatch(/미기록 변경/);

    fs.writeFileSync(prd, original + "\n### [CLI-001] 또 설치\n");
    expect(errors().join()).toMatch(/항목 ID가 중복됐다: CLI-001/);

    fs.writeFileSync(prd, original.replace("version: 1.0.0", "<<<<<<< HEAD\nversion: 1.1.0\n=======\nversion: 1.2.0\n>>>>>>> other"));
    expect(errors().join()).toMatch(/충돌 표시/);
  });

  it("버전과 개정 기록이 어긋나거나 기준 버전이 상위에 없으면 잡는다", () => {
    const repo = openRepo(target);
    docNew(repo, "prd", undefined, today);
    docComplete(repo, "prd", undefined, today);
    docNew(repo, "spec", "login", today);

    const prd = docPath(repo, "prd");
    fs.writeFileSync(prd, fs.readFileSync(prd, "utf8").replace("version: 1.0.0\nstatus", "version: 1.1.0\nstatus"));
    expect(errors().join("\n")).toMatch(/개정 기록의 마지막 항목과 다르다/);

    const spec = docPath(repo, "spec", "login");
    fs.writeFileSync(spec, fs.readFileSync(spec, "utf8").replace("version: 1.0.0", "version: 3.0.0, items: [CLI-777]"));
    const messages = errors().join("\n");
    expect(messages).toMatch(/기준 버전\(3\.0\.0\)이 prd의 버전/);
    expect(messages).toMatch(/개정 기록에 없다/);
    expect(messages).toMatch(/없던 ID다: CLI-777/);
  });

  it("breakdown의 형식 오류를 잡는다", () => {
    const repo = openRepo(target);
    const file = docPath(repo, "breakdown", "login");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\nstatus: draft\n---\n- [ ] T001 경로가 없다\n");
    expect(errors().join("\n")).toMatch(/T001에 백틱으로 감싼 경로가 없다/);
  });
});

describe("번들", () => {
  it("빌드한 번들로 설치하고, 설치된 번들이 하위 디렉터리에서 판정을 낸다", () => {
    execFileSync(process.execPath, [path.join(PROJECT, "scripts", "build.mjs")], { cwd: PROJECT });
    const pkg = tempDir("dist");
    fs.copyFileSync(path.join(PROJECT, "dist", "sdd-android.mjs"), path.join(pkg, "sdd-android.mjs"));
    makeAssets(pkg);

    const target = gitRepo();
    const env = { ...process.env, HOME: tempDir("home") };
    const run = (cwd: string, ...args: string[]) =>
      spawnSync(process.execPath, [path.join(pkg, "sdd-android.mjs"), ...args], { cwd, env, encoding: "utf8" });

    const installed = run(target, "init").stdout;
    expect(installed).toContain("설치했다");
    expect(installed).toContain("impl setup");
    const sub = path.join(target, "app", "src");
    fs.mkdirSync(sub, { recursive: true });

    // 패키지의 CLI를 불러도 저장소의 번들이 일한다.
    expect(run(sub, "doc", "new", "prd").stdout).toContain("docs/prd.md");
    expect(run(sub, "doc", "complete", "prd").stdout).toContain("1.0.0");
    expect(run(sub, "doc", "new", "spec", "login").status).toBe(0);
    expect(run(sub, "gate", "blueprint").stdout).toContain("login: 중단");
    const blocked = run(sub, "doc", "new", "blueprint", "login");
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("상위 미완료");
    expect(run(sub, "check").status).toBe(0);
    expect(JSON.parse(run(sub, "status", "--json").stdout).project.prd.version).toBe("1.0.0");

    // 저장소의 번들은 패키지의 assets 디렉터리 없이 돈다. 확장 명령은 없다.
    fs.rmSync(path.join(pkg, "assets"), { recursive: true });
    for (const removed of ["extension", "preset", "directives", "run"]) expect(run(sub, removed, "list").stderr, removed).toContain("알 수 없는 명령이다");
    expect(fs.existsSync(path.join(target, ".sdd-android", "extensions"))).toBe(false);
    expect(run(sub, "openapi", "operations").stdout).toContain("출처가 없다");

    // 구현 단계의 스킬이 설치되어 있고, Figma 설정 명령이 번들에서 돈다.
    expect(run(sub, "figma", "show").stdout).toContain("mcp__figma-desktop__get_metadata");
    expect(run(sub, "figma", "setup", "--server", "remote", "--name", "figma").stdout).toContain("mcp__figma__get_screenshot");
    expect(run(sub, "check").stderr + run(sub, "check").stdout).not.toContain("Figma 설정이 없다");
    const orchestrator = fs.readFileSync(path.join(target, ".claude", "skills", "impl-orchestrator", "SKILL.md"), "utf8");
    expect(orchestrator).toContain("Skill(create-logic)");
    expect(orchestrator).not.toContain("{{");
    expect(run(sub, "gate", "implement").stdout).toContain("login: 중단");

    // 저장소 밖에서 명령 앞의 --root를 공백과 = 두 형태로 받는다. 그 값을 명령으로 읽지 않는다.
    const outside = tempDir("outside");
    for (const args of [["--root", target], [`--root=${target}`]]) {
      const ran = run(outside, ...args, "gate", "blueprint");
      expect(ran.stdout, args.join(" ")).toContain("login: 중단");
    }

    // PATH에 node가 없는 셸에서도 실행 스크립트가 node를 찾아 판정을 낸다.
    const fakeHome = tempDir("home");
    fs.mkdirSync(path.join(fakeHome, ".local", "bin"), { recursive: true });
    fs.symlinkSync(process.execPath, path.join(fakeHome, ".local", "bin", "node"));
    const bare = spawnSync("/bin/sh", [path.join(target, ".sdd-android", "bin", "sdd-android"), "gate", "blueprint"], {
      cwd: sub,
      env: { PATH: "/usr/bin:/bin", HOME: fakeHome },
      encoding: "utf8",
    });
    expect(bare.status).toBe(0);
    expect(bare.stdout).toContain("login: 중단");
  }, 30000);
});

describe("실린 스킬과 템플릿", () => {
  const assets = tempDir("assets");
  const built = buildAssets(assets);
  const languages = [...new Set(Object.keys(built).map((key) => key.split("/")[0]))];
  const skillsDir = path.join(assets, "ko", "skills");

  const DOC_STAGES = ["constitution", "prd", "spec", "blueprint", "breakdown"];
  const READ_ONLY = ["clarify", "analyze"];
  /** 구현이 끝난 feature의 수정. spec과 breakdown을 쓰므로 쓰기 hook을 갖는다. */
  const FIX = "fix";
  const IMPL = ["create-logic", "create-structure", "create-test", "create-ui", "design-inspector", "heal-build", "heal-test", "impl-orchestrator", "sync-rules", "verify-build", "verify-principles", "verify-ui"];

  it("한국어 스킬이 합성되고 채우지 않은 포함 표기가 남지 않는다", () => {
    expect(languages).toContain("ko");
    expect(fs.readdirSync(skillsDir).sort()).toEqual([...DOC_STAGES, ...READ_ONLY, FIX, ...IMPL].sort());
    for (const name of fs.readdirSync(skillsDir)) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      expect(text, name).not.toContain("{{>");
      expect(text, name).toContain(`name: {{skill:${name}}}`);
      expect(text, name).toContain("allowed-tools: Bash(sh *)");
      expect(text, name).not.toContain("sdd-android.mjs");
      expect(text, name).not.toContain("directives");
      expect(text, name).not.toContain("확장 지시");
    }
  });

  it("문서를 쓰는 단계는 게이트 판정을 주입받고 쓰기 hook을 갖는다", () => {
    for (const name of DOC_STAGES) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      expect(text, name).toContain("hook write");
      expect(text, name).toContain(`.sdd-android/bin/sdd-android" gate ${name}`);
    }
    const fix = fs.readFileSync(path.join(skillsDir, FIX, "SKILL.md"), "utf8");
    expect(fix).toContain("hook write");
    expect(fix).toContain('.sdd-android/bin/sdd-android" gate breakdown');
  });

  it("읽기 전용 단계는 hook과 기록 명령의 호출을 갖지 않는다", () => {
    for (const name of READ_ONLY) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      // hook은 스킬이 끝난 뒤에도 세션에 남아, 같은 세션의 다음 단계가 쓰는 것까지 막는다.
      expect(text, name).not.toContain("hooks:");
      expect(text, name).toContain("## 읽기 전용");
      expect(text, name).not.toMatch(/^\s*sdd-android doc (new|complete|revise|confirm|checklist)/m);
    }
    const analyze = fs.readFileSync(path.join(skillsDir, "analyze", "SKILL.md"), "utf8");
    expect(analyze).toContain("context: fork");
  });

  it("구현 단계의 일꾼은 격리 실행이며 검증은 읽기 전용에 모델을 명시한다", () => {
    const names = IMPL;
    for (const name of names) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      expect(text, name).not.toContain("hooks:");
      if (name === "impl-orchestrator") {
        expect(text).not.toContain("context: fork");
        expect(text).toContain('.sdd-android/bin/sdd-android" gate implement');
        for (const worker of names.filter((other) => other !== name && other !== "sync-rules")) expect(text).toContain(`Skill({{skill:${worker}}})`);
        expect(text).not.toContain("Skill({{skill:sync-rules}})");
      } else if (name === "sync-rules") {
        // 구현 단계 밖에서 사용자가 부르는 스킬이다. 사용자에게 물어야 하므로 메인 세션에서 돈다.
        expect(text).not.toContain("context: fork");
      } else {
        expect(text, name).toContain("context: fork");
      }
      if (name.startsWith("create-") || name.startsWith("heal-")) {
        // 자체 확인은 프로젝트가 정한 검사 명령으로 돈다. 고정된 Gradle 명령을 쓰지 않는다.
        expect(text, name).toContain("sdd-android impl try {feature} {작업}");
        expect(text, name).not.toContain("Bash(./gradlew *)");
        expect(text, name).not.toMatch(/`\.\/gradlew /);
      }
      if (name.startsWith("create-")) {
        expect(text, name).toContain('.sdd-android/bin/sdd-android" gate implement');
        expect(text, name).toContain("## 범위");
        expect(text, name).toContain("## 보고의 형식");
      }
      if (name === "create-ui" || name === "verify-ui" || name === "design-inspector") {
        expect(text, name).toContain('.sdd-android/bin/sdd-android" figma show');
      }
      if (name.startsWith("verify-")) {
        expect(text, name).toContain("agent: Explore");
        expect(text, name).toMatch(/^model: /m);
        expect(text, name).not.toMatch(/^\s*sdd-android impl /m);
      }
    }
  });

  it("문서를 쓰는 단계마다 같은 이름의 템플릿이 있고, 템플릿의 자리표시자는 항목으로 읽히지 않는다", () => {
    for (const name of DOC_STAGES) {
      const template = fs.readFileSync(path.join(assets, "ko", "templates", `${name}.md`), "utf8");
      expect(splitItems(template).items.size, name).toBe(0);
    }
  });

  it("빌드 결과에 CRLF가 없고, CRLF인 원본도 LF로 읽는다", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
      );
    for (const file of walk(assets)) expect(fs.readFileSync(file, "utf8"), file).not.toContain("\r");

    const crlf = path.join(tempDir("crlf"), "a.md");
    fs.writeFileSync(crlf, "하나\r\n둘\r\n");
    expect(readText(crlf)).toBe("하나\n둘\n");
  });

  it("스킬이 가리키는 스킬은 접두사를 붙여 설치된다", () => {
    const pkg = tempDir("pkg");
    const bundle = path.join(pkg, "sdd-android.mjs");
    fs.writeFileSync(bundle, "// bundle\n");
    const target = gitRepo();
    init({ target, language: "ko", prefix: "sdd", assets: assetsFromDir(assets), bundlePath: bundle, version: "0.1.0", homeDir: tempDir("home") });
    const prd = fs.readFileSync(path.join(target, ".claude", "skills", "sdd-prd", "SKILL.md"), "utf8");
    expect(prd).toContain("name: sdd-prd");
    expect(prd).toContain("`/sdd-spec`");
    expect(prd).not.toContain("{{");
  });
});

describe("upgrade", () => {
  let pkg: string;
  let target: string;
  const skill = () => path.join(target, ".claude", "skills", "sdd-spec", "SKILL.md");
  const asset = (...parts: string[]) => path.join(pkg, "assets", "ko", ...parts);
  const run = (version = "0.2.0") =>
    upgrade({ target, assets: assetsFromDir(path.join(pkg, "assets")), bundlePath: path.join(pkg, "sdd-android.mjs"), version });

  beforeEach(() => {
    pkg = tempDir("pkg");
    fs.writeFileSync(path.join(pkg, "sdd-android.mjs"), "// bundle 1\n");
    target = gitRepo();
    init({ target, language: "ko", prefix: "sdd", assets: assetsFromDir(makeAssets(pkg)), bundlePath: path.join(pkg, "sdd-android.mjs"), version: "0.1.0", homeDir: tempDir("home") });
    // 새 버전의 패키지: 번들과 spec 스킬이 바뀌고, 템플릿 하나가 빠지고 하나가 생긴다.
    fs.writeFileSync(path.join(pkg, "sdd-android.mjs"), "// bundle 2\n");
    fs.writeFileSync(asset("skills", "spec", "SKILL.md"), SKILLS.spec + "새 문단. `/{{skill:blueprint}}`\n");
    fs.rmSync(asset("templates", "research.md"));
    fs.writeFileSync(asset("templates", "glossary.md"), "# 용어집\n");
  });

  it("고치지 않은 파일은 새 버전으로 바꾸고 설정의 접두사를 그대로 쓴다", () => {
    const result = run();
    expect(result).toMatchObject({ from: "0.1.0", to: "0.2.0" });
    expect(result.replaced).toEqual([".sdd-android/bin/sdd-android.mjs", ".claude/skills/sdd-spec/SKILL.md"]);
    expect(result.added).toEqual([".sdd-android/templates/glossary.md"]);
    expect(result.removed).toEqual([".sdd-android/templates/research.md"]);
    expect(fs.readFileSync(skill(), "utf8")).toContain("새 문단. `/sdd-blueprint`");
    expect(fs.existsSync(path.join(target, ".sdd-android", "templates", "research.md"))).toBe(false);

    const manifest = readManifest(target);
    expect(manifest?.version).toBe("0.2.0");
    expect(manifest?.files[".sdd-android/templates/research.md"]).toBeUndefined();
    expect(check(openRepo(target)).ok).toBe(true);
  });

  it("고친 파일은 그대로 두고 새 버전을 옆에 둔다", () => {
    fs.appendFileSync(skill(), "내가 더한 줄\n");
    fs.appendFileSync(path.join(target, ".sdd-android", "templates", "research.md"), "내 메모\n");
    const result = run();
    expect(result.kept).toEqual([{ file: ".claude/skills/sdd-spec/SKILL.md", next: ".claude/skills/sdd-spec/SKILL.md.new" }]);
    expect(result.orphaned).toEqual([".sdd-android/templates/research.md"]);
    expect(fs.readFileSync(skill(), "utf8")).toContain("내가 더한 줄");
    expect(fs.readFileSync(`${skill()}.new`, "utf8")).toContain("새 문단");
    expect(fs.existsSync(path.join(target, ".sdd-android", "templates", "research.md"))).toBe(true);
  });

  it("고쳤지만 새 버전에서 바뀌지 않은 파일에는 아무것도 두지 않는다", () => {
    const blueprint = path.join(target, ".claude", "skills", "sdd-blueprint", "SKILL.md");
    fs.appendFileSync(blueprint, "내가 더한 줄\n");
    const result = run();
    expect(result.kept).toEqual([]);
    expect(fs.existsSync(`${blueprint}.new`)).toBe(false);
  });

  it("없어진 파일은 다시 만들고, 문서와 설정은 건드리지 않는다", () => {
    fs.rmSync(skill());
    const repo = openRepo(target);
    docNew(repo, "prd", undefined, { today: "2026-10-05" });
    const prd = fs.readFileSync(docPath(repo, "prd"), "utf8");
    const config = fs.readFileSync(path.join(target, ".sdd-android", "config.yaml"), "utf8");

    expect(run().restored).toEqual([".claude/skills/sdd-spec/SKILL.md"]);
    expect(fs.readFileSync(docPath(repo, "prd"), "utf8")).toBe(prd);
    expect(fs.readFileSync(path.join(target, ".sdd-android", "config.yaml"), "utf8")).toBe(config);
  });

  it("두 번 올리면 두 번째에는 바뀌는 것이 없다", () => {
    run();
    const again = run();
    expect([again.replaced, again.added, again.removed, again.kept, again.restored].flat()).toEqual([]);
  });

  it("설치 기록이 없거나 낮은 버전으로는 올리지 않는다", () => {
    expect(() => run("0.0.9")).toThrow(/낮은 버전/);
    fs.rmSync(path.join(target, ".sdd-android", "manifest.json"));
    expect(() => run()).toThrow(/init/);
  });

  it("변경 내역에서 설치된 버전 뒤부터 새 버전까지를 뽑는다", () => {
    const log = "# 변경 내역\n\n## 0.3.0\n\n- 셋\n\n## 0.2.0\n\n- 둘\n\n## 0.1.0\n\n- 하나\n";
    expect(changelogBetween(log, "0.1.0", "0.2.0")).toBe("## 0.2.0\n\n- 둘");
    expect(changelogBetween(log, "0.1.0", "0.3.0")).toContain("- 셋");
    expect(changelogBetween(log, "0.1.0", "0.3.0")).not.toContain("- 하나");
    expect(changelogBetween(log, "0.3.0", "0.3.0")).toBe("");
  });
});
