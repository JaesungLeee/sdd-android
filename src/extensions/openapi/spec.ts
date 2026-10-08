/**
 * OpenAPI 문서의 읽기와 찾기. 스크립트(`openapi.ts`)와 `openapi add`가 함께 쓴다. 부수 효과가 없다.
 */
import { parse } from "yaml";

export type Json = Record<string, unknown>;

export type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export const ACCEPT = { accept: "application/json, application/yaml, text/yaml, */*" };

/** JSON이면 JSON으로, 아니면 YAML로 읽는다. OpenAPI 문서는 YAML이 흔하다. */
export function parseSpec(text: string): Json {
  let data: unknown;
  const trimmed = text.trimStart();
  if (isHtml(trimmed)) throw new Error("HTML 페이지가 왔다. Swagger UI가 아니라 문서 자체의 주소를 적는다(보통 /v3/api-docs나 …/openapi.json)");
  if (trimmed.startsWith("{")) data = JSON.parse(trimmed);
  else data = parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("OpenAPI 문서가 아니다");
  const doc = data as Json;
  if (typeof doc.openapi !== "string" && typeof doc.swagger !== "string") throw new Error("OpenAPI 문서가 아니다: openapi 키가 없다");
  return doc;
}

export function isHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html|<!--)/i.test(text);
}

export interface Discovered {
  /** 문서를 읽은 주소. 페이지 안에 든 문서면 그 스크립트의 주소다. */
  url: string;
  text: string;
  doc: Json;
}

async function fetchText(url: string, fetchImpl: Fetch): Promise<string | undefined> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), headers: ACCEPT });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

/** 페이지의 초기화 스크립트에 적힌 문서 주소. Swagger UI 배포본의 기본값(petstore)은 아니다. */
function urlInInitializer(script: string, base: URL): string | undefined {
  const match = /\burl:\s*["']([^"']+)["']/.exec(script);
  if (!match) return undefined;
  const found = match[1] as string;
  if (/petstore\.swagger\.io/.test(found)) return undefined;
  try {
    return new URL(found, base).toString();
  } catch {
    return undefined;
  }
}

/** NestJS가 `swagger-ui-init.js`에 통째로 넣는 `"swaggerDoc": {…}`를 괄호를 세어 잘라 낸다. */
export function inlineSwaggerDoc(script: string): string | undefined {
  const at = script.indexOf('"swaggerDoc":');
  if (at < 0) return undefined;
  const start = script.indexOf("{", at);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < script.length; i += 1) {
    const ch = script[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Swagger UI 페이지의 주소를 받았을 때 그 페이지가 읽는 문서를 찾는다.
 * 초기화 스크립트의 `url`, NestJS의 `-json`과 `-yaml`, 흔한 자리들, 마지막으로 페이지 안에 든 문서의 순서다.
 */
export async function discoverDocument(pageUrl: string, fetchImpl: Fetch): Promise<Discovered | undefined> {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return undefined;
  }
  const page = base.toString().replace(/\/$/, "");
  const origin = base.origin;
  const candidates: string[] = [];
  for (const name of ["swagger-initializer.js", "swagger-ui-init.js"]) {
    const script = await fetchText(`${page}/${name}`, fetchImpl);
    if (!script) continue;
    const found = urlInInitializer(script, base);
    if (found) candidates.push(found);
  }
  candidates.push(
    `${page}-json`,
    `${page}-yaml`,
    `${page}.json`,
    `${page}/openapi.json`,
    `${page}/swagger.json`,
    `${origin}/v3/api-docs`,
    `${origin}/openapi.json`,
    `${origin}/swagger.json`,
    `${origin}/swagger/v1/swagger.json`,
  );
  for (const url of [...new Set(candidates)].filter((candidate) => candidate !== page)) {
    const text = await fetchText(url, fetchImpl);
    if (!text || isHtml(text)) continue;
    try {
      return { url, text, doc: parseSpec(text) };
    } catch {
      continue;
    }
  }
  const init = await fetchText(`${page}/swagger-ui-init.js`, fetchImpl);
  const inline = init ? inlineSwaggerDoc(init) : undefined;
  if (inline) {
    try {
      return { url: `${page}/swagger-ui-init.js`, text: inline, doc: parseSpec(inline) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
