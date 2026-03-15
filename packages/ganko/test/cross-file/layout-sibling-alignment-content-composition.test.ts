import { noopLogger } from "@drskillissue/ganko-shared";
import { describe, expect, it } from "vitest";
import { buildSolidGraph } from "../../src/solid/plugin";
import { buildCSSGraph } from "../../src/css/plugin";
import {
  buildLayoutGraph,
  collectAlignmentCases,
  evaluateAlignmentCase,
} from "../../src/cross-file";
import { parseCode } from "../solid/test-utils";

type AlignmentDecision = ReturnType<typeof evaluateAlignmentCase>;

function collectDecisionsFromFixture(tsx: string, css: string): readonly AlignmentDecision[] {
  const solidInput = parseCode(tsx, "/project/App.tsx");
  const solidGraph = buildSolidGraph(solidInput);
  const cssGraph = buildCSSGraph({
    files: [{ path: "/project/layout.css", content: css }],
  });

  const context = {
    solids: [solidGraph],
    css: cssGraph,
    layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
  };

  const cases = collectAlignmentCases(context);
  const out: AlignmentDecision[] = [];

  for (const c of cases) {
    out.push(evaluateAlignmentCase(c));
  }

  return out;
}

function hasAcceptedDecision(decisions: readonly AlignmentDecision[]): boolean {
  for (const decision of decisions) {
    if (decision.kind === "accept") return true;
  }
  return false;
}

function hasCompositionFinding(decisions: readonly AlignmentDecision[]): boolean {
  for (const decision of decisions) {
    if (decision.kind !== "accept") continue;
    const findings = decision.evaluation.signalFindings;
    for (const finding of findings) {
      if (finding.kind === "content-composition-conflict") return true;
    }
  }
  return false;
}

describe("content composition baseline detection", () => {
  // Test 1: Data table with sortable and non-sortable column headers
  // All cells use vertical-align: middle → CSS2 §17.5.3 geometric centering,
  // baselines never consulted. The inline-flex sort-icon inside one cell is
  // irrelevant because cell-to-cell alignment is geometric.
  it("does not flag sortable header with inline-flex icon when all headers use vertical-align: middle", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Table() {
          return (
            <table>
              <tbody>
                <tr>
                  <th class="header">
                    <span>
                      IP Address
                      <span class="sort-icon">.</span>
                    </span>
                  </th>
                  <th class="header">Status</th>
                  <th class="header">Created</th>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        .header { padding: 8px 12px; line-height: 20px; vertical-align: middle; }
        .sort-icon { display: inline-flex; width: 16px; height: 16px; line-height: 12px; }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(false);
  });

  // Test 2: Same header, but sort wrapper uses inline-flex alignment (mitigated)
  it("does not flag when wrapping span uses inline-flex align-items: center", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Table() {
          return (
            <table>
              <tbody>
                <tr>
                  <th class="header">
                    <span class="sort-wrapper">
                      IP Address
                      <span class="sort-icon">.</span>
                    </span>
                  </th>
                  <th class="header">Status</th>
                  <th class="header">Created</th>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        .header { padding: 8px 12px; line-height: 20px; }
        .sort-wrapper { display: inline-flex; align-items: center; gap: 4px; }
        .sort-icon { display: inline-flex; width: 16px; height: 16px; }
      `,
    );

    expect(hasCompositionFinding(decisions)).toBe(false);
  });

  // Test 3: Navigation bar with badge count on one tab
  it("flags nav link with inline-block badge among text-only links", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Nav() {
          return (
            <nav class="nav">
              <a class="nav-link" href="/dashboard">Dashboard</a>
              <a class="nav-link" href="/inbox">
                Inbox
                <span class="badge">3</span>
              </a>
              <a class="nav-link" href="/settings">Settings</a>
            </nav>
          );
        }
      `,
      `
        .nav { display: flex; gap: 16px; align-items: baseline; }
        .nav-link { line-height: 20px; }
        .badge {
          display: inline-block;
          height: 20px;
          min-width: 20px;
          border-radius: 10px;
          background: red;
          font-size: 11px;
          text-align: center;
          line-height: 20px;
          vertical-align: baseline;
        }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(true);
  });

  // Test 4: Toolbar button group — some buttons have icons, some don't
  it("flags button with icon among text-only buttons", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Toolbar() {
          return (
            <div class="toolbar">
              <button class="btn">Save</button>
              <button class="btn">Cancel</button>
              <button class="btn">
                <span class="btn-icon">X</span>
                Delete
              </button>
            </div>
          );
        }
      `,
      `
        .toolbar { display: flex; gap: 8px; align-items: baseline; }
        .btn { padding: 6px 12px; line-height: 20px; }
        .btn-icon {
          display: inline-flex;
          width: 16px;
          height: 16px;
          vertical-align: baseline;
          line-height: 12px;
        }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(true);
  });

  // Test 5: All buttons have icons — consistent composition
  it("does not flag when all siblings have identical composition", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Toolbar() {
          return (
            <div class="toolbar">
              <button class="btn">
                <span class="btn-icon">S</span>
                Save
              </button>
              <button class="btn">
                <span class="btn-icon">C</span>
                Cancel
              </button>
              <button class="btn">
                <span class="btn-icon">D</span>
                Delete
              </button>
            </div>
          );
        }
      `,
      `
        .toolbar { display: flex; gap: 8px; }
        .btn { padding: 6px 12px; line-height: 20px; }
        .btn-icon { display: inline-flex; width: 16px; height: 16px; }
      `,
    );

    expect(hasCompositionFinding(decisions)).toBe(false);
  });

  // Test 6: Card grid — img vs inline-block baseline difference
  it("detects intrinsic replaced vs container replaced divergence", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Cards() {
          return (
            <div class="grid">
              <div class="card">
                <span class="avatar-text">JD</span>
                <span>John Doe</span>
              </div>
              <div class="card">
                <img class="avatar-img" src="/avatar.jpg" />
                <span>Jane Smith</span>
              </div>
              <div class="card">
                <span class="avatar-text">AB</span>
                <span>Alice Brown</span>
              </div>
            </div>
          );
        }
      `,
      `
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-items: baseline; }
        .card { line-height: 20px; }
        .avatar-text {
          display: inline-block;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #eee;
          text-align: center;
          line-height: 40px;
        }
        .avatar-img {
          width: 40px;
          height: 40px;
          border-radius: 50%;
        }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(true);
  });

  // Test 7: Sidebar nav — badge deeply nested through inline spans
  // The parent uses flex-direction: column, so the block axis is the main axis.
  // Vertical offset differences are the flex algorithm's normal behavior, and
  // line-height/composition divergence between column-flex siblings does not
  // cause visual misalignment (each item occupies its own row).
  it("does not flag deeply nested inline elements in flex-direction: column", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Sidebar() {
          return (
            <ul class="sidebar">
              <li class="sidebar-item"><a href="/home">Home</a></li>
              <li class="sidebar-item"><a href="/projects">Projects</a></li>
              <li class="sidebar-item">
                <a href="/features">
                  <span>
                    <span>
                      Features
                      <span class="new-badge">NEW</span>
                    </span>
                  </span>
                </a>
              </li>
              <li class="sidebar-item"><a href="/docs">Docs</a></li>
            </ul>
          );
        }
      `,
      `
        .sidebar { list-style: none; padding: 0; display: flex; flex-direction: column; align-items: baseline; }
        .sidebar-item { line-height: 20px; }
        .new-badge {
          display: inline-flex;
          align-items: center;
          padding: 0 6px;
          height: 18px;
          border-radius: 9px;
          background: #10b981;
          color: white;
          font-size: 11px;
          line-height: 14px;
        }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(false);
  });

  // Test 8: Block-level children isolate baseline
  it("does not flag when inline-replaced is inside a block child", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Orders() {
          return (
            <div class="list">
              <div class="item">
                <p>Order 1234 — Shipped</p>
              </div>
              <div class="item">
                <p>Order 5678 — Processing</p>
                <div class="details">
                  <span class="icon">T</span>
                  Tracking available
                </div>
              </div>
              <div class="item">
                <p>Order 9012 — Delivered</p>
              </div>
            </div>
          );
        }
      `,
      `
        .list { display: flex; flex-direction: column; gap: 12px; }
        .item { line-height: 20px; }
        .details { display: block; padding: 8px; border-top: 1px solid #eee; }
        .icon { display: inline-flex; width: 20px; height: 20px; }
      `,
    );

    expect(hasCompositionFinding(decisions)).toBe(false);
  });

  // Test 10: Form field group — label with required asterisk as inline-flex
  // The parent .field uses flex-direction: column. Vertical positioning is
  // controlled by the flex main axis, not alignment. Composition differences
  // between label and input are irrelevant for vertical alignment.
  it("does not flag label with inline-flex asterisk in flex-direction: column", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Form() {
          return (
            <form>
              <div class="field">
                <label class="label">Username</label>
                <input type="text" />
              </div>
              <div class="field">
                <label class="label">
                  Email
                  <span class="required">*</span>
                </label>
                <input type="email" />
              </div>
              <div class="field">
                <label class="label">Bio</label>
                <textarea />
              </div>
            </form>
          );
        }
      `,
      `
        .field { display: flex; flex-direction: column; gap: 4px; }
        .label { line-height: 20px; vertical-align: baseline; }
        .required {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 8px;
          height: 8px;
          color: red;
          font-size: 14px;
          line-height: 12px;
        }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(false);
  });

  // Test 11: Breadcrumb — majority have mixed composition, text-only outlier is lower risk
  it("does not produce composition finding for text-only outlier among mixed majority", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Breadcrumb() {
          return (
            <nav aria-label="Breadcrumb">
              <ol class="breadcrumb">
                <li class="crumb">
                  <a href="/">Home</a>
                  <span class="sep">{">"}</span>
                </li>
                <li class="crumb">
                  <a href="/products">Products</a>
                  <span class="sep">{">"}</span>
                </li>
                <li class="crumb">
                  <a href="/products/widget" aria-current="page">Widget</a>
                </li>
              </ol>
            </nav>
          );
        }
      `,
      `
        .breadcrumb { display: flex; list-style: none; gap: 4px; align-items: center; }
        .crumb { line-height: 20px; }
        .sep { display: inline-flex; width: 16px; height: 16px; }
      `,
    );

    // text-only outlier among mixed-* majority produces lower strength; the
    // composition finding should not be the dominant factor
    expect(hasCompositionFinding(decisions)).toBe(false);
  });

  // Test 12: Dropdown menu items — some with keyboard shortcut hints
  // The parent .menu uses flex-direction: column. Vertical differences are
  // the flex algorithm stacking items, not alignment misalignment.
  it("does not flag menu items with inline-block kbd in flex-direction: column", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Menu() {
          return (
            <ul role="menu" class="menu">
              <li role="menuitem" class="menu-item">
                Undo
                <kbd class="shortcut">Ctrl+Z</kbd>
              </li>
              <li role="menuitem" class="menu-item">
                Redo
                <kbd class="shortcut">Ctrl+Y</kbd>
              </li>
              <li role="menuitem" class="menu-item">Cut</li>
              <li role="menuitem" class="menu-item">Copy</li>
              <li role="menuitem" class="menu-item">Paste</li>
            </ul>
          );
        }
      `,
      `
        .menu { list-style: none; padding: 4px 0; display: flex; flex-direction: column; align-items: baseline; }
        .menu-item { padding: 8px 12px; line-height: 20px; }
        .shortcut {
          display: inline-block;
          margin-left: 24px;
          padding: 2px 6px;
          border-radius: 3px;
          border: 1px solid #ccc;
          font-size: 12px;
          line-height: 16px;
        }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(false);
  });

  // Test 13: Tag list — one tag has a dismiss button, but each tag is inline-flex
  // with align-items: center, which mitigates the baseline issue internally.
  // The dismiss button's height may cause a height difference (not a baseline issue),
  // which is outside the scope of content-composition detection.
  it("does not flag tag with dismiss button when tags use inline-flex align-items: center", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Tags() {
          return (
            <div class="tags">
              <span class="tag">JavaScript</span>
              <span class="tag">TypeScript</span>
              <span class="tag dismiss-tag">
                SolidJS
                <button class="dismiss">x</button>
              </span>
              <span class="tag">CSS</span>
            </div>
          );
        }
      `,
      `
        .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
        .tag {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          background: #e5e7eb;
          line-height: 20px;
        }
        .dismiss-tag { padding-right: 6px; }
        .dismiss {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: none;
          margin-left: 4px;
          padding: 0;
        }
      `,
    );

    expect(hasCompositionFinding(decisions)).toBe(false);
  });

  // Test 14: Pricing table — one cell has inline status indicator
  // CSS2 §17.5.3: `vertical-align: middle` on table cells positions content
  // at the geometric center of the row, bypassing baseline alignment entirely.
  // Content composition divergence cannot cause visible misalignment when all
  // cells use `vertical-align: middle`.
  it("does not flag table cell with inline-block dot when all cells use vertical-align: middle", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function PricingRow() {
          return (
            <table>
              <tbody>
                <tr>
                  <td class="cell">Starter Plan</td>
                  <td class="cell">$9/month</td>
                  <td class="cell">10 projects</td>
                  <td class="cell">
                    <span class="dot" />
                    Available
                  </td>
                  <td class="cell">Basic</td>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        .cell { padding: 12px 16px; line-height: 20px; vertical-align: middle; }
        .dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #22c55e;
        }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(false);
  });

  // Test 15: Flex parent with align-items: baseline — should fire
  it("flags composition divergence under flex align-items: baseline", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <div class="item">Regular text item</div>
              <div class="item">
                Another text item
                <span class="icon">.</span>
              </div>
              <div class="item">Third text item</div>
            </div>
          );
        }
      `,
      `
        .row { display: flex; gap: 24px; align-items: baseline; }
        .item { font-size: 14px; line-height: 20px; }
        .icon { display: inline-flex; width: 20px; height: 20px; line-height: 12px; }
      `,
    );

    expect(hasAcceptedDecision(decisions)).toBe(true);
  });

  // Test 16: Flex parent with align-items: center — should NOT fire (masked)
  it("does not flag composition divergence when parent uses align-items: center", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <div class="item">Regular text item</div>
              <div class="item">
                Another text item
                <span class="icon">.</span>
              </div>
              <div class="item">Third text item</div>
            </div>
          );
        }
      `,
      `
        .row { display: flex; gap: 24px; align-items: center; }
        .item { font-size: 14px; line-height: 20px; }
        .icon { display: inline-flex; width: 20px; height: 20px; }
      `,
    );

    expect(hasCompositionFinding(decisions)).toBe(false);
  });
});
