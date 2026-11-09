import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { docChanges, docChecklist, docComplete, docConfirm, docNew, docRevise } from "../src/commands/doc.js";
import { stageGate } from "../src/commands/gate.js";
import { hookWrite } from "../src/commands/hook.js";
import { status } from "../src/commands/status.js";
import { docPath, hashPath, loadDoc, openRepo, Refusal, type Repo } from "../src/core/repo.js";

const TEMPLATES: Record<string, string> = {
  constitution: "# 헌법\n\n### [P-001] 원칙 하나\n\n내용\n",
  prd: "# PRD\n\n머리말\n\n### [CLI-001] 설치\n\n설치한다.\n\n### [CLI-002] 갱신\n\n갱신한다.\n",
  spec: "# 스펙\n\n요구사항\n",
  checklist: "# 체크리스트\n\n- [ ] 요구사항이 검증 가능하다\n- [ ] 미정 항목이 없다\n",
  blueprint: "# 설계\n\n설계 내용\n",
  research: "# 리서치\n",
  breakdown: "# 작업 목록\n\n- [ ] T001 [US1] 만든다 `src/a.ts`\n- [ ] FINAL 마지막 확인\n",
};

let repo: Repo;
let day = 1;
const next = () => ({ today: `2026-10-${String(day++).padStart(2, "0")}` });

function edit(kind: Parameters<typeof docPath>[1], feature: string | undefined, change: (text: string) => string): void {
  const file = docPath(repo, kind, feature);
  fs.writeFileSync(file, change(fs.readFileSync(file, "utf8")));
}

function passChecklist(feature: string): void {
  edit("checklist", feature, (text) => text.replace(/- \[ \]/g, "- [x]"));
  docChecklist(repo, feature);
}

function completeSpec(feature: string, depends?: string[]): void {
  docNew(repo, "spec", feature, next());
  passChecklist(feature);
  docComplete(repo, "spec", feature, { ...next(), depends });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-android-"));
  fs.mkdirSync(path.join(root, ".sdd-android", "templates"), { recursive: true });
  fs.writeFileSync(path.join(root, ".sdd-android", "config.yaml"), "language: ko\ndocs_dir: docs\n");
  for (const [name, body] of Object.entries(TEMPLATES)) {
    fs.writeFileSync(path.join(root, ".sdd-android", "templates", `${name}.md`), body);
  }
  repo = openRepo(root);
  day = 1;
});

describe("신규 문서(Flow A)", () => {
  it("템플릿을 복사하면 draft이고 버전이 없다", () => {
    docNew(repo, "prd", undefined, next());
    const doc = loadDoc(repo, "prd");
    expect(doc?.meta).toEqual({ status: "draft", created: "2026-10-01" });
    expect(doc?.body).toBe(TEMPLATES.prd);
  });

  it("완료를 기록하면 created, 1.0.0이 되고 해시가 남는다", () => {
    docNew(repo, "prd", undefined, next());
    expect(docComplete(repo, "prd", undefined, next()).version).toBe("1.0.0");

    expect(loadDoc(repo, "prd")?.meta).toEqual({
      version: "1.0.0",
      status: "created",
      created: "2026-10-01",
      updated: "2026-10-02",
      revisions: [{ version: "1.0.0", date: "2026-10-02" }],
    });
    const hashes = fs.readFileSync(hashPath(repo, "prd"), "utf8").split("\n");
    expect(hashes[0]).toBe("version 1.0.0");
    expect(hashes.slice(1, 4).map((line) => line.split(" ")[0])).toEqual(["*", "CLI-001", "CLI-002"]);
  });

  it("이미 있는 문서는 다시 만들지 않는다", () => {
    docNew(repo, "prd", undefined, next());
    expect(() => docNew(repo, "prd", undefined, next())).toThrow(Refusal);
  });

  it("feature 단계는 feature 이름을 요구한다", () => {
    expect(() => docNew(repo, "spec", undefined, next())).toThrow(/feature 이름/);
    expect(() => docNew(repo, "spec", "Login Flow", next())).toThrow(/소문자/);
  });
});

describe("개정(Flow B)", () => {
  beforeEach(() => {
    docNew(repo, "prd", undefined, next());
    docComplete(repo, "prd", undefined, next());
  });

  it("에이전트가 지목하지 않아도 바뀐 항목을 모두 낸다", () => {
    edit("prd", undefined, (text) => text.replace("설치한다.", "설치하고 기록한다.").replace("갱신한다.", "갱신하고 알린다."));
    expect(docChanges(repo, "prd", undefined)).toMatchObject({ dirty: true, changed: ["CLI-001", "CLI-002"] });
  });

  it("등급이 빠진 항목이 있으면 거부한다", () => {
    edit("prd", undefined, (text) => text.replace("설치한다.", "설치하고 기록한다.").replace("갱신한다.", "갱신하고 알린다."));
    expect(() => docRevise(repo, "prd", undefined, { ...next(), grades: { "CLI-001": "minor" } })).toThrow(/CLI-002/);
  });

  it("바뀌지 않은 항목에 등급을 매기면 거부한다", () => {
    edit("prd", undefined, (text) => text.replace("설치한다.", "설치하고 기록한다."));
    const grades = { "CLI-001": "minor", "CLI-002": "patch" } as const;
    expect(() => docRevise(repo, "prd", undefined, { ...next(), grades })).toThrow(/바뀌지 않은/);
  });

  it("항목마다 등급을 기록하고 가장 큰 등급으로 버전을 올린다", () => {
    edit("prd", undefined, (text) =>
      text.replace("설치한다.", "설치하고 기록한다.").replace("갱신한다.", "갱신 한다.").replace("머리말", "새 머리말"),
    );
    const grades = { "CLI-001": "minor", "CLI-002": "patch", "*": "patch" } as const;
    expect(docRevise(repo, "prd", undefined, { ...next(), grades }).version).toBe("1.1.0");

    const doc = loadDoc(repo, "prd");
    expect(doc?.meta.revisions?.at(-1)).toEqual({ version: "1.1.0", date: "2026-10-03", items: grades });
    expect(doc?.unrecorded).toBe(false);
  });

  it("지운 항목은 major, 새 항목은 minor 이상으로 고정한다", () => {
    edit("prd", undefined, (text) => text.replace("### [CLI-002] 갱신\n\n갱신한다.\n", "### [CLI-003] 점검\n\n점검한다.\n"));
    expect(docChanges(repo, "prd", undefined).floors).toEqual({ "CLI-002": "major", "CLI-003": "minor" });
    expect(() =>
      docRevise(repo, "prd", undefined, { ...next(), grades: { "CLI-002": "minor", "CLI-003": "minor" } }),
    ).toThrow(/major/);
    expect(() =>
      docRevise(repo, "prd", undefined, { ...next(), grades: { "CLI-002": "major", "CLI-003": "patch" } }),
    ).toThrow(/minor 이상/);
    expect(docRevise(repo, "prd", undefined, { ...next(), grades: { "CLI-002": "major", "CLI-003": "minor" } }).version).toBe(
      "2.0.0",
    );
  });

  it("바뀐 곳이 없으면 개정을 기록하지 않는다", () => {
    expect(() => docRevise(repo, "prd", undefined, { ...next(), grades: {} })).toThrow(/바뀐 곳이 없다/);
  });

  it("버전을 올리지 않고 고친 본문을 미기록 변경으로 잡는다", () => {
    edit("prd", undefined, (text) => text.replace("설치한다.", "설치하고 기록한다."));
    expect(loadDoc(repo, "prd")?.unrecorded).toBe(true);
    expect(status(repo).project.prd?.unrecorded).toBe(true);
  });
});

describe("spec의 완료 조건", () => {
  beforeEach(() => {
    docNew(repo, "prd", undefined, next());
    docComplete(repo, "prd", undefined, next());
    docNew(repo, "spec", "login", next());
  });

  it("spec을 만들면 checklist도 함께 만들고 prd의 버전을 기준으로 적는다", () => {
    expect(loadDoc(repo, "spec", "login")?.meta.based_on).toEqual({ prd: { version: "1.0.0" } });
    expect(loadDoc(repo, "checklist", "login")?.meta).toEqual({ status: "draft" });
  });

  it("체크되지 않은 항목이 있으면 failed이고 완료를 거부한다", () => {
    edit("checklist", "login", (text) => text.replace("- [ ] 요구사항", "- [x] 요구사항"));
    expect(docChecklist(repo, "login")).toEqual({ status: "failed", checked: 1, total: 2 });
    expect(() => docComplete(repo, "spec", "login", next())).toThrow(/pass가 아니다/);
  });

  it("검증한 뒤 spec 본문이 바뀌었으면 완료를 거부한다", () => {
    passChecklist("login");
    edit("spec", "login", (text) => text.replace("요구사항", "바뀐 요구사항"));
    expect(() => docComplete(repo, "spec", "login", next())).toThrow(/본문이 바뀌었다/);
    docChecklist(repo, "login");
    expect(docComplete(repo, "spec", "login", next()).version).toBe("1.0.0");
  });

  it("의존 항목은 prd에 있는 ID여야 한다", () => {
    passChecklist("login");
    expect(() => docComplete(repo, "spec", "login", { ...next(), depends: ["CLI-009"] })).toThrow(/prd에 없는/);
    docComplete(repo, "spec", "login", { ...next(), depends: ["CLI-002", "CLI-001"] });
    expect(loadDoc(repo, "spec", "login")?.meta.based_on).toEqual({
      prd: { version: "1.0.0", items: ["CLI-001", "CLI-002"] },
    });
    expect(loadDoc(repo, "checklist", "login")?.meta).toEqual({ status: "pass", based_on: { spec: { version: "1.0.0" } } });
  });

  it("spec을 개정하면 checklist를 다시 검증해야 한다", () => {
    passChecklist("login");
    docComplete(repo, "spec", "login", next());
    edit("spec", "login", (text) => text.replace("요구사항", "바뀐 요구사항"));
    expect(() => docRevise(repo, "spec", "login", { ...next(), grade: "minor" })).toThrow(/본문이 바뀌었다/);
    docChecklist(repo, "login");
    expect(docRevise(repo, "spec", "login", { ...next(), grade: "minor" }).version).toBe("1.1.0");
  });
});

describe("착수 게이트", () => {
  beforeEach(() => {
    docNew(repo, "prd", undefined, next());
    docComplete(repo, "prd", undefined, next());
  });

  it("spec이 없으면 blueprint를 시작할 수 없다", () => {
    expect(stageGate(repo, "blueprint", "login")).toMatchObject({ action: "block", mode: "new" });
    expect(() => docNew(repo, "blueprint", "login", next())).toThrow(/상위 문서 없음/);
  });

  it("draft인 spec으로는 blueprint를 시작할 수 없다", () => {
    docNew(repo, "spec", "login", next());
    expect(() => docNew(repo, "blueprint", "login", next())).toThrow(/상위 미완료/);
  });

  it("완료된 spec으로는 blueprint를 시작하고 research도 함께 만든다", () => {
    completeSpec("login");
    const { created } = docNew(repo, "blueprint", "login", next());
    expect(created.map((file) => path.basename(file))).toEqual(["blueprint.md", "research.md"]);
    expect(loadDoc(repo, "blueprint", "login")?.meta.based_on).toEqual({ spec: { version: "1.0.0" } });
  });

  it("spec에 미기록 변경이 있으면 확인을 요구하고, 계속하기로 했으면 진행한다", () => {
    completeSpec("login");
    edit("spec", "login", (text) => text.replace("요구사항", "몰래 바꾼 요구사항"));
    expect(stageGate(repo, "blueprint", "login").action).toBe("confirm");
    expect(() => docNew(repo, "blueprint", "login", next())).toThrow(/--acknowledged/);
    expect(docNew(repo, "blueprint", "login", { ...next(), acknowledged: true }).created).toHaveLength(2);
  });

  it("blueprint가 spec에 MAJOR로 뒤처져 있으면 breakdown을 시작할 수 없다", () => {
    completeSpec("login");
    docNew(repo, "blueprint", "login", next());
    docComplete(repo, "blueprint", "login", next());
    edit("spec", "login", (text) => text.replace("요구사항", "완전히 다른 요구사항"));
    docChecklist(repo, "login");
    docRevise(repo, "spec", "login", { ...next(), grade: "major" });

    expect(stageGate(repo, "breakdown", "login")).toMatchObject({
      action: "block",
      reasons: [{ doc: "blueprint", against: "spec", verdict: "behind-major", action: "block" }],
    });
    // blueprint 자신은 뒤처진 것을 푸는 단계이므로 막히지 않는다.
    expect(stageGate(repo, "blueprint", "login")).toMatchObject({ action: "pass", mode: "revise" });
  });

  it("prd와 spec 사이의 뒤처짐은 보고만 하고 막지 않는다", () => {
    completeSpec("login", ["CLI-001"]);
    edit("prd", undefined, (text) => text.replace("설치한다.", "전혀 다르게 설치한다."));
    const result = docRevise(repo, "prd", undefined, { ...next(), grades: { "CLI-001": "major" } });

    expect(result.stale).toMatchObject([{ feature: "login", lower: "spec", upper: "prd", verdict: "behind-major" }]);
    expect(stageGate(repo, "blueprint", "login").action).toBe("pass");
  });

  it("한 항목에만 의존하는 spec은 그 항목의 등급만 따른다", () => {
    completeSpec("login", ["CLI-002"]);
    edit("prd", undefined, (text) => text.replace("설치한다.", "전혀 다르게 설치한다.").replace("갱신한다.", "갱신 한다."));
    const grades = { "CLI-001": "major", "CLI-002": "patch" } as const;
    expect(docRevise(repo, "prd", undefined, { ...next(), grades }).stale).toMatchObject([{ verdict: "behind-patch" }]);
  });
});

describe("영향 없음 확인(Flow C)", () => {
  it("자기 버전은 그대로 두고 기준 버전만 올린다", () => {
    docNew(repo, "prd", undefined, next());
    docComplete(repo, "prd", undefined, next());
    completeSpec("login");
    edit("prd", undefined, (text) => text.replace("설치한다.", "전혀 다르게 설치한다."));
    docRevise(repo, "prd", undefined, { ...next(), grades: { "CLI-001": "major" } });

    expect(docConfirm(repo, "spec", "login")).toEqual({ updated: ["prd"] });
    const spec = loadDoc(repo, "spec", "login");
    expect(spec?.meta.version).toBe("1.0.0");
    expect(spec?.meta.based_on).toEqual({ prd: { version: "2.0.0" } });
    expect(spec?.unrecorded).toBe(false);
  });

  it("본문이 바뀐 문서에는 쓸 수 없다", () => {
    completeSpec("login");
    edit("spec", "login", (text) => text.replace("요구사항", "바뀐 요구사항"));
    expect(() => docConfirm(repo, "spec", "login")).toThrow(/doc revise/);
  });
});

describe("쓰기 hook", () => {
  it("중단 판정인 문서의 쓰기만 막는다", () => {
    docNew(repo, "spec", "login", next());
    const blueprint = docPath(repo, "blueprint", "login");
    expect(hookWrite(repo, blueprint)).toMatchObject({ allow: false });
    expect(hookWrite(repo, blueprint.replace("blueprint.md", "research.md"))).toMatchObject({ allow: false });
    expect(hookWrite(repo, docPath(repo, "spec", "login"))).toEqual({ allow: true });
  });

  it("확인 필요는 막지 않는다", () => {
    completeSpec("login");
    edit("spec", "login", (text) => text.replace("요구사항", "몰래 바꾼 요구사항"));
    expect(hookWrite(repo, docPath(repo, "blueprint", "login"))).toEqual({ allow: true });
  });

  it("사슬 문서가 아닌 파일은 통과시킨다", () => {
    expect(hookWrite(repo, path.join(repo.root, "src", "a.ts"))).toEqual({ allow: true });
    expect(hookWrite(repo, path.join(repo.root, "docs", "notes.md"))).toEqual({ allow: true });
  });
});

describe("status", () => {
  it("feature의 문서 상태, 체크리스트, 작업 수, 판정을 낸다", () => {
    completeSpec("login");
    docNew(repo, "blueprint", "login", next());
    docComplete(repo, "blueprint", "login", next());
    docNew(repo, "breakdown", "login", next());

    const [feature] = status(repo).features;
    expect(feature).toMatchObject({
      name: "login",
      docs: {
        spec: { status: "created", version: "1.0.0" },
        blueprint: { status: "created", version: "1.0.0" },
        breakdown: { status: "draft" },
      },
      checklist: { status: "pass", checked: 2, total: 2 },
      tasks: { done: 0, total: 1 },
    });
  });
});
