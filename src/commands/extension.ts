import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleFromDir, type Assets } from "../core/assets.js";
import {
  bundleSkills,
  MANIFEST_FILE,
  planBundle,
  readBundle,
  satisfiesRequirement,
  type Bundle,
  type ExtensionKind,
  type ExtensionManifest,
} from "../core/extension.js";
import { hashContent, readManifest, writeManifest, type InstalledExtension, type Manifest } from "../core/manifest.js";
import { Refusal, STAGES, type Repo } from "../core/repo.js";
import { skillName } from "../core/skilltext.js";

export interface ExtensionSummary extends ExtensionManifest {
  origin?: "builtin" | "local";
  installed: boolean;
}

export interface ListResult {
  /** 패키지에 내장된 확장과 설치된 확장. 이름순이다. */
  extensions: ExtensionSummary[];
}

function installedDir(repo: Repo, name: string): string {
  return path.join(repo.root, ".mob-sdd", "extensions", name);
}

function requireManifest(repo: Repo): Manifest {
  const manifest = readManifest(repo.root);
  if (!manifest) throw new Refusal("설치 기록이 없다. 먼저 init으로 설치한다.");
  return manifest;
}

/** 내장된 것과 설치된 것을 함께 보여 준다(PRD CLI-004). */
export function listExtensions(repo: Repo, assets: Assets, kind?: ExtensionKind): ListResult {
  const manifest = requireManifest(repo);
  const installed = manifest.extensions ?? {};
  const byName = new Map<string, ExtensionSummary>();
  for (const [name, files] of assets.extensions(repo.config.language)) {
    const bundle = readBundle(files);
    byName.set(name, { ...bundle.manifest, origin: "builtin", installed: name in installed });
  }
  for (const [name, entry] of Object.entries(installed)) {
    const dir = installedDir(repo, name);
    const known = byName.get(name);
    const bundle = fs.existsSync(path.join(dir, MANIFEST_FILE)) ? readBundle(bundleFromDir(dir)) : undefined;
    byName.set(name, {
      ...(bundle?.manifest ?? known ?? { name, kind: entry.kind, version: entry.version, directives: {} }),
      version: entry.version,
      origin: entry.origin,
      installed: true,
    });
  }
  const extensions = [...byName.values()].filter((item) => !kind || item.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
  return { extensions };
}

/** 내장 확장이나 로컬 경로의 묶음을 읽는다. */
export function resolveBundle(repo: Repo, assets: Assets, nameOrPath: string): { bundle: Bundle; origin: "builtin" | "local" } {
  const builtin = assets.extensions(repo.config.language).get(nameOrPath);
  if (builtin) return { bundle: readBundle(builtin), origin: "builtin" };
  const dir = path.resolve(nameOrPath);
  if (fs.existsSync(path.join(dir, MANIFEST_FILE))) return { bundle: readBundle(bundleFromDir(dir)), origin: "local" };
  throw new Refusal(`내장 확장의 이름도 묶음 디렉터리의 경로도 아니다: ${nameOrPath}`);
}

export interface AddOptions {
  origin: "builtin" | "local";
  /** 사용자 홈. 이름이 겹치는 스킬을 찾는 데 쓴다. */
  homeDir?: string;
  /** extension과 preset 명령을 나누므로, 기대한 종류와 다르면 거부한다. */
  expectKind?: ExtensionKind;
}

export interface AddResult {
  name: string;
  kind: ExtensionKind;
  version: string;
  /** 이미 설치된 것을 갱신했다. */
  updated: boolean;
  added: string[];
  replaced: string[];
  /** 사용자가 고쳐서 그대로 두고 새 버전을 옆에 둔 파일. */
  kept: { file: string; next: string }[];
  removed: string[];
  skills: string[];
}

function coreNames(assets: Assets, language: string): { skills: Set<string>; templates: Set<string> } {
  const skills = new Set<string>();
  const templates = new Set<string>();
  for (const rel of assets.core(language).keys()) {
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    const template = /^templates\/([^/]+\.md)$/.exec(rel);
    if (skill) skills.add(skill[1] as string);
    if (template) templates.add(template[1] as string);
  }
  return { skills, templates };
}

/**
 * 확장이나 preset을 설치한다(PRD CLI-004). 설치는 묶음의 파일을 저장소에 복사하고 설치 기록에 남기는 것이다.
 * 같은 이름이 이미 설치되어 있으면 갱신이다. 그때의 파일 처리는 upgrade와 같다.
 */
export function addExtension(repo: Repo, assets: Assets, bundle: Bundle, options: AddOptions): AddResult {
  const manifest = requireManifest(repo);
  const { name, kind, version, requires } = bundle.manifest;
  if (options.expectKind && kind !== options.expectKind) {
    throw new Refusal(`${name}은 ${kind}다. ${options.expectKind} 명령이 아니라 ${kind} 명령으로 설치한다.`);
  }
  if (!satisfiesRequirement(requires, manifest.version)) {
    throw new Refusal(`${name} ${version}은 mob-sdd ${requires?.slice(2)} 이상이 필요하다(설치된 버전 ${manifest.version}). 먼저 upgrade한다.`);
  }

  const { language, prefix } = repo.config;
  const core = coreNames(assets, language);
  const skills = bundleSkills(bundle);
  const templates = [...bundle.files.keys()].map((rel) => /^templates\/([^/]+\.md)$/.exec(rel)?.[1]).filter((n): n is string => n !== undefined);
  if (kind === "preset") {
    const unknown = [...skills.filter((n) => !core.skills.has(n)), ...templates.filter((n) => !core.templates.has(n))];
    if (unknown.length > 0) throw new Refusal(`preset은 코어의 스킬과 템플릿만 교체한다. 코어에 없는 이름: ${unknown.join(", ")}`);
  } else {
    const clash = skills.filter((n) => core.skills.has(n));
    if (clash.length > 0) throw new Refusal(`코어의 스킬과 이름이 겹친다: ${clash.join(", ")}`);
  }

  const previous = manifest.extensions?.[name];
  const updated = previous !== undefined;
  const planned = planBundle(bundle, prefix);
  const home = options.homeDir ?? os.homedir();

  // 겹치는 곳. 갱신이면 자기 파일은 겹치는 것이 아니다.
  const conflicts: string[] = [];
  for (const file of planned) {
    const recorded = manifest.files[file.target];
    const exists = fs.existsSync(path.join(repo.root, file.target));
    if (recorded) {
      const own = recorded.source === name;
      const replacing = file.replacesCore && recorded.source === "core";
      if (!own && !replacing) conflicts.push(`${file.target} (${recorded.source === "core" ? "코어" : recorded.source}의 파일)`);
    } else if (exists) {
      conflicts.push(file.target);
    }
  }
  for (const skill of skills) {
    if (fs.existsSync(path.join(home, ".claude", "skills", skillName(skill, prefix)))) {
      conflicts.push(`~/.claude/skills/${skillName(skill, prefix)} (사용자 홈의 스킬과 이름이 같다)`);
    }
  }
  if (conflicts.length > 0) {
    throw new Refusal(["이미 있는 파일과 겹쳐 설치하지 않았다.", ...conflicts.map((c) => `- ${c}`)].join("\n"));
  }

  const result: AddResult = { name, kind, version, updated, added: [], replaced: [], kept: [], removed: [], skills: skills.map((s) => skillName(s, prefix)) };
  const write = (rel: string, content: string) => {
    const file = path.join(repo.root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const coreFiles = assets.core(language);
  const coreContent = (target: string): string | undefined => {
    const skill = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(target);
    const template = /^\.mob-sdd\/templates\/([^/]+)$/.exec(target);
    if (template) return coreFiles.get(`templates/${template[1]}`);
    if (skill) {
      const bare = prefix && (skill[1] as string).startsWith(`${prefix}-`) ? (skill[1] as string).slice(prefix.length + 1) : (skill[1] as string);
      const text = coreFiles.get(`skills/${bare}/SKILL.md`);
      return text === undefined ? undefined : text.replace(/\{\{skill:([a-z0-9][a-z0-9-]*)\}\}/g, (_, n: string) => skillName(n, prefix));
    }
    return undefined;
  };

  const targets = new Set<string>();
  for (const file of planned) {
    targets.add(file.target);
    const recorded = manifest.files[file.target];
    const incoming = hashContent(file.content);
    const current = fs.existsSync(path.join(repo.root, file.target)) ? hashContent(fs.readFileSync(path.join(repo.root, file.target))) : undefined;
    const entry = { sha256: incoming, source: name, ...(file.replacesCore ? { core: hashContent(coreContent(file.target) ?? "") } : {}) };

    if (!recorded || recorded.source !== name) {
      write(file.target, file.content);
      (recorded ? result.replaced : result.added).push(file.target);
    } else if (current === undefined || current === recorded.sha256) {
      if (current !== incoming) {
        write(file.target, file.content);
        result.replaced.push(file.target);
      }
    } else if (current !== incoming && recorded.sha256 !== incoming) {
      write(`${file.target}.new`, file.content);
      result.kept.push({ file: file.target, next: `${file.target}.new` });
    }
    manifest.files[file.target] = { ...entry, ...(recorded?.core && !file.replacesCore ? {} : {}) };
    if (recorded?.source === name && recorded.core) manifest.files[file.target] = { ...entry, core: recorded.core };
  }

  // 이전 버전에는 있었고 새 묶음에는 없는 파일.
  for (const [rel, recorded] of Object.entries(manifest.files)) {
    if (recorded.source !== name || targets.has(rel)) continue;
    delete manifest.files[rel];
    const file = path.join(repo.root, rel);
    if (!fs.existsSync(file)) continue;
    if (hashContent(fs.readFileSync(file)) === recorded.sha256) {
      if (recorded.core) {
        const core = coreContent(rel);
        if (core !== undefined) {
          write(rel, core);
          manifest.files[rel] = { sha256: hashContent(core), source: "core" };
          result.replaced.push(rel);
          continue;
        }
      }
      fs.rmSync(file);
      result.removed.push(rel);
    }
  }

  manifest.extensions = { ...(manifest.extensions ?? {}), [name]: { kind, version, origin: options.origin } };
  writeManifest(repo.root, manifest);
  return result;
}

export interface RemoveResult {
  name: string;
  removed: string[];
  /** 코어의 파일로 되살린 것. */
  restored: string[];
  /** 사용자가 고쳐서 남긴 파일. 코어를 되살린 자리면 옆에 복사해 두었다. */
  kept: string[];
}

/** 확장을 제거한다. preset이 교체한 코어 파일은 번들에 실린 원본으로 되살린다. */
export function removeExtension(repo: Repo, assets: Assets, name: string, expectKind?: ExtensionKind): RemoveResult {
  const manifest = requireManifest(repo);
  const entry = manifest.extensions?.[name];
  if (!entry) throw new Refusal(`설치되어 있지 않다: ${name}`);
  if (expectKind && entry.kind !== expectKind) throw new Refusal(`${name}은 ${entry.kind}다. ${entry.kind} 명령으로 제거한다.`);

  const { language, prefix } = repo.config;
  const coreFiles = assets.core(language);
  const result: RemoveResult = { name, removed: [], restored: [], kept: [] };

  for (const [rel, recorded] of Object.entries(manifest.files)) {
    if (recorded.source !== name) continue;
    delete manifest.files[rel];
    const file = path.join(repo.root, rel);
    const exists = fs.existsSync(file);
    const modified = exists && hashContent(fs.readFileSync(file)) !== recorded.sha256;

    if (recorded.core !== undefined) {
      const skill = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(rel);
      const template = /^\.mob-sdd\/templates\/([^/]+)$/.exec(rel);
      let core: string | undefined;
      if (template) core = coreFiles.get(`templates/${template[1]}`);
      if (skill) {
        const installed = skill[1] as string;
        const bare = prefix && installed.startsWith(`${prefix}-`) ? installed.slice(prefix.length + 1) : installed;
        core = coreFiles.get(`skills/${bare}/SKILL.md`)?.replace(/\{\{skill:([a-z0-9][a-z0-9-]*)\}\}/g, (_, n: string) => skillName(n, prefix));
      }
      if (core === undefined) throw new Refusal(`번들에 코어 파일이 없어 되살릴 수 없다: ${rel}`);
      if (modified) {
        fs.copyFileSync(file, `${file}.removed`);
        result.kept.push(`${rel}.removed`);
      }
      fs.writeFileSync(file, core);
      manifest.files[rel] = { sha256: hashContent(core), source: "core" };
      result.restored.push(rel);
      continue;
    }
    if (!exists) continue;
    if (modified) {
      result.kept.push(rel);
      continue;
    }
    fs.rmSync(file);
    result.removed.push(rel);
    let dir = path.dirname(file);
    while (dir !== repo.root && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }

  delete manifest.extensions?.[name];
  writeManifest(repo.root, manifest);
  return result;
}

export interface Directive {
  extension: string;
  /** 저장소 루트 기준의 경로. */
  file: string;
}

/**
 * 단계에 적용되는 확장 지시 파일(PRD CLI-004). 단계가 시작될 때 본문 주입으로 알린다.
 * 순서는 확장 이름순으로 고정한다.
 */
export function directives(repo: Repo, stage: string): Directive[] {
  const manifest = readManifest(repo.root);
  const found: Directive[] = [];
  for (const name of Object.keys(manifest?.extensions ?? {}).sort()) {
    const dir = installedDir(repo, name);
    if (!fs.existsSync(path.join(dir, MANIFEST_FILE))) continue;
    const bundle = readBundle(bundleFromDir(dir));
    const rel = bundle.manifest.directives[stage];
    if (rel) found.push({ extension: name, file: `.mob-sdd/extensions/${name}/${rel}` });
  }
  return found;
}

/** 지시의 대상이 될 수 있는 단계 이름. 코어 단계와 설치된 스킬(접두사를 뺀 이름)이다. */
export function knownStages(repo: Repo, manifest: Manifest): Set<string> {
  const names = new Set<string>(STAGES);
  const { prefix } = repo.config;
  for (const rel of Object.keys(manifest.files)) {
    const skill = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    if (!skill) continue;
    const installed = skill[1] as string;
    names.add(prefix && installed.startsWith(`${prefix}-`) ? installed.slice(prefix.length + 1) : installed);
  }
  return names;
}

export function formatList(result: ListResult): string {
  if (result.extensions.length === 0) return "내장된 확장도 설치된 확장도 없다.";
  return result.extensions
    .map((item) => {
      const state = item.installed ? `설치됨 (${item.origin === "local" ? "로컬" : "내장"})` : "내장, 설치 안 됨";
      const stages = Object.keys(item.directives);
      return `- ${item.name} ${item.version} [${item.kind}] ${state}${item.description ? ` — ${item.description}` : ""}${stages.length > 0 ? ` (지시: ${stages.join(", ")})` : ""}`;
    })
    .join("\n");
}

export function formatAdd(result: AddResult): string {
  const lines = [`${result.name} ${result.version}을 ${result.updated ? "갱신했다" : "설치했다"}.`];
  const section = (title: string, items: string[]) => {
    if (items.length > 0) lines.push(title, ...items.map((item) => `- ${item}`));
  };
  section("새 파일:", result.added);
  section("바꾼 파일:", result.replaced);
  section("지운 파일:", result.removed);
  section("고친 파일이라 그대로 뒀다. 새 버전을 옆에 뒀다:", result.kept.map((k) => `${k.file} (새 버전: ${k.next})`));
  if (result.skills.length > 0) lines.push(`스킬: ${result.skills.map((s) => `/${s}`).join(", ")}`);
  return lines.join("\n");
}

export function formatRemove(result: RemoveResult): string {
  const lines = [`${result.name}을 제거했다.`];
  const section = (title: string, items: string[]) => {
    if (items.length > 0) lines.push(title, ...items.map((item) => `- ${item}`));
  };
  section("지운 파일:", result.removed);
  section("코어의 파일로 되살렸다:", result.restored);
  section("고친 파일이라 남겼다:", result.kept);
  return lines.join("\n");
}

export function formatDirectives(found: Directive[]): string {
  if (found.length === 0) return "확장 지시가 없다.";
  return found.map((d) => `- ${d.file} (${d.extension})`).join("\n");
}

export type { InstalledExtension };
