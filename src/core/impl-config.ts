import fs from "node:fs";
import path from "node:path";
import { parse, parseDocument } from "yaml";
import { Refusal, type Repo } from "./repo.js";

/**
 * 구현 단계의 기계 검사 명령(`.mob-sdd/config.yaml`의 `impl.checks`). 커밋하는 설정이라 팀이 같은 검사를 돌린다.
 * 이 검사들의 통과와 실패는 CLI가 명령을 돌려 종료 코드로 정한다. 에이전트의 보고로는 통과를 적을 수 없다.
 */
export const MACHINE_CHECKS = ["build", "lint", "test"] as const;
export type MachineCheck = (typeof MACHINE_CHECKS)[number];

/** Lint 도구가 없는 프로젝트는 `lint: none`으로 명시한다. 그때만 Lint가 건너뜀이 된다. */
export const NO_COMMAND = "none";

/** 명령 하나이거나, 모듈마다 다른 명령. 모듈 묶음의 `*`가 기본이다. */
export type CommandSpec = string | Record<string, string>;

export type ImplChecks = Record<MachineCheck, CommandSpec>;

export const DEFAULT_COMMANDS: Record<"build" | "test", string> = {
  build: "./gradlew {module}:compileDebugKotlin",
  test: "./gradlew {module}:testDebugUnitTest {tests}",
};

export function isMachineCheck(value: string): value is MachineCheck {
  return (MACHINE_CHECKS as readonly string[]).includes(value);
}

function configFile(repo: Repo): string {
  return path.join(repo.root, ".mob-sdd", "config.yaml");
}

function validateSpec(where: string, raw: unknown): CommandSpec {
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const spec: Record<string, string> = {};
    for (const [module, command] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof command !== "string" || command.trim() === "") throw new Error(`${where}.${module}: 명령은 비어 있지 않은 문자열이다`);
      spec[module] = command.trim();
    }
    if (!spec["*"]) throw new Error(`${where}: 모듈마다 명령을 적을 때는 기본 명령 "*"도 적는다`);
    return spec;
  }
  throw new Error(`${where}: 명령 문자열이거나 모듈에서 명령으로의 묶음이다`);
}

/** `impl.checks`의 형식을 검사한다. 비어 있으면 undefined, 일부만 있으면 빠진 것을 알린다. */
export function validateImplChecks(raw: unknown): { checks?: ImplChecks; missing: MachineCheck[] } {
  if (raw === undefined || raw === null) return { missing: [...MACHINE_CHECKS] };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("impl은 키와 값의 묶음이어야 한다");
  const given = (raw as { checks?: unknown }).checks;
  if (given === undefined || given === null) return { missing: [...MACHINE_CHECKS] };
  if (typeof given !== "object" || Array.isArray(given)) throw new Error("impl.checks는 키와 값의 묶음이어야 한다");
  const checks: Partial<ImplChecks> = {};
  for (const [kind, value] of Object.entries(given as Record<string, unknown>)) {
    if (!isMachineCheck(kind)) throw new Error(`impl.checks의 검사는 ${MACHINE_CHECKS.join(", ")}이다: ${kind}`);
    const spec = validateSpec(`impl.checks.${kind}`, value);
    if (spec === NO_COMMAND && kind !== "lint") throw new Error(`impl.checks.${kind}: none은 lint에만 쓴다. 빌드와 테스트는 건너뛸 수 없다`);
    checks[kind] = spec;
  }
  const missing = MACHINE_CHECKS.filter((kind) => checks[kind] === undefined);
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
    throw new Refusal(`.mob-sdd/config.yaml의 impl.checks가 형식에 맞지 않는다: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!result.checks) {
    throw new Refusal(
      `구현 단계의 검사 명령이 설정되어 있지 않다: ${result.missing.join(", ")}. 사용자가 mob-sdd impl setup --lint <명령|none>으로 정한다(빌드와 테스트는 기본값이 있다). 검사는 CLI가 이 명령을 돌려 종료 코드로 판정한다.`,
    );
  }
  return result.checks;
}

/** 모듈에 맞는 명령. 모듈 묶음이면 그 모듈의 것, 없으면 `*`. */
export function commandFor(spec: CommandSpec, module: string): string {
  return typeof spec === "string" ? spec : (spec[module] ?? (spec["*"] as string));
}

export interface SetupOptions {
  build?: string;
  lint?: string;
  test?: string;
}

/**
 * 검사 명령을 설정에 적는다. 준 것만 바꾸고, 없는 빌드와 테스트는 기본값으로 채운다.
 * Lint는 기본값이 없다. 도구가 없으면 `none`을 명시해야 건너뜀이 되므로, 사람이 고르게 한다.
 * 설정 파일의 다른 내용과 주석은 그대로 둔다.
 */
export function implSetup(repo: Repo, options: SetupOptions): { checks: ImplChecks; changed: MachineCheck[] } {
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
      if (given === NO_COMMAND && kind !== "lint") throw new Refusal(`${kind}는 none으로 둘 수 없다. 빌드와 테스트는 건너뛸 수 없다`);
      doc.setIn(["impl", "checks", kind], given);
      changed.push(kind);
    } else if (plain?.[kind] === undefined) {
      if (kind === "lint") {
        throw new Refusal("Lint 명령이 없다. --lint <명령>을 주거나, 프로젝트에 Lint 도구가 없으면 --lint none으로 명시한다");
      }
      doc.setIn(["impl", "checks", kind], DEFAULT_COMMANDS[kind]);
      changed.push(kind);
    }
  }
  let checks: ImplChecks | undefined;
  try {
    checks = validateImplChecks(doc.toJSON()?.impl).checks;
  } catch (error) {
    throw new Refusal(`.mob-sdd/config.yaml의 impl.checks가 형식에 맞지 않는다: ${error instanceof Error ? error.message : String(error)}. 파일을 고친 뒤 다시 한다`);
  }
  if (!checks) throw new Refusal("검사 명령을 정하지 못했다");
  fs.writeFileSync(file, doc.toString());
  return { checks, changed };
}
