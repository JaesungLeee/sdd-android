import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { check } from "../src/commands/check.js";
import { docChecklist, docComplete, docNew, docRevise } from "../src/commands/doc.js";
import { gateAll, implementGate } from "../src/commands/gate.js";
import {
  failuresPath,
  implAssign,
  implAttempt,
  implCheck,
  implFinal,
  implNext,
  implReport,
  implReset,
  implShow,
  implStart,
  implTry,
  implVerify,
  parseChecks,
  type Exec,
} from "../src/commands/impl.js";
import { implSetup, readImplChecks } from "../src/core/impl-config.js";
import { detectProject } from "../src/core/detect.js";
import { fixCheck, formatFixCheck } from "../src/commands/fix.js";
import { status } from "../src/commands/status.js";
import { matchTasks, parseTasks, setChecked, splitUnits, validateTasks } from "../src/core/breakdown.js";
import { checkpointPath, readCheckpoint, writeCheckpoint } from "../src/core/checkpoint.js";
import { docPath, loadDoc, openRepo, Refusal, type Repo } from "../src/core/repo.js";

const BREAKDOWN = `# 작업 목록

## 셋업

- [ ] T001 모듈 골격 \`feature/login/build.gradle.kts\`

## US1

- [ ] T002 [P] [US1] [until:T004] 로그인 테스트 \`domain/src/test/LoginTest.kt\`
- [ ] T003 [P] [US1] 사용자 모델 \`domain/src/main/model/User.kt\`
- [ ] T004 [US1] 로그인 유스케이스 \`domain/src/main/usecase/\`

## US2

- [ ] T005 [US2] 화면 \`feature/login/src/main/LoginScreen.kt\`

## 마무리

- [ ] T006 배선 \`app/src/main/Nav.kt\`

## 마지막 확인

- [ ] FINAL 마지막 확인
`;

const TEMPLATES: Record<string, string> = {
  spec: "# 스펙\n\n요구사항\n",
  checklist: "# 체크리스트\n\n- [x] 하나\n",
  blueprint: "# 설계\n\n설계 내용\n",
  research: "# 리서치\n",
  breakdown: BREAKDOWN,
};

let repo: Repo;
let day = 1;
const today = () => `2026-10-${String(day++).padStart(2, "0")}`;
const F = "login";

function body(): string {
  return loadDoc(repo, "breakdown", F)?.body ?? "";
}

function checked(id: string): boolean {
  return parseTasks(body()).find((task) => task.id === id)?.checked ?? false;
}

function buildChain(): void {
  docNew(repo, "spec", F, { today: today() });
  docChecklist(repo, F);
  docComplete(repo, "spec", F, { today: today() });
  docNew(repo, "blueprint", F, { today: today() });
  docComplete(repo, "blueprint", F, { today: today() });
  docNew(repo, "breakdown", F, { today: today() });
  docComplete(repo, "breakdown", F, { today: today() });
}

function start(): void {
  implStart(repo, F, { today: today() });
  implAssign(repo, F, ["T001=structure", "T002=test", "T003=logic", "T004=logic", "T005=ui", "T006=structure"]);
}

type Outcome = Partial<Record<"build" | "lint" | "test" | "rules", "pass" | "fail">>;

/** 돌린 명령. 시험의 설정에서 명령의 첫 낱말이 검사의 이름이다. */
let ran: string[] = [];

/** CLI가 기계 검사를 돌린다. 명령 대신 정해 둔 종료 코드를 돌려준다. */
function run(id: string | undefined, outcome: Outcome = {}) {
  const exec: Exec = (command, _cwd, log) => {
    ran.push(command);
    const kind = command.split(" ")[0] as keyof Outcome;
    fs.writeSync(log, outcome[kind] === "fail" ? `e: file:///x/${kind}.kt:1:1 ${kind} 오류\n` : "BUILD SUCCESSFUL\n");
    return outcome[kind] === "fail" ? 1 : 0;
  };
  return implCheck(repo, F, id, { exec });
}

/** 작업을 끝내고 CLI가 돌린 검사를 통과시킨 뒤 판정한다. 디자인처럼 기계 검사가 아닌 결과는 인자로 준다. */
function finish(id: string, checks: string[] = []): void {
  implReport(repo, F, id, { today: today(), status: "done", modules: ["m"], files: [] });
  run(id);
  implVerify(repo, F, id, { today: today(), checks: parseChecks(checks) });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-android-impl-"));
  fs.mkdirSync(path.join(root, ".sdd-android", "templates"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".sdd-android", "config.yaml"),
    'language: ko\ndocs_dir: docs\nimpl:\n  checks:\n    build: "build {module}"\n    lint: "lint {module}"\n    test: "test {module} {tests}"\n',
  );
  fs.writeFileSync(path.join(root, ".sdd-android", "manifest.json"), JSON.stringify({ version: "0.3.0", files: {} }));
  for (const [name, text] of Object.entries(TEMPLATES)) fs.writeFileSync(path.join(root, ".sdd-android", "templates", `${name}.md`), text);
  repo = openRepo(root);
  day = 1;
  ran = [];
  buildChain();
});

describe("breakdown의 계산", () => {
  it("체크를 올리고 내려도 다른 글자는 그대로다", () => {
    const raised = setChecked(BREAKDOWN, ["T001", "FINAL"], true);
    expect(raised).toContain("- [x] T001 모듈 골격");
    expect(raised).toContain("- [x] FINAL 마지막 확인");
    expect(setChecked(raised, ["T001"], false)).toBe(setChecked(BREAKDOWN, ["FINAL"], true));
  });

  it("단위는 스토리의 첫 작업 앞에서 나누고, 스토리 밖 작업은 다음 스토리에 들어간다", () => {
    const units = splitUnits(parseTasks(BREAKDOWN)).map((unit) => [unit.name, unit.tasks.map((task) => task.id)]);
    expect(units).toEqual([
      ["US1", ["T001", "T002", "T003", "T004"]],
      ["US2", ["T005"]],
      ["tail", ["T006"]],
    ]);
  });

  it("파일은 가장 긴 경로로 맞은 작업에 대응한다", () => {
    const tasks = parseTasks(
      "- [ ] T001 전체 `domain/`\n- [ ] T002 하나 `domain/src/main/usecase/`\n- [ ] T003 파일 `domain/src/main/usecase/Login.kt`\n- [ ] T004 같은 파일 `domain/src/main/usecase/Login.kt`\n- [ ] FINAL 끝\n",
    );
    expect(matchTasks(tasks, "domain/src/main/usecase/Login.kt").map((task) => task.id)).toEqual(["T003", "T004"]);
    expect(matchTasks(tasks, "domain/src/main/usecase/Other.kt").map((task) => task.id)).toEqual(["T002"]);
    expect(matchTasks(tasks, "./domain/src/test/X.kt").map((task) => task.id)).toEqual(["T001"]);
    expect(matchTasks(tasks, "app/Main.kt")).toEqual([]);
  });
});

describe("착수 게이트와 체크포인트", () => {
  it("breakdown이 완료되어 있으면 통과하고 체크포인트에 버전을 적는다", () => {
    const result = implStart(repo, F, { today: today() });
    expect(result.action).toBe("pass");
    expect(result.resumed).toBe(false);
    expect(result.versions).toEqual({ spec: "1.0.0", blueprint: "1.0.0", breakdown: "1.0.0" });
    expect(fs.existsSync(checkpointPath(repo, F))).toBe(true);
    expect(fs.readFileSync(path.join(repo.root, ".sdd-android", "impl", ".gitignore"), "utf8")).toBe("*\n");
    expect(gateAll(repo, "implement")[0]).toMatchObject({ stage: "implement", mode: "resume", confirmed: true });
  });

  it("breakdown이 없거나 draft이면 막는다", () => {
    const G = "other";
    docNew(repo, "spec", G, { today: today() });
    docChecklist(repo, G);
    docComplete(repo, "spec", G, { today: today() });
    docNew(repo, "blueprint", G, { today: today() });
    docComplete(repo, "blueprint", G, { today: today() });
    expect(() => implStart(repo, G, { today: today() })).toThrow(/breakdown이 없다/);
    expect(implementGate(repo, G)).toMatchObject({ action: "block", mode: "new" });
    docNew(repo, "breakdown", G, { today: today() });
    expect(() => implStart(repo, G, { today: today() })).toThrow(/중단/);
    expect(implementGate(repo, G).reasons[0]?.verdict).toBe("upper-draft");
  });

  it("실행 도중 상위가 MINOR 개정되면 확인 필요이고, 승인하면 버전을 갱신한다", () => {
    start();
    const file = docPath(repo, "blueprint", F);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8") + "\n더 쓴 설계\n");
    docRevise(repo, "blueprint", F, { today: today(), grade: "minor" });
    expect(implementGate(repo, F)).toMatchObject({ action: "confirm", confirmed: false });
    expect(() => implStart(repo, F, { today: today() })).toThrow(/확인 필요/);
    // breakdown을 영향 없음으로 맞춘 뒤에는 다시 통과한다. 여기서는 승인만으로 간다.
    const result = implStart(repo, F, { today: today(), acknowledged: true });
    expect(result.checkpoint.started.decision).toBe("acknowledged");
    expect(result.checkpoint.assignments.T001).toBe("structure");
  });

  it("검사 명령이 설정되어 있지 않으면 시작하지 않고, setup은 Lint만 사람이 고르게 한다", () => {
    const file = path.join(repo.root, ".sdd-android", "config.yaml");
    fs.writeFileSync(file, "language: ko\ndocs_dir: docs # 문서\n");
    expect(() => implStart(repo, F, { today: today() })).toThrow(/검사 명령이 설정되어 있지 않다: build, lint, test.*impl setup/);
    expect(() => implSetup(repo, {})).toThrow(/--lint none/);
    expect(() => implSetup(repo, { build: "none", lint: "none" })).toThrow(/건너뛸 수 없다/);

    const result = implSetup(repo, { lint: "./gradlew {module}:detekt" });
    expect(result.checks).toEqual({
      build: "./gradlew {module}:compileDebugKotlin",
      lint: "./gradlew {module}:detekt",
      test: "./gradlew {module}:testDebugUnitTest {tests}",
    });
    expect(fs.readFileSync(file, "utf8")).toContain("docs_dir: docs # 문서");
    // 다시 부르면 준 것만 바꾼다
    expect(implSetup(repo, { test: "./gradlew {module}:test {tests}" }).changed).toEqual(["test"]);
    expect(implStart(repo, F, { today: today() }).action).toBe("pass");

    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("test: ./gradlew {module}:test {tests}", "test: none"));
    expect(check(repo).problems.map((problem) => problem.message)).toContain("impl.checks.test: none은 lint에만 쓴다. 빌드와 테스트는 건너뛸 수 없다");
    expect(() => implStart(repo, F, { today: today() })).toThrow(/형식에 맞지 않는다/);
  });

  it("setup은 Gradle 설정에서 Lint 도구, 규칙 도구, flavor를 찾아 제안만 하고 적지는 않는다", () => {
    const file = path.join(repo.root, ".sdd-android", "config.yaml");
    fs.writeFileSync(file, "language: ko\ndocs_dir: docs\n");
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo.root, rel), text);
    };
    write("build.gradle.kts", 'plugins {\n  id("io.gitlab.arturbosch.detekt") version "1.23.6" apply false\n}\n');
    write("app/build.gradle.kts", 'android {\n  flavorDimensions += "env"\n  productFlavors {\n    create("prod") { dimension = "env" }\n    create("dev") { dimension = "env" }\n  }\n}\n');
    write("core/domain/build.gradle", "android {\n  productFlavors {\n    free {\n      dimension 'tier'\n    }\n    paid { }\n  }\n}\n");
    write("konsist/build.gradle.kts", "dependencies {\n  testImplementation(libs.konsist)\n}\n");
    write("build-logic/convention/src/main/kotlin/Flavors.kt", 'fun configure() { productFlavors { create("staging") {} } }\n');
    write("app/build/generated/x.gradle.kts", 'plugins { id("org.jlleitschuh.gradle.ktlint") }\n');
    write("core/model/build.gradle.kts", 'plugins {\n  kotlin("jvm")\n}\n');
    write("core/common/build.gradle", "plugins {\n  id 'org.jetbrains.kotlin.jvm'\n}\n");
    write("build-logic/convention/build.gradle.kts", "plugins {\n  alias(libs.plugins.kotlin.jvm)\n}\n");
    write("build-logic/convention/src/main/kotlin/JvmLibrary.kt", 'class JvmLibrary { fun apply() { pluginManager.apply("org.jetbrains.kotlin.jvm") } }\n');

    const detected = detectProject(repo.root);
    expect(detected.lint).toEqual([{ tool: "detekt", file: "build.gradle.kts", command: "./gradlew {module}:detekt" }]);
    expect(detected.rules).toEqual([{ tool: "konsist", file: "konsist/build.gradle.kts", command: "./gradlew :konsist:test" }]);
    expect(detected.flavors).toEqual([
      { module: ":app", file: "app/build.gradle.kts", names: ["prod", "dev"] },
      { module: "", file: "build-logic/convention/src/main/kotlin/Flavors.kt", names: ["staging"] },
      { module: ":core:domain", file: "core/domain/build.gradle", names: ["free", "paid"] },
    ]);
    // build-logic 자신의 빌드 스크립트는 모듈이 아니라 보지 않는다.
    expect(detected.jvm).toEqual([
      { module: "", file: "build-logic/convention/src/main/kotlin/JvmLibrary.kt" },
      { module: ":core:common", file: "core/common/build.gradle" },
      { module: ":core:model", file: "core/model/build.gradle.kts" },
    ]);

    // Lint가 없으면 거부하면서 찾은 도구를 알려 준다. 적은 것은 없다.
    expect(() => implSetup(repo, {})).toThrow(/detekt\(build\.gradle\.kts\)를 찾았다\. 그 도구를 쓰면 --lint "\.\/gradlew \{module\}:detekt"/);
    expect(fs.readFileSync(file, "utf8")).toBe("language: ko\ndocs_dir: docs\n");

    const notes = implSetup(repo, { lint: "./gradlew {module}:ktlintCheck" }).notes.join("\n");
    expect(notes).toContain("Lint 명령이 프로젝트에서 찾은 detekt(build.gradle.kts)를 돌리지 않는 것 같다");
    expect(notes).toContain('--rules "./gradlew :konsist:test"');
    expect(notes).toContain(':app에 flavor(prod, dev)가 있다');
    expect(notes).toContain('":app": "./gradlew {module}:compileProdDebugKotlin"');
    expect(notes).toContain('":app": "./gradlew {module}:testProdDebugUnitTest {tests}"');
    expect(notes).toContain('":core:domain": "./gradlew {module}:compileFreeDebugKotlin"');
    expect(notes).toContain("컨벤션 플러그인(build-logic/convention/src/main/kotlin/Flavors.kt)에 flavor(staging)가 있다");
    expect(notes).toContain(":core:model 모듈은 Android가 아닌 Kotlin/JVM 모듈이다(core/model/build.gradle.kts)");
    expect(notes).toContain("컨벤션 플러그인(build-logic/convention/src/main/kotlin/JvmLibrary.kt)이 Kotlin/JVM 모듈을 만든다");
    // 모듈마다의 제안은 붙여 넣을 묶음 하나로 모인다
    const snippet = notes.slice(notes.indexOf("위 모듈의 명령을"));
    expect(snippet).toContain('      build:\n        "*": "./gradlew {module}:compileDebugKotlin"\n        ":app": "./gradlew {module}:compileProdDebugKotlin"\n        ":core:domain": "./gradlew {module}:compileFreeDebugKotlin"\n        ":core:common": "./gradlew {module}:compileKotlin"\n        ":core:model": "./gradlew {module}:compileKotlin"');
    expect(snippet).toContain('":core:model": "./gradlew {module}:test {tests}"');
    expect(snippet.match(/      build:/g)).toHaveLength(1);
    // 제안은 적지 않는다
    expect(readImplChecks(repo)?.build).toBe("./gradlew {module}:compileDebugKotlin");

    // 모듈마다 적고 찾은 도구를 쓰면 그 제안은 사라진다
    fs.writeFileSync(
      file,
      'language: ko\ndocs_dir: docs\nimpl:\n  checks:\n    build:\n      "*": "./gradlew {module}:compileDebugKotlin"\n      ":app": "./gradlew {module}:compileProdDebugKotlin"\n    lint: "./gradlew {module}:detekt"\n    test:\n      "*": "./gradlew {module}:testDebugUnitTest {tests}"\n      ":app": "./gradlew {module}:testProdDebugUnitTest {tests}"\n',
    );
    const after = implSetup(repo, { rules: "./gradlew :konsist:test" }).notes.join("\n");
    expect(after).not.toContain("Lint 명령이");
    expect(after).not.toContain("--rules");
    expect(after).not.toContain(":app에 flavor");
    expect(after).toContain(":core:domain에 flavor(free, paid)가 있다");
    expect(after).toContain(":core:model 모듈은 Android가 아닌 Kotlin/JVM 모듈이다");
    expect(after).not.toContain('":app": "./gradlew {module}:compileProdDebugKotlin"');
  });

  it("배정은 모든 작업을 덮어야 하고 연결 표기가 있는 작업은 test여야 한다", () => {
    implStart(repo, F, { today: today() });
    expect(() => implAssign(repo, F, ["T001=structure"])).toThrow(/배정이 없는 작업/);
    expect(() => implAssign(repo, F, ["T002=logic"])).toThrow(/test여야/);
    expect(() => implAssign(repo, F, ["T001=screen"])).toThrow(/종류는/);
    expect(() => implAssign(repo, F, ["T009=logic"])).toThrow(/없거나 폐기된/);
    expect(implNext(repo, F).unassigned).toEqual(["T001", "T002", "T003", "T004", "T005", "T006"]);
  });

  it("이미 체크된 작업에도 종류가 있어야 한다. 뒤의 검증이 체크를 내릴 수 있다", () => {
    const file = docPath(repo, "breakdown", F);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("- [ ] T001", "- [x] T001"));
    implStart(repo, F, { today: today() });
    expect(() => implAssign(repo, F, ["T002=test", "T003=logic", "T004=logic", "T005=ui", "T006=structure"])).toThrow(/T001/);
    // 거부된 배정은 기록되지 않는다.
    expect(implNext(repo, F).unassigned).toContain("T001");
    implAssign(repo, F, ["T001=structure", "T002=test", "T003=logic", "T004=logic", "T005=ui", "T006=structure"]);
    expect(implNext(repo, F).unassigned).toEqual([]);
  });
});

describe("작업의 진행", () => {
  beforeEach(start);

  it("다음 작업은 문서 순서의 첫 미완료 작업이고 단위와 테스트 가능 여부를 함께 준다", () => {
    const next = implNext(repo, F);
    expect(next.task).toMatchObject({ id: "T001", kind: "structure", phase: "create" });
    expect(next.unit).toBe("US1");
    expect(next.unitEnd).toBe(false);
    expect(readCheckpoint(repo, F)?.current).toEqual({ task: "T001", phase: "create" });
  });

  it("구현 보고만으로는 체크되지 않고, 검증이 다 모이면 체크된다", () => {
    const report = implReport(repo, F, "T001", { today: today(), status: "done", modules: ["feature"], files: ["feature/login/build.gradle.kts"] });
    expect(report.required).toEqual(["build", "lint"]);
    expect(checked("T001")).toBe(false);

    // 통과는 인자로 적을 수 없고, CLI가 돌린 결과가 없으면 판정할 것이 없다
    expect(() => implVerify(repo, F, "T001", { today: today(), checks: { build: "pass" } })).toThrow(/impl check/);
    expect(() => implVerify(repo, F, "T001", { today: today(), checks: {} })).toThrow(/검사 결과가 없다/);
    expect(checked("T001")).toBe(false);

    expect(run("T001").runs.map((done) => [done.kind, done.result])).toEqual([["build", "pass"], ["lint", "pass"]]);
    expect(ran).toEqual(["build feature", "lint feature"]);
    expect(checked("T001")).toBe(false);
    const full = implVerify(repo, F, "T001", { today: today(), checks: {} });
    expect(full.raised).toEqual(["T001"]);
    expect(readCheckpoint(repo, F)?.tasks.T001?.runs).toBeUndefined();
    expect(checked("T001")).toBe(true);
    expect(readCheckpoint(repo, F)?.current).toBeUndefined();
    expect(loadDoc(repo, "breakdown", F)?.unrecorded).toBe(false);
    expect(check(repo).ok).toBe(true);
  });

  it("테스트 작업은 검증 대기로 두었다가 연결된 구현 작업의 테스트가 통과하면 함께 체크된다", () => {
    finish("T001");
    const report = implReport(repo, F, "T002", { today: today(), status: "done" });
    expect(report.waiting).toBe(true);
    expect(checked("T002")).toBe(false);

    finish("T003");
    expect(checked("T003")).toBe(true);
    expect(checked("T002")).toBe(false);

    const next = implNext(repo, F);
    expect(next.task?.id).toBe("T004");
    expect(next.testable).toEqual(["T002"]);
    expect(next.unitEnd).toBe(true);

    implReport(repo, F, "T004", { today: today(), status: "done", modules: ["m"] });
    expect(implReport(repo, F, "T004", { today: today(), status: "done" }).required).toEqual(["build", "lint", "test"]);
    const checked4 = run("T004", { test: "fail" });
    // 테스트는 연결된 테스트 작업의 클래스만 돌린다. 테스트 작업이 모듈을 보고하지 않았으면 구현 작업의 모듈이다
    expect(checked4.runs.map((done) => done.commands[0])).toEqual(["build m", "lint m", "test m --tests '*LoginTest'"]);
    expect(checked4.runs[2]?.summary).toEqual(["e: file:///x/test.kt:1:1 test 오류"]);
    const failed = implVerify(repo, F, "T004", { today: today(), checks: {} });
    expect(failed.redo).toEqual([{ id: "T002", kind: "test", failure: "test" }]);
    expect(checked("T004")).toBe(false);

    implAttempt(repo, F, "T002", { today: today(), failure: "test", symptom: "assert 실패", note: "비교 연산자; 고침" });
    run("T004");
    const passed = implVerify(repo, F, "T004", { today: today(), checks: {} });
    expect(passed.raised).toEqual(["T004", "T002"]);
    expect(checked("T002")).toBe(true);
    expect(readCheckpoint(repo, F)?.waiting).toEqual([]);
    expect(readCheckpoint(repo, F)?.tasks.T002?.attempts?.test?.rounds[0]?.result).toBe("pass");
  });

  it("내려간 작업은 다시 만들지 않고 다시 검증한다. 테스트 작업이 내려가면 대기로 돌아가고 구현 작업의 게이트에 다시 든다", () => {
    for (const id of ["T001", "T003"]) finish(id);
    implReport(repo, F, "T002", { today: today(), status: "done" });
    finish("T004");
    finish("T005", ["design=skip"]);
    finish("T006");
    expect(checked("T002") && checked("T004")).toBe(true);
    implVerify(repo, F, undefined, { today: today(), unit: "US1", checks: { principles: "pass", design: "skip" } });
    expect(readCheckpoint(repo, F)?.units.US1).toBeDefined();

    // 마지막 확인의 테스트 실패가 테스트 파일을 가리킨다. 그 작업이 속한 단위의 검증 기록도 지워진다
    const failed = implFinal(repo, F, { today: today(), result: "fail", failure: "test", symptom: "기대값", files: ["domain/src/test/LoginTest.kt"] });
    expect(failed.lowered.sort()).toEqual(["T002", "T004"]);
    expect(readCheckpoint(repo, F)?.units.US1).toBeUndefined();
    expect(checked("T002") || checked("T004")).toBe(false);
    expect(readCheckpoint(repo, F)?.waiting).toEqual(["T002"]);
    expect(readCheckpoint(repo, F)?.tasks.T004?.status).toBe("done");

    // 이어서 실행하면 구현 작업의 verify 단계부터이고, 게이트에 테스트가 다시 든다
    const next = implNext(repo, F);
    expect(next.task?.id).toBe("T004");
    expect(next.task?.phase).toBe("verify");
    expect(next.testable).toEqual(["T002"]);
    expect(run("T004", { test: "fail" }).runs.map((done) => done.kind)).toEqual(["build", "lint", "test"]);
    const again = implVerify(repo, F, "T004", { today: today(), checks: {}, files: ["domain/src/test/LoginTest.kt"] });
    expect(again.redo).toEqual([{ id: "T002", kind: "test", failure: "test" }]);
    run("T004");
    expect(implVerify(repo, F, "T004", { today: today(), checks: {} }).raised).toEqual(["T004", "T002"]);
    expect(readCheckpoint(repo, F)?.waiting).toEqual([]);
  });

  it("검증 대기인 테스트 작업은 직접 검증할 수 없다", () => {
    finish("T001");
    implReport(repo, F, "T002", { today: today(), status: "done" });
    expect(() => implVerify(repo, F, "T002", { today: today(), checks: { build: "fail" } })).toThrow(/검증 대기/);
    expect(() => run("T002")).toThrow(/검증 대기/);
  });

  it("단위 검증의 실패는 파일로 작업을 찾아 체크를 내리고, 통과는 단위에 적힌다", () => {
    finish("T001");
    implReport(repo, F, "T002", { today: today(), status: "done" });
    finish("T003");
    finish("T004");
    expect(implNext(repo, F).task?.id).toBe("T005");
    expect(implNext(repo, F).pendingUnit).toBe("US1");

    const failed = implVerify(repo, F, undefined, {
      today: today(),
      unit: "US1",
      checks: { principles: "fail" },
      files: ["domain/src/main/model/User.kt", "app/Other.kt"],
    });
    expect(failed.lowered).toEqual(["T003"]);
    expect(failed.redo).toEqual([{ id: "T003", kind: "logic", failure: "principles" }]);
    expect(failed.unmatched).toEqual(["app/Other.kt"]);
    // 작업 없는 실패는 오케스트레이터가 멈추고 사람에게 넘기므로 그 자리에서 적힌다.
    const failures = fs.readFileSync(failuresPath(repo, F), "utf8");
    expect(failures).toContain("작업 없음 · 원칙 · 사람에게 넘김");
    expect(failures).toContain("단위 US1의 검증에서 어느 작업의 경로에도 맞지 않는 파일이 실패했다");
    expect(failures).toContain("- **파일**: `app/Other.kt`");
    expect(failures).not.toContain("T003 · 원칙");
    expect(checked("T003")).toBe(false);
    expect(checked("T004")).toBe(true);
    expect(implNext(repo, F).task?.id).toBe("T003");

    implAttempt(repo, F, "T003", { today: today(), failure: "principles", symptom: "계층 위반", note: "data 의존 제거" });
    finish("T003");
    const passed = implVerify(repo, F, undefined, { today: today(), unit: "US1", checks: { principles: "pass" } });
    expect(passed.unit).toBe("US1");
    expect(implNext(repo, F).pendingUnit).toBeUndefined();
    expect(implShow(repo, F).units[0]).toMatchObject({ name: "US1", done: true, verified: true });
  });

  it("같은 실패의 네 번째 시도를 거부하고 사람에게 넘긴다. 통과해도 횟수는 그대로다", () => {
    implReport(repo, F, "T001", { today: today(), status: "done", modules: ["m"] });
    const attempt = (note: string) => implAttempt(repo, F, "T001", { today: today(), failure: "build", symptom: "컴파일 오류", note });
    expect(attempt("import 누락").round).toBe(1);
    implVerify(repo, F, "T001", { today: today(), checks: { build: "fail" } });
    attempt("타입 불일치");
    // 빌드는 통과했지만 Lint가 남아 체크는 오르지 않는다
    run("T001", { lint: "fail" });
    implVerify(repo, F, "T001", { today: today(), checks: {} });
    // 빌드를 고친 수정이 다시 깨뜨려도 횟수는 이어진다.
    implVerify(repo, F, "T001", { today: today(), checks: { build: "fail" } });
    expect(attempt("null 안전성").remaining).toBe(0);
    expect(() => attempt("또 다른 원인")).toThrow(/3회를 넘었다/);

    const checkpoint = readCheckpoint(repo, F);
    expect(checkpoint?.handed).toEqual(["T001"]);
    expect(checkpoint?.tasks.T001?.attempts?.build?.rounds.map((round) => round.result)).toEqual(["fail", "pass", undefined]);
    const failures = fs.readFileSync(failuresPath(repo, F), "utf8");
    expect(failures).toContain("T001 · 빌드 · 사람에게 넘김");
    expect(failures).toContain("1. import 누락 → 실패");
    expect(failures).toContain("2. 타입 불일치 → 통과");
    expect(failures).toContain("3. null 안전성 → 미검증");

    expect(implNext(repo, F).task).toMatchObject({ id: "T001", handed: true });
    expect(implReset(repo, F, "T001").cleared).toEqual(["build"]);
    expect(readCheckpoint(repo, F)?.handed).toEqual([]);
    expect(attempt("다시").round).toBe(1);
  });

  it("두 번 이상 시도한 끝에 치유된 실패를 기록한다", () => {
    implReport(repo, F, "T001", { today: today(), status: "done", modules: ["m"] });
    implAttempt(repo, F, "T001", { today: today(), failure: "lint", symptom: "줄 길이", note: "줄 나눔" });
    implVerify(repo, F, "T001", { today: today(), checks: { lint: "fail" } });
    implAttempt(repo, F, "T001", { today: today(), failure: "lint", note: "포맷터 실행" });
    run("T001");
    const result = implVerify(repo, F, "T001", { today: today(), checks: {} });
    expect(result.healed).toEqual(["lint"]);
    expect(fs.readFileSync(failuresPath(repo, F), "utf8")).toContain("T001 · Lint · 치유됨");
  });

  it("한 번에 치유된 실패와 막힘은 기록하지 않는다", () => {
    implReport(repo, F, "T001", { today: today(), status: "done", modules: ["m"] });
    implAttempt(repo, F, "T001", { today: today(), failure: "build", symptom: "x", note: "y" });
    run("T001");
    implVerify(repo, F, "T001", { today: today(), checks: {} });
    expect(implReport(repo, F, "T003", { today: today(), status: "blocked" }).status).toBe("blocked");
    expect(fs.existsSync(failuresPath(repo, F))).toBe(false);
  });

  it("범위를 넘어 사람에게 넘긴 실패를 기록한다", () => {
    implReport(repo, F, "T001", { today: today(), status: "handed", failure: "test", symptom: "테스트가 틀렸다", files: ["domain/src/test/LoginTest.kt"] });
    expect(readCheckpoint(repo, F)?.handed).toEqual(["T001"]);
    expect(fs.readFileSync(failuresPath(repo, F), "utf8")).toContain("- **파일**: `domain/src/test/LoginTest.kt`");
    expect(() => implReport(repo, F, "T001", { today: today(), status: "handed" })).toThrow(/--failure/);
  });

  it("UI 작업은 디자인 검사가 있어야 체크되고 건너뜀도 막지 않는다", () => {
    for (const id of ["T001", "T003"]) finish(id);
    implReport(repo, F, "T002", { today: today(), status: "done" });
    finish("T004");
    implReport(repo, F, "T005", { today: today(), status: "done", modules: ["m"] });
    run("T005");
    const partial = implVerify(repo, F, "T005", { today: today(), checks: {} });
    expect(partial.missing).toEqual(["design"]);
    const skipped = implVerify(repo, F, "T005", { today: today(), checks: { design: "skip" } });
    expect(skipped.raised).toEqual(["T005"]);
  });

  it("빌드와 테스트의 건너뜀은 체크를 올리지 못하고, Lint의 건너뜀은 설정의 none으로만 된다", () => {
    implReport(repo, F, "T001", { today: today(), status: "done", modules: ["m"] });
    // 환경 문제로 CLI의 빌드가 실패했으면 에이전트가 건너뜀으로 적어 멈춘다
    run("T001", { build: "fail" });
    const skipped = implVerify(repo, F, "T001", { today: today(), checks: { build: "skip" } });
    expect(skipped.raised).toEqual([]);
    expect(skipped.blockedBySkip).toEqual(["build"]);
    expect(checked("T001")).toBe(false);
    expect(() => implVerify(repo, F, "T001", { today: today(), checks: { lint: "skip" } })).toThrow(/Lint의 건너뜀은 인자로/);

    implSetup(repo, { lint: "none" });
    const result = run("T001");
    expect(result.runs.find((done) => done.kind === "lint")).toEqual({ kind: "lint", result: "skip", commands: [], summary: [] });
    expect(ran.filter((command) => command.startsWith("lint"))).toEqual(["lint m"]);
    expect(implVerify(repo, F, "T001", { today: today(), checks: {} }).raised).toEqual(["T001"]);
  });

  it("기본 실행기는 셸로 명령을 돌리고 종료 코드로 판정한다", () => {
    implSetup(repo, { build: "echo built {module}", lint: "echo 'e: lint boom' && exit 3" });
    implReport(repo, F, "T001", { today: today(), status: "done", modules: [":app"] });
    const result = implCheck(repo, F, "T001");
    expect(result.runs.map((done) => [done.kind, done.result])).toEqual([["build", "pass"], ["lint", "fail"]]);
    expect(result.runs[1]?.summary).toEqual(["e: lint boom"]);
    expect(fs.readFileSync(path.join(repo.root, result.runs[0]?.log ?? ""), "utf8")).toContain("built :app\n\n[종료 코드 0]");
    expect(implVerify(repo, F, "T001", { today: today(), checks: {} }).redo).toEqual([{ id: "T001", kind: "structure", failure: "lint" }]);
  });

  it("검사를 돌린 뒤 작업의 파일이 바뀌면 그 결과로는 판정하지 않는다", () => {
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo.root, rel), text);
    };
    write("feature/login/build.gradle.kts", "plugins {}\n");
    implReport(repo, F, "T001", { today: today(), status: "done", modules: ["m"] });
    run("T001");
    write("feature/login/build.gradle.kts", "plugins { id(\"x\") }\n");
    expect(() => implVerify(repo, F, "T001", { today: today(), checks: {} })).toThrow(/파일이 바뀌어 그 결과를 버렸다/);
    expect(readCheckpoint(repo, F)?.tasks.T001?.runs).toBeUndefined();
    // 내용이 같으면 다시 쓴 파일이어도 같은 결과로 본다
    run("T001");
    write("feature/login/build.gradle.kts", "plugins { id(\"x\") }\n");
    expect(implVerify(repo, F, "T001", { today: today(), checks: {} }).raised).toEqual(["T001"]);
  });

  it("디자인만 다시 적을 때 그 사이 코드가 바뀌었으면 앞서 적힌 빌드 통과를 쓰지 않는다", () => {
    for (const id of ["T001", "T003"]) finish(id);
    implReport(repo, F, "T002", { today: today(), status: "done" });
    finish("T004");
    implReport(repo, F, "T005", { today: today(), status: "done", modules: ["m"] });
    run("T005");
    expect(implVerify(repo, F, "T005", { today: today(), checks: {} }).missing).toEqual(["design"]);
    // 디자인 차이를 고치느라 화면 파일이 바뀌었다
    fs.mkdirSync(path.join(repo.root, "feature/login/src/main"), { recursive: true });
    fs.writeFileSync(path.join(repo.root, "feature/login/src/main/LoginScreen.kt"), "fun LoginScreen() {}\n");
    const result = implVerify(repo, F, "T005", { today: today(), checks: { design: "pass" } });
    expect(result.stale).toEqual(["build", "lint"]);
    expect(result.raised).toEqual([]);
    expect(result.missing).toEqual(["build", "lint"]);
    run("T005");
    expect(implVerify(repo, F, "T005", { today: today(), checks: {} }).raised).toEqual(["T005"]);
  });

  it("규칙 도구의 명령이 있으면 작업과 마지막 확인이 그 통과를 요구하고, 실패는 그 작업을 다시 고치게 한다", () => {
    implSetup(repo, { rules: "rules {module}" });
    implReport(repo, F, "T001", { today: today(), status: "done", modules: ["m"] });
    expect(implReport(repo, F, "T001", { today: today(), status: "done", modules: ["m"] }).required).toEqual(["build", "lint", "rules"]);
    run("T001", { rules: "fail" });
    expect(ran).toEqual(["build m", "lint m", "rules m"]);
    expect(implVerify(repo, F, "T001", { today: today(), checks: {} }).redo).toEqual([{ id: "T001", kind: "structure", failure: "rules" }]);
    expect(() => implVerify(repo, F, "T001", { today: today(), checks: { rules: "pass" } })).toThrow(/규칙의 통과는 인자로/);
    run("T001");
    expect(implVerify(repo, F, "T001", { today: today(), checks: {} }).raised).toEqual(["T001"]);

    // none은 규칙 도구를 따로 돌리지 않는다는 뜻이라 항목을 지운다
    expect(implSetup(repo, { rules: "none" }).checks.rules).toBeUndefined();
    expect(fs.readFileSync(path.join(repo.root, ".sdd-android", "config.yaml"), "utf8")).not.toContain("rules");
  });

  it("모듈을 보고하지 않은 작업은 검사를 돌리지 않고, 모듈마다 다른 명령을 쓸 수 있다", () => {
    implReport(repo, F, "T001", { today: today(), status: "done" });
    expect(() => run("T001")).toThrow(/보고한 모듈이 없다/);
    const file = path.join(repo.root, ".sdd-android", "config.yaml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('build: "build {module}"', 'build:\n      "*": "build {module}"\n      ":core": "build-jvm {module}"'));
    implReport(repo, F, "T001", { today: today(), status: "done", modules: [":app", ":core"] });
    expect(run("T001").runs[0]?.commands).toEqual(["build :app", "build-jvm :core"]);
    expect(fs.readFileSync(path.join(repo.root, ".sdd-android", "impl", F, "logs", "T001-build.log"), "utf8")).toContain("$ build-jvm :core");
  });

  it("새 체크포인트는 이미 끝난 단위를 다시 검증하지 않는다", () => {
    for (const id of ["T001", "T003"]) finish(id);
    implReport(repo, F, "T002", { today: today(), status: "done" });
    finish("T004");
    fs.rmSync(checkpointPath(repo, F));
    implStart(repo, F, { today: today() });
    expect(readCheckpoint(repo, F)?.units).toEqual({ US1: { checks: { principles: "skip" } } });
    implAssign(repo, F, ["T001=test", "T002=test", "T003=logic", "T004=logic", "T005=ui", "T006=structure"]);
    expect(implNext(repo, F).pendingUnit).toBeUndefined();
  });

  it("마지막 확인은 통과면 FINAL을 올리고 체크포인트를 지우며, 실패면 대응 작업의 체크를 내린다", () => {
    for (const id of ["T001", "T003"]) finish(id);
    implReport(repo, F, "T002", { today: today(), status: "done" });
    finish("T004");
    expect(() => implFinal(repo, F, { today: today(), result: "pass" })).toThrow(/체크되지 않은 작업/);
    finish("T005", ["design=skip"]);
    finish("T006");
    expect(implNext(repo, F).final).toBe(true);

    const failed = implFinal(repo, F, { today: today(), result: "fail", failure: "principles", symptom: "의존 방향", files: ["app/src/main/Nav.kt"] });
    expect(failed.lowered).toEqual(["T006"]);
    expect(checked("T006")).toBe(false);
    expect(fs.readFileSync(failuresPath(repo, F), "utf8")).toContain("T006 · 원칙 · 마지막 확인에서 남음");
    expect(implNext(repo, F).task?.id).toBe("T006");

    finish("T006");
    // 마지막 확인의 검사 결과를 모두 적어야 올라간다. 빌드·테스트는 건너뜀으로 안 되고, 실패는 pass로 적을 수 없다
    expect(() => implFinal(repo, F, { today: today(), result: "pass" })).toThrow(/빠진 검사: 빌드, Lint, 테스트, 원칙.*impl check login --final/);
    expect(() => implFinal(repo, F, { today: today(), result: "pass", checks: parseChecks(["build=pass", "lint=pass", "test=pass", "principles=pass"]) })).toThrow(/인자로 적을 수 없다/);
    // 마지막 확인은 feature의 모든 모듈에 테스트 전체를 돌린다
    ran = [];
    run(undefined, { lint: "fail" });
    expect(ran).toEqual(["build m", "lint m", "test m"]);
    expect(() => implFinal(repo, F, { today: today(), result: "pass", checks: { principles: "pass" } })).toThrow(/실패한 검사가 있다: Lint/);
    // 그 뒤 코드가 바뀌면(구현 보고) 돌린 결과는 버려진다
    run(undefined);
    implReport(repo, F, "T006", { today: today(), status: "done", modules: ["m"] });
    expect(readCheckpoint(repo, F)?.final).toBeUndefined();
    run(undefined);
    // 보고 없이 사람이 파일을 고쳐도 내용 해시로 알아챈다
    fs.mkdirSync(path.join(repo.root, "app/src/main"), { recursive: true });
    fs.writeFileSync(path.join(repo.root, "app/src/main/Nav.kt"), "// 손으로 고침\n");
    expect(() => implFinal(repo, F, { today: today(), result: "pass", checks: { principles: "pass" } })).toThrow(/--final 뒤에 작업의 파일이 바뀌어/);
    expect(readCheckpoint(repo, F)?.final).toBeUndefined();
    run(undefined);
    // Figma 줄이 있는 스토리의 ui 작업이 있으면 디자인(캡처)도 필요하다
    const specFile = docPath(repo, "spec", F);
    const specText = fs.readFileSync(specFile, "utf8");
    fs.writeFileSync(specFile, `${specText}\n### US2. 화면\n\n**Figma**: [화면](https://www.figma.com/design/abc?node-id=1-2)\n`);
    expect(() => implFinal(repo, F, { today: today(), result: "pass", checks: { principles: "pass" } })).toThrow(/빠진 검사: 디자인.*캡처/);
    fs.writeFileSync(specFile, specText);
    const passed = implFinal(repo, F, { today: today(), result: "pass", checks: parseChecks(["principles=pass", "design=skip"]) });
    expect(passed.done).toBe(true);
    expect(passed.checkpoint?.assignments.T006).toBe("structure");
    expect(checked("FINAL")).toBe(true);
    expect(fs.existsSync(checkpointPath(repo, F))).toBe(false);
    expect(implNext).toBeDefined();
    expect(status(repo, F).features[0]?.tasks).toEqual({ done: 6, total: 6, final: true, inProgress: false });
    expect(implementGate(repo, F).mode).toBe("done");
    expect(() => implStart(repo, F, { today: today() })).toThrow(/구현은 끝났다/);
    expect(check(repo).ok).toBe(true);
  });

  it("breakdown을 개정해 작업이 더해지면 FINAL이 내려가고, check는 어긋난 FINAL을 오류로 본다", () => {
    for (const id of ["T001", "T003"]) finish(id);
    implReport(repo, F, "T002", { today: today(), status: "done" });
    finish("T004");
    finish("T005", ["design=skip"]);
    finish("T006");
    run(undefined);
    implFinal(repo, F, { today: today(), result: "pass", checks: { principles: "pass" } });

    const file = docPath(repo, "breakdown", F);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("- [x] FINAL", "- [ ] T007 새 작업 `app/New.kt`\n- [x] FINAL"));
    expect(check(repo).problems.map((problem) => problem.message)).toContain("마지막 확인 줄(FINAL)이 체크됐는데 체크되지 않은 작업이 있다");
    docRevise(repo, "breakdown", F, { today: today(), grade: "minor" });
    expect(checked("FINAL")).toBe(false);
    expect(check(repo).ok).toBe(true);
    expect(implementGate(repo, F).mode).toBe("new");
  });

  it("이어서 실행하면 체크된 작업을 건너뛰고 진행 중이던 단계에서 이어 간다", () => {
    finish("T001");
    implReport(repo, F, "T002", { today: today(), status: "done" });
    implReport(repo, F, "T003", { today: today(), status: "done" });
    const resumed = implStart(repo, F, { today: today() });
    expect(resumed.resumed).toBe(true);
    expect(resumed.confirmed).toBe(true);
    expect(implNext(repo, F).task).toMatchObject({ id: "T003", kind: "logic", phase: "verify" });
  });

  it("검사 인자의 형식을 검사한다", () => {
    expect(() => parseChecks(["build"])).toThrow(Refusal);
    expect(() => parseChecks(["screen=pass"])).toThrow(Refusal);
    expect(parseChecks([])).toEqual({});
    expect(parseChecks(["build=pass", "test=skip"])).toEqual({ build: "pass", test: "skip" });
  });
});

describe("자체 확인(impl try)", () => {
  const fake = (outcome: Outcome = {}): Exec => (command, _cwd, log) => {
    ran.push(command);
    const kind = command.split(" ")[0] as keyof Outcome;
    fs.writeSync(log, outcome[kind] === "fail" ? `e: ${kind} 오류\n` : "BUILD SUCCESSFUL\n");
    return outcome[kind] === "fail" ? 1 : 0;
  };

  it("impl check와 같은 명령을 체크포인트 없이 돌리고 아무것도 기록하지 않는다", () => {
    expect(() => implTry(repo, F, "T004")).toThrow(/--modules/);
    expect(() => implTry(repo, F, "T099", { modules: [":domain"] })).toThrow(/없거나 폐기된/);
    const result = implTry(repo, F, "T004", { modules: [":domain"], exec: fake() });
    expect(ran).toEqual(["build :domain", "lint :domain", "test :domain --tests '*LoginTest'"]);
    expect(result.runs.map((done) => done.log)).toContain(".sdd-android/impl/login/logs/try-T004-build.log");
    expect(readCheckpoint(repo, F)).toBeUndefined();
    expect(fs.readFileSync(path.join(repo.root, ".sdd-android", "impl", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("테스트 작업은 그 테스트를 돌리고, --only는 고른 검사만, 빌드가 실패하면 테스트를 건너뛴다", () => {
    implTry(repo, F, "T002", { modules: [":domain"], only: ["test"], exec: fake() });
    expect(ran).toEqual(["test :domain --tests '*LoginTest'"]);
    ran = [];
    const failed = implTry(repo, F, "T004", { modules: [":domain"], exec: fake({ build: "fail" }) });
    expect(ran).toEqual(["build :domain", "lint :domain"]);
    expect(failed.testNote).toMatch(/빌드가 실패/);
    expect(failed.runs[0]?.summary).toEqual(["e: build 오류"]);
    ran = [];
    expect(implTry(repo, F, "T003", { modules: [":domain"], only: ["test"], exec: fake() }).testNote).toMatch(/연결된 테스트 작업이 없어/);
    expect(ran).toEqual([]);
  });

  it("구현 보고가 있으면 그 모듈을 쓰고, 체크포인트는 바뀌지 않는다", () => {
    start();
    implReport(repo, F, "T001", { today: today(), status: "done", modules: [":feature:login"], files: [] });
    const before = fs.readFileSync(checkpointPath(repo, F), "utf8");
    implTry(repo, F, "T001", { exec: fake({ lint: "fail" }) });
    expect(ran).toEqual(["build :feature:login", "lint :feature:login"]);
    expect(fs.readFileSync(checkpointPath(repo, F), "utf8")).toBe(before);
  });
});

describe("수정 단위", () => {
  const FIX_SECTION = `## 수정: FIX-001 날짜 미반영

- [ ] T007 [FIX-001] [until:T008] 날짜 재현 테스트 \`domain/src/test/DateBugTest.kt\`
- [ ] T008 [FIX-001] 날짜를 넘긴다 \`domain/src/main/usecase/Booking.kt\`

`;

  /** feature의 구현을 끝까지 마친다. */
  function complete(): void {
    start();
    for (const id of ["T001", "T003"]) finish(id);
    implReport(repo, F, "T002", { today: today(), status: "done" });
    finish("T004");
    finish("T005", ["design=skip"]);
    finish("T006");
    run(undefined);
    implFinal(repo, F, { today: today(), result: "pass", checks: { principles: "pass" } });
  }

  function addFix(section: string = FIX_SECTION): void {
    const file = docPath(repo, "breakdown", F);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("## 마지막 확인", `${section}## 마지막 확인`));
  }

  it("수정 단위는 스토리의 나눔과 따로 한 단위이고 기존 단위의 구성을 바꾸지 않는다", () => {
    addFix();
    const units = splitUnits(parseTasks(body())).map((unit) => [unit.name, unit.tasks.map((task) => task.id)]);
    expect(units).toEqual([
      ["US1", ["T001", "T002", "T003", "T004"]],
      ["US2", ["T005"]],
      ["tail", ["T006"]],
      ["FIX-001", ["T007", "T008"]],
    ]);
  });

  it("떨어진 스토리는 같은 이름의 단위 둘이 되므로 오류다", () => {
    const tasks = parseTasks("- [ ] T001 [US1] a `a.kt`\n- [ ] T002 [US2] b `b.kt`\n- [ ] T003 [US1] c `c.kt`\n- [ ] T004 [US1] [FIX-001] d `d.kt`\n- [ ] FINAL 끝\n");
    expect(validateTasks(tasks)).toEqual([
      "4행: T004에 스토리와 수정 단위가 함께 있다. 하나만 단다",
      "3행: US1의 작업이 다른 단위 뒤에 다시 나온다. 한 단위의 작업은 한곳에 모은다. 끝난 기능에 작업을 더하려면 수정 단위([FIX-…])를 쓴다",
    ]);
    // 스토리 밖의 작업이 사이에 있는 것은 떨어진 것이 아니다
    expect(validateTasks(parseTasks("- [ ] T001 [US1] a `a.kt`\n- [ ] T002 b `b.kt`\n- [ ] T003 [US1] c `c.kt`\n- [ ] FINAL 끝\n"))).toEqual([]);
  });

  it("끝난 feature에 작은 수정을 더해 그 단위만 구현하고, 마지막 확인은 그 단위가 바꾼 모듈만 돈다", () => {
    complete();
    addFix();
    const result = fixCheck(repo, F, "FIX-001");
    expect(result).toEqual({ feature: F, fix: "FIX-001", tasks: ["T007", "T008"], test: "T007" });
    expect(formatFixCheck(result)).toContain(`/impl-orchestrator ${F} --fix FIX-001`);
    expect(formatFixCheck(result, "sdd")).toContain(`/sdd-impl-orchestrator ${F} --fix FIX-001`);
    docRevise(repo, "breakdown", F, { today: today(), grade: "minor" });
    expect(checked("FINAL")).toBe(false);

    // 다른 모듈의 작업이 끝났다는 기록은 새 체크포인트에 없다
    const started = implStart(repo, F, { today: today(), fix: "FIX-001" });
    expect(started.checkpoint.fix).toBe("FIX-001");
    expect(implNext(repo, F).unassigned).toEqual(["T007", "T008"]);
    expect(() => implAssign(repo, F, ["T007=logic"])).toThrow(/test여야/);
    implAssign(repo, F, ["T007=test", "T008=logic"]);
    expect(implNext(repo, F)).toMatchObject({ task: { id: "T007" }, unit: "FIX-001" });

    implReport(repo, F, "T007", { today: today(), status: "done", modules: [":domain"] });
    implReport(repo, F, "T008", { today: today(), status: "done", modules: [":domain"] });
    ran = [];
    run("T008");
    expect(ran).toEqual(["build :domain", "lint :domain", "test :domain --tests '*DateBugTest'"]);
    expect(implVerify(repo, F, "T008", { today: today(), checks: {} }).raised).toEqual(["T008", "T007"]);
    expect(implNext(repo, F).pendingUnit).toBe("FIX-001");
    implVerify(repo, F, undefined, { today: today(), unit: "FIX-001", checks: { principles: "pass" } });

    // 단위 밖 작업의 기록이 체크포인트에 있어도 마지막 확인은 그 단위가 바꾼 모듈만 돈다.
    const checkpoint = readCheckpoint(repo, F);
    checkpoint!.tasks["T001"] = { ...checkpoint!.tasks["T001"], modules: [":app"] };
    writeCheckpoint(repo, F, checkpoint!);
    ran = [];
    run(undefined);
    expect(ran).toEqual(["build :domain", "lint :domain", "test :domain"]);
    expect(implFinal(repo, F, { today: today(), result: "pass", checks: { principles: "pass" } }).done).toBe(true);
    expect(checked("FINAL")).toBe(true);
  });

  it("범위를 넘는 수정은 무엇이 넘었는지 모아 거부한다", () => {
    addFix();
    expect(() => fixCheck(repo, F, "FIX-001")).toThrow(/구현이 끝나지 않았다/);
    const file = docPath(repo, "breakdown", F);
    fs.writeFileSync(file, setChecked(fs.readFileSync(file, "utf8"), ["T001", "T002", "T003", "T004", "T005", "T006", "FINAL"], true));

    const wide = `## 수정: FIX-002 넓은 수정

- [ ] T009 [FIX-002] 새 화면 \`app/src/debug/New.kt\`
- [ ] T010 [FIX-002] 의존성 \`app/build.gradle.kts\`
- [ ] T011 [FIX-002] 모듈 전체 \`domain/\`

`;
    addFix(wide);
    const message = (() => {
      try {
        fixCheck(repo, F, "FIX-002");
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toContain("FIX-002의 작업이 3개다");
    expect(message).toContain("FIX-002 밖에 체크되지 않은 작업이 있다: T007, T008");
    expect(message).toContain("재현 테스트");
    expect(message).toContain("T009의 경로가 기존 작업이 맡은 곳 밖이다: app/src/debug/New.kt");
    expect(message).toContain("T010가 빌드 구성을 고친다: app/build.gradle.kts");
    expect(message).toContain("T011의 경로가 디렉터리다: domain/");
    expect(message).toContain("정식 경로");
  });

  it("문구처럼 재현 테스트가 없는 수정은 사유를 적어야 하고, spec의 변경이 PATCH를 넘으면 거부한다", () => {
    complete();
    addFix(`## 수정: FIX-001 문구

- [ ] T007 [FIX-001] 버튼 문구 \`feature/login/src/main/LoginScreen.kt\`

`);
    expect(() => fixCheck(repo, F, "FIX-001")).toThrow(/--no-test/);
    expect(fixCheck(repo, F, "FIX-001", { noTest: "문구만 바꾼다" }).noTest).toBe("문구만 바꾼다");

    const spec = docPath(repo, "spec", F);
    // 문구를 고치는 spec의 PATCH 개정은 그대로 통과한다
    fs.writeFileSync(spec, fs.readFileSync(spec, "utf8").replace("요구사항", "요구사항: 버튼 문구는 확인"));
    docChecklist(repo, F);
    docRevise(repo, "spec", F, { today: today(), grade: "patch" });
    expect(fixCheck(repo, F, "FIX-001", { noTest: "문구만 바꾼다" }).tasks).toEqual(["T007"]);
    fs.writeFileSync(spec, fs.readFileSync(spec, "utf8") + "\n새 요구사항\n");
    docChecklist(repo, F);
    docRevise(repo, "spec", F, { today: today(), grade: "minor" });
    expect(() => fixCheck(repo, F, "FIX-001", { noTest: "문구만 바꾼다" })).toThrow(/게이트를 통과시키지 않는다/);
  });

  it("수정 모드는 그 단위 밖에 남은 작업이 있으면 시작하지 않는다", () => {
    addFix();
    docRevise(repo, "breakdown", F, { today: today(), grade: "minor" });
    expect(() => implStart(repo, F, { today: today(), fix: "FIX-001" })).toThrow(/FIX-001 밖에 체크되지 않은 작업이 있다: T001/);
    expect(() => implStart(repo, F, { today: today(), fix: "FIX-009" })).toThrow(/수정 단위가 없다/);
  });
});
