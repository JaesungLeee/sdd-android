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
import { fixCheck, formatFixCheck } from "./commands/fix.js";
import { formatGate, gateAll, isGateStage, verdictText, type GateStage } from "./commands/gate.js";
import { figmaSetup, figmaShow, formatFigmaSetup, formatFigmaShow } from "./commands/figma.js";
import { formatHookOutput, hookWrite } from "./commands/hook.js";
import {
  formatAssign,
  formatAttempt,
  formatCheck as formatImplCheck,
  formatFinal,
  formatNext,
  formatReport,
  formatShow,
  formatStart,
  formatVerify,
  implAssign,
  implAttempt,
  implCheck,
  implFinal,
  implNext,
  implReport,
  implReset,
  implShow,
  implStart,
  implVerify,
  parseChecks,
} from "./commands/impl.js";
import { isCheck, type Check } from "./core/checkpoint.js";
import { implSetup, MACHINE_CHECKS } from "./core/impl-config.js";
import { loadAssets } from "./core/assets.js";
import { init, type InitOptions } from "./commands/init.js";
import { promptInit } from "./commands/init-prompt.js";
import { formatStatus, status } from "./commands/status.js";
import { formatUpgrade, upgrade } from "./commands/upgrade.js";
import { addSource, formatSources as formatOpenApiSources, listSources, removeSource } from "./commands/openapi.js";
import { queryOperations } from "./openapi/operations.js";
import { findRoot, isStage, localDate, openRepo, Refusal, type Repo, type Stage } from "./core/repo.js";
import { readManifest } from "./core/manifest.js";
import { isGrade, type Grade } from "./core/version.js";
import { VERSION } from "./version.js";

const USAGE = `sdd-android <명령>

  init                             이 저장소에 설치한다 (--language, --prefix, --yes)
  upgrade                          설치된 파일을 이 버전으로 올린다
  status [feature]                 진행 상태와 버전 체인 판정
  check                            설치와 문서에 깨진 곳이 없는지 검사한다
  gate <단계>                      그 단계의 착수 게이트 판정 (implement 포함)
  doc new <단계> [feature]         템플릿을 복사해 draft 문서를 만든다
  doc changes <단계> [feature]     기록된 해시와 비교해 바뀐 곳을 낸다
  doc complete <단계> [feature]    신규 문서의 완료를 기록한다
  doc revise <단계> [feature]      개정을 기록한다 (--grade)
  doc confirm <단계> [feature]     영향 없음을 기록한다
  doc restore <단계> [feature]     병합 뒤 메타데이터와 해시를 HEAD 쪽으로 되돌린다 (--from)
  doc checklist <feature>          체크리스트의 상태를 기록한다
  figma show|setup                 Figma 서버 설정과 읽기 도구의 권한 (--server, --name)
  hook write                       쓰기 hook (입력은 표준 입력의 JSON)
  fix check <feature> <FIX-001>    /fix가 더한 수정 단위가 작은 수정의 범위 안인지 판정한다 (--no-test <사유>)
  impl start <feature>             착수 게이트를 확인하고 체크포인트를 만든다 (--fix <FIX-001>이면 그 수정 단위만)
  impl assign <feature> T001=종류… 작업의 종류를 기록한다 (test, logic, ui, structure)
  impl next <feature>              다음 작업과 종류, 단계
  impl report <feature> <작업>     구현 보고 (--status done|blocked|handed, --modules, --files, --previews)
  impl setup                       기계 검사의 명령을 config.yaml에 적는다 (--build, --lint <명령|none>, --test, --rules <명령|none>)
  impl check <feature> [작업]      CLI가 빌드, Lint, 규칙, 테스트를 돌려 종료 코드로 적는다 (--final이면 마지막 확인)
  impl verify <feature> [작업]     검증 결과를 판정한다. 빌드·Lint·테스트는 impl check의 결과를 쓴다 (--check 디자인·원칙=결과, 실패 지목, --files, --unit)
  impl attempt <feature> <작업>    치유 직전에 시도를 센다 (--failure, --symptom, --note)
  impl final <feature>             마지막 확인 (--result pass|fail, 통과면 impl check --final 뒤에 --check 원칙·디자인=pass|skip, 실패면 --files, --failure, --symptom)
  impl reset <feature> <작업>      사용자가 승인한 뒤 시도 횟수를 초기화한다
  impl show <feature>              체크포인트
  openapi list|add|remove          OpenAPI 출처의 목록, 추가(--url이나 --path), 제거. config.yaml의 openapi.sources를 쓴다
  openapi operations               출처마다 문서를 조회해 오퍼레이션 목록을 낸다 (--source, --filter)
  openapi show <오퍼레이션>…       고른 오퍼레이션의 파라미터, 요청, 응답을 펼친다. operationId나 "METHOD /path" (--source)

옵션: --json, --acknowledged, --grade <등급|항목=등급>, --depends <ID,ID>, --root <경로>, --version`;

const OPTIONS = {
  json: { type: "boolean", default: false },
  acknowledged: { type: "boolean", default: false },
  grade: { type: "string", multiple: true, default: [] as string[] },
  depends: { type: "string" },
  root: { type: "string" },
  from: { type: "string" },
  status: { type: "string" },
  modules: { type: "string" },
  files: { type: "string" },
  previews: { type: "string" },
  check: { type: "string", multiple: true, default: [] as string[] },
  unit: { type: "string" },
  failure: { type: "string" },
  symptom: { type: "string" },
  note: { type: "string" },
  result: { type: "string" },
  final: { type: "boolean", default: false },
  build: { type: "string" },
  lint: { type: "string" },
  test: { type: "string" },
  rules: { type: "string" },
  fix: { type: "string" },
  "no-test": { type: "string" },
  language: { type: "string", default: "ko" },
  prefix: { type: "string" },
  yes: { type: "boolean", short: "y", default: false },
  server: { type: "string" },
  name: { type: "string" },
  url: { type: "string" },
  path: { type: "string" },
  source: { type: "string" },
  filter: { type: "string" },
  version: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

const SELF = fileURLToPath(import.meta.url);

/** 첫 명령의 위치와 그 앞의 `--root`. 값을 받는 옵션(`--root X`)의 값은 명령이 아니다. */
function locateCommand(argv: string[]): { index: number; root?: string } {
  let root: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (!arg.startsWith("-")) return { index: i, ...(root !== undefined ? { root } : {}) };
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const flag = arg.slice(2, eq < 0 ? undefined : eq);
    const inline = eq < 0 ? undefined : arg.slice(eq + 1);
    const option = (OPTIONS as Record<string, { type: string }>)[flag];
    if (option?.type !== "string" || inline !== undefined) {
      if (flag === "root" && inline !== undefined) root = inline;
      continue;
    }
    if (flag === "root") root = argv[i + 1];
    i += 1;
  }
  return { index: -1, ...(root !== undefined ? { root } : {}) };
}

function isInstalledBundle(): boolean {
  const binDir = path.dirname(SELF);
  return path.basename(binDir) === "bin" && path.basename(path.dirname(binDir)) === ".sdd-android";
}

/**
 * npx로 받은 CLI는 `init`과 `upgrade`만 직접 하고 나머지는 저장소의 번들에 넘긴다(PRD CLI-003).
 * 판정은 언제나 저장소의 번들이 해야 팀원 사이에 결과가 어긋나지 않는다.
 */
function delegate(argv: string[]): boolean {
  const located = locateCommand(argv);
  const command = located.index >= 0 ? argv[located.index] : undefined;
  if (isInstalledBundle() || command === "init" || command === "upgrade" || argv.length === 0) return false;
  const root = located.root ?? process.env.SDD_ANDROID_ROOT ?? findRoot(process.cwd());
  if (!root) return false;
  const bundle = path.join(path.resolve(root), ".sdd-android", "bin", "sdd-android.mjs");
  if (!fs.existsSync(bundle) || fs.realpathSync(bundle) === fs.realpathSync(SELF)) return false;

  const installed = readManifest(path.resolve(root))?.version;
  if (installed && installed !== VERSION && VERSION !== "0.0.0-dev") {
    console.error(`저장소에 설치된 버전은 ${installed}다(실행한 버전 ${VERSION}). 올리려면 npx sdd-android@latest upgrade`);
  }
  const result = spawnSync(process.execPath, [bundle, ...argv], { stdio: "inherit" });
  process.exitCode = result.status ?? 2;
  return true;
}

/** CLI는 작업 디렉터리가 아니라 자기 파일의 위치로 저장소 루트를 정한다(PRD CLI-003). */
function resolveRoot(explicit: string | undefined): string {
  if (explicit) return path.resolve(explicit);
  if (process.env.SDD_ANDROID_ROOT) return path.resolve(process.env.SDD_ANDROID_ROOT);

  if (isInstalledBundle()) return path.dirname(path.dirname(path.dirname(SELF)));
  const found = findRoot(process.cwd());
  if (!found) throw new Refusal("sdd-android가 설치된 저장소를 찾지 못했다");
  return found;
}

function requireStage(value: string | undefined): Stage {
  if (!value || !isStage(value)) {
    throw new Refusal(`단계 이름이 필요하다: constitution, prd, spec, blueprint, breakdown (받은 값: ${value ?? "없음"})`);
  }
  return value;
}

function requireGateStage(value: string | undefined): GateStage {
  if (!value || !isGateStage(value)) {
    throw new Refusal(`단계 이름이 필요하다: constitution, prd, spec, blueprint, breakdown, implement (받은 값: ${value ?? "없음"})`);
  }
  return value;
}

function requireFeatureArg(value: string | undefined): string {
  if (!value) throw new Refusal("feature 이름이 필요하다");
  return value;
}

function requireTaskArg(value: string | undefined): string {
  if (!value) throw new Refusal("작업 ID가 필요하다");
  return value;
}

function splitList(value: string | undefined): string[] | undefined {
  return value === undefined ? undefined : value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseFailure(value: string | undefined): Check | undefined {
  if (value === undefined) return undefined;
  if (!isCheck(value)) throw new Refusal(`실패 종류는 build, lint, test, rules, design, principles 가운데 하나다: ${value}`);
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

async function run(argv: string[]): Promise<{ text: string; data: unknown; exitCode?: number }> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const [command, ...rest] = positionals;
  if (values.version) return { text: VERSION, data: { version: VERSION } };
  if (values.help || !command) return { text: USAGE, data: { usage: USAGE } };

  if (command === "upgrade") {
    // 저장소의 번들은 자기 자신을 새 버전으로 바꿀 수 없다. 새 버전의 패키지로 실행해야 한다.
    if (isInstalledBundle()) throw new Refusal("upgrade는 새 버전의 패키지로 실행한다: npx sdd-android@latest upgrade");
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
    const result = gateAll(repo, requireGateStage(rest[0]));
    return { text: formatGate(result), data: result };
  }
  if (command === "fix") {
    const [action, featureArg, fixArg] = rest;
    if (action !== "check") throw new Refusal("fix 명령은 check다: fix check <feature> <FIX-001>");
    if (!fixArg) throw new Refusal("수정 단위의 ID가 필요하다: fix check <feature> <FIX-001>");
    const result = fixCheck(repo, requireFeatureArg(featureArg), fixArg, values["no-test"] ? { noTest: values["no-test"] } : {});
    return { text: formatFixCheck(result), data: result };
  }
  if (command === "impl") {
    const [action, featureArg, taskArg] = rest;
    if (action === "setup") {
      const result = implSetup(repo, { build: values.build, lint: values.lint, test: values.test, rules: values.rules });
      const lines = MACHINE_CHECKS.map((kind) => `- ${kind}: ${result.checks[kind] === undefined ? "없음" : JSON.stringify(result.checks[kind])}${result.changed.includes(kind) ? " (적음)" : ""}`);
      return { text: ["구현 단계의 검사 명령 (.sdd-android/config.yaml의 impl.checks):", ...lines].join("\n"), data: result };
    }
    const feature = requireFeatureArg(featureArg);
    const today = write.today;
    switch (action) {
      case "start": {
        const result = implStart(repo, feature, { ...write, ...(values.fix ? { fix: values.fix } : {}) });
        return { text: formatStart(result), data: result };
      }
      case "assign": {
        const result = implAssign(repo, feature, rest.slice(2));
        return { text: formatAssign(result), data: result };
      }
      case "next": {
        const result = implNext(repo, feature);
        return { text: formatNext(result), data: result };
      }
      case "report": {
        const status = values.status;
        if (status !== "done" && status !== "blocked" && status !== "handed") throw new Refusal("--status는 done, blocked, handed 가운데 하나다");
        const result = implReport(repo, feature, requireTaskArg(taskArg), {
          today,
          status,
          modules: splitList(values.modules),
          files: splitList(values.files),
          previews: splitList(values.previews),
          failure: parseFailure(values.failure),
          symptom: values.symptom,
          note: values.note,
        });
        return { text: formatReport(result), data: result };
      }
      case "check": {
        if (values.final && taskArg) throw new Refusal("--final은 작업 없이 feature 전체를 돌린다");
        if (!values.final && !taskArg) throw new Refusal("작업 ID가 필요하다. 마지막 확인이면 --final");
        const result = implCheck(repo, feature, values.final ? undefined : taskArg);
        return { text: formatImplCheck(result), data: result };
      }
      case "verify": {
        const result = implVerify(repo, feature, taskArg, { today, checks: parseChecks(values.check), files: splitList(values.files), unit: values.unit });
        return { text: formatVerify(result), data: result };
      }
      case "attempt": {
        const failure = parseFailure(values.failure);
        if (!failure) throw new Refusal("--failure가 필요하다");
        if (!values.note) throw new Refusal("--note에 짚은 원인과 시도를 적는다");
        const result = implAttempt(repo, feature, requireTaskArg(taskArg), { today, failure, symptom: values.symptom, note: values.note });
        return { text: formatAttempt(result), data: result };
      }
      case "final": {
        if (values.result !== "pass" && values.result !== "fail") throw new Refusal("--result는 pass나 fail이다");
        const result = implFinal(repo, feature, {
          today,
          result: values.result,
          checks: parseChecks(values.check),
          files: splitList(values.files),
          failure: parseFailure(values.failure),
          symptom: values.symptom,
        });
        return { text: formatFinal(result), data: result };
      }
      case "reset": {
        const result = implReset(repo, feature, requireTaskArg(taskArg));
        return { text: `${result.task}의 시도 횟수를 초기화했다.`, data: result };
      }
      case "show": {
        const result = implShow(repo, feature);
        return { text: formatShow(result), data: result };
      }
    }
    throw new Refusal("impl 명령은 setup, start, assign, next, report, check, verify, attempt, final, reset, show 가운데 하나다");
  }
  if (command === "figma") {
    if (rest[0] === "show") {
      const result = figmaShow(repo);
      return { text: formatFigmaShow(result), data: result };
    }
    if (rest[0] === "setup") {
      const result = figmaSetup(repo, { server: values.server, name: values.name });
      return { text: formatFigmaSetup(result), data: result };
    }
    throw new Refusal("figma 명령은 show나 setup이다");
  }
  if (command === "openapi") {
    const [action, name] = rest;
    if (action === "list") {
      const result = listSources(repo);
      return { text: formatOpenApiSources(result), data: { sources: result } };
    }
    if (action === "add") {
      const result = await addSource(repo, name, { url: values.url, path: values.path });
      const lines = [
        `출처를 ${result.replaced ? "바꿨다" : "더했다"}: ${result.source.name}`,
        ...(result.resolvedFrom ? [`${result.resolvedFrom}은 Swagger UI 페이지라 그 페이지가 읽는 문서의 주소로 바꿨다: ${result.source.url}`] : []),
        ...(result.note ? [result.note] : []),
        formatOpenApiSources(result.sources),
      ];
      return { text: lines.join("\n"), data: result };
    }
    if (action === "remove") {
      const result = removeSource(repo, name);
      return { text: `출처를 뺐다: ${result.removed.name}
${formatOpenApiSources(result.sources)}`, data: result };
    }
    if (action === "operations" || action === "show") {
      const text = await queryOperations(repo.root, action, { source: values.source, filter: values.filter, selectors: rest.slice(1) });
      return { text, data: { text } };
    }
    throw new Refusal("openapi 명령은 list, add <이름> --url <주소>|--path <경로>, remove <이름>, operations, show <오퍼레이션>… 가운데 하나다");
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
    `sdd-android ${VERSION}을 설치했다.`,
    ...result.files.map((file) => `- ${file}`),
    ...result.backedUp.map((moved) => `옮겼다: ${moved.from} → ${moved.to}`),
    "",
    result.skills.length > 0
      ? `첫 단계: /${result.skills.find((name) => name.endsWith("constitution")) ?? result.skills[0]}`
      : "",
    "구현 단계를 쓰기 전에 sdd-android impl setup --lint <명령|none>으로 검사 명령을 정한다.",
    "Figma를 쓰면 sdd-android figma setup --server desktop|remote --name <등록 이름>으로 서버와 권한을 정한다.",
  ];
  return { text: lines.join("\n").trimEnd(), data: result };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  try {
    if (delegate(argv)) return;
    const located = locateCommand(argv);
    const first = located.index >= 0 ? argv[located.index] : undefined;
    const wantsInfo = argv.includes("--help") || argv.includes("-h") || argv.includes("--version");
    const { text, data, exitCode }: { text: string; data: unknown; exitCode?: number } =
      first === "init" && !wantsInfo ? await runInit(argv) : await run(argv);
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
