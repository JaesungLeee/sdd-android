#!/usr/bin/env node
/**
 * OpenAPI 대조 extension의 스크립트(PRD CLI-004). 빌드가 `yaml`과 함께 파일 하나로 묶어
 * `.mob-sdd/extensions/openapi/scripts/openapi.mjs`로 설치한다. `mob-sdd run openapi openapi.mjs …`로 부른다.
 *
 *   list [--source <이름>] [--filter <텍스트>]   출처마다 머리말과 오퍼레이션 목록
 *   show <operationId | "METHOD /path">…         고른 오퍼레이션을 $ref를 풀어 펼친다
 *
 * 조회 실패는 머리말에 적고 종료 코드는 0이다. blueprint가 실패한 출처와 대조하지 못한 계약을 적어야 하기 때문이다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { readSources, type SourceConfig } from "./config.js";

export { readSources, validateSources, type SourceConfig } from "./config.js";

type Json = Record<string, unknown>;

export interface Operation {
  method: string;
  path: string;
  id?: string;
  summary?: string;
  tags: string[];
  raw: Json;
}

export interface LoadedSource {
  name: string;
  /** URL이거나 저장소 루트 기준의 경로. */
  origin: string;
  fetchedAt: string;
  title?: string;
  version?: string;
  doc?: Json;
  error?: string;
  operations: Operation[];
}

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

// 조회

export type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export async function loadSource(root: string, source: SourceConfig, fetchImpl: Fetch = fetch, now: Date = new Date()): Promise<LoadedSource> {
  const origin = source.url ?? (source.path as string);
  const loaded: LoadedSource = { name: source.name, origin, fetchedAt: now.toISOString(), operations: [] };
  try {
    let text: string;
    if (source.url) {
      const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/json, application/yaml, text/yaml, */*" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } else {
      const file = path.resolve(root, source.path as string);
      if (!fs.existsSync(file)) throw new Error(`파일이 없다: ${source.path}`);
      text = fs.readFileSync(file, "utf8");
    }
    const doc = parseSpec(text);
    loaded.doc = doc;
    const info = (doc.info ?? {}) as Json;
    if (typeof info.title === "string") loaded.title = info.title;
    if (typeof info.version === "string" || typeof info.version === "number") loaded.version = String(info.version);
    loaded.operations = listOperations(doc);
  } catch (error) {
    loaded.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
  }
  return loaded;
}

/** JSON이면 JSON으로, 아니면 YAML로 읽는다. OpenAPI 문서는 YAML이 흔하다. */
export function parseSpec(text: string): Json {
  let data: unknown;
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) data = JSON.parse(trimmed);
  else data = parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("OpenAPI 문서가 아니다");
  const doc = data as Json;
  if (typeof doc.openapi !== "string" && typeof doc.swagger !== "string") throw new Error("OpenAPI 문서가 아니다: openapi 키가 없다");
  return doc;
}

export function listOperations(doc: Json): Operation[] {
  const paths = (doc.paths ?? {}) as Record<string, Json>;
  const operations: Operation[] = [];
  for (const [route, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const method of METHODS) {
      const raw = item[method];
      if (!raw || typeof raw !== "object") continue;
      const op = raw as Json;
      operations.push({
        method: method.toUpperCase(),
        path: route,
        ...(typeof op.operationId === "string" ? { id: op.operationId } : {}),
        ...(typeof op.summary === "string" ? { summary: op.summary } : {}),
        tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
        raw: op,
      });
    }
  }
  return operations;
}

export function filterOperations(operations: Operation[], filter: string | undefined): Operation[] {
  if (!filter) return operations;
  const needle = filter.toLowerCase();
  return operations.filter((op) => [op.path, op.id ?? "", op.summary ?? "", ...op.tags].some((text) => text.toLowerCase().includes(needle)));
}

/** `operationId`이거나 `METHOD /path`. */
export function findOperations(sources: LoadedSource[], selector: string): { source: LoadedSource; operation: Operation }[] {
  const match = /^([A-Za-z]+)\s+(\/\S*)$/.exec(selector.trim());
  const found: { source: LoadedSource; operation: Operation }[] = [];
  for (const source of sources) {
    for (const operation of source.operations) {
      const hit = match ? operation.method === (match[1] as string).toUpperCase() && operation.path === match[2] : operation.id === selector.trim();
      if (hit) found.push({ source, operation });
    }
  }
  return found;
}

// 출력

function header(source: LoadedSource): string {
  if (source.error) return `== ${source.name} (${source.origin}) · 조회 실패: ${source.error}`;
  const info = [source.title, source.version].filter(Boolean).join(" ");
  return `== ${source.name} (${source.origin}) · 조회 ${source.fetchedAt}${info ? ` · ${info}` : ""}`;
}

export function formatList(sources: LoadedSource[], filter?: string): string {
  const lines: string[] = [];
  for (const source of sources) {
    lines.push(header(source));
    if (source.error) continue;
    const operations = filterOperations(source.operations, filter);
    if (operations.length === 0) lines.push(filter ? `(${filter}에 맞는 오퍼레이션이 없다)` : "(오퍼레이션이 없다)");
    for (const op of operations) {
      const tags = op.tags.length > 0 ? ` [${op.tags.join(", ")}]` : "";
      lines.push(`${op.method} ${op.path} ${op.id ?? "-"} ${op.summary ?? "-"}${tags}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function renderOperation(source: LoadedSource, op: Operation): string {
  const doc = source.doc ?? {};
  const lines = [`== ${source.name} · ${op.method} ${op.path}${op.id ? ` ${op.id}` : ""} · 조회 ${source.fetchedAt}`];
  if (op.summary) lines.push(`요약: ${op.summary}`);
  if (typeof op.raw.description === "string") lines.push(`설명: ${op.raw.description.replace(/\s+/g, " ").slice(0, 300)}`);
  if (typeof op.raw.deprecated === "boolean" && op.raw.deprecated) lines.push("폐기 예정(deprecated)");

  const parameters = [...(Array.isArray(op.raw.parameters) ? op.raw.parameters : [])].map((p) => deref(doc, p as Json, new Set()));
  if (parameters.length > 0) {
    lines.push("파라미터:");
    for (const p of parameters) {
      const where = [p.in, p.required ? "필수" : ""].filter(Boolean).join(", ");
      const schema = p.schema ? schemaText(doc, p.schema as Json, 3, new Set()) : "";
      const description = typeof p.description === "string" ? ` · ${p.description.replace(/\s+/g, " ")}` : "";
      lines.push(`- ${String(p.name)} (${where}): ${schema}${description}`);
    }
  }
  const body = op.raw.requestBody ? deref(doc, op.raw.requestBody as Json, new Set()) : undefined;
  if (body) {
    for (const [type, media] of Object.entries((body.content ?? {}) as Record<string, Json>)) {
      lines.push(`요청 본문: ${type}${body.required ? " (필수)" : ""}`);
      lines.push(...indent(schemaBlock(doc, media.schema as Json | undefined)));
    }
  }
  const responses = Object.entries((op.raw.responses ?? {}) as Record<string, Json>);
  if (responses.length > 0) {
    lines.push("응답:");
    for (const [status, raw] of responses) {
      const response = deref(doc, raw, new Set());
      const content = Object.entries((response.content ?? {}) as Record<string, Json>);
      const description = typeof response.description === "string" ? ` ${response.description}` : "";
      if (content.length === 0) {
        lines.push(`- ${status}${description}`);
        continue;
      }
      for (const [type, media] of content) {
        lines.push(`- ${status} ${type}${description}`);
        lines.push(...indent(schemaBlock(doc, media.schema as Json | undefined)));
      }
    }
  }
  return lines.join("\n");
}

function indent(lines: string[]): string[] {
  return lines.map((line) => `  ${line}`);
}

function schemaBlock(doc: Json, schema: Json | undefined): string[] {
  if (!schema) return ["(스키마 없음)"];
  return schemaText(doc, schema, 0, new Set()).split("\n");
}

/** `$ref`를 푼다. 같은 참조를 되풀이해 만나면 순환이다. */
function deref(doc: Json, node: Json, seen: Set<string>): Json {
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  if (seen.has(ref)) return { "x-cycle": ref };
  const target = resolveRef(doc, ref);
  if (!target) return { "x-unresolved": ref };
  return deref(doc, target, new Set([...seen, ref]));
}

export function resolveRef(doc: Json, ref: string): Json | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!node || typeof node !== "object") return undefined;
    node = (node as Json)[key];
  }
  return node && typeof node === "object" ? (node as Json) : undefined;
}

function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/**
 * 스키마를 짧은 글로 낸다. 객체는 `{ 이름*: 타입 }`(필수는 `*`), 배열은 `[타입]`, 열거는 `a | b`.
 * 깊이 2까지는 줄을 나눠 쓰고 그 아래는 한 줄이다. 순환 참조는 이름으로만 적는다.
 */
export function schemaText(doc: Json, schema: Json, depth: number, seen: Set<string>): string {
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (seen.has(ref)) return `${refName(ref)} (순환)`;
    const target = resolveRef(doc, ref);
    if (!target) return `${refName(ref)} (찾지 못함)`;
    return schemaText(doc, target, depth, new Set([...seen, ref]));
  }
  const nullable = schema.nullable === true ? "?" : "";
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(" | ") + nullable;
  for (const key of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(schema[key])) return (schema[key] as Json[]).map((s) => schemaText(doc, s, depth + 1, seen)).join(" | ");
  }
  if (Array.isArray(schema.allOf)) {
    const merged: Json = { type: "object", properties: {}, required: [] as string[] };
    for (const part of schema.allOf as Json[]) {
      const resolved = typeof part.$ref === "string" ? (resolveRef(doc, part.$ref) ?? {}) : part;
      Object.assign(merged.properties as Json, (resolved.properties ?? {}) as Json);
      (merged.required as string[]).push(...((resolved.required as string[] | undefined) ?? []));
    }
    return schemaText(doc, merged, depth, seen);
  }
  const type = typeof schema.type === "string" ? schema.type : Array.isArray(schema.type) ? (schema.type as string[]).join(" | ") : schema.properties ? "object" : schema.items ? "array" : "any";
  if (type === "array") {
    const items = schema.items && typeof schema.items === "object" ? schemaText(doc, schema.items as Json, depth + 1, seen) : "any";
    return `[${items}]${nullable}`;
  }
  if (type === "object") {
    const properties = Object.entries((schema.properties ?? {}) as Record<string, Json>);
    const required = new Set((schema.required as string[] | undefined) ?? []);
    const extra = schema.additionalProperties && typeof schema.additionalProperties === "object" ? schemaText(doc, schema.additionalProperties as Json, depth + 1, seen) : undefined;
    if (properties.length === 0) return extra ? `{ [키]: ${extra} }${nullable}` : `object${nullable}`;
    const fields = properties.map(([name, prop]) => `${name}${required.has(name) ? "*" : ""}: ${schemaText(doc, prop, depth + 1, seen)}`);
    if (extra) fields.push(`[키]: ${extra}`);
    if (depth < 2) return `{\n${fields.map((field) => `  ${field.replace(/\n/g, "\n  ")}`).join("\n")}\n}${nullable}`;
    return `{ ${fields.join(", ")} }${nullable}`;
  }
  const format = typeof schema.format === "string" ? `(${schema.format})` : "";
  const limits = [
    schema.minimum !== undefined ? `최소 ${schema.minimum}` : "",
    schema.maximum !== undefined ? `최대 ${schema.maximum}` : "",
    schema.maxLength !== undefined ? `최대 ${schema.maxLength}자` : "",
    typeof schema.pattern === "string" ? `패턴 ${schema.pattern}` : "",
  ].filter(Boolean);
  return `${type}${format}${nullable}${limits.length > 0 ? ` (${limits.join(", ")})` : ""}`;
}

// 실행

interface Args {
  command?: string;
  source?: string;
  filter?: string;
  selectors: string[];
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { selectors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--source") args.source = argv[++i];
    else if (arg === "--filter") args.filter = argv[++i];
    else if (!args.command) args.command = arg;
    else args.selectors.push(arg);
  }
  return args;
}

export async function main(argv: string[], root: string, fetchImpl: Fetch = fetch): Promise<{ text: string; exitCode: number }> {
  const args = parseArgs(argv);
  if (args.command !== "list" && args.command !== "show") {
    return { text: "openapi.mjs list [--source <이름>] [--filter <텍스트>] | show <operationId | \"METHOD /path\">… [--source <이름>]", exitCode: 2 };
  }
  let configured: SourceConfig[];
  try {
    configured = readSources(root);
  } catch (error) {
    return { text: `설정을 읽을 수 없다: ${error instanceof Error ? error.message : String(error)}`, exitCode: 2 };
  }
  if (configured.length === 0) return { text: "출처가 없다. .mob-sdd/config.yaml의 openapi.sources에 적는다.", exitCode: 0 };
  const picked = args.source ? configured.filter((source) => source.name === args.source) : configured;
  if (picked.length === 0) return { text: `그런 출처가 없다: ${args.source} (있는 것: ${configured.map((s) => s.name).join(", ")})`, exitCode: 2 };
  const sources = await Promise.all(picked.map((source) => loadSource(root, source, fetchImpl)));

  if (args.command === "list") return { text: formatList(sources, args.filter), exitCode: 0 };
  if (args.selectors.length === 0) return { text: "펼칠 오퍼레이션이 필요하다: operationId나 \"METHOD /path\"", exitCode: 2 };
  const blocks: string[] = [];
  for (const source of sources) if (source.error) blocks.push(header(source));
  for (const selector of args.selectors) {
    const found = findOperations(sources, selector);
    if (found.length === 0) blocks.push(`== ${selector}: 어느 출처에도 없다`);
    for (const { source, operation } of found) blocks.push(renderOperation(source, operation));
  }
  return { text: blocks.join("\n\n"), exitCode: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.MOB_SDD_ROOT ?? process.cwd();
  main(process.argv.slice(2), root)
    .then(({ text, exitCode }) => {
      if (text) console.log(text);
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
