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
import { formatGate, gateAll, isGateStage, verdictText, type GateStage } from "./commands/gate.js";
import { figmaSetup, figmaShow, formatFigmaSetup, formatFigmaShow } from "./commands/figma.js";
import { formatHookOutput, hookWrite, hookWriteScoped, isHookScope } from "./commands/hook.js";
import {
  formatAssign,
  formatAttempt,
  formatFinal,
  formatNext,
  formatReport,
  formatShow,
  formatStart,
  formatVerify,
  implAssign,
  implAttempt,
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
import { loadAssets } from "./core/assets.js";
import { addExtension, directives, formatAdd, formatDirectives, formatList, formatRemove, listExtensions, removeExtension, resolveBundle } from "./commands/extension.js";
import { init, type InitOptions } from "./commands/init.js";
import { promptInit } from "./commands/init-prompt.js";
import { formatStatus, status } from "./commands/status.js";
import { formatUpgrade, upgrade } from "./commands/upgrade.js";
import { runScript } from "./commands/run.js";
import { addSource, formatSources as formatOpenApiSources, listSources, removeSource } from "./commands/openapi.js";
import { formatIndex, formatLint, formatRecord as formatWikiRecord, formatSources, wikiCategoryAdd, wikiIndex, wikiLint, wikiRecord, wikiSources } from "./commands/wiki.js";
import { findRoot, isStage, localDate, openRepo, Refusal, type Repo, type Stage } from "./core/repo.js";
import { readManifest } from "./core/manifest.js";
import { isGrade, type Grade } from "./core/version.js";
import { VERSION } from "./version.js";

const USAGE = `mob-sdd <명령>

  init                             이 저장소에 설치한다 (--language, --prefix, --yes, --extension <내장 확장>)
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
  extension list|add|remove        확장의 목록, 설치(이름이나 경로), 제거
  figma show|setup                 Figma 서버 설정과 읽기 도구의 권한 (--server, --name)
  preset list|add|remove           preset의 목록, 설치, 제거
  directives <단계>                그 단계에 적용되는 확장 지시 파일
  hook write                       쓰기 hook (입력은 표준 입력의 JSON, --scope wiki면 위키 밖의 문서 쓰기를 막는다)
  impl start <feature>             착수 게이트를 확인하고 체크포인트를 만든다
  impl assign <feature> T001=종류… 작업의 종류를 기록한다 (test, logic, ui, structure)
  impl next <feature>              다음 작업과 종류, 단계
  impl report <feature> <작업>     구현 보고 (--status done|blocked|handed, --modules, --files, --previews)
  impl verify <feature> [작업]     검증 결과 (--check 종류=결과…, --files, --unit)
  impl attempt <feature> <작업>    치유 직전에 시도를 센다 (--failure, --symptom, --note)
  impl final <feature>             마지막 확인 (--result pass|fail, 통과면 --check 검사=pass|skip 모두, 실패면 --files, --failure, --symptom)
  impl reset <feature> <작업>      사용자가 승인한 뒤 시도 횟수를 초기화한다
  impl show <feature>              체크포인트
  openapi list|add|remove          OpenAPI 출처의 목록, 추가(--url이나 --path), 제거. config.yaml의 openapi.sources를 쓴다
  run <확장> <스크립트> [인자…]    확장의 scripts/ 아래 .mjs를 실행한다 (인자는 그대로 넘긴다)
  wiki index                       위키 색인을 다시 만든다
  wiki record <페이지>…            페이지의 원본 해시와 commit을 적고 색인을 다시 만든다
  wiki lint                        위키 점검의 계산 부분 (형식, 깨진 링크, 원본 없음, 낡음 후보, 고아, 색인)
  wiki sources                     미수집 원본과 낡음 후보
  wiki category add <이름>         갈래를 설정에 더한다 (--description)

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
  language: { type: "string", default: "ko" },
  prefix: { type: "string" },
  yes: { type: "boolean", short: "y", default: false },
  extension: { type: "string", multiple: true },
  server: { type: "string" },
  name: { type: "string" },
  description: { type: "string" },
  scope: { type: "string" },
  url: { type: "string" },
  path: { type: "string" },
  version: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

const SELF = fileURLToPath(import.meta.url);

function isInstalledBundle(): boolean {
  const binDir = path.dirname(SELF);
  return path.basename(binDir) === "bin" && path.basename(path.dirname(binDir)) === ".mob-sdd";
}

/**
 * npx로 받은 CLI는 `init`과 `upgrade`만 직접 하고 나머지는 저장소의 번들에 넘긴다(PRD CLI-003).
 * 판정은 언제나 저장소의 번들이 해야 팀원 사이에 결과가 어긋나지 않는다.
 */
function delegate(argv: string[]): boolean {
  const command = argv.find((arg) => !arg.startsWith("-"));
  if (isInstalledBundle() || command === "init" || command === "upgrade" || argv.length === 0) return false;
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag >= 0 ? argv[rootFlag + 1] : (process.env.MOB_SDD_ROOT ?? findRoot(process.cwd()));
  if (!root) return false;
  const bundle = path.join(path.resolve(root), ".mob-sdd", "bin", "mob-sdd.mjs");
  if (!fs.existsSync(bundle) || fs.realpathSync(bundle) === fs.realpathSync(SELF)) return false;

  const installed = readManifest(path.resolve(root))?.version;
  if (installed && installed !== VERSION && VERSION !== "0.0.0-dev") {
    console.error(`저장소에 설치된 버전은 ${installed}다(실행한 버전 ${VERSION}). 올리려면 npx mob-sdd@latest upgrade`);
  }
  const result = spawnSync(process.execPath, [bundle, ...argv], { stdio: "inherit" });
  process.exitCode = result.status ?? 2;
  return true;
}

/** CLI는 작업 디렉터리가 아니라 자기 파일의 위치로 저장소 루트를 정한다(PRD CLI-003). */
function resolveRoot(explicit: string | undefined): string {
  if (explicit) return path.resolve(explicit);
  if (process.env.MOB_SDD_ROOT) return path.resolve(process.env.MOB_SDD_ROOT);

  if (isInstalledBundle()) return path.dirname(path.dirname(path.dirname(SELF)));
  const found = findRoot(process.cwd());
  if (!found) throw new Refusal("mob-sdd가 설치된 저장소를 찾지 못했다");
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
  if (!isCheck(value)) throw new Refusal(`실패 종류는 build, lint, test, design, principles 가운데 하나다: ${value}`);
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
    if (isInstalledBundle()) throw new Refusal("upgrade는 새 버전의 패키지로 실행한다: npx mob-sdd@latest upgrade");
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
    const result = check(repo, undefined, loadAssets(SELF));
    return { text: formatCheck(result), data: result, exitCode: result.ok ? 0 : 1 };
  }
  if (command === "gate") {
    const result = gateAll(repo, requireGateStage(rest[0]));
    return { text: formatGate(result), data: result };
  }
  if (command === "impl") {
    const [action, featureArg, taskArg] = rest;
    const feature = requireFeatureArg(featureArg);
    const today = write.today;
    switch (action) {
      case "start": {
        const result = implStart(repo, feature, write);
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
    throw new Refusal("impl 명령은 start, assign, next, report, verify, attempt, final, reset, show 가운데 하나다");
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
    throw new Refusal("openapi 명령은 list, add <이름> --url <주소>|--path <경로>, remove <이름> 가운데 하나다");
  }
  if (command === "wiki") {
    const [action, ...args] = rest;
    switch (action) {
      case "index": {
        const result = wikiIndex(repo);
        return { text: formatIndex(result), data: result };
      }
      case "record": {
        const result = wikiRecord(repo, args);
        return { text: formatWikiRecord(result), data: result };
      }
      case "lint": {
        const result = wikiLint(repo);
        return { text: formatLint(result), data: result };
      }
      case "sources": {
        const result = wikiSources(repo);
        return { text: formatSources(result), data: result };
      }
      case "category": {
        if (args[0] !== "add") throw new Refusal("wiki category 명령은 add <이름> --description <설명>이다");
        const result = wikiCategoryAdd(repo, args[1], values.description);
        return { text: `갈래를 더했다: ${result.name} (${result.description})`, data: result };
      }
    }
    throw new Refusal("wiki 명령은 index, record, lint, sources, category add 가운데 하나다");
  }
  if (command === "directives") {
    if (!rest[0]) throw new Refusal("단계 이름이 필요하다");
    const found = directives(repo, rest[0]);
    return { text: formatDirectives(found), data: found };
  }
  if (command === "hook" && rest[0] === "write") {
    const input = JSON.parse(fs.readFileSync(0, "utf8")) as { tool_input?: { file_path?: string } };
    const file = input.tool_input?.file_path;
    const scope = values.scope;
    if (scope !== undefined && !isHookScope(scope)) throw new Refusal(`--scope는 wiki다: ${scope}`);
    const decision = !file ? { allow: true } : scope ? hookWriteScoped(repo, file, scope) : hookWrite(repo, file);
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
    ...(values.extension !== undefined ? { extensions: values.extension } : {}),
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
        extensionsGiven: values.extension !== undefined,
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
    `mob-sdd ${VERSION}을 설치했다.`,
    ...result.files.map((file) => `- ${file}`),
    ...result.backedUp.map((moved) => `옮겼다: ${moved.from} → ${moved.to}`),
    result.extensions.length > 0 ? `함께 설치한 확장: ${result.extensions.join(", ")}` : "구현 단계는 확장으로 더한다: mob-sdd extension add android",
    ...(result.existingCode && !result.extensions.includes("wiki")
      ? ["기존 코드가 있다. mob-sdd extension add wiki로 위키를 설치하고 /wiki-ingest로 첫 수집을 하면 단계들이 코드베이스의 서술을 읽는다."]
      : []),
    "",
    result.skills.length > 0
      ? `첫 단계: /${result.skills.find((name) => name.endsWith("constitution")) ?? result.skills[0]}`
      : "",
    ...(result.extensions.includes("android") ? ["Figma를 쓰면 mob-sdd figma setup --server desktop|remote --name <등록 이름>으로 서버와 권한을 정한다."] : []),
    ...(result.extensions.includes("wiki") && result.existingCode ? ["첫 수집: /wiki-ingest 로 architecture/overview.md부터 만든다."] : []),
  ];
  return { text: lines.join("\n").trimEnd(), data: result };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  try {
    if (delegate(argv)) return;
    const first = argv.find((arg) => !arg.startsWith("-"));
    // 스크립트의 인자는 이 CLI의 옵션이 아니다. 옵션 해석 전에 그대로 넘긴다.
    if (first === "run") {
      const at = argv.indexOf("run");
      const rootFlag = argv.indexOf("--root");
      const explicitRoot = rootFlag >= 0 && rootFlag < at ? argv[rootFlag + 1] : undefined;
      const [extension, script, ...args] = argv.slice(at + 1);
      const result = runScript(openRepo(resolveRoot(explicitRoot)), extension, script, args);
      process.exitCode = result.status;
      return;
    }
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
