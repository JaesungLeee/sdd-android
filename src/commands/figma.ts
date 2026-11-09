import fs from "node:fs";
import path from "node:path";
import {
  figmaConfig,
  figmaServerName,
  figmaToolNames,
  isFigmaServer,
  LOCAL_CONFIG_FILE,
  readLocalConfig,
  writeLocalConfig,
  type FigmaConfig,
  type FigmaServer,
} from "../core/local-config.js";
import { Refusal, type Repo } from "../core/repo.js";

export const SETTINGS_LOCAL = ".claude/settings.local.json";

export interface FigmaShowResult {
  /** 설정 파일이 있는지. 없으면 기본값으로 동작한다. */
  configured: boolean;
  config: FigmaConfig;
  /** 지금 쓰는 서버의 등록 이름. */
  name: string;
  /** 읽기 도구 네 개의 전체 이름. */
  tools: string[];
  /** 개인 설정 파일에 아직 허용되지 않은 도구. */
  missingPermissions: string[];
}

interface Settings {
  permissions?: { allow?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

function readSettings(repo: Repo): Settings {
  const file = path.join(repo.root, SETTINGS_LOCAL);
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("객체가 아니다");
    return data as Settings;
  } catch (error) {
    throw new Refusal(`${SETTINGS_LOCAL}을 읽을 수 없다: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function allowed(settings: Settings): string[] {
  const allow = settings.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((item): item is string => typeof item === "string") : [];
}

/** 스킬 본문에 주입할 Figma 설정. 스킬 파일에는 개인 값이 없고 실행할 때 여기서 받는다(PRD STG-007). */
export function figmaShow(repo: Repo): FigmaShowResult {
  const local = readLocalConfig(repo);
  const config = figmaConfig(local);
  const tools = figmaToolNames(config);
  const have = new Set(allowed(readSettings(repo)));
  return {
    configured: local?.figma !== undefined,
    config,
    name: figmaServerName(config),
    tools,
    missingPermissions: tools.filter((tool) => !have.has(tool)),
  };
}

export interface FigmaSetupOptions {
  server?: string;
  /** 고른 서버의 등록 이름. */
  name?: string;
}

export interface FigmaSetupResult extends FigmaShowResult {
  /** 이번에 개인 설정 파일에 더한 도구. */
  addedPermissions: string[];
  files: string[];
}

/**
 * Figma 서버를 고르고 읽기 도구 네 개의 권한을 개인 설정 파일에 더한다. 사용자가 실행했을 때만 쓴다.
 * 팀이 공유하는 `.claude/settings.json`과 사용자의 `.gitignore`는 고치지 않는다(PRD SYS-006).
 */
export function figmaSetup(repo: Repo, options: FigmaSetupOptions): FigmaSetupResult {
  const local = readLocalConfig(repo) ?? {};
  const current = figmaConfig(local);
  const server: FigmaServer = options.server === undefined ? current.server : requireServer(options.server);
  const next: FigmaConfig = { ...current, server };
  if (options.name !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_:.-]*$/.test(options.name)) throw new Refusal(`서버의 등록 이름이 아니다: ${options.name}`);
    if (server === "desktop") next.desktop_name = options.name;
    else next.remote_name = options.name;
  }
  writeLocalConfig(repo, { ...local, figma: next });

  const settings = readSettings(repo);
  const have = allowed(settings);
  const tools = figmaToolNames(next);
  const addedPermissions = tools.filter((tool) => !have.includes(tool));
  const files = [path.join(".sdd-android", LOCAL_CONFIG_FILE)];
  if (addedPermissions.length > 0) {
    settings.permissions = { ...settings.permissions, allow: [...have, ...addedPermissions] };
    const file = path.join(repo.root, SETTINGS_LOCAL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
    files.push(SETTINGS_LOCAL);
  }
  return { ...figmaShow(repo), addedPermissions, files };
}

function requireServer(value: string): FigmaServer {
  if (!isFigmaServer(value)) throw new Refusal(`--server는 desktop이나 remote다: ${value}`);
  return value;
}

export function formatFigmaShow(result: FigmaShowResult): string {
  const lines = [
    `Figma 서버: ${result.config.server} (등록 이름 ${result.name})${result.configured ? "" : " — 설정이 없어 기본값이다. sdd-android figma setup으로 정한다"}`,
    `읽기 도구: ${result.tools.join(", ")}`,
  ];
  if (result.missingPermissions.length > 0) {
    lines.push(`권한이 없는 도구: ${result.missingPermissions.join(", ")}. 대화형 실행에서는 승인을 묻고, 비대화형 실행에서는 거부된다. sdd-android figma setup이 ${SETTINGS_LOCAL}에 더한다.`);
  } else {
    lines.push(`권한: ${SETTINGS_LOCAL}에 네 도구가 모두 있다.`);
  }
  return lines.join("\n");
}

export function formatFigmaSetup(result: FigmaSetupResult): string {
  const lines = [`Figma 서버를 ${result.config.server} (${result.name})로 정했다.`, ...result.files.map((file) => `- ${file}`)];
  if (result.addedPermissions.length > 0) lines.push(`권한을 더했다: ${result.addedPermissions.join(", ")}`);
  else lines.push("더할 권한이 없다. 네 도구가 이미 허용되어 있다.");
  return lines.join("\n");
}
