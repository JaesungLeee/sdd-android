import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildAssets, compareLanguages, composeSkill, includedFragments, readText } from "../scripts/build.mjs";
import { check } from "../src/commands/check.js";
import { docChecklist, docComplete, docNew } from "../src/commands/doc.js";
import { init } from "../src/commands/init.js";
import { promptInit } from "../src/commands/init-prompt.js";
import { changelogBetween, upgrade } from "../src/commands/upgrade.js";
import { parseTasks, validateTasks, countTasks } from "../src/core/breakdown.js";
import { readManifest } from "../src/core/manifest.js";
import { docPath, openRepo, Refusal } from "../src/core/repo.js";
import { splitItems } from "../src/core/items.js";
import { applyPrefix } from "../src/core/skilltext.js";

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdd-first-${name}-`));
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
    expect(tasks[3]).toMatchObject({ dropped: true, checked: true });
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
    assetsDir: path.join(pkg, "assets"),
    bundlePath: bundle,
    version: "0.1.0",
    homeDir: home,
  });

  beforeEach(() => {
    pkg = tempDir("pkg");
    makeAssets(pkg);
    bundle = path.join(pkg, "sdd-first.mjs");
    fs.writeFileSync(bundle, "// bundle\n");
    home = tempDir("home");
  });

  it("스킬, 템플릿, 번들, 설정, 설치 기록을 설치한다", () => {
    const target = gitRepo();
    const result = init(options(target));
    expect(result.skills).toEqual(["blueprint", "spec"]);
    expect(result.files).toContain(".claude/skills/spec/SKILL.md");
    expect(result.files).toContain(".sdd-first/bin/sdd-first.mjs");
    expect(fs.readFileSync(path.join(target, ".sdd-first", "config.yaml"), "utf8")).toContain('prefix: ""');

    const manifest = readManifest(target);
    expect(manifest?.version).toBe("0.1.0");
    expect(Object.keys(manifest?.files ?? {})).toEqual([...Object.keys(manifest?.files ?? {})].sort());
    expect(manifest?.files[".sdd-first/templates/prd.md"]?.source).toBe("core");
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
    expect(fs.existsSync(path.join(target, ".sdd-first"))).toBe(false);
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
    expect(result.backedUp).toEqual([{ from: ".claude/skills/spec", to: ".sdd-first/backup/2026-10-04/skills/spec" }]);
    expect(fs.readFileSync(path.join(target, ".sdd-first/backup/2026-10-04/skills/spec/SKILL.md"), "utf8")).toBe("내 스킬\n");
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
    const bundle = path.join(pkg, "sdd-first.mjs");
    fs.writeFileSync(bundle, "// bundle\n");
    target = gitRepo();
    init({ target, language: "ko", prefix: "", assetsDir: makeAssets(pkg), bundlePath: bundle, version: "0.1.0", homeDir: tempDir("home") });
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
    fs.rmSync(path.join(target, ".sdd-first", "templates", "prd.md"));
    const result = check(openRepo(target));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      { level: "warn", where: ".claude/skills/spec/SKILL.md", message: "설치한 뒤 바뀐 파일이다" },
      { level: "error", where: ".sdd-first/templates/prd.md", message: "설치된 파일이 없다" },
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
    fs.copyFileSync(path.join(PROJECT, "dist", "sdd-first.mjs"), path.join(pkg, "sdd-first.mjs"));
    makeAssets(pkg);

    const target = gitRepo();
    const env = { ...process.env, HOME: tempDir("home") };
    const run = (cwd: string, ...args: string[]) =>
      spawnSync(process.execPath, [path.join(pkg, "sdd-first.mjs"), ...args], { cwd, env, encoding: "utf8" });

    expect(run(target, "init").stdout).toContain("설치했다");
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

    // PATH에 node가 없는 셸에서도 실행 스크립트가 node를 찾아 판정을 낸다.
    const fakeHome = tempDir("home");
    fs.mkdirSync(path.join(fakeHome, ".local", "bin"), { recursive: true });
    fs.symlinkSync(process.execPath, path.join(fakeHome, ".local", "bin", "node"));
    const bare = spawnSync("/bin/sh", [path.join(target, ".sdd-first", "bin", "sdd-first"), "gate", "blueprint"], {
      cwd: sub,
      env: { PATH: "/usr/bin:/bin", HOME: fakeHome },
      encoding: "utf8",
    });
    expect(bare.status).toBe(0);
    expect(bare.stdout).toContain("login: 중단");
  });
});

describe("실린 스킬과 템플릿", () => {
  const assets = tempDir("assets");
  const languages = buildAssets(assets);
  const skillsDir = path.join(assets, "ko", "skills");

  const DOC_STAGES = ["constitution", "prd", "spec", "blueprint", "breakdown"];
  const READ_ONLY = ["clarify", "analyze"];

  it("한국어 스킬이 합성되고 채우지 않은 포함 표기가 남지 않는다", () => {
    expect(languages).toContain("ko");
    expect(fs.readdirSync(skillsDir).sort()).toEqual([...DOC_STAGES, ...READ_ONLY].sort());
    for (const name of fs.readdirSync(skillsDir)) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      expect(text, name).not.toContain("{{>");
      expect(text, name).toContain(`name: {{skill:${name}}}`);
      expect(text, name).toContain("allowed-tools: Bash(sh *)");
      expect(text, name).not.toContain("sdd-first.mjs");
    }
  });

  it("문서를 쓰는 단계는 게이트 판정을 주입받고 쓰기 hook을 갖는다", () => {
    for (const name of DOC_STAGES) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      expect(text, name).toContain("hook write");
      expect(text, name).toContain(`.sdd-first/bin/sdd-first" gate ${name}`);
    }
  });

  it("읽기 전용 단계는 hook과 기록 명령의 호출을 갖지 않는다", () => {
    for (const name of READ_ONLY) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      // hook은 스킬이 끝난 뒤에도 세션에 남아, 같은 세션의 다음 단계가 쓰는 것까지 막는다.
      expect(text, name).not.toContain("hooks:");
      expect(text, name).toContain("## 읽기 전용");
      expect(text, name).not.toMatch(/^\s*sdd-first doc (new|complete|revise|confirm|checklist)/m);
    }
    const analyze = fs.readFileSync(path.join(skillsDir, "analyze", "SKILL.md"), "utf8");
    expect(analyze).toContain("context: fork");
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
    const bundle = path.join(pkg, "sdd-first.mjs");
    fs.writeFileSync(bundle, "// bundle\n");
    const target = gitRepo();
    init({ target, language: "ko", prefix: "sdd", assetsDir: assets, bundlePath: bundle, version: "0.1.0", homeDir: tempDir("home") });
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
    upgrade({ target, assetsDir: path.join(pkg, "assets"), bundlePath: path.join(pkg, "sdd-first.mjs"), version });

  beforeEach(() => {
    pkg = tempDir("pkg");
    fs.writeFileSync(path.join(pkg, "sdd-first.mjs"), "// bundle 1\n");
    target = gitRepo();
    init({ target, language: "ko", prefix: "sdd", assetsDir: makeAssets(pkg), bundlePath: path.join(pkg, "sdd-first.mjs"), version: "0.1.0", homeDir: tempDir("home") });
    // 새 버전의 패키지: 번들과 spec 스킬이 바뀌고, 템플릿 하나가 빠지고 하나가 생긴다.
    fs.writeFileSync(path.join(pkg, "sdd-first.mjs"), "// bundle 2\n");
    fs.writeFileSync(asset("skills", "spec", "SKILL.md"), SKILLS.spec + "새 문단. `/{{skill:blueprint}}`\n");
    fs.rmSync(asset("templates", "research.md"));
    fs.writeFileSync(asset("templates", "wiki.md"), "# 위키\n");
  });

  it("고치지 않은 파일은 새 버전으로 바꾸고 설정의 접두사를 그대로 쓴다", () => {
    const result = run();
    expect(result).toMatchObject({ from: "0.1.0", to: "0.2.0" });
    expect(result.replaced).toEqual([".sdd-first/bin/sdd-first.mjs", ".claude/skills/sdd-spec/SKILL.md"]);
    expect(result.added).toEqual([".sdd-first/templates/wiki.md"]);
    expect(result.removed).toEqual([".sdd-first/templates/research.md"]);
    expect(fs.readFileSync(skill(), "utf8")).toContain("새 문단. `/sdd-blueprint`");
    expect(fs.existsSync(path.join(target, ".sdd-first", "templates", "research.md"))).toBe(false);

    const manifest = readManifest(target);
    expect(manifest?.version).toBe("0.2.0");
    expect(manifest?.files[".sdd-first/templates/research.md"]).toBeUndefined();
    expect(check(openRepo(target)).ok).toBe(true);
  });

  it("고친 파일은 그대로 두고 새 버전을 옆에 둔다", () => {
    fs.appendFileSync(skill(), "내가 더한 줄\n");
    fs.appendFileSync(path.join(target, ".sdd-first", "templates", "research.md"), "내 메모\n");
    const result = run();
    expect(result.kept).toEqual([{ file: ".claude/skills/sdd-spec/SKILL.md", next: ".claude/skills/sdd-spec/SKILL.md.new" }]);
    expect(result.orphaned).toEqual([".sdd-first/templates/research.md"]);
    expect(fs.readFileSync(skill(), "utf8")).toContain("내가 더한 줄");
    expect(fs.readFileSync(`${skill()}.new`, "utf8")).toContain("새 문단");
    expect(fs.existsSync(path.join(target, ".sdd-first", "templates", "research.md"))).toBe(true);
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
    const config = fs.readFileSync(path.join(target, ".sdd-first", "config.yaml"), "utf8");

    expect(run().restored).toEqual([".claude/skills/sdd-spec/SKILL.md"]);
    expect(fs.readFileSync(docPath(repo, "prd"), "utf8")).toBe(prd);
    expect(fs.readFileSync(path.join(target, ".sdd-first", "config.yaml"), "utf8")).toBe(config);
  });

  it("두 번 올리면 두 번째에는 바뀌는 것이 없다", () => {
    run();
    const again = run();
    expect([again.replaced, again.added, again.removed, again.kept, again.restored].flat()).toEqual([]);
  });

  it("설치 기록이 없거나 낮은 버전으로는 올리지 않는다", () => {
    expect(() => run("0.0.9")).toThrow(/낮은 버전/);
    fs.rmSync(path.join(target, ".sdd-first", "manifest.json"));
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
