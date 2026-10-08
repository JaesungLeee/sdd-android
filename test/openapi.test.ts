import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/commands/check.js";
import { runScript } from "../src/commands/run.js";
import { openRepo, Refusal } from "../src/core/repo.js";
import { findOperations, formatList, listOperations, loadSource, main, parseSpec, renderOperation, validateSources, type Fetch } from "../src/extensions/openapi/openapi.js";

const SPEC = {
  openapi: "3.0.3",
  info: { title: "Pet Store", version: "1.2.0" },
  paths: {
    "/pets": {
      get: { operationId: "listPets", summary: "펫 목록", tags: ["pets"], parameters: [{ name: "limit", in: "query", schema: { type: "integer", maximum: 100 } }], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } } } } } } },
      post: { operationId: "createPet", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NewPet" } } } }, responses: { "201": { description: "made" } } },
    },
    "/pets/{petId}": {
      get: { operationId: "getPet", parameters: [{ $ref: "#/components/parameters/PetId" }], responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } }, "404": { $ref: "#/components/responses/NotFound" } } },
    },
  },
  components: {
    parameters: { PetId: { name: "petId", in: "path", required: true, description: "펫의 ID", schema: { type: "integer", format: "int64" } } },
    responses: { NotFound: { description: "없음", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
    schemas: {
      Pet: { allOf: [{ $ref: "#/components/schemas/NewPet" }, { type: "object", required: ["id"], properties: { id: { type: "integer", format: "int64" }, owner: { $ref: "#/components/schemas/Owner" } } }] },
      NewPet: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 50 }, kind: { type: "string", enum: ["dog", "cat"] }, tags: { type: "array", items: { type: "string" } } } },
      Owner: { type: "object", properties: { name: { type: "string" }, pets: { type: "array", items: { $ref: "#/components/schemas/Pet" } } } },
      Error: { type: "object", required: ["code", "message"], properties: { code: { type: "integer" }, message: { type: "string", nullable: true } } },
    },
  },
};

function tempRepo(config: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mob-sdd-openapi-"));
  fs.mkdirSync(path.join(root, ".mob-sdd"));
  fs.writeFileSync(path.join(root, ".mob-sdd", "config.yaml"), `language: ko\ndocs_dir: docs\nprefix: ""\n${config}`);
  return root;
}
const fakeFetch = (body: string | number): Fetch => async () => (typeof body === "number" ? { ok: false, status: body, text: async () => "" } : { ok: true, status: 200, text: async () => body });
const now = new Date("2026-10-08T06:00:00Z");

describe("OpenAPI 문서", () => {
  it("JSON과 YAML을 읽고 오퍼레이션을 문서 순서로 낸다", () => {
    const fromJson = listOperations(parseSpec(JSON.stringify(SPEC)));
    expect(fromJson.map((op) => `${op.method} ${op.path}`)).toEqual(["GET /pets", "POST /pets", "GET /pets/{petId}"]);
    const yaml = "openapi: 3.0.3\ninfo: { title: T, version: 1 }\npaths:\n  /a:\n    get: { operationId: a, summary: 에이, tags: [x] }\n";
    const fromYaml = listOperations(parseSpec(yaml));
    expect(fromYaml[0]).toMatchObject({ method: "GET", path: "/a", id: "a", summary: "에이", tags: ["x"] });
    expect(() => parseSpec("hello: world\n")).toThrow(/openapi 키가 없다/);
    expect(() => parseSpec("[1, 2]")).toThrow(/OpenAPI 문서가 아니다/);
  });

  it("list는 머리말과 목록을 내고 필터로 좁힌다", async () => {
    const root = tempRepo("");
    const source = await loadSource(root, { name: "api", url: "https://x.y/openapi.json" }, fakeFetch(JSON.stringify(SPEC)), now);
    expect(source.error).toBeUndefined();
    const text = formatList([source]);
    expect(text).toContain("== api (https://x.y/openapi.json) · 조회 2026-10-08T06:00:00.000Z · Pet Store 1.2.0");
    expect(text).toContain("GET /pets listPets 펫 목록 [pets]");
    expect(text).toContain("POST /pets createPet -");
    expect(formatList([source], "petid")).toContain("GET /pets/{petId} getPet");
    expect(formatList([source], "petid")).not.toContain("POST /pets");
    expect(formatList([source], "없는것")).toContain("(없는것에 맞는 오퍼레이션이 없다)");
  });

  it("show는 $ref, allOf, 열거, 배열, 필수 표시, nullable, 순환을 펼친다", async () => {
    const root = tempRepo("");
    fs.writeFileSync(path.join(root, "openapi.json"), JSON.stringify(SPEC));
    const source = await loadSource(root, { name: "api", path: "openapi.json" }, fakeFetch(500), now);
    expect(source.error).toBeUndefined();
    const [get] = findOperations([source], "GET /pets/{petId}");
    const text = renderOperation(source, get!.operation);
    expect(text).toContain("== api · GET /pets/{petId} getPet · 조회 2026-10-08T06:00:00.000Z");
    expect(text).toContain("- petId (path, 필수): integer(int64) · 펫의 ID");
    expect(text).toContain("- 200 application/json");
    expect(text).toContain("name*: string (최대 50자)");
    expect(text).toContain('kind: "dog" | "cat"');
    expect(text).toContain("tags: [string]");
    expect(text).toContain("id*: integer(int64)");
    expect(text).toContain("pets: [Pet (순환)]");
    expect(text).toContain("- 404 application/json 없음");
    expect(text).toContain("message*: string?");
    const [post] = findOperations([source], "createPet");
    expect(renderOperation(source, post!.operation)).toContain("요청 본문: application/json (필수)");
    expect(findOperations([source], "nope")).toEqual([]);
  });

  it("조회 실패는 머리말에 적히고 다른 출처는 그대로 나온다", async () => {
    const root = tempRepo("");
    const bad = await loadSource(root, { name: "bad", url: "https://x.y/none" }, fakeFetch(404), now);
    const missing = await loadSource(root, { name: "file", path: "없음.yaml" }, fakeFetch(200), now);
    expect(bad.error).toBe("HTTP 404");
    expect(missing.error).toBe("파일이 없다: 없음.yaml");
    const text = formatList([bad, missing]);
    expect(text).toContain("== bad (https://x.y/none) · 조회 실패: HTTP 404");
    expect(text).toContain("== file (없음.yaml) · 조회 실패: 파일이 없다: 없음.yaml");
  });

  it("설정의 출처를 검사하고 main이 명령을 가른다", async () => {
    expect(validateSources(undefined)).toEqual([]);
    expect(validateSources({ sources: [{ name: "a", url: "https://x" }, { name: "b", path: "p.yaml" }] })).toEqual([{ name: "a", url: "https://x" }, { name: "b", path: "p.yaml" }]);
    expect(() => validateSources({ sources: [{ name: "A", url: "https://x" }] })).toThrow(/name/);
    expect(() => validateSources({ sources: [{ name: "a", url: "https://x", path: "p" }] })).toThrow(/하나만/);
    expect(() => validateSources({ sources: [{ name: "a", url: "ftp://x" }] })).toThrow(/http/);
    expect(() => validateSources({ sources: [{ name: "a", url: "https://x" }, { name: "a", path: "p" }] })).toThrow(/겹친다/);
    expect(() => validateSources({ sources: "x" })).toThrow(/목록/);

    const none = tempRepo("");
    expect((await main(["list"], none)).text).toContain("출처가 없다");
    const root = tempRepo("openapi:\n  sources:\n    - name: api\n      path: openapi.json\n");
    fs.writeFileSync(path.join(root, "openapi.json"), JSON.stringify(SPEC));
    expect((await main([], root)).exitCode).toBe(2);
    expect((await main(["list", "--filter", "pets"], root)).text).toContain("GET /pets listPets");
    expect((await main(["list", "--source", "nope"], root)).exitCode).toBe(2);
    const shown = await main(["show", "getPet", "GET /pets", "없음"], root);
    expect(shown.exitCode).toBe(0);
    expect(shown.text).toContain("== api · GET /pets/{petId} getPet");
    expect(shown.text).toContain("== api · GET /pets listPets");
    expect(shown.text).toContain("== 없음: 어느 출처에도 없다");
    expect((await main(["show"], root)).exitCode).toBe(2);
  });

  it("check는 출처의 형식과 path의 파일을 본다", () => {
    const root = tempRepo("openapi:\n  sources:\n    - name: api\n      path: contracts/openapi.yaml\n    - name: bad\n");
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".mob-sdd", "manifest.json"), JSON.stringify({ version: "0.4.0", files: {} }));
    const messages = () => check(openRepo(root)).problems.filter((p) => p.where === ".mob-sdd/config.yaml").map((p) => p.message);
    expect(messages()).toEqual(["openapi.sources[1]: url과 path 가운데 하나만 적는다"]);
    fs.writeFileSync(path.join(root, ".mob-sdd", "config.yaml"), "language: ko\nopenapi:\n  sources:\n    - name: api\n      path: contracts/openapi.yaml\n");
    expect(messages()).toEqual(["openapi 출처 api의 파일이 없다: contracts/openapi.yaml"]);
    fs.mkdirSync(path.join(root, "contracts"));
    fs.writeFileSync(path.join(root, "contracts", "openapi.yaml"), "openapi: 3.0.0\n");
    expect(messages()).toEqual([]);
  });
});

describe("run", () => {
  it("설치된 확장의 scripts/ 아래 .mjs만 저장소 루트에서 실행하고 인자와 종료 코드를 그대로 넘긴다", () => {
    const root = tempRepo("");
    const ext = path.join(root, ".mob-sdd", "extensions", "sample");
    fs.mkdirSync(path.join(ext, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ext, "extension.yaml"), "name: sample\nkind: extension\nversion: 1.0.0\n");
    fs.writeFileSync(path.join(ext, "scripts", "echo.mjs"), "console.log(JSON.stringify({ args: process.argv.slice(2), root: process.env.MOB_SDD_ROOT, cwd: process.cwd() })); process.exitCode = 3;\n");
    fs.writeFileSync(path.join(ext, "other.mjs"), "console.log('x');\n");
    const repo = openRepo(root);
    const result = runScript(repo, "sample", "echo.mjs", ["list", "--filter", "x y"], { capture: true });
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout ?? "")).toEqual({ args: ["list", "--filter", "x y"], root, cwd: fs.realpathSync(root) === root ? root : expect.any(String) });
    expect(() => runScript(repo, "nope", "echo.mjs", [])).toThrow(/설치된 확장이 아니다/);
    expect(() => runScript(repo, "sample", "../other.mjs", [])).toThrow(Refusal);
    expect(() => runScript(repo, "sample", "echo.js", [])).toThrow(/\.mjs/);
    expect(() => runScript(repo, "sample", "none.mjs", [])).toThrow(/스크립트가 없다/);
    expect(() => runScript(repo, undefined, "echo.mjs", [])).toThrow(/확장 이름/);
  });
});
