import { describe, expect, it } from "vitest";
import { normalizeSignalMap, LayoutSignalSource, LayoutSignalGuard, SignalValueKind, SignalQuality } from "../../src/cross-file/layout";
import type { LayoutCascadedDeclaration } from "../../src/cross-file/layout/graph";

function makeMap(entries: readonly [string, string][]) {
  const out = new Map<string, LayoutCascadedDeclaration>();
  for (const entry of entries) {
    out.set(entry[0], {
      value: entry[1],
      source: LayoutSignalSource.Selector,
      guardProvenance: {
        kind: LayoutSignalGuard.Unconditional,
        conditions: [],
        key: "always" as const,
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

    expect(translateY?.kind).toBe(SignalValueKind.Known);
    expect(translate?.kind).toBe(SignalValueKind.Known);
    expect(translate3d?.kind).toBe(SignalValueKind.Known);

    if (!translateY || translateY.kind !== SignalValueKind.Known) throw new Error("expected translateY known signal");
    if (!translate || translate.kind !== SignalValueKind.Known) throw new Error("expected translate known signal");
    if (!translate3d || translate3d.kind !== SignalValueKind.Known) throw new Error("expected translate3d known signal");

    expect(translateY.px).toBe(-2);
    expect(translate.px).toBe(-3);
    expect(translate3d.px).toBe(4);
  });

  it("parses translate property vertical component", () => {
    const signals = normalizeSignalMap(makeMap([["translate", "2px -5px"]]));
    const translate = signals.get("translate");

    expect(translate?.kind).toBe(SignalValueKind.Known);
    if (!translate || translate.kind !== SignalValueKind.Known) throw new Error("expected translate known signal");
    expect(translate.px).toBe(-5);
  });

  it("keeps non-px transform values as unknown", () => {
    const signals = normalizeSignalMap(makeMap([["transform", "translateY(-10%)"]]));
    const transform = signals.get("transform");

    expect(transform?.kind).toBe(SignalValueKind.Unknown);
  });

  it("treats runtime-dependent transform and keyword values as unknown", () => {
    const transformSignals = normalizeSignalMap(makeMap([["transform", "translateY(var(--y))"]]));
    const keywordSignals = normalizeSignalMap(makeMap([["align-self", "var(--align-self)"]]));

    const transform = transformSignals.get("transform");
    const alignSelf = keywordSignals.get("align-self");

    expect(transform?.kind).toBe(SignalValueKind.Unknown);
    expect(alignSelf?.kind).toBe(SignalValueKind.Unknown);
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

    expect(top?.kind).toBe(SignalValueKind.Known);
    expect(marginTop?.kind).toBe(SignalValueKind.Known);
    expect(insetBlockStart?.kind).toBe(SignalValueKind.Known);
    expect(insetBlockEnd?.kind).toBe(SignalValueKind.Known);

    if (!top || top.kind !== SignalValueKind.Known) throw new Error("expected top known signal");
    if (!marginTop || marginTop.kind !== SignalValueKind.Known) throw new Error("expected margin-top known signal");
    if (!insetBlockStart || insetBlockStart.kind !== SignalValueKind.Known) throw new Error("expected inset-block-start known signal");
    if (!insetBlockEnd || insetBlockEnd.kind !== SignalValueKind.Known) throw new Error("expected inset-block-end known signal");

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
    expect(lineHeight?.kind).toBe(SignalValueKind.Known);
    if (!lineHeight || lineHeight.kind !== SignalValueKind.Known) throw new Error("expected line-height known signal");
    expect(lineHeight.px).toBe(24);
    expect(lineHeight.quality).toBe(SignalQuality.Estimated);
  });

  it("expands block-axis shorthands into monitored longhands", () => {
    const signals = normalizeSignalMap(
      makeMap([
        ["margin-top", "2px"],
        ["margin-bottom", "4px"],
        ["padding-top", "1px"],
        ["padding-bottom", "1px"],
        ["inset-block-start", "3px"],
        ["inset-block-end", "5px"],
      ]),
    );

    const marginTop = signals.get("margin-top");
    const marginBottom = signals.get("margin-bottom");
    const paddingTop = signals.get("padding-top");
    const paddingBottom = signals.get("padding-bottom");
    const insetStart = signals.get("inset-block-start");
    const insetEnd = signals.get("inset-block-end");

    expect(marginTop?.kind).toBe(SignalValueKind.Known);
    expect(marginBottom?.kind).toBe(SignalValueKind.Known);
    expect(paddingTop?.kind).toBe(SignalValueKind.Known);
    expect(paddingBottom?.kind).toBe(SignalValueKind.Known);
    expect(insetStart?.kind).toBe(SignalValueKind.Known);
    expect(insetEnd?.kind).toBe(SignalValueKind.Known);

    if (!marginTop || marginTop.kind !== SignalValueKind.Known) throw new Error("expected margin-top known signal");
    if (!marginBottom || marginBottom.kind !== SignalValueKind.Known) throw new Error("expected margin-bottom known signal");
    if (!paddingTop || paddingTop.kind !== SignalValueKind.Known) throw new Error("expected padding-top known signal");
    if (!paddingBottom || paddingBottom.kind !== SignalValueKind.Known) throw new Error("expected padding-bottom known signal");
    if (!insetStart || insetStart.kind !== SignalValueKind.Known) throw new Error("expected inset-block-start known signal");
    if (!insetEnd || insetEnd.kind !== SignalValueKind.Known) throw new Error("expected inset-block-end known signal");

    expect(marginTop.px).toBe(2);
    expect(marginBottom.px).toBe(4);
    expect(paddingTop.px).toBe(1);
    expect(paddingBottom.px).toBe(1);
    expect(insetStart.px).toBe(3);
    expect(insetEnd.px).toBe(5);
  });
});
