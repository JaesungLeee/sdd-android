import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Assets } from "../core/assets.js";
import { bundleSkills, planBundle, readBundle, satisfiesRequirement, type Bundle } from "../core/extension.js";
import { hashContent, manifestPath, writeManifest, type Manifest } from "../core/manifest.js";
import { LAUNCHER, LAUNCHER_PATH, markExecutable } from "../core/launcher.js";
import { openRepo, Refusal } from "../core/repo.js";
import { applyPrefix, skillName } from "../core/skilltext.js";
import { addExtension } from "./extension.js";

export interface InitOptions {
  /** 설치할 저장소의 루트. */
  target: string;
  language: string;
  /** 스킬 이름 접두사. 없으면 빈 문자열. */
  prefix: string;
  /** 패키지에 실린 스킬, 템플릿, 내장 확장. */
  assets: Assets;
  /** 저장소에 복사할 CLI 번들. */
  bundlePath: string;
  version: string;
  /** 사용자 홈. 이름이 겹치는 스킬을 찾는 데 쓴다. */
  homeDir?: string;
  /** 프로젝트의 겹치는 스킬을 백업으로 옮기고 설치한다. 사용자가 고른 경우에만 준다. */
  backup?: boolean;
  /** 백업 디렉터리의 이름에 쓰는 날짜. */
  today?: string;
  /** 함께 설치할 내장 확장의 이름. 기본은 없다. 코어는 스택을 전제하지 않으므로 구현 단계의 확장은 명시했을 때만 설치한다(PRD CLI-001). */
  extensions?: string[];
}

export interface InitConflicts {
  /** 프로젝트의 `.claude/skills/` 아래에서 이름이 겹치는 스킬. 접두사를 붙이거나 백업하고 덮어쓸 수 있다. */
  skills: string[];
  /** 사용자 홈의 스킬과 겹치는 이름. 홈의 파일은 건드리지 않으므로 접두사로만 피한다. */
  home: string[];
  /** `.mob-sdd/` 아래에 이미 있는 파일. 설치 기록 없이 있으면 사람이 봐야 한다. */
  state: string[];
}

export interface InitPlan {
  files: Map<string, string | Buffer>;
  skills: string[];
  /** 함께 설치할 내장 확장의 묶음. */
  bundles: Bundle[];
  conflicts: InitConflicts;
}

export interface InitResult {
  files: string[];
  skills: string[];
  /** 백업으로 옮긴 스킬의 원래 경로와 옮긴 경로. */
  backedUp: { from: string; to: string }[];
  /** 함께 설치한 확장의 이름. */
  extensions: string[];
  /** git이 추적하는 파일이 있는 저장소다. 위키의 첫 수집을 권하는 근거다(PRD CLI-001). */
  existingCode: boolean;
}

function hasTrackedFiles(target: string): boolean {
  try {
    return execFileSync("git", ["-C", target, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).length > 0;
  } catch {
    return false;
  }
}

/** 함께 설치할 내장 확장의 묶음. 이름이 내장 확장에 없거나 이 버전이 요건을 만족하지 못하면 거부한다. */
function pickBundles(options: InitOptions): Bundle[] {
  const builtin = options.assets.extensions(options.language);
  const bundles: Bundle[] = [];
  for (const name of new Set(options.extensions ?? [])) {
    const files = builtin.get(name);
    if (!files) throw new Refusal(`내장 확장이 아니다: ${name} (있는 것: ${[...builtin.keys()].join(", ") || "없음"})`);
    const bundle = readBundle(files);
    if (!satisfiesRequirement(bundle.manifest.requires, options.version)) {
      throw new Refusal(`${name}은 mob-sdd ${bundle.manifest.requires?.slice(2)} 이상이 필요하다(이 버전 ${options.version})`);
    }
    bundles.push(bundle);
  }
  return bundles;
}

const PREFIX = /^[a-z0-9][a-z0-9-]*$/;

export function hasConflicts(conflicts: InitConflicts): boolean {
  return conflicts.skills.length + conflicts.home.length + conflicts.state.length > 0;
}

export function describeConflicts(conflicts: InitConflicts): string[] {
  return [
    ...conflicts.state.map((rel) => `- ${rel}`),
    ...conflicts.skills.map((name) => `- .claude/skills/${name}/SKILL.md`),
    ...conflicts.home.map((name) => `- ~/.claude/skills/${name} (사용자 홈의 스킬과 이름이 같다)`),
  ];
}

/** 패키지가 설치하는 코어 파일. 경로에서 내용으로. `init`과 `upgrade`가 함께 쓴다. */
export function coreFiles(options: Pick<InitOptions, "assets" | "language" | "prefix" | "bundlePath">): {
  files: Map<string, string | Buffer>;
  skills: string[];
} {
  const core = options.assets.core(options.language);
  if (core.size === 0) throw new Refusal(`지원하지 않는 언어다: ${options.language}`);

  const files = new Map<string, string | Buffer>();
  files.set(".mob-sdd/bin/mob-sdd.mjs", fs.readFileSync(options.bundlePath));
  files.set(LAUNCHER_PATH, LAUNCHER);
  files.set(".mob-sdd/.gitignore", "config.local.yaml\n");
  // 실행 스크립트가 CRLF로 체크아웃되면 sh가 실행하지 못한다. git의 줄바꿈 변환 설정과 무관하게 LF로 둔다.
  files.set(".mob-sdd/.gitattributes", "bin/mob-sdd text eol=lf\n");
  const skills: string[] = [];
  for (const [rel, text] of [...core].sort(([a], [b]) => a.localeCompare(b))) {
    const template = /^templates\/([^/]+\.md)$/.exec(rel);
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    if (template) files.set(`.mob-sdd/templates/${template[1]}`, text);
    if (skill) {
      const installed = skillName(skill[1] as string, options.prefix);
      skills.push(installed);
      files.set(`.claude/skills/${installed}/SKILL.md`, applyPrefix(text, options.prefix));
    }
  }
  return { files, skills };
}

/** 설치할 파일과 겹치는 곳을 계산한다. 아무것도 쓰지 않는다. */
export function planInit(options: InitOptions): InitPlan {
  const { target, language, prefix } = options;
  if (!fs.existsSync(path.join(target, ".git"))) {
    throw new Refusal(`git 저장소의 루트가 아니다: ${target}\n저장소 루트에서 실행하거나 먼저 git init을 실행한다.`);
  }
  if (fs.existsSync(manifestPath(target))) {
    throw new Refusal("이미 설치되어 있다. 새 버전으로 올리려면 upgrade를 쓴다.");
  }
  if (prefix && !PREFIX.test(prefix)) throw new Refusal(`접두사는 소문자, 숫자, 하이픈만 쓴다: ${prefix}`);

  const { files, skills } = coreFiles(options);
  const bundles = pickBundles(options);
  // 확장의 스킬도 코어와 같이 겹침을 본다. 코어를 설치한 뒤 확장에서 겹치면 반쯤 설치된 채 멈추기 때문이다.
  const extensionSkills = bundles.flatMap((bundle) => bundleSkills(bundle).map((name) => skillName(name, prefix)));
  const allSkills = [...skills, ...extensionSkills];
  const extensionState = bundles.flatMap((bundle) => planBundle(bundle, prefix).map((file) => file.target).filter((rel) => rel.startsWith(".mob-sdd/")));

  const exists = (rel: string) => fs.existsSync(path.join(target, rel));
  const home = options.homeDir ?? os.homedir();
  return {
    files,
    skills,
    bundles,
    conflicts: {
      skills: allSkills.filter((name) => exists(`.claude/skills/${name}/SKILL.md`)),
      home: allSkills.filter((name) => fs.existsSync(path.join(home, ".claude", "skills", name))),
      state: [...files.keys(), ".mob-sdd/config.yaml", ...extensionState].filter((rel) => rel.startsWith(".mob-sdd/") && exists(rel)),
    },
  };
}

function backupDir(target: string, today: string): string {
  const base = path.join(".mob-sdd", "backup", today);
  let rel = base;
  for (let n = 2; fs.existsSync(path.join(target, rel)); n += 1) rel = `${base}-${n}`;
  return rel;
}

/** 저장소에 워크플로 일체를 설치한다(PRD CLI-001). 이미 있는 파일은 덮어쓰지 않는다. */
export function init(options: InitOptions): InitResult {
  const { target, language, prefix } = options;
  const plan = planInit(options);
  const { conflicts } = plan;

  const blocking = options.backup ? conflicts.home.length + conflicts.state.length > 0 : hasConflicts(conflicts);
  if (blocking) {
    const lines = [
      "이미 있는 파일과 겹쳐 설치하지 않았다.",
      ...describeConflicts(conflicts),
      "기존 파일을 옮기거나, 스킬 이름이 겹치면 --prefix로 접두사를 붙여 설치한다.",
    ];
    throw new Refusal(lines.join("\n"));
  }

  // 백업은 스킬 디렉터리 밖에 둔다. 같은 자리에 두면 Claude Code가 그것도 스킬로 읽는다.
  const backedUp: InitResult["backedUp"] = [];
  if (conflicts.skills.length > 0) {
    const dir = backupDir(target, options.today ?? "backup");
    for (const name of conflicts.skills) {
      const from = path.join(".claude", "skills", name);
      const to = path.join(dir, "skills", name);
      fs.mkdirSync(path.dirname(path.join(target, to)), { recursive: true });
      fs.renameSync(path.join(target, from), path.join(target, to));
      backedUp.push({ from, to });
    }
  }

  const manifest: Manifest = { version: options.version, files: {}, extensions: {} };
  for (const [rel, content] of plan.files) {
    const file = path.join(target, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (rel === LAUNCHER_PATH) markExecutable(file);
    manifest.files[rel] = { sha256: hashContent(content), source: "core" };
  }
  fs.writeFileSync(
    path.join(target, ".mob-sdd", "config.yaml"),
    [`language: ${language}`, "agent: claude-code", "docs_dir: docs", `prefix: "${prefix}"`, ""].join("\n"),
  );
  writeManifest(target, manifest);

  // 내장 확장은 코어와 같은 절차로 설치한다. 겹침은 위에서 이미 봤다.
  const repo = openRepo(target);
  const extensions: string[] = [];
  const extensionFiles: string[] = [];
  const skills = [...plan.skills];
  for (const bundle of plan.bundles) {
    const added = addExtension(repo, options.assets, bundle, { origin: "builtin", homeDir: options.homeDir });
    extensions.push(added.name);
    extensionFiles.push(...added.added);
    skills.push(...added.skills);
  }

  return {
    files: [...plan.files.keys(), ".mob-sdd/config.yaml", ".mob-sdd/manifest.json", ...extensionFiles].sort(),
    skills,
    backedUp,
    extensions,
    existingCode: hasTrackedFiles(target),
  };
}
