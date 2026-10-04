import { describe, expect, it } from "vitest";
import { actionFor, judgeChain, judgeRelation, lagGrade, type DocState } from "../src/core/chain.js";
import type { Meta } from "../src/core/frontmatter.js";

const doc = (meta: Meta, unrecorded = false): DocState => ({ meta, unrecorded });

const PRD: Meta = {
  version: "2.0.0",
  status: "created",
  revisions: [
    { version: "1.0.0", date: "2026-10-01" },
    { version: "1.0.1", date: "2026-10-02", items: { "SYS-003": "patch" } },
    { version: "1.1.0", date: "2026-10-03", items: { "CLI-002": "minor" } },
    { version: "2.0.0", date: "2026-10-04", items: { "CLI-001": "major", "SYS-003": "patch" } },
  ],
};

const specOn = (version: string, items?: string[]): DocState =>
  doc({ version: "1.0.0", status: "created", based_on: { prd: { version, ...(items ? { items } : {}) } } });

describe("판정 종류", () => {
  it("일치", () => {
    expect(judgeRelation(specOn("2.0.0"), "prd", doc(PRD))).toBe("match");
  });

  it("등급별 뒤처짐", () => {
    expect(judgeRelation(specOn("1.0.0", ["SYS-003"]), "prd", doc(PRD))).toBe("behind-patch");
    expect(judgeRelation(specOn("1.0.0", ["CLI-002"]), "prd", doc(PRD))).toBe("behind-minor");
    expect(judgeRelation(specOn("1.0.0", ["CLI-001"]), "prd", doc(PRD))).toBe("behind-major");
  });

  it("상위 미완료", () => {
    expect(judgeRelation(specOn("1.0.0"), "prd", doc({ status: "draft" }))).toBe("upper-draft");
  });

  it("기준 버전이 상위보다 높음", () => {
    expect(judgeRelation(specOn("2.1.0"), "prd", doc(PRD))).toBe("base-ahead");
  });

  it("기준 버전 비어 있음", () => {
    expect(judgeRelation(doc({ version: "1.0.0", status: "created" }), "prd", doc(PRD))).toBe("base-missing");
  });

  it("미기록 변경", () => {
    expect(judgeRelation(specOn("2.0.0"), "prd", doc(PRD, true))).toBe("unrecorded-change");
  });

  it("상위 문서 없음", () => {
    expect(judgeRelation(specOn("1.0.0"), "prd", undefined)).toBe("upper-missing");
  });
});

describe("항목 단위 판정", () => {
  it("의존 항목과 겹치는 개정이 없으면 일치다", () => {
    expect(judgeRelation(specOn("1.0.0", ["CLI-004"]), "prd", doc(PRD))).toBe("match");
  });

  it("같은 개정에서 다른 항목이 크게 바뀌었어도 의존 항목의 등급만 본다", () => {
    expect(lagGrade({ version: "1.1.0", items: ["SYS-003"] }, PRD)).toBe("patch");
  });

  it("항목 밖의 변경은 모든 하위 문서에 걸린다", () => {
    const prd: Meta = {
      version: "1.1.0",
      status: "created",
      revisions: [
        { version: "1.0.0", date: "2026-10-01" },
        { version: "1.1.0", date: "2026-10-02", items: { "*": "minor" } },
      ],
    };
    expect(lagGrade({ version: "1.0.0", items: ["CLI-004"] }, prd)).toBe("minor");
  });

  it("의존 항목을 적지 않았으면 상위 문서 전체에 의존한다", () => {
    expect(judgeRelation(specOn("1.0.0"), "prd", doc(PRD))).toBe("behind-major");
    expect(judgeRelation(specOn("1.1.0"), "prd", doc(PRD))).toBe("behind-major");
  });

  it("기준 버전 이전의 개정은 세지 않는다", () => {
    expect(lagGrade({ version: "1.1.0", items: ["CLI-002"] }, PRD)).toBeNull();
  });

  it("개정 기록이 없는 상위는 버전 번호의 차이로 등급을 낸다", () => {
    expect(lagGrade({ version: "1.0.0" }, { version: "1.3.0", status: "created" })).toBe("minor");
  });
});

describe("판정별 처리", () => {
  it("게이트 관계", () => {
    expect(actionFor("match", true)).toBe("pass");
    expect(actionFor("behind-patch", true)).toBe("pass");
    expect(actionFor("behind-minor", true)).toBe("confirm");
    expect(actionFor("unrecorded-change", true)).toBe("confirm");
    expect(actionFor("base-missing", true)).toBe("confirm");
    expect(actionFor("behind-major", true)).toBe("block");
    expect(actionFor("upper-unresolved", true)).toBe("block");
    expect(actionFor("upper-draft", true)).toBe("block");
    expect(actionFor("base-ahead", true)).toBe("block");
  });

  it("보고만 하는 관계는 어떤 판정도 막지 않는다", () => {
    expect(actionFor("match", false)).toBe("pass");
    expect(actionFor("behind-major", false)).toBe("report");
    expect(actionFor("upper-draft", false)).toBe("report");
  });
});

describe("judgeChain", () => {
  const spec = (version: string): DocState =>
    doc({ version, status: "created", based_on: { prd: { version: "2.0.0" } } });
  const blueprint = (specVersion: string): DocState =>
    doc({ version: "1.0.0", status: "created", based_on: { spec: { version: specVersion } } });
  const breakdown: DocState = doc({
    version: "1.0.0",
    status: "created",
    based_on: { blueprint: { version: "1.0.0" } },
  });

  const verdicts = (docs: Parameters<typeof judgeChain>[0]) =>
    Object.fromEntries(judgeChain(docs).map((r) => [`${r.lower}→${r.upper}`, `${r.verdict}/${r.action}`]));

  it("모두 최신이면 모두 통과한다", () => {
    expect(verdicts({ prd: doc(PRD), spec: spec("1.0.0"), blueprint: blueprint("1.0.0"), breakdown })).toEqual({
      "spec→prd": "match/pass",
      "blueprint→spec": "match/pass",
      "breakdown→blueprint": "match/pass",
    });
  });

  it("상위가 뒤처져 있으면 그 하위에는 상위 미해결만 표시한다", () => {
    expect(verdicts({ spec: spec("2.0.0"), blueprint: blueprint("1.0.0"), breakdown })["breakdown→blueprint"]).toBe(
      "upper-unresolved/block",
    );
  });

  it("PATCH 뒤처짐은 하위로 전이시키지 않는다", () => {
    expect(verdicts({ spec: spec("1.0.1"), blueprint: blueprint("1.0.0"), breakdown })).toMatchObject({
      "blueprint→spec": "behind-patch/pass",
      "breakdown→blueprint": "match/pass",
    });
  });

  it("보고만 하는 관계의 뒤처짐은 전이시키지 않는다", () => {
    const stale = doc({ version: "1.0.0", status: "created", based_on: { prd: { version: "1.0.0" } } });
    expect(verdicts({ prd: doc(PRD), spec: stale, blueprint: blueprint("1.0.0") })).toEqual({
      "spec→prd": "behind-major/report",
      "blueprint→spec": "match/pass",
    });
  });

  it("prd가 없고 spec이 prd를 기준으로 삼지 않으면 그 관계를 판정하지 않는다", () => {
    const alone = doc({ version: "1.0.0", status: "created" });
    expect(verdicts({ spec: alone })).toEqual({});
  });

  it("draft인 spec으로는 blueprint를 진행할 수 없다", () => {
    expect(verdicts({ spec: doc({ status: "draft" }), blueprint: blueprint("1.0.0") })["blueprint→spec"]).toBe(
      "upper-draft/block",
    );
  });
});
