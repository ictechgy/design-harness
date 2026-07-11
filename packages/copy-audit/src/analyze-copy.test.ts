import { scoreFindings, type CopyStyle } from "@design-harness/core";
import { describe, expect, it } from "vitest";

import {
  analyzeCopy,
  copyAuditCapabilityNotices,
  type CopyInventory,
  type CopyTextNode
} from "./index.js";

const MINIMAL_STYLE: CopyStyle = {
  schemaVersion: "0.2",
  locale: "ko-KR"
};

function inventory(items: readonly CopyTextNode[]): CopyInventory {
  return {
    viewport: "desktop",
    evidenceRef: "text-inventory-desktop",
    items
  };
}

function oneNode(text: string, overrides: Partial<CopyTextNode> = {}): CopyInventory {
  return inventory([{
    selector: "main > p",
    text,
    ...overrides
  }]);
}

describe("analyzeCopy placeholder grammar", () => {
  it("does not flag clean Korean or English copy", () => {
    expect(analyzeCopy(oneNode("주문이 완료되었습니다. Your order is ready."), MINIMAL_STYLE)).toEqual([]);
  });

  it("aggregates supported Mustache variables by source family", () => {
    const findings = analyzeCopy(
      oneNode("안녕하세요 {{user_name}}님. 담당자는 {{ user.name }}입니다. {{user_name}}"),
      MINIMAL_STYLE
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkName: "placeholder-leak",
      sourceRefs: ["mustache-spec"],
      severity: "high",
      confidence: "high",
      determinism: "deterministic",
      resultKind: "failure",
      runtime: "static-dom",
      observed: {
        matches: ["{{user_name}}", "{{ user.name }}"],
        occurrenceCount: 3
      }
    });
  });

  it("aggregates supported ICU complex arguments by source family", () => {
    const findings = analyzeCopy(
      oneNode("{count, plural, one {item}} {gender, select, other {user}} {rank, selectordinal, other {#th}}"),
      MINIMAL_STYLE
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceRefs: ["unicode-icu-messageformat"],
      observed: {
        matches: ["{count, plural,", "{gender, select,", "{rank, selectordinal,"],
        occurrenceCount: 3
      }
    });
  });

  it("combines TODO and Lorem ipsum under the output-contract source", () => {
    const findings = analyzeCopy(
      oneNode("TODO then Lorem\tipsum then TODO:"),
      MINIMAL_STYLE
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceRefs: ["design-harness-output-contract"],
      observed: {
        matches: ["TODO", "Lorem\tipsum"],
        occurrenceCount: 3
      }
    });
  });

  it("emits separate findings with exact sources when families coexist", () => {
    const findings = analyzeCopy(
      oneNode("{{name}} {count, plural, one {item} other {items}} TODO"),
      MINIMAL_STYLE
    );

    expect(findings.map((finding) => finding.sourceRefs)).toEqual([
      ["mustache-spec"],
      ["unicode-icu-messageformat"],
      ["design-harness-output-contract"]
    ]);
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(3);
  });

  it("rejects neighboring Mustache, ICU, TODO, and Lorem forms", () => {
    const negativeForms = [
      "{{#section}}",
      "{{! comment }}",
      "{{{name}}}",
      "{{& name}}",
      "{{ user + name }}",
      "{{9name}}",
      "{{=<% %>=}}",
      "{name}",
      "{amount, number}",
      "{date, date, short}",
      "{time, time, short}",
      "{count, Plural, one {item}}",
      "todo",
      "TODOLIST",
      "가TODO",
      "TODO값",
      "_TODO",
      "lorem",
      "alorem ipsum",
      "lorem ipsum2",
      "_lorem ipsum",
      "lorem ipsum_",
      "Use {braces} in ordinary prose."
    ].join(" | ");

    expect(analyzeCopy(oneNode(negativeForms), MINIMAL_STYLE)).toEqual([]);
  });

  it("accepts punctuation-delimited TODO and case-insensitive Unicode-space Lorem ipsum", () => {
    const findings = analyzeCopy(oneNode("TODO: LOREM\u00a0IPSUM"), MINIMAL_STYLE);

    expect(findings).toHaveLength(1);
    expect(findings[0].observed).toMatchObject({
      matches: ["TODO", "LOREM\u00a0IPSUM"],
      occurrenceCount: 2
    });
  });
});

describe("analyzeCopy configured rules", () => {
  it("flags only the shipped josa hedge forms unless the policy allows them", () => {
    const input = oneNode("파일을(를) 선택하고 이름이(가) 맞는지 확인하세요. 은(는) 제외합니다.");
    const defaultFindings = analyzeCopy(input, MINIMAL_STYLE);
    const allowedFindings = analyzeCopy(input, {
      ...MINIMAL_STYLE,
      josaHedgePolicy: "allow"
    });

    expect(defaultFindings).toHaveLength(1);
    expect(defaultFindings[0]).toMatchObject({
      checkName: "josa-hedge",
      severity: "low",
      sourceRefs: ["copy-style-contract"],
      observed: {
        matches: ["을(를)", "이(가)"],
        occurrenceCount: 2
      }
    });
    expect(allowedFindings).toEqual([]);
  });

  it("separates banned and use-carefully glossary findings and skips approved and lemma entries", () => {
    const copyStyle: CopyStyle = {
      ...MINIMAL_STYLE,
      glossary: [
        { term: "잔액", tier: "approved" },
        {
          term: "충전하기",
          tier: "banned",
          preferredTerm: "입금하기",
          note: "Use the configured funding term."
        },
        {
          term: "잔고",
          tier: "use-carefully",
          preferredTerm: "잔액",
          note: "Review financial context."
        },
        { term: "결제", tier: "banned", match: "lemma" }
      ]
    };

    const findings = analyzeCopy(oneNode("잔액을 충전하기 전에 잔고와 결제를 확인하세요."), copyStyle);

    expect(findings.map((finding) => finding.checkName)).toEqual([
      "glossary-banned-term",
      "glossary-use-carefully-term"
    ]);
    expect(findings[0].recommendation).toContain("입금하기");
    expect(findings[0].recommendation).toContain("Use the configured funding term.");
    expect(findings[1].recommendation).toContain("잔액");
    expect(findings[1].recommendation).toContain("Review financial context.");
  });

  it("includes configured replacement and reason for a banned phrase", () => {
    const copyStyle: CopyStyle = {
      ...MINIMAL_STYLE,
      bannedPhrases: [{
        phrase: "빠르고 쉽습니다",
        suggestedReplacement: "3분 안에 신청할 수 있어요",
        reason: "State a measurable outcome."
      }]
    };

    const findings = analyzeCopy(oneNode("신청은 빠르고 쉽습니다."), copyStyle);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkName: "banned-phrase",
      severity: "medium",
      sourceRefs: ["copy-style-contract"]
    });
    expect(findings[0].recommendation).toContain("3분 안에 신청할 수 있어요");
    expect(findings[0].recommendation).toContain("State a measurable outcome.");
  });

  it("applies scoped rules only to resolved matching surfaces", () => {
    const copyStyle: CopyStyle = {
      ...MINIMAL_STYLE,
      glossary: [{
        term: "충전하기",
        tier: "banned",
        surfaces: ["button"]
      }]
    };
    const nodes: CopyTextNode[] = [
      {
        selector: "button",
        text: "충전하기",
        copySurface: {
          surface: "button",
          ruleIndex: 0,
          matcher: { kind: "role", value: "button" }
        }
      },
      {
        selector: "main > p",
        text: "충전하기",
        copySurface: {
          surface: "body",
          ruleIndex: 1,
          matcher: { kind: "adapter", adapter: "web-dom", value: "main p" }
        }
      },
      { selector: "aside > p", text: "충전하기" }
    ];

    expect(analyzeCopy(inventory(nodes), copyStyle).map((finding) => finding.selector)).toEqual(["button"]);

    const unscoped = analyzeCopy(inventory(nodes), {
      ...MINIMAL_STYLE,
      glossary: [{ term: "충전하기", tier: "banned" }]
    });
    expect(unscoped.map((finding) => finding.selector)).toEqual(["button", "main > p", "aside > p"]);
  });

  it("normalizes NFC and Unicode whitespace while keeping literal matching case-sensitive", () => {
    const normalizedMatch = analyzeCopy(oneNode("Cafe\u0301\u2003\u2003안내"), {
      ...MINIMAL_STYLE,
      glossary: [{ term: "Café 안내", tier: "banned" }]
    });
    const caseMismatch = analyzeCopy(oneNode("fast and clear"), {
      ...MINIMAL_STYLE,
      bannedPhrases: [{ phrase: "Fast and clear" }]
    });

    expect(normalizedMatch).toHaveLength(1);
    expect(normalizedMatch[0].observed).toMatchObject({
      text: "Cafe\u0301\u2003\u2003안내",
      matches: ["Café 안내"]
    });
    expect(caseMismatch).toEqual([]);
  });

  it("uses normalized substring matching without an implicit Korean token boundary", () => {
    const findings = analyzeCopy(oneNode("충전하기를 눌러 주세요."), {
      ...MINIMAL_STYLE,
      glossary: [{ term: "충전하기", tier: "banned" }]
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].observed).toMatchObject({
      matches: ["충전하기"],
      occurrenceCount: 1
    });
  });

  it("aggregates repeated literals and lets the first applicable duplicate rule win", () => {
    const findings = analyzeCopy(oneNode("금지어 금지어"), {
      ...MINIMAL_STYLE,
      glossary: [
        {
          term: "금지어",
          tier: "banned",
          preferredTerm: "첫 번째 표현"
        },
        {
          term: "금지어",
          tier: "banned",
          preferredTerm: "두 번째 표현"
        }
      ]
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].observed).toMatchObject({ occurrenceCount: 2 });
    expect(findings[0].recommendation).toContain("첫 번째 표현");
    expect(findings[0].recommendation).not.toContain("두 번째 표현");
  });

  it("allows a later duplicate when the earlier surface-scoped rule is inapplicable", () => {
    const findings = analyzeCopy(oneNode("금지어"), {
      ...MINIMAL_STYLE,
      glossary: [
        {
          term: "금지어",
          tier: "banned",
          preferredTerm: "버튼 표현",
          surfaces: ["button"]
        },
        {
          term: "금지어",
          tier: "banned",
          preferredTerm: "전역 표현"
        }
      ]
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].recommendation).toContain("전역 표현");
  });

  it("does not literal-match a duplicate when the first applicable entry requests lemma matching", () => {
    const copyStyle: CopyStyle = {
      ...MINIMAL_STYLE,
      glossary: [
        { term: "결제", tier: "banned", match: "lemma" },
        { term: "결제", tier: "banned", match: "literal" }
      ]
    };

    expect(analyzeCopy(oneNode("결제를 확인하세요."), copyStyle)).toEqual([]);
    expect(copyAuditCapabilityNotices(copyStyle)).toHaveLength(1);
  });

  it("deduplicates repeated banned-phrase configuration by normalized pattern", () => {
    const findings = analyzeCopy(oneNode("다시 시도 다시 시도"), {
      ...MINIMAL_STYLE,
      bannedPhrases: [
        { phrase: "다시 시도", suggestedReplacement: "처음 제안" },
        { phrase: "다시 시도", suggestedReplacement: "나중 제안" }
      ]
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].observed).toMatchObject({ occurrenceCount: 2 });
    expect(findings[0].recommendation).toContain("처음 제안");
  });
});

describe("copy finding contract", () => {
  it("locks metadata, evidence, and scoring for all five checks", () => {
    const findings = analyzeCopy(oneNode("TODO 파일을(를) 금지어 주의어 빠르고 쉽습니다"), {
      ...MINIMAL_STYLE,
      glossary: [
        { term: "금지어", tier: "banned" },
        { term: "주의어", tier: "use-carefully" }
      ],
      bannedPhrases: [{ phrase: "빠르고 쉽습니다" }]
    });

    expect(findings.map((finding) => ({
      checkName: finding.checkName,
      criterionId: finding.criterionId,
      severity: finding.severity,
      confidence: finding.confidence,
      determinism: finding.determinism,
      resultKind: finding.resultKind,
      runtime: finding.runtime,
      category: finding.category,
      evidenceRefs: finding.evidenceRefs,
      viewport: finding.viewport
    }))).toEqual([
      {
        checkName: "placeholder-leak",
        criterionId: "content.placeholder.unrendered",
        severity: "high",
        confidence: "high",
        determinism: "deterministic",
        resultKind: "failure",
        runtime: "static-dom",
        category: "content",
        evidenceRefs: ["text-inventory-desktop"],
        viewport: "desktop"
      },
      {
        checkName: "josa-hedge",
        criterionId: "content.josa-hedge.policy",
        severity: "low",
        confidence: "high",
        determinism: "deterministic",
        resultKind: "risk",
        runtime: "static-dom",
        category: "content",
        evidenceRefs: ["text-inventory-desktop"],
        viewport: "desktop"
      },
      {
        checkName: "glossary-banned-term",
        criterionId: "content.glossary.banned-term",
        severity: "medium",
        confidence: "high",
        determinism: "deterministic",
        resultKind: "risk",
        runtime: "static-dom",
        category: "content",
        evidenceRefs: ["text-inventory-desktop"],
        viewport: "desktop"
      },
      {
        checkName: "glossary-use-carefully-term",
        criterionId: "content.glossary.use-carefully-term",
        severity: "low",
        confidence: "high",
        determinism: "deterministic",
        resultKind: "risk",
        runtime: "static-dom",
        category: "content",
        evidenceRefs: ["text-inventory-desktop"],
        viewport: "desktop"
      },
      {
        checkName: "banned-phrase",
        criterionId: "content.banned-phrase.policy",
        severity: "medium",
        confidence: "high",
        determinism: "deterministic",
        resultKind: "risk",
        runtime: "static-dom",
        category: "content",
        evidenceRefs: ["text-inventory-desktop"],
        viewport: "desktop"
      }
    ]);

    const score = scoreFindings(findings);
    expect(score.deductions.map((deduction) => deduction.points)).toEqual([20, 2.4, 6, 2.4, 6]);
    expect(score).toMatchObject({ value: 63.2, band: "needs-work" });
  });

  it("produces stable unique IDs and preserves selector, region, and original text", () => {
    const sourceRegion = { x: 1, y: 2, width: 30, height: 12 };
    const input = oneNode("TODO", {
      selector: "#status",
      region: sourceRegion,
      truncated: true
    });

    const first = analyzeCopy(input, MINIMAL_STYLE);
    const second = analyzeCopy(input, MINIMAL_STYLE);

    expect(second.map((finding) => finding.id)).toEqual(first.map((finding) => finding.id));
    expect(new Set(first.map((finding) => finding.id)).size).toBe(first.length);
    expect(first[0]).toMatchObject({
      selector: "#status",
      region: sourceRegion,
      observed: {
        text: "TODO",
        truncated: true
      }
    });
    expect(first[0].region).not.toBe(sourceRegion);
  });

  it("does not mutate frozen inventory or copy-style inputs", () => {
    const input = deepFreeze(oneNode("TODO 금지어"));
    const copyStyle = deepFreeze<CopyStyle>({
      ...MINIMAL_STYLE,
      glossary: [{ term: "금지어", tier: "banned" }]
    });
    const inputBefore = JSON.stringify(input);
    const styleBefore = JSON.stringify(copyStyle);

    expect(() => analyzeCopy(input, copyStyle)).not.toThrow();
    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(JSON.stringify(copyStyle)).toBe(styleBefore);
  });
});

describe("copyAuditCapabilityNotices", () => {
  it("emits one stable notice per normalized lemma term and no finding fallback", () => {
    const copyStyle: CopyStyle = {
      ...MINIMAL_STYLE,
      glossary: [
        { term: "Cafe\u0301", tier: "banned", match: "lemma" },
        { term: "Café", tier: "use-carefully", match: "lemma" },
        { term: "잔고", tier: "approved", match: "lemma" },
        { term: "리터럴", tier: "banned", match: "literal" }
      ]
    };

    expect(copyAuditCapabilityNotices(copyStyle)).toEqual([
      {
        code: "copy-analysis-capability-unavailable",
        message: "Glossary term \"Café\" requests lemma matching, which is unavailable in the parser-free copy analyzer.",
        details: {
          capability: "glossary-lemma-matching",
          term: "Cafe\u0301",
          glossaryIndex: 0
        }
      },
      {
        code: "copy-analysis-capability-unavailable",
        message: "Glossary term \"잔고\" requests lemma matching, which is unavailable in the parser-free copy analyzer.",
        details: {
          capability: "glossary-lemma-matching",
          term: "잔고",
          glossaryIndex: 2
        }
      }
    ]);
    expect(analyzeCopy(oneNode("Café 잔고"), copyStyle)).toEqual([]);
  });

  it("does not mutate a frozen configuration", () => {
    const copyStyle = deepFreeze<CopyStyle>({
      ...MINIMAL_STYLE,
      glossary: [{ term: "잔고", tier: "use-carefully", match: "lemma" }]
    });
    const before = JSON.stringify(copyStyle);

    expect(copyAuditCapabilityNotices(copyStyle)).toHaveLength(1);
    expect(JSON.stringify(copyStyle)).toBe(before);
  });
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
