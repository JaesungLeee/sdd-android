import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Assets } from "../core/assets.js";
import { hashContent, manifestPath, writeManifest, type Manifest } from "../core/manifest.js";
import { LAUNCHER } from "../core/launcher.js";
import { Refusal } from "../core/repo.js";
import { applyPrefix, skillName } from "../core/skilltext.js";

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
}

export interface InitConflicts {
  /** 프로젝트의 `.claude/skills/` 아래에서 이름이 겹치는 스킬. 접두사를 붙이거나 백업하고 덮어쓸 수 있다. */
  skills: string[];
  /** 사용자 홈의 스킬과 겹치는 이름. 홈의 파일은 건드리지 않으므로 접두사로만 피한다. */
  home: string[];
  /** `.sdd-first/` 아래에 이미 있는 파일. 설치 기록 없이 있으면 사람이 봐야 한다. */
  state: string[];
}

export interface InitPlan {
  files: Map<string, string | Buffer>;
  skills: string[];
  conflicts: InitConflicts;
}

export interface InitResult {
  files: string[];
  skills: string[];
  /** 백업으로 옮긴 스킬의 원래 경로와 옮긴 경로. */
  backedUp: { from: string; to: string }[];
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
  files.set(".sdd-first/bin/sdd-first.mjs", fs.readFileSync(options.bundlePath));
  files.set(".sdd-first/bin/sdd-first", LAUNCHER);
  files.set(".sdd-first/.gitignore", "config.local.yaml\n");
  // 실행 스크립트가 CRLF로 체크아웃되면 sh가 실행하지 못한다. git의 줄바꿈 변환 설정과 무관하게 LF로 둔다.
  files.set(".sdd-first/.gitattributes", "bin/sdd-first text eol=lf\n");
  const skills: string[] = [];
  for (const [rel, text] of [...core].sort(([a], [b]) => a.localeCompare(b))) {
    const template = /^templates\/([^/]+\.md)$/.exec(rel);
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    if (template) files.set(`.sdd-first/templates/${template[1]}`, text);
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

  const exists = (rel: string) => fs.existsSync(path.join(target, rel));
  const home = options.homeDir ?? os.homedir();
  return {
    files,
    skills,
    conflicts: {
      skills: skills.filter((name) => exists(`.claude/skills/${name}/SKILL.md`)),
      home: skills.filter((name) => fs.existsSync(path.join(home, ".claude", "skills", name))),
      state: [...files.keys(), ".sdd-first/config.yaml"].filter((rel) => rel.startsWith(".sdd-first/") && exists(rel)),
    },
  };
}

function backupDir(target: string, today: string): string {
  const base = path.join(".sdd-first", "backup", today);
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
    manifest.files[rel] = { sha256: hashContent(content), source: "core" };
  }
  fs.writeFileSync(
    path.join(target, ".sdd-first", "config.yaml"),
    [`language: ${language}`, "agent: claude-code", "docs_dir: docs", `prefix: "${prefix}"`, ""].join("\n"),
  );
  writeManifest(target, manifest);

  return {
    files: [...plan.files.keys(), ".sdd-first/config.yaml", ".sdd-first/manifest.json"].sort(),
    skills: plan.skills,
    backedUp,
  };
}
