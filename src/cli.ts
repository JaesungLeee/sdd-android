#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  docChanges,
  docChecklist,
  docComplete,
  docConfirm,
  docNew,
  docRestore,
  docRevise,
  type RecordResult,
} from "./commands/doc.js";
import { check, formatCheck } from "./commands/check.js";
import { formatGate, gateAll, verdictText } from "./commands/gate.js";
import { formatHookOutput, hookWrite } from "./commands/hook.js";
import { loadAssets } from "./core/assets.js";
import { addExtension, directives, formatAdd, formatDirectives, formatList, formatRemove, listExtensions, removeExtension, resolveBundle } from "./commands/extension.js";
import { init, type InitOptions } from "./commands/init.js";
import { promptInit } from "./commands/init-prompt.js";
import { formatStatus, status } from "./commands/status.js";
import { formatUpgrade, upgrade } from "./commands/upgrade.js";
import { findRoot, isStage, localDate, openRepo, Refusal, type Repo, type Stage } from "./core/repo.js";
import { readManifest } from "./core/manifest.js";
import { isGrade, type Grade } from "./core/version.js";
import { VERSION } from "./version.js";

const USAGE = `sdd-first <명령>

  init                             이 저장소에 설치한다 (--language, --prefix, --yes)
  upgrade                          설치된 파일을 이 버전으로 올린다
  status [feature]                 진행 상태와 버전 체인 판정
  check                            설치와 문서에 깨진 곳이 없는지 검사한다
  gate <단계>                      그 단계의 착수 게이트 판정
  doc new <단계> [feature]         템플릿을 복사해 draft 문서를 만든다
  doc changes <단계> [feature]     기록된 해시와 비교해 바뀐 곳을 낸다
  doc complete <단계> [feature]    신규 문서의 완료를 기록한다
  doc revise <단계> [feature]      개정을 기록한다 (--grade)
  doc confirm <단계> [feature]     영향 없음을 기록한다
  doc restore <단계> [feature]     병합 뒤 메타데이터와 해시를 HEAD 쪽으로 되돌린다 (--from)
  doc checklist <feature>          체크리스트의 상태를 기록한다
  extension list|add|remove        확장의 목록, 설치(이름이나 경로), 제거
  preset list|add|remove           preset의 목록, 설치, 제거
  directives <단계>                그 단계에 적용되는 확장 지시 파일
  hook write                       쓰기 hook (입력은 표준 입력의 JSON)

옵션: --json, --acknowledged, --grade <등급|항목=등급>, --depends <ID,ID>, --root <경로>, --version`;

const OPTIONS = {
  json: { type: "boolean", default: false },
  acknowledged: { type: "boolean", default: false },
  grade: { type: "string", multiple: true, default: [] as string[] },
  depends: { type: "string" },
  root: { type: "string" },
  from: { type: "string" },
  language: { type: "string", default: "ko" },
  prefix: { type: "string" },
  yes: { type: "boolean", short: "y", default: false },
  version: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

const SELF = fileURLToPath(import.meta.url);

function isInstalledBundle(): boolean {
  const binDir = path.dirname(SELF);
  return path.basename(binDir) === "bin" && path.basename(path.dirname(binDir)) === ".sdd-first";
}

/**
 * npx로 받은 CLI는 `init`과 `upgrade`만 직접 하고 나머지는 저장소의 번들에 넘긴다(PRD CLI-003).
 * 판정은 언제나 저장소의 번들이 해야 팀원 사이에 결과가 어긋나지 않는다.
 */
function delegate(argv: string[]): boolean {
  const command = argv.find((arg) => !arg.startsWith("-"));
  if (isInstalledBundle() || command === "init" || command === "upgrade" || argv.length === 0) return false;
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag >= 0 ? argv[rootFlag + 1] : (process.env.SDD_FIRST_ROOT ?? findRoot(process.cwd()));
  if (!root) return false;
  const bundle = path.join(path.resolve(root), ".sdd-first", "bin", "sdd-first.mjs");
  if (!fs.existsSync(bundle) || fs.realpathSync(bundle) === fs.realpathSync(SELF)) return false;

  const installed = readManifest(path.resolve(root))?.version;
  if (installed && installed !== VERSION && VERSION !== "0.0.0-dev") {
    console.error(`저장소에 설치된 버전은 ${installed}다(실행한 버전 ${VERSION}). 올리려면 npx sdd-first@latest upgrade`);
  }
  const result = spawnSync(process.execPath, [bundle, ...argv], { stdio: "inherit" });
  process.exitCode = result.status ?? 2;
  return true;
}

/** CLI는 작업 디렉터리가 아니라 자기 파일의 위치로 저장소 루트를 정한다(PRD CLI-003). */
function resolveRoot(explicit: string | undefined): string {
  if (explicit) return path.resolve(explicit);
  if (process.env.SDD_FIRST_ROOT) return path.resolve(process.env.SDD_FIRST_ROOT);

  if (isInstalledBundle()) return path.dirname(path.dirname(path.dirname(SELF)));
  const found = findRoot(process.cwd());
  if (!found) throw new Refusal("sdd-first가 설치된 저장소를 찾지 못했다");
  return found;
}

function requireStage(value: string | undefined): Stage {
  if (!value || !isStage(value)) {
    throw new Refusal(`단계 이름이 필요하다: constitution, prd, spec, blueprint, breakdown (받은 값: ${value ?? "없음"})`);
  }
  return value;
}

function parseGrades(values: string[]): { grade?: Grade; grades?: Record<string, Grade> } {
  let grade: Grade | undefined;
  const grades: Record<string, Grade> = {};
  for (const value of values) {
    const split = value.lastIndexOf("=");
    const name = split < 0 ? undefined : value.slice(0, split);
    const level = split < 0 ? value : value.slice(split + 1);
    if (!isGrade(level)) throw new Refusal(`등급이 아니다: ${value}`);
    if (name === undefined) grade = level;
    else grades[name] = level;
  }
  return { grade, grades: Object.keys(grades).length > 0 ? grades : undefined };
}

function formatRecord(result: RecordResult): string {
  const lines = [`버전 ${result.version}${result.grade ? ` (${result.grade})` : ""}`];
  for (const stale of result.stale) {
    lines.push(`- ${stale.feature}: ${stale.lower} → ${stale.upper} ${verdictText(stale.verdict)}`);
  }
  return lines.join("\n");
}

function run(argv: string[]): { text: string; data: unknown; exitCode?: number } {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const [command, ...rest] = positionals;
  if (values.version) return { text: VERSION, data: { version: VERSION } };
  if (values.help || !command) return { text: USAGE, data: { usage: USAGE } };

  if (command === "upgrade") {
    // 저장소의 번들은 자기 자신을 새 버전으로 바꿀 수 없다. 새 버전의 패키지로 실행해야 한다.
    if (isInstalledBundle()) throw new Refusal("upgrade는 새 버전의 패키지로 실행한다: npx sdd-first@latest upgrade");
    const changelogFile = path.join(path.dirname(SELF), "CHANGELOG.md");
    const result = upgrade({
      target: resolveRoot(values.root),
      assets: loadAssets(SELF),
      bundlePath: SELF,
      version: VERSION,
      changelog: fs.existsSync(changelogFile) ? fs.readFileSync(changelogFile, "utf8") : undefined,
    });
    return { text: formatUpgrade(result), data: result };
  }

  const repo: Repo = openRepo(resolveRoot(values.root));
  const write = { today: localDate(), acknowledged: values.acknowledged };
  const depends = values.depends === undefined ? undefined : values.depends.split(",").filter(Boolean);

  if (command === "status") {
    const result = status(repo, rest[0]);
    return { text: formatStatus(result), data: result };
  }
  if (command === "check") {
    const result = check(repo);
    return { text: formatCheck(result), data: result, exitCode: result.ok ? 0 : 1 };
  }
  if (command === "gate") {
    const result = gateAll(repo, requireStage(rest[0]));
    return { text: formatGate(result), data: result };
  }
  if (command === "extension" || command === "preset") {
    const assets = loadAssets(SELF);
    const [action, target] = rest;
    if (action === "list") {
      const result = listExtensions(repo, assets, command);
      return { text: formatList(result), data: result };
    }
    if (action === "add" && target) {
      const { bundle, origin } = resolveBundle(repo, assets, target);
      const result = addExtension(repo, assets, bundle, { origin, expectKind: command });
      return { text: formatAdd(result), data: result };
    }
    if (action === "remove" && target) {
      const result = removeExtension(repo, assets, target, command);
      return { text: formatRemove(result), data: result };
    }
    throw new Refusal(`${command} 명령은 list, add <이름|경로>, remove <이름> 가운데 하나다`);
  }
  if (command === "directives") {
    if (!rest[0]) throw new Refusal("단계 이름이 필요하다");
    const found = directives(repo, rest[0]);
    return { text: formatDirectives(found), data: found };
  }
  if (command === "hook" && rest[0] === "write") {
    const input = JSON.parse(fs.readFileSync(0, "utf8")) as { tool_input?: { file_path?: string } };
    const file = input.tool_input?.file_path;
    const decision = file ? hookWrite(repo, file) : { allow: true };
    return { text: formatHookOutput(decision), data: decision };
  }
  if (command === "doc") {
    const [action, first, second] = rest;
    if (action === "checklist") {
      const result = docChecklist(repo, first);
      return { text: `checklist: ${result.status} (${result.checked}/${result.total})`, data: result };
    }
    const stage = requireStage(first);
    switch (action) {
      case "new": {
        const result = docNew(repo, stage, second, write);
        return { text: result.created.map((file) => `만들었다: ${path.relative(repo.root, file)}`).join("\n"), data: result };
      }
      case "changes": {
        const result = docChanges(repo, stage, second);
        const text = result.dirty
          ? [
              `기준 버전 ${result.version}`,
              `바뀐 곳: ${result.changed.join(", ") || "없음"}`,
              `새 항목: ${result.added.join(", ") || "없음"}`,
              `지워진 항목: ${result.removed.join(", ") || "없음"}`,
            ].join("\n")
          : `기준 버전 ${result.version}\n바뀐 곳이 없다.`;
        const duplicates = result.duplicates.flatMap((duplicate) => [
          `번호가 겹친 항목: ${duplicate.id}`,
          ...duplicate.headings.map((heading, index) => {
            const side = duplicate.original === undefined ? "" : duplicate.original === index + 1 ? " (원래 있던 항목)" : " (들어온 항목. 새 번호를 준다)";
            return `  ${index + 1}. ${heading}${side}`;
          }),
          ...(duplicate.dependents.length > 0 ? [`  이 ID에 의존하는 문서: ${duplicate.dependents.join(", ")}`] : []),
        ]);
        return { text: [text, ...duplicates].join("\n"), data: result };
      }
      case "complete": {
        const result = docComplete(repo, stage, second, { ...write, depends });
        return { text: formatRecord(result), data: result };
      }
      case "revise": {
        const result = docRevise(repo, stage, second, { ...write, depends, ...parseGrades(values.grade) });
        return { text: formatRecord(result), data: result };
      }
      case "restore": {
        const result = docRestore(repo, stage, second, { from: values.from });
        const lines = [
          `${result.from}의 기록으로 되돌렸다${result.version ? ` (버전 ${result.version})` : ""}.`,
          ...result.restored.map((file) => `- ${file}`),
          "이어서 doc changes로 들어온 변경을 확인하고 개정으로 기록한다.",
        ];
        return { text: lines.join("\n"), data: result };
      }
      case "confirm": {
        const result = docConfirm(repo, stage, second, { depends });
        const text = result.updated.length > 0 ? `기준 버전을 올렸다: ${result.updated.join(", ")}` : "올릴 기준 버전이 없다.";
        return { text, data: result };
      }
    }
  }
  throw new Refusal(`알 수 없는 명령이다: ${positionals.join(" ")}\n\n${USAGE}`);
}

/**
 * 설치. 터미널에서 실행했고 `--yes`가 없으면 묻고, 아니면 인자와 기본값으로 진행한다.
 * 스크립트와 CI에서는 묻지 않아야 멈추지 않는다.
 */
async function runInit(argv: string[]): Promise<{ text: string; data: unknown }> {
  const { values } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const base: InitOptions = {
    target: path.resolve(values.root ?? process.cwd()),
    language: values.language,
    prefix: values.prefix ?? "",
    assets: loadAssets(SELF),
    bundlePath: SELF,
    version: VERSION,
    today: localDate(),
  };
  let options: InitOptions | undefined = base;

  if (process.stdin.isTTY && !values.yes && !values.json) {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      options = await promptInit(base, {
        prefixGiven: values.prefix !== undefined,
        ask: (question) => terminal.question(question),
        print: (text) => console.log(text),
      });
    } finally {
      terminal.close();
    }
    if (!options) return { text: "설치하지 않았다.", data: { installed: false } };
  }

  const result = init(options);
  const lines = [
    `sdd-first ${VERSION}을 설치했다.`,
    ...result.files.map((file) => `- ${file}`),
    ...result.backedUp.map((moved) => `옮겼다: ${moved.from} → ${moved.to}`),
    "",
    result.skills.length > 0
      ? `첫 단계: /${result.skills.find((name) => name.endsWith("constitution")) ?? result.skills[0]}`
      : "",
  ];
  return { text: lines.join("\n").trimEnd(), data: result };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  try {
    if (delegate(argv)) return;
    const first = argv.find((arg) => !arg.startsWith("-"));
    const wantsInfo = argv.includes("--help") || argv.includes("-h") || argv.includes("--version");
    const { text, data, exitCode }: { text: string; data: unknown; exitCode?: number } =
      first === "init" && !wantsInfo ? await runInit(argv) : run(argv);
    const output = json ? JSON.stringify(data, null, 2) : text;
    if (output) console.log(output);
    if (exitCode) process.exitCode = exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(message);
    process.exitCode = error instanceof Refusal ? 1 : 2;
  }
}

void main();
