import { describe, expect, it } from "vitest";
import {
  compileDesignGuide,
  createExampleDesignGuide,
  DesignGuideProfileError,
  GUIDE_TOKEN_HARD_CEILING,
  GuideCompileError,
  PRIMARY_TASK_SUPPORTING_MAX,
  SIGNATURE_SCOPES,
  type DesignGuide,
  type SignatureCommitment
} from "./index.js";

/**
 * ADR-003: typed signature commitments and a declared primary task.
 *
 * The measured motivation is in the ROADMAP backlog: the compiled pack changed
 * token adherence (-0.4145) but not composition divergence (-0.0006), because
 * the schema's entire positive vocabulary was one free-text string.
 */
describe("guide positive vocabulary (ADR-003)", () => {
  const commitment = (over: Partial<SignatureCommitment> = {}): SignatureCommitment => ({
    id: "status-rail",
    scope: "layout",
    commitment: "Anchor every screen on a compact outlined status rail.",
    instead: "A row of equally weighted summary cards.",
    ...over
  });

  const widen = (over: Partial<DesignGuide> = {}): DesignGuide => ({
    ...createExampleDesignGuide(),
    ...over
  });

  it("leaves an unwidened guide byte-identical in rules and token estimate", () => {
    const base = compileDesignGuide(createExampleDesignGuide());
    expect(base.rules).toHaveLength(5);
    expect(base.rules.map((rule) => rule.id)).toEqual([
      "tokens.design-system",
      "signature-element",
      "decorative-gradient-without-purpose",
      "generic-card-grid",
      "uniform-visual-emphasis"
    ]);
    // Absence performs no work: no primary-task or commitment rule appears.
    expect(base.rules.some((rule) => rule.id === "primary-task")).toBe(false);
    expect(base.rules.some((rule) => rule.id.startsWith("signature-commitment-"))).toBe(false);
  });

  it("emits the primary task first, because emphasis is relative to it", () => {
    const result = compileDesignGuide(
      widen({ primaryTask: { statement: "Clear the overnight settlement exception queue." } })
    );
    expect(result.rules[0]?.id).toBe("primary-task");
    expect(result.rules[0]?.effect).toBe("require");
    expect(result.rules[0]?.goodExample).toBe("Clear the overnight settlement exception queue.");
    expect(result.markdown).toContain("Make this the most obvious thing on the surface");
  });

  it("renders supporting tasks as explicitly subordinate", () => {
    const result = compileDesignGuide(
      widen({
        primaryTask: {
          statement: "Clear the exception queue.",
          supportingTasks: ["Check payout totals.", "Open a dispute."]
        }
      })
    );
    expect(result.rules[0]?.description).toContain("keep these subordinate");
    expect(result.rules[0]?.description).toContain("Check payout totals.");
  });

  it("emits commitments after the free-text signature so the broad rule comes first", () => {
    const result = compileDesignGuide(widen({ signatureCommitments: [commitment()] }));
    const ids = result.rules.map((rule) => rule.id);
    expect(ids.indexOf("signature-element")).toBeLessThan(ids.indexOf("signature-commitment-status-rail"));
    const rule = result.rules.find((entry) => entry.id === "signature-commitment-status-rail");
    expect(rule?.effect).toBe("require");
    expect(rule?.goodExample).toBe(commitment().commitment);
    expect(rule?.badExample).toBe(commitment().instead);
    expect(rule?.name).toBe("Signature commitment (layout)");
  });

  it("orders commitments by scope then id, independent of authoring order", () => {
    const forward = compileDesignGuide(
      widen({
        signatureCommitments: [
          commitment({ id: "zebra", scope: "state" }),
          commitment({ id: "alpha", scope: "state" }),
          commitment({ id: "middle", scope: "layout" })
        ]
      })
    );
    const reversed = compileDesignGuide(
      widen({
        signatureCommitments: [
          commitment({ id: "middle", scope: "layout" }),
          commitment({ id: "alpha", scope: "state" }),
          commitment({ id: "zebra", scope: "state" })
        ]
      })
    );
    const idsOf = (result: ReturnType<typeof compileDesignGuide>) =>
      result.rules.filter((rule) => rule.id.startsWith("signature-commitment-")).map((rule) => rule.id);
    expect(idsOf(forward)).toEqual([
      "signature-commitment-middle",
      "signature-commitment-alpha",
      "signature-commitment-zebra"
    ]);
    expect(idsOf(reversed)).toEqual(idsOf(forward));
    expect(reversed.sourceHash).toBe(forward.sourceHash);
  });

  it("covers every declared scope when the pack has room for them", () => {
    // The example guide already spends 1306 of the 2000-token ceiling, so a
    // five-scope sweep is tested on a guide with fewer prohibitions.
    const lean = widen({ prohibitions: ["generic-card-grid"] });
    const result = compileDesignGuide({
      ...lean,
      signatureCommitments: SIGNATURE_SCOPES.map((scope) => commitment({ id: scope, scope }))
    });
    for (const scope of SIGNATURE_SCOPES) {
      expect(result.rules.some((rule) => rule.subject.includes(`signature-commitment:${scope}:`))).toBe(true);
    }
    expect(result.tokenEstimate.estimated).toBeLessThanOrEqual(GUIDE_TOKEN_HARD_CEILING);
  });

  it("moves the source hash when either field is added, and keeps them distinguishable", () => {
    const base = compileDesignGuide(createExampleDesignGuide()).sourceHash;
    const withTask = compileDesignGuide(widen({ primaryTask: { statement: "One job." } })).sourceHash;
    const withCommitment = compileDesignGuide(widen({ signatureCommitments: [commitment()] })).sourceHash;
    expect(withTask).not.toBe(base);
    expect(withCommitment).not.toBe(base);
    expect(withTask).not.toBe(withCommitment);
  });

  it("rejects duplicate commitment ids at profile validation, before compilation", () => {
    expect(() =>
      compileDesignGuide(widen({ signatureCommitments: [commitment(), commitment()] }))
    ).toThrow(DesignGuideProfileError);
  });

  it("rejects a commitment whose instead repeats its commitment", () => {
    expect(() =>
      compileDesignGuide(
        widen({ signatureCommitments: [commitment({ instead: commitment().commitment })] })
      )
    ).toThrow(DesignGuideProfileError);
  });

  it("rejects an unknown scope", () => {
    expect(() =>
      compileDesignGuide(
        widen({
          signatureCommitments: [commitment({ scope: "vibes" as unknown as SignatureCommitment["scope"] })]
        })
      )
    ).toThrow(DesignGuideProfileError);
  });

  it("rejects more supporting tasks than the declared cap", () => {
    const tooMany = Array.from({ length: PRIMARY_TASK_SUPPORTING_MAX + 1 }, (_unused, index) => `Task ${index}.`);
    expect(() =>
      compileDesignGuide(widen({ primaryTask: { statement: "One job.", supportingTasks: tooMany } }))
    ).toThrow(DesignGuideProfileError);
  });

  it("rejects a supporting task that repeats the primary statement", () => {
    expect(() =>
      compileDesignGuide(
        widen({ primaryTask: { statement: "One job.", supportingTasks: ["One job."] } })
      )
    ).toThrow(GuideCompileError);
  });

  it("rejects duplicate supporting tasks", () => {
    expect(() =>
      compileDesignGuide(
        widen({ primaryTask: { statement: "One job.", supportingTasks: ["A.", "A."] } })
      )
    ).toThrow(GuideCompileError);
  });

  /**
   * ADR-003 decision 6 keeps the ceiling at 2000. The measured consequence is
   * that the ceiling, not the schema, is now the binding limit on positive
   * vocabulary: on top of the example guide's five rules, three commitments fit
   * without a primary task and two fit with one. A project that wants more must
   * cut prohibitions or shorten prose, never get a bigger pack.
   */
  it("admits three commitments and rejects the fourth on the example guide", () => {
    const three = compileDesignGuide(
      widen({
        signatureCommitments: SIGNATURE_SCOPES.slice(0, 3).map((scope) => commitment({ id: scope, scope }))
      })
    );
    expect(three.tokenEstimate.estimated).toBeLessThanOrEqual(GUIDE_TOKEN_HARD_CEILING);
    expect(three.rules).toHaveLength(8);

    expect(() =>
      compileDesignGuide(
        widen({
          signatureCommitments: SIGNATURE_SCOPES.slice(0, 4).map((scope) => commitment({ id: scope, scope }))
        })
      )
    ).toThrow(GuideCompileError);
  });

  it("admits two commitments alongside a primary task, and rejects the third", () => {
    const task = { statement: "Clear the overnight settlement exception queue.", supportingTasks: ["Check payout totals."] };
    const two = compileDesignGuide(
      widen({
        primaryTask: task,
        signatureCommitments: SIGNATURE_SCOPES.slice(0, 2).map((scope) => commitment({ id: scope, scope }))
      })
    );
    expect(two.tokenEstimate.estimated).toBeLessThanOrEqual(GUIDE_TOKEN_HARD_CEILING);
    expect(GUIDE_TOKEN_HARD_CEILING).toBe(2000);

    expect(() =>
      compileDesignGuide(
        widen({
          primaryTask: task,
          signatureCommitments: SIGNATURE_SCOPES.slice(0, 3).map((scope) => commitment({ id: scope, scope }))
        })
      )
    ).toThrow(GuideCompileError);
  });
});
