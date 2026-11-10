import fs from "node:fs";
import path from "node:path";
import { parse, parseDocument } from "yaml";
import { detectProject, flavorCommands, JVM_COMMANDS, type Detected, type Found } from "./detect.js";
import { Refusal, type Repo } from "./repo.js";

/**
 * 구현 단계의 기계 검사 명령(`.sdd-android/config.yaml`의 `impl.checks`). 커밋하는 설정이라 팀이 같은 검사를 돌린다.
 * 이 검사들의 통과와 실패는 CLI가 명령을 돌려 종료 코드로 정한다. 에이전트의 보고로는 통과를 적을 수 없다.
 */
export const MACHINE_CHECKS = ["build", "lint", "test", "rules"] as const;
export type MachineCheck = (typeof MACHINE_CHECKS)[number];

/**
 * 반드시 있어야 하는 검사. `rules`는 constitution 원칙의 도구 규칙(Konsist 테스트, Lint와 따로 도는 detekt 규칙 등)을 돌리는 명령이고,
 * 그런 도구가 없거나 Lint 명령이 이미 돌리면 두지 않는다.
 */
export const REQUIRED_CHECKS = ["build", "lint", "test"] as const;

/** Lint 도구가 없는 프로젝트는 `lint: none`으로 명시한다. 그때만 Lint가 건너뜀이 된다. */
export const NO_COMMAND = "none";

/** 명령 하나이거나, 모듈마다 다른 명령. 모듈 묶음의 `*`가 기본이다. */
export type CommandSpec = string | Record<string, string>;

export type ImplChecks = Record<(typeof REQUIRED_CHECKS)[number], CommandSpec> & { rules?: CommandSpec };

export const DEFAULT_COMMANDS: Record<"build" | "test", string> = {
  build: "./gradlew {module}:compileDebugKotlin",
  test: "./gradlew {module}:testDebugUnitTest {tests}",
};

export function isMachineCheck(value: string): value is MachineCheck {
  return (MACHINE_CHECKS as readonly string[]).includes(value);
}

function configFile(repo: Repo): string {
  return path.join(repo.root, ".sdd-android", "config.yaml");
}

function validateSpec(where: string, raw: unknown): CommandSpec {
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const spec: Record<string, string> = {};
    for (const [module, command] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof command !== "string" || command.trim() === "") throw new Error(`${where}.${module}: 명령은 비어 있지 않은 문자열이다`);
      // 건너뜀은 검사 전체에만 있다. 묶음 안의 none은 셸 명령으로 돌아 실패가 된다.
      if (command.trim() === NO_COMMAND) {
        throw new Error(`${where}.${module}: none은 모듈 묶음 안에 쓸 수 없다. 검사 전체를 건너뛸 때만 lint: none으로 적고, 그 모듈에 도구가 없으면 그 모듈에서 성공하는 명령을 적는다`);
      }
      spec[module] = command.trim();
    }
    if (!spec["*"]) throw new Error(`${where}: 모듈마다 명령을 적을 때는 기본 명령 "*"도 적는다`);
    return spec;
  }
  throw new Error(`${where}: 명령 문자열이거나 모듈에서 명령으로의 묶음이다`);
}

/** `impl.checks`의 형식을 검사한다. 비어 있으면 undefined, 일부만 있으면 빠진 것을 알린다. */
export function validateImplChecks(raw: unknown): { checks?: ImplChecks; missing: MachineCheck[] } {
  if (raw === undefined || raw === null) return { missing: [...REQUIRED_CHECKS] };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("impl은 키와 값의 묶음이어야 한다");
  const given = (raw as { checks?: unknown }).checks;
  if (given === undefined || given === null) return { missing: [...REQUIRED_CHECKS] };
  if (typeof given !== "object" || Array.isArray(given)) throw new Error("impl.checks는 키와 값의 묶음이어야 한다");
  const checks: Partial<ImplChecks> = {};
  for (const [kind, value] of Object.entries(given as Record<string, unknown>)) {
    if (!isMachineCheck(kind)) throw new Error(`impl.checks의 검사는 ${MACHINE_CHECKS.join(", ")}이다: ${kind}`);
    const spec = validateSpec(`impl.checks.${kind}`, value);
    if (spec === NO_COMMAND && kind !== "lint") {
      throw new Error(kind === "rules" ? "impl.checks.rules: 돌릴 규칙 도구가 없으면 none 대신 rules를 지운다" : `impl.checks.${kind}: none은 lint에만 쓴다. 빌드와 테스트는 건너뛸 수 없다`);
    }
    checks[kind] = spec;
  }
  const missing = REQUIRED_CHECKS.filter((kind) => checks[kind] === undefined);
  return missing.length === 0 ? { checks: checks as ImplChecks, missing } : { missing };
}

function readRaw(repo: Repo): unknown {
  const data = (parse(fs.readFileSync(configFile(repo), "utf8")) ?? {}) as { impl?: unknown };
  return data.impl;
}

/** 검사 명령. 설정이 없거나 빠진 검사가 있으면 `impl setup`을 안내하며 거부한다. */
export function requireImplChecks(repo: Repo): ImplChecks {
  let result: ReturnType<typeof validateImplChecks>;
  try {
    result = validateImplChecks(readRaw(repo));
  } catch (error) {
    throw new Refusal(`.sdd-android/config.yaml의 impl.checks가 형식에 맞지 않는다: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!result.checks) {
    throw new Refusal(
      `구현 단계의 검사 명령이 설정되어 있지 않다: ${result.missing.join(", ")}. 사용자가 sdd-android impl setup --lint <명령|none>으로 정한다(빌드와 테스트는 기본값이 있다). 검사는 CLI가 이 명령을 돌려 종료 코드로 판정한다.`,
    );
  }
  return result.checks;
}

/** 검사 명령을 읽기만 한다. 없거나 형식이 어긋나면 undefined. 거부는 requireImplChecks가 한다. */
export function readImplChecks(repo: Repo): ImplChecks | undefined {
  try {
    return validateImplChecks(readRaw(repo)).checks;
  } catch {
    return undefined;
  }
}

/** 모듈에 맞는 명령. 모듈 묶음이면 그 모듈의 것, 없으면 `*`. */
export function commandFor(spec: CommandSpec, module: string): string {
  return typeof spec === "string" ? spec : (spec[module] ?? (spec["*"] as string));
}

export interface SetupOptions {
  build?: string;
  lint?: string;
  test?: string;
  rules?: string;
}

export interface SetupResult {
  checks: ImplChecks;
  changed: MachineCheck[];
  /** 프로젝트의 Gradle 설정에서 찾은 것과 맞지 않아 보이는 곳의 제안. 적지 않는다. */
  notes: string[];
}

function spoken(found: Found[]): string {
  return found.map((item) => `${item.tool}(${item.file})`).join(", ");
}

/** 설정한 명령과 프로젝트에서 찾은 것을 맞대어 제안을 낸다. 찾은 것은 추정이라 적지 않고 보여 주기만 한다. */
export function setupNotes(checks: ImplChecks, detected: Detected): string[] {
  const notes: string[] = [];
  const commands = (spec: CommandSpec | undefined) => (spec === undefined ? [] : typeof spec === "string" ? [spec] : Object.values(spec));
  if (detected.lint.length > 0) {
    const tasks = detected.lint.map((found) => found.command.split(":").pop() as string);
    const lint = commands(checks.lint);
    if (checks.lint === NO_COMMAND) {
      notes.push(`Lint가 none인데 프로젝트에서 ${spoken(detected.lint)}를 찾았다. 쓰는 도구면 --lint "${detected.lint[0]?.command}"로 정한다.`);
    } else if (!lint.some((command) => tasks.some((task) => command.includes(task)))) {
      notes.push(`Lint 명령이 프로젝트에서 찾은 ${spoken(detected.lint)}를 돌리지 않는 것 같다: ${lint.join(", ")}. 그 도구를 쓰면 --lint "${detected.lint[0]?.command}"로 정한다.`);
    }
  }
  if (checks.rules === undefined && detected.rules.length > 0) {
    notes.push(`규칙 도구 ${spoken(detected.rules)}를 찾았다. 구현 단계에서 돌리려면 --rules "${detected.rules[0]?.command}"로 정한다.`);
  }
  // 빌드와 테스트의 명령이 모듈에 맞지 않아 보이는 곳. 사유는 모듈마다, 고칠 묶음은 하나로 모아 보여 준다.
  const entries: Record<"build" | "test", [string, string][]> = { build: [], test: [] };
  const suggest = (module: string, kind: "build" | "test", command: string) => {
    if (!entries[kind].some(([name]) => name === module)) entries[kind].push([module, command]);
  };
  for (const flavored of detected.flavors) {
    const names = flavored.names.join(", ");
    if (!flavored.module) {
      notes.push(`컨벤션 플러그인(${flavored.file})에 flavor(${names})가 있다. 그 플러그인을 쓰는 모듈의 빌드와 테스트 명령을 .sdd-android/config.yaml의 impl.checks에 모듈마다 적는다. 모든 모듈이 쓰면 "*"를 flavor의 명령으로 적는다.`);
      continue;
    }
    const unhandled = (["build", "test"] as const).filter((kind) => {
      const command = commandFor(checks[kind], flavored.module).toLowerCase();
      return !flavored.names.some((name) => command.includes(name.toLowerCase()));
    });
    if (unhandled.length === 0) continue;
    notes.push(`${flavored.module}에 flavor(${names})가 있다(${flavored.file}). 지금 명령은 그 모듈에서 variant를 고르지 않아 돌지 않을 수 있다.`);
    const commands = flavorCommands(flavored.names[0] as string);
    for (const kind of unhandled) suggest(flavored.module, kind, commands[kind]);
  }
  for (const jvm of detected.jvm) {
    if (!jvm.module) {
      notes.push(`컨벤션 플러그인(${jvm.file})이 Kotlin/JVM 모듈을 만든다. 그 플러그인을 쓰는 모듈의 빌드와 테스트 명령을 .sdd-android/config.yaml의 impl.checks에 모듈마다 적는다(\`compileKotlin\`, \`test\`).`);
      continue;
    }
    // 디버그 variant의 태스크는 Android 모듈에만 있다.
    const unhandled = (["build", "test"] as const).filter((kind) => /debug/i.test(commandFor(checks[kind], jvm.module)));
    if (unhandled.length === 0) continue;
    notes.push(`${jvm.module} 모듈은 Android가 아닌 Kotlin/JVM 모듈이다(${jvm.file}). 지금 명령은 Android의 디버그 태스크라 그 모듈에 없다.`);
    for (const kind of unhandled) suggest(jvm.module, kind, JVM_COMMANDS[kind]);
  }
  const kinds = (["build", "test"] as const).filter((kind) => entries[kind].length > 0);
  if (kinds.length > 0) {
    const lines = kinds.flatMap((kind) => [
      `      ${kind}:`,
      `        "*": "${commandFor(checks[kind], "*")}"`,
      ...entries[kind].map(([module, command]) => `        "${module}": "${command}"`),
    ]);
    notes.push([`위 모듈의 명령을 .sdd-android/config.yaml의 impl.checks에 모듈마다 적는다. flavor 차원이 여럿이면 이름을 조합한다:`, ...lines].join("\n"));
  }
  return notes;
}

/**
 * 검사 명령을 설정에 적는다. 준 것만 바꾸고, 없는 빌드와 테스트는 기본값으로 채운다.
 * Lint는 기본값이 없다. 도구가 없으면 `none`을 명시해야 건너뜀이 되므로, 사람이 고르게 한다.
 * 설정 파일의 다른 내용과 주석은 그대로 둔다. 프로젝트의 Gradle 설정에서 찾은 것은 제안으로만 돌려준다.
 */
export function implSetup(repo: Repo, options: SetupOptions): SetupResult {
  const detected = detectProject(repo.root);
  const file = configFile(repo);
  const doc = parseDocument(fs.readFileSync(file, "utf8"));
  const current = doc.getIn(["impl", "checks"], false);
  const plain = (current && typeof current === "object" && "toJSON" in current ? (current as { toJSON(): unknown }).toJSON() : current) as
    | Record<string, unknown>
    | undefined;
  const changed: MachineCheck[] = [];
  for (const kind of MACHINE_CHECKS) {
    const given = options[kind]?.trim();
    if (given !== undefined && given !== "") {
      if (given === NO_COMMAND && kind === "rules") {
        // 규칙 도구를 따로 돌리지 않는다는 뜻이다. 항목을 지운다.
        if (plain?.rules !== undefined) {
          doc.deleteIn(["impl", "checks", "rules"]);
          changed.push(kind);
        }
        continue;
      }
      if (given === NO_COMMAND && kind !== "lint") throw new Refusal(`${kind}는 none으로 둘 수 없다. 빌드와 테스트는 건너뛸 수 없다`);
      doc.setIn(["impl", "checks", kind], given);
      changed.push(kind);
    } else if (plain?.[kind] === undefined && kind !== "rules") {
      if (kind === "lint") {
        const hint = detected.lint.length > 0 ? ` 프로젝트에서 ${spoken(detected.lint)}를 찾았다. 그 도구를 쓰면 --lint "${detected.lint[0]?.command}"이다.` : "";
        throw new Refusal(`Lint 명령이 없다. --lint <명령>을 주거나, 프로젝트에 Lint 도구가 없으면 --lint none으로 명시한다.${hint}`);
      }
      doc.setIn(["impl", "checks", kind], DEFAULT_COMMANDS[kind]);
      changed.push(kind);
    }
  }
  let checks: ImplChecks | undefined;
  try {
    checks = validateImplChecks(doc.toJSON()?.impl).checks;
  } catch (error) {
    throw new Refusal(`.sdd-android/config.yaml의 impl.checks가 형식에 맞지 않는다: ${error instanceof Error ? error.message : String(error)}. 파일을 고친 뒤 다시 한다`);
  }
  if (!checks) throw new Refusal("검사 명령을 정하지 못했다");
  fs.writeFileSync(file, doc.toString());
  return { checks, changed, notes: setupNotes(checks, detected) };
}
