import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/diagnostic";
import { analyzeCrossFileInput } from "../../src/cross-file";
import { parseCode } from "../solid/test-utils";

interface CssFixture {
  readonly path: string;
  readonly content: string;
}

function runRule(tsx: string, files: readonly CssFixture[]): readonly Diagnostic[] {
  const solid = parseCode(tsx, "/project/App.tsx");
  const diagnostics: Diagnostic[] = [];

  analyzeCrossFileInput(
    {
      solid,
      css: { files },
    },
    (diagnostic) => diagnostics.push(diagnostic),
  );

  return diagnostics.filter((diagnostic) => diagnostic.rule === "css-layout-sibling-alignment-outlier");
}

function canonicalize(diagnostics: readonly Diagnostic[]): readonly string[] {
  const out: string[] = [];
  for (const d of diagnostics) {
    out.push(`${d.file}:${d.loc.start.line}:${d.loc.start.column}:${d.message}`);
  }
  out.sort();
  return out;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle<T>(values: readonly T[], rng: () => number): readonly T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) throw new Error(`Expected elements at indices ${i} and ${j}`);
    out[i] = b;
    out[j] = a;
  }
  return out;
}

function buildCssRule(selector: string, declarations: readonly string[]): string {
  return `${selector} { ${declarations.join("; ")}; }`;
}

describe("layout alignment determinism", () => {
  it("keeps diagnostics stable across css parse/order permutations", () => {
    const tsx = `
      import "./base.css";
      import "./components.css";

      export function Row() {
        return (
          <div class="row">
            <span class="icon">.</span>
            <span class="label">Label</span>
          </div>
        );
      }
    `;

    const first = runRule(tsx, [
      {
        path: "/project/base.css",
        content: `
          .row { display: flex; align-items: flex-start; }
          .label { line-height: 20px; }
        `,
      },
      {
        path: "/project/components.css",
        content: `
          .icon { transform: translateY(-2px); line-height: 12px; }
        `,
      },
    ]);

    const second = runRule(tsx, [
      {
        path: "/project/components.css",
        content: `
          .icon { line-height: 12px; transform: translateY(-2px); }
        `,
      },
      {
        path: "/project/base.css",
        content: `
          .label { line-height: 20px; }
          .row { align-items: flex-start; display: flex; }
        `,
      },
    ]);

    expect(first.length).toBeGreaterThan(0);
    expect(canonicalize(second)).toStrictEqual(canonicalize(first));
  });

  it("keeps byte-identical diagnostics across expanded css permutations", () => {
    const tsx = `
      import "./base.css";
      import "./components.css";

      export function Row() {
        return (
          <div class="row">
            <span class="icon">.</span>
            <span class="label">Label</span>
          </div>
        );
      }
    `;

    const permutations: readonly (readonly CssFixture[])[] = [
      [
        {
          path: "/project/base.css",
          content: `
            .row { display: flex; align-items: flex-start; }
            .label { line-height: 20px; }
          `,
        },
        {
          path: "/project/components.css",
          content: `
            .icon { transform: translateY(-2px); line-height: 12px; }
          `,
        },
      ],
      [
        {
          path: "/project/components.css",
          content: `
            .icon { line-height: 12px; transform: translateY(-2px); }
          `,
        },
        {
          path: "/project/base.css",
          content: `
            .label { line-height: 20px; }
            .row { align-items: flex-start; display: flex; }
          `,
        },
      ],
      [
        {
          path: "/project/base.css",
          content: `
            .row { align-items: flex-start; }
            .row { display: flex; }
            .label { line-height: 20px; }
          `,
        },
        {
          path: "/project/components.css",
          content: `
            .icon { line-height: 12px; }
            .icon { transform: translateY(-2px); }
          `,
        },
      ],
      [
        {
          path: "/project/components.css",
          content: `
            .icon { transform: translateY(-2px); }
            .icon { line-height: 12px; }
          `,
        },
        {
          path: "/project/base.css",
          content: `
            .label { line-height: 20px; }
            .row { display: flex; }
            .row { align-items: flex-start; }
          `,
        },
      ],
    ];

    const perm0 = permutations[0];
    if (!perm0) throw new Error("Expected permutation at index 0");
    const baseline = canonicalize(runRule(tsx, perm0));
    expect(baseline.length).toBeGreaterThan(0);

    for (let i = 1; i < permutations.length; i++) {
      const perm = permutations[i];
      if (!perm) throw new Error(`Expected permutation at index ${i}`);
      const next = canonicalize(runRule(tsx, perm));
      expect(next).toStrictEqual(baseline);
    }
  });

  it("keeps byte-identical diagnostics across 100 randomized css permutations", () => {
    const tsx = `
      import "./base.css";
      import "./components.css";

      export function Row() {
        return (
          <div class="row">
            <span class="icon">.</span>
            <span class="label">Label</span>
          </div>
        );
      }
    `;

    let baseline: readonly string[] | null = null;

    for (let i = 0; i < 100; i++) {
      const rng = createRng(i + 1);
      const rowRule = buildCssRule(".row", shuffle(["display: flex", "align-items: flex-start"], rng));
      const labelRule = buildCssRule(".label", shuffle(["line-height: 20px", "white-space: normal"], rng));
      const iconRule = buildCssRule(".icon", shuffle(["transform: translateY(-2px)", "line-height: 12px"], rng));

      const files = shuffle<CssFixture>([
        {
          path: "/project/base.css",
          content: `${rowRule}\n${labelRule}`,
        },
        {
          path: "/project/components.css",
          content: `${iconRule}`,
        },
      ], rng);

      const next = canonicalize(runRule(tsx, files));
      if (baseline === null) {
        baseline = next;
        expect(baseline.length).toBeGreaterThan(0);
        continue;
      }

      expect(next).toStrictEqual(baseline);
    }
  });

  it("keeps conditional multimodal diagnostics stable across permutations", () => {
    const tsx = `
      import "./base.css";
      import "./clusters.css";

      export function Row() {
        return (
          <div class="row">
            <span class="a">A</span>
            <span class="b">B</span>
            <span class="c">C</span>
            <span class="d">D</span>
          </div>
        );
      }
    `;

    const baselineRules = [
      ".row { display: flex; align-items: flex-start; }",
      "@media (min-width: 900px) { .row { writing-mode: vertical-rl; } }",
    ] as const;
    const clusterRules = [
      ".a, .b { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }",
      ".c, .d { line-height: 20px; vertical-align: middle; }",
      "@media (min-width: 900px) { .a { transform: translateY(-3px); } }",
    ] as const;

    let baseline: readonly string[] | null = null;

    for (let i = 0; i < 40; i++) {
      const rng = createRng(1000 + i);
      const baseContent = shuffle(baselineRules, rng).join("\n");
      const clusterContent = shuffle(clusterRules, rng).join("\n");
      const files = shuffle<CssFixture>([
        { path: "/project/base.css", content: baseContent },
        { path: "/project/clusters.css", content: clusterContent },
      ], rng);

      const next = canonicalize(runRule(tsx, files));
      if (baseline === null) {
        baseline = next;
        continue;
      }

      expect(next).toStrictEqual(baseline);
    }
  });
});
