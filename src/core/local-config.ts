import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { Refusal, type Repo } from "./repo.js";

/** Figma MCP 서버의 종류. 원격 서버와 데스크톱 앱의 Dev Mode 서버다(PRD STG-007 「Figma 서버의 선택」). */
export type FigmaServer = "desktop" | "remote";

export interface FigmaConfig {
  server: FigmaServer;
  /** Claude Code에 등록된 서버의 이름. 사람마다 다르다. */
  desktop_name: string;
  remote_name: string;
}

/** 사람마다 다른 환경 값. `.sdd-first/config.local.yaml`에 두고 커밋하지 않는다(PRD SYS-006). */
export interface LocalConfig {
  figma?: Partial<FigmaConfig>;
}

export const LOCAL_CONFIG_FILE = "config.local.yaml";

export const FIGMA_DEFAULTS: FigmaConfig = { server: "desktop", desktop_name: "figma-desktop", remote_name: "figma" };

/** Figma를 읽는 도구. 쓰기 도구가 같은 서버에 있으므로 서버 전체를 허용하지 않는다. */
export const FIGMA_READ_TOOLS = ["get_metadata", "get_variable_defs", "get_screenshot", "get_design_context"] as const;

export function localConfigPath(repo: Repo): string {
  return path.join(repo.root, ".sdd-first", LOCAL_CONFIG_FILE);
}

export function readLocalConfig(repo: Repo): LocalConfig | undefined {
  const file = localConfigPath(repo);
  if (!fs.existsSync(file)) return undefined;
  let data: unknown;
  try {
    data = parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Refusal(`${LOCAL_CONFIG_FILE}을 읽을 수 없다: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  if (data === null || data === undefined) return {};
  if (typeof data !== "object" || Array.isArray(data)) throw new Refusal(`${LOCAL_CONFIG_FILE}이 키와 값의 묶음이 아니다`);
  return data as LocalConfig;
}

export function writeLocalConfig(repo: Repo, config: LocalConfig): void {
  const file = localConfigPath(repo);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringify(config));
}

export function isFigmaServer(value: string): value is FigmaServer {
  return value === "desktop" || value === "remote";
}

/** 설정과 기본값을 합친 Figma 설정. 설정 파일이 없으면 기본값이다. */
export function figmaConfig(local: LocalConfig | undefined): FigmaConfig {
  const given = local?.figma ?? {};
  return {
    server: given.server !== undefined && isFigmaServer(given.server) ? given.server : FIGMA_DEFAULTS.server,
    desktop_name: typeof given.desktop_name === "string" && given.desktop_name ? given.desktop_name : FIGMA_DEFAULTS.desktop_name,
    remote_name: typeof given.remote_name === "string" && given.remote_name ? given.remote_name : FIGMA_DEFAULTS.remote_name,
  };
}

/** 지금 쓰는 서버의 등록 이름. */
export function figmaServerName(config: FigmaConfig): string {
  return config.server === "desktop" ? config.desktop_name : config.remote_name;
}

/**
 * MCP 도구의 전체 이름. `mcp__{서버 이름}__{도구}`이며, 서버 이름의 하이픈은 남고 콜론 같은 글자는 밑줄이 된다
 * (`figma-desktop` → `mcp__figma-desktop__get_metadata`, `plugin:figma:figma` → `mcp__plugin_figma_figma__get_metadata`).
 */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server.replace(/[^A-Za-z0-9_-]/g, "_")}__${tool}`;
}

export function figmaToolNames(config: FigmaConfig): string[] {
  return FIGMA_READ_TOOLS.map((tool) => mcpToolName(figmaServerName(config), tool));
}
