import { describe, expect, it } from "vitest";
import { normalizeSignalMap, LayoutSignalSource, LayoutSignalGuard } from "../../src/cross-file/layout";
import type { LayoutCascadedDeclaration } from "../../src/cross-file/layout/graph";

function makeMap(entries: readonly [string, string][]) {
  const out = new Map<string, LayoutCascadedDeclaration>();
  for (const entry of entries) {
    out.set(entry[0], {
      value: entry[1],
      source: LayoutSignalSource.Selector,
      guard: LayoutSignalGuard.Unconditional,
      guardProvenance: {
        kind: LayoutSignalGuard.Unconditional,
        conditions: [],
        key: "always",
      },
    });
  }
  return out;
}

describe("layout signal normalization", () => {
  it("parses transform translate variants to vertical px offsets", () => {
    const translateYSignals = normalizeSignalMap(makeMap([["transform", "translateY(-2px)"]]));
    const translateSignals = normalizeSignalMap(makeMap([["transform", "translate(1px, -3px)"]]));
    const translate3dSignals = normalizeSignalMap(makeMap([["transform", "translate3d(1px, 4px, 0px)"]]));

    const translateY = translateYSignals.get("transform");
    const translate = translateSignals.get("transform");
    const translate3d = translate3dSignals.get("transform");

    expect(translateY?.kind).toBe("known");
    expect(translate?.kind).toBe("known");
    expect(translate3d?.kind).toBe("known");

    if (!translateY || translateY.kind !== "known") throw new Error("expected translateY known signal");
    if (!translate || translate.kind !== "known") throw new Error("expected translate known signal");
    if (!translate3d || translate3d.kind !== "known") throw new Error("expected translate3d known signal");

    expect(translateY.px).toBe(-2);
    expect(translate.px).toBe(-3);
    expect(translate3d.px).toBe(4);
  });

  it("parses translate property vertical component", () => {
    const signals = normalizeSignalMap(makeMap([["translate", "2px -5px"]]));
    const translate = signals.get("translate");

    expect(translate?.kind).toBe("known");
    if (!translate || translate.kind !== "known") throw new Error("expected translate known signal");
    expect(translate.px).toBe(-5);
  });

  it("keeps non-px transform values as unknown", () => {
    const signals = normalizeSignalMap(makeMap([["transform", "translateY(-10%)"]]));
    const transform = signals.get("transform");

    expect(transform?.kind).toBe("unknown");
  });

  it("treats runtime-dependent transform and keyword values as unknown", () => {
    const transformSignals = normalizeSignalMap(makeMap([["transform", "translateY(var(--y))"]]));
    const keywordSignals = normalizeSignalMap(makeMap([["align-self", "var(--align-self)"]]));

    const transform = transformSignals.get("transform");
    const alignSelf = keywordSignals.get("align-self");

    expect(transform?.kind).toBe("unknown");
    expect(alignSelf?.kind).toBe("unknown");
  });

  it("parses top/margin/inset block offsets", () => {
    const signals = normalizeSignalMap(
      makeMap([
        ["top", "2px"],
        ["margin-top", "-1px"],
        ["inset-block-start", "3px"],
        ["inset-block-end", "1px"],
      ]),
    );

    const top = signals.get("top");
    const marginTop = signals.get("margin-top");
    const insetBlockStart = signals.get("inset-block-start");
    const insetBlockEnd = signals.get("inset-block-end");

    expect(top?.kind).toBe("known");
    expect(marginTop?.kind).toBe("known");
    expect(insetBlockStart?.kind).toBe("known");
    expect(insetBlockEnd?.kind).toBe("known");

    if (!top || top.kind !== "known") throw new Error("expected top known signal");
    if (!marginTop || marginTop.kind !== "known") throw new Error("expected margin-top known signal");
    if (!insetBlockStart || insetBlockStart.kind !== "known") throw new Error("expected inset-block-start known signal");
    if (!insetBlockEnd || insetBlockEnd.kind !== "known") throw new Error("expected inset-block-end known signal");

    expect(top.px).toBe(2);
    expect(marginTop.px).toBe(-1);
    expect(insetBlockStart.px).toBe(3);
    expect(insetBlockEnd.px).toBe(1);
  });

  it("derives line-height px from unitless values and font-size", () => {
    const signals = normalizeSignalMap(
      makeMap([
        ["font-size", "20px"],
        ["line-height", "1.2"],
      ]),
    );

    const lineHeight = signals.get("line-height");
    expect(lineHeight?.kind).toBe("known");
    if (!lineHeight || lineHeight.kind !== "known") throw new Error("expected line-height known signal");
    expect(lineHeight.px).toBe(24);
    expect(lineHeight.quality).toBe("estimated");
  });

  it("expands block-axis shorthands into monitored longhands", () => {
    const signals = normalizeSignalMap(
      makeMap([
        ["margin-block", "2px 4px"],
        ["padding-block", "1px"],
        ["inset-block", "3px 5px"],
      ]),
    );

    const marginTop = signals.get("margin-top");
    const marginBottom = signals.get("margin-bottom");
    const paddingTop = signals.get("padding-top");
    const paddingBottom = signals.get("padding-bottom");
    const insetStart = signals.get("inset-block-start");
    const insetEnd = signals.get("inset-block-end");

    expect(marginTop?.kind).toBe("known");
    expect(marginBottom?.kind).toBe("known");
    expect(paddingTop?.kind).toBe("known");
    expect(paddingBottom?.kind).toBe("known");
    expect(insetStart?.kind).toBe("known");
    expect(insetEnd?.kind).toBe("known");

    if (!marginTop || marginTop.kind !== "known") throw new Error("expected margin-top known signal");
    if (!marginBottom || marginBottom.kind !== "known") throw new Error("expected margin-bottom known signal");
    if (!paddingTop || paddingTop.kind !== "known") throw new Error("expected padding-top known signal");
    if (!paddingBottom || paddingBottom.kind !== "known") throw new Error("expected padding-bottom known signal");
    if (!insetStart || insetStart.kind !== "known") throw new Error("expected inset-block-start known signal");
    if (!insetEnd || insetEnd.kind !== "known") throw new Error("expected inset-block-end known signal");

    expect(marginTop.px).toBe(2);
    expect(marginBottom.px).toBe(4);
    expect(paddingTop.px).toBe(1);
    expect(paddingBottom.px).toBe(1);
    expect(insetStart.px).toBe(3);
    expect(insetEnd.px).toBe(5);
  });
});
