import { parse } from "yaml";
import type { FileMap } from "./assets.js";
import { Refusal } from "./repo.js";
import { applyPrefix, skillName } from "./skilltext.js";
import { compareVersions, isVersion } from "./version.js";

export type ExtensionKind = "extension" | "preset";

/** 묶음의 선언 파일 `extension.yaml`. */
export interface ExtensionManifest {
  name: string;
  kind: ExtensionKind;
  version: string;
  /** 필요한 mob-sdd의 최소 버전. `>=0.2.0` 꼴이다. */
  requires?: string;
  description?: string;
  /** 단계 이름에서 지시 파일의 묶음 안 상대 경로로. */
  directives: Record<string, string>;
}

export interface Bundle {
  manifest: ExtensionManifest;
  /** 묶음의 파일. `extension.yaml`을 포함한다. */
  files: FileMap;
}

export const MANIFEST_FILE = "extension.yaml";
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** 묶음 파일에서 선언을 읽고 형식을 검사한다. */
export function readBundle(files: FileMap): Bundle {
  const text = files.get(MANIFEST_FILE);
  if (text === undefined) throw new Refusal(`묶음에 ${MANIFEST_FILE}이 없다`);
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new Refusal(`${MANIFEST_FILE}을 읽을 수 없다: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Refusal(`${MANIFEST_FILE}이 키와 값의 묶음이 아니다`);
  const raw = data as Record<string, unknown>;

  const name = raw.name;
  if (typeof name !== "string" || !NAME.test(name)) throw new Refusal(`${MANIFEST_FILE}: name은 소문자, 숫자, 하이픈으로 된 이름이어야 한다`);
  if (name === "core") throw new Refusal(`${MANIFEST_FILE}: core는 쓸 수 없는 이름이다`);
  const kind = raw.kind;
  if (kind !== "extension" && kind !== "preset") throw new Refusal(`${MANIFEST_FILE}: kind는 extension이나 preset이어야 한다`);
  const version = raw.version;
  if (typeof version !== "string" || !isVersion(version)) throw new Refusal(`${MANIFEST_FILE}: version이 버전 형식이 아니다`);
  const requires = raw.requires;
  if (requires !== undefined && (typeof requires !== "string" || !/^>=\d+\.\d+\.\d+$/.test(requires))) {
    throw new Refusal(`${MANIFEST_FILE}: requires는 ">=0.2.0" 꼴이어야 한다`);
  }
  const directives: Record<string, string> = {};
  if (raw.directives !== undefined) {
    if (!raw.directives || typeof raw.directives !== "object" || Array.isArray(raw.directives)) {
      throw new Refusal(`${MANIFEST_FILE}: directives는 단계 이름에서 파일 경로로의 묶음이어야 한다`);
    }
    for (const [stage, rel] of Object.entries(raw.directives as Record<string, unknown>)) {
      if (!NAME.test(stage)) throw new Refusal(`${MANIFEST_FILE}: 단계 이름이 아니다: ${stage}`);
      if (typeof rel !== "string" || !files.has(rel)) throw new Refusal(`${MANIFEST_FILE}: ${stage}의 지시 파일이 묶음에 없다: ${String(rel)}`);
      directives[stage] = rel;
    }
  }
  for (const rel of files.keys()) {
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    if (rel.startsWith("skills/") && !skill) throw new Refusal(`skills/ 아래는 skills/{이름}/SKILL.md만 둘 수 있다: ${rel}`);
    if (skill && !NAME.test(skill[1] as string)) throw new Refusal(`스킬 이름이 아니다: ${rel}`);
  }

  return {
    manifest: {
      name,
      kind,
      version,
      ...(requires !== undefined ? { requires: requires as string } : {}),
      ...(typeof raw.description === "string" ? { description: raw.description } : {}),
      directives,
    },
    files,
  };
}

/** 필요한 mob-sdd 버전을 만족하는지. */
export function satisfiesRequirement(requires: string | undefined, version: string): boolean {
  if (!requires || !isVersion(version)) return true;
  return compareVersions(version, requires.slice(2)) >= 0;
}

/** 묶음의 스킬 이름. 접두사를 붙이기 전이다. */
export function bundleSkills(bundle: Bundle): string[] {
  return [...bundle.files.keys()]
    .map((rel) => /^skills\/([^/]+)\/SKILL\.md$/.exec(rel)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

export interface PlannedFile {
  /** 저장소 안의 경로. */
  target: string;
  content: string;
  /** preset이 코어의 파일을 교체하는 것이면 그 코어 파일의 설치 경로와 같다. */
  replacesCore: boolean;
}

/**
 * 묶음의 파일이 저장소의 어디에 놓이는지(PRD CLI-004).
 * 스킬은 `.claude/skills/`에, preset의 템플릿은 코어의 자리에, 나머지는 `.mob-sdd/extensions/{이름}/`에 둔다.
 */
export function planBundle(bundle: Bundle, prefix: string): PlannedFile[] {
  const { name, kind } = bundle.manifest;
  const planned: PlannedFile[] = [];
  for (const [rel, text] of [...bundle.files].sort(([a], [b]) => a.localeCompare(b))) {
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    const template = /^templates\/([^/]+\.md)$/.exec(rel);
    if (skill) {
      planned.push({
        target: `.claude/skills/${skillName(skill[1] as string, prefix)}/SKILL.md`,
        content: applyPrefix(text, prefix),
        replacesCore: kind === "preset",
      });
    } else if (template && kind === "preset") {
      planned.push({ target: `.mob-sdd/templates/${template[1]}`, content: text, replacesCore: true });
    } else {
      planned.push({ target: `.mob-sdd/extensions/${name}/${rel}`, content: text, replacesCore: false });
    }
  }
  return planned;
}
