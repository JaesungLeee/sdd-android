import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { check } from "../src/commands/check.js";
import { docNew } from "../src/commands/doc.js";
import { status } from "../src/commands/status.js";
import { countPrinciples, parsePrinciples, verifyToolCheck } from "../src/core/principles.js";
import { docPath, openRepo, type Repo } from "../src/core/repo.js";

const CONSTITUTION = `# 헌법

## 핵심 원칙

### [P-001] 로그는 GCLog로 남긴다

\`android.util.Log\`를 직접 쓰지 않는다.

**근거**: 사람의 결정
**검사**: detekt \`ForbiddenImport\` (config/detekt.yml)

### [P-002] UI 계층은 data 구현체를 가져다 쓰지 않는다

**근거**: 사람의 결정
**검사**: konsist \`ui does not import data\` (konsist/src/test/kotlin/LayerTest.kt)
**검사**: ktlint \`standard:filename\` (.editorconfig)

### [P-003] 화면 상태는 단방향으로 흐른다

**근거**: 사람의 결정
**검사**: 감사

### [P-004] 테스트 우선

**근거**: 사람의 결정

## 거버넌스

- **검사**: 이것은 원칙 밖이라 보지 않는다
`;

let repo: Repo;

function write(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo.root, rel), text);
}

function messages(): string[] {
  return check(repo).problems.map((problem) => problem.message);
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mob-sdd-principles-"));
  fs.mkdirSync(path.join(root, ".mob-sdd", "templates"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mob-sdd", "config.yaml"), "language: ko\ndocs_dir: docs\n");
  fs.writeFileSync(path.join(root, ".mob-sdd", "manifest.json"), JSON.stringify({ version: "0.5.0", files: {} }));
  fs.writeFileSync(path.join(root, ".mob-sdd", "templates", "constitution.md"), CONSTITUTION);
  repo = openRepo(root);
  docNew(repo, "constitution", undefined, { today: "2026-11-05" });
});

describe("원칙의 검사 줄", () => {
  it("원칙마다 도구의 규칙, 감사, 미지정을 읽고 원칙 밖의 줄은 보지 않는다", () => {
    const principles = parsePrinciples(CONSTITUTION);
    expect(principles.map((principle) => [principle.id, principle.tools.map((tool) => tool.tool), principle.audit])).toEqual([
      ["P-001", ["detekt"], false],
      ["P-002", ["konsist", "ktlint"], false],
      ["P-003", [], true],
      ["P-004", [], false],
    ]);
    expect(principles[0]?.tools[0]).toEqual({ tool: "detekt", rule: "ForbiddenImport", file: "config/detekt.yml" });
    expect(principles[0]?.title).toBe("로그는 GCLog로 남긴다");
    expect(countPrinciples(principles)).toEqual({ total: 4, tool: 2, audit: 1, unspecified: 1 });
  });

  it("형식에 맞지 않는 검사 줄을 따로 모은다", () => {
    const [principle] = parsePrinciples("### [P-001] 하나\n\n**검사**: detekt ForbiddenImport\n");
    expect(principle?.malformed).toEqual(["detekt ForbiddenImport"]);
  });

  it("YAML 설정은 규칙이 키로 있어야 하고 active: false면 꺼진 것이다", () => {
    const rule = { tool: "detekt", rule: "ForbiddenImport", file: "config/detekt.yml" };
    expect(verifyToolCheck(repo, rule)).toMatch(/설정 파일이 없다/);
    write("config/detekt.yml", "style:\n  # ForbiddenImport는 아래에\n  MagicNumber:\n    active: true\n");
    expect(verifyToolCheck(repo, rule)).toMatch(/규칙이 설정에 없다/);
    write("config/detekt.yml", "style:\n  ForbiddenImport:\n    active: false\n");
    expect(verifyToolCheck(repo, rule)).toMatch(/꺼져 있다/);
    write("config/detekt.yml", "style:\n  ForbiddenImport:\n    active: true\n    imports: ['android.util.Log']\n");
    expect(verifyToolCheck(repo, rule)).toBeUndefined();
  });

  it("그 밖의 파일은 규칙 이름이 글자로 있어야 하고 disabled 줄이 있으면 꺼진 것이다", () => {
    const rule = { tool: "ktlint", rule: "standard:filename", file: ".editorconfig" };
    write(".editorconfig", "[*.kt]\nktlint_standard_filename = disabled\nktlint_standard:filename = disabled\n");
    expect(verifyToolCheck(repo, rule)).toMatch(/꺼져 있다/);
    write(".editorconfig", "[*.kt]\n# standard:filename 은 켠다\n");
    expect(verifyToolCheck(repo, rule)).toBeUndefined();
    expect(verifyToolCheck(repo, { tool: "konsist", rule: "ui does not import data", file: ".editorconfig" })).toMatch(/규칙이 설정에 없다/);
  });

  it("check가 설정에 없는 규칙을 오류로 알리고, 모두 있으면 통과한다", () => {
    expect(messages()).toEqual([
      "P-001의 detekt 검사: 설정 파일이 없다: config/detekt.yml",
      "P-002의 konsist 검사: 설정 파일이 없다: konsist/src/test/kotlin/LayerTest.kt",
      "P-002의 ktlint 검사: 설정 파일이 없다: .editorconfig",
    ]);
    write("config/detekt.yml", "style:\n  ForbiddenImport:\n    active: true\n");
    write("konsist/src/test/kotlin/LayerTest.kt", 'class LayerTest {\n  @Test fun `ui does not import data`() {}\n}\n');
    write(".editorconfig", "[*.kt]\nktlint_standard_filename = enabled # standard:filename\n");
    expect(messages()).toEqual([]);
    expect(check(repo).ok).toBe(true);

    const file = docPath(repo, "constitution");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("**검사**: 감사", "**검사**: 감사함"));
    expect(messages()).toEqual(['P-003의 검사 줄이 형식에 맞지 않는다: "감사함". 도구 `규칙` (설정 파일)이나 감사로 적는다']);
  });

  it("도구로 검사하는 원칙이 있는데 돌릴 명령이 없으면 알린다", () => {
    write("config/detekt.yml", "style:\n  ForbiddenImport:\n    active: true\n");
    write("konsist/src/test/kotlin/LayerTest.kt", "ui does not import data\n");
    write(".editorconfig", "standard:filename\n");
    const config = path.join(repo.root, ".mob-sdd", "config.yaml");
    fs.writeFileSync(config, 'language: ko\ndocs_dir: docs\nimpl:\n  checks:\n    build: "b"\n    lint: none\n    test: "t"\n');
    expect(messages()).toEqual(["도구로 검사하는 원칙이 있는데 구현 단계가 돌릴 명령이 없다(lint가 none이고 rules가 없다). 규칙은 설정에 있어도 검사가 돌지 않는다"]);
    fs.writeFileSync(config, fs.readFileSync(config, "utf8") + '    rules: "./gradlew :konsist:test"\n');
    expect(messages()).toEqual([]);
  });

  it("status가 원칙을 무엇이 판정하는지 센다", () => {
    expect(status(repo).principles).toEqual({ total: 4, tool: 2, audit: 1, unspecified: 1 });
  });
});
