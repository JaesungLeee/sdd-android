import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { splitItems } from "./items.js";
import type { Repo } from "./repo.js";

/**
 * constitution 원칙의 `**검사**:` 줄. 원칙마다 지켰는지를 무엇이 판정하는지 적는다.
 *
 * - `**검사**: detekt \`ForbiddenImport\` (config/detekt.yml)`: 도구의 규칙. 규칙 이름이 그 파일에 있어야 한다.
 * - `**검사**: 감사`: 도구로 표현할 수 없는 원칙. 구현 단계의 원칙 감사(LLM)가 본다.
 *
 * 한 원칙에 도구 줄을 여럿 둘 수 있다. 줄이 없는 원칙은 미지정이고 감사가 본다.
 * 도구는 스택을 가리지 않는다. CLI는 도구를 돌리지 않고, 규칙이 설정에 들어 있는지만 대조한다.
 */
export interface ToolCheck {
  tool: string;
  rule: string;
  /** 저장소 루트 기준. */
  file: string;
}

export interface Principle {
  id: string;
  title: string;
  /** 도구의 규칙. 비어 있으면 감사이거나 미지정이다. */
  tools: ToolCheck[];
  audit: boolean;
  /** 형식에 맞지 않는 `검사` 줄. */
  malformed: string[];
}

const CHECK_LINE = /^\s*[-*]?\s*\*\*검사\*\*\s*:\s*(.*)$/;
const TOOL_CHECK = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s+`([^`]+)`\s+\(([^()]+)\)\s*$/;
export const AUDIT = "감사";

export function parsePrinciples(body: string): Principle[] {
  const principles: Principle[] = [];
  for (const [id, text] of splitItems(body).items) {
    const lines = text.split("\n");
    const title = (lines[0] ?? "").replace(/^#+\s*\[[^\]]+\]\s*/, "").trim();
    const principle: Principle = { id, title, tools: [], audit: false, malformed: [] };
    for (const line of lines.slice(1)) {
      const match = CHECK_LINE.exec(line);
      if (!match) continue;
      const value = (match[1] ?? "").trim();
      if (value === AUDIT) {
        principle.audit = true;
        continue;
      }
      const tool = TOOL_CHECK.exec(value);
      if (tool) principle.tools.push({ tool: (tool[1] as string).toLowerCase(), rule: (tool[2] as string).trim(), file: (tool[3] as string).trim() });
      else principle.malformed.push(value);
    }
    principles.push(principle);
  }
  return principles;
}

export interface PrincipleCount {
  total: number;
  /** 도구의 규칙이 하나라도 있는 원칙. */
  tool: number;
  audit: number;
  unspecified: number;
}

export function countPrinciples(principles: Principle[]): PrincipleCount {
  const tool = principles.filter((principle) => principle.tools.length > 0).length;
  const audit = principles.filter((principle) => principle.tools.length === 0 && principle.audit).length;
  return { total: principles.length, tool, audit, unspecified: principles.length - tool - audit };
}

/** YAML에서 규칙 이름을 키로 찾는다. 찾으면 그 값, 못 찾으면 undefined. 처음 찾은 것을 쓴다. */
function findKey(node: unknown, key: string): { value: unknown } | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, key)) return { value: (node as Record<string, unknown>)[key] };
  for (const child of Object.values(node as Record<string, unknown>)) {
    const found = findKey(child, key);
    if (found) return found;
  }
  return undefined;
}

/**
 * 도구의 규칙이 설정에 실제로 들어 있는지. 문제가 없으면 undefined.
 * YAML(detekt 등)은 규칙 이름이 키로 있어야 하고 `active: false`면 꺼진 것이다.
 * 그 밖의 파일(Konsist 테스트, `.editorconfig`, 린트 설정)은 규칙 이름이 글자로 들어 있어야 하고, `규칙 = disabled` 줄이 있으면 꺼진 것이다.
 */
export function verifyToolCheck(repo: Repo, check: ToolCheck): string | undefined {
  const full = path.join(repo.root, check.file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return `설정 파일이 없다: ${check.file}`;
  const text = fs.readFileSync(full, "utf8");
  if (/\.ya?ml$/i.test(check.file)) {
    let data: unknown;
    try {
      data = parse(text);
    } catch (error) {
      return `설정 파일을 YAML로 읽을 수 없다: ${check.file}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    }
    const found = findKey(data, check.rule);
    if (!found) return `규칙이 설정에 없다: ${check.rule} (${check.file})`;
    const value = found.value;
    if (value === false || (value && typeof value === "object" && (value as { active?: unknown }).active === false)) return `규칙이 꺼져 있다: ${check.rule} (${check.file})`;
    return undefined;
  }
  if (!text.includes(check.rule)) return `규칙이 설정에 없다: ${check.rule} (${check.file})`;
  const escaped = check.rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^\\s*\\S*${escaped}\\s*=\\s*disabled\\s*$`, "m").test(text)) return `규칙이 꺼져 있다: ${check.rule} (${check.file})`;
  return undefined;
}
