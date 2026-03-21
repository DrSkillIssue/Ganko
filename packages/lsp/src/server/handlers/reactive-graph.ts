/**
 * Reactive Graph Handler
 *
 * Implements the `solid/showReactiveGraph` custom LSP request.
 * Builds a SolidGraph from the target file, extracts computation
 * entities and dependency/ownership edges, then serializes them
 * as Mermaid and DOT diagrams for the VS Code webview.
 */
import type { FeatureHandlerContext } from "./handler-context";
import type { SolidGraph, ComputationEntity, DependencyEdge } from "@drskillissue/ganko";
import { uriToPath, Level } from "@drskillissue/ganko-shared";

/** Node in the reactive graph response. */
interface ReactiveGraphNode {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly line: number;
}

/** Edge in the reactive graph response. */
interface ReactiveGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  /** For store/props: the property path (e.g. ".foo.bar"). Empty for signals. */
  readonly label: string;
}

/** Full response for solid/showReactiveGraph. */
interface ReactiveGraphResult {
  readonly mermaid: string;
  readonly dot: string;
  readonly nodes: readonly ReactiveGraphNode[];
  readonly edges: readonly ReactiveGraphEdge[];
}

/** Request params for solid/showReactiveGraph. */
interface ReactiveGraphParams {
  readonly textDocument: { readonly uri: string };
}

/**
 * Handle the solid/showReactiveGraph request.
 *
 * Builds a SolidGraph for the requested file and serializes
 * the reactive dependency graph to Mermaid/DOT formats.
 */
export function handleReactiveGraph(
  params: ReactiveGraphParams,
  ctx: FeatureHandlerContext,
): ReactiveGraphResult | null {
  const { log } = ctx;
  const path = uriToPath(params.textDocument.uri);

  const graph = ctx.getSolidGraph(path);
  if (!graph) {
    if (log.isLevelEnabled(Level.Trace)) log.trace(`reactiveGraph: no SolidGraph for ${path}`);
    return null;
  }

  const nodes = buildNodes(graph);
  const edges = buildEdges(graph);

  if (nodes.length === 0) {
    if (log.isLevelEnabled(Level.Trace)) log.trace(`reactiveGraph: 0 nodes for ${path}`);
    return null;
  }

  if (log.isLevelEnabled(Level.Trace)) log.trace(`reactiveGraph: ${nodes.length} nodes, ${edges.length} edges for ${path}`);
  return {
    mermaid: toMermaid(nodes, edges),
    dot: toDot(nodes, edges),
    nodes,
    edges,
  };
}

/**
 * Builds response nodes from computations and standalone signals.
 *
 * Includes:
 * - All ComputationEntity values (effects, memos, computed, roots, etc.)
 * - Standalone reactive variables (signals/stores not produced by a computation)
 */
function buildNodes(graph: SolidGraph): ReactiveGraphNode[] {
  const nodes: ReactiveGraphNode[] = [];
  const coveredVarIds = new Set<number>();
  const sf = graph.sourceFile;

  // Computation nodes
  const computations = graph.computations;
  for (let i = 0, len = computations.length; i < len; i++) {
    const comp = computations[i];
    if (!comp) continue;
    const name = computationName(comp);
    const line = sf.getLineAndCharacterOfPosition(comp.call.node.getStart(sf)).line + 1;

    nodes.push({
      id: `comp_${comp.id}`,
      name,
      kind: comp.kind,
      line,
    });

    if (comp.variable) coveredVarIds.add(comp.variable.id);
  }

  // Standalone reactive variables (signals/stores not covered by a computation)
  const reactive = graph.reactiveVariables;
  for (let i = 0, len = reactive.length; i < len; i++) {
    const v = reactive[i];
    if (!v) continue;
    if (coveredVarIds.has(v.id)) continue;
    if (!v.reactiveKind) continue;

    const declNode = v.declarations[0];
    const line = declNode ? sf.getLineAndCharacterOfPosition(declNode.getStart(sf)).line + 1 : 0;
    nodes.push({
      id: `var_${v.id}`,
      name: v.name,
      kind: v.reactiveKind,
      line,
    });
  }

  return nodes;
}

/**
 * Builds response edges from dependency and ownership edges.
 */
function buildEdges(graph: SolidGraph): ReactiveGraphEdge[] {
  const edges: ReactiveGraphEdge[] = [];

  // Dependency edges: source → consumer
  const deps = graph.dependencyEdges;
  for (let i = 0, len = deps.length; i < len; i++) {
    const dep = deps[i];
    if (!dep) continue;
    const fromId = sourceNodeId(graph, dep);
    const toId = `comp_${dep.consumer.id}`;
    const kind = dep.isUntracked ? "untracked" : "dependency";
    const label = dep.propertyPath ? "." + dep.propertyPath.join(".") : "";

    edges.push({ from: fromId, to: toId, kind, label });
  }

  // Ownership edges: owner → child
  const owns = graph.ownershipEdges;
  for (let i = 0, len = owns.length; i < len; i++) {
    const own = owns[i];
    if (!own) continue;
    edges.push({
      from: `comp_${own.owner.id}`,
      to: `comp_${own.child.id}`,
      kind: "ownership",
      label: "",
    });
  }

  return edges;
}

/**
 * Determines the source node ID for a dependency edge.
 *
 * If the source variable is produced by a computation (memo/resource),
 * returns that computation's ID. Otherwise returns the variable's ID.
 */
function sourceNodeId(graph: SolidGraph, dep: DependencyEdge): string {
  const source = dep.source;
  const computations = graph.computations;
  for (let i = 0, len = computations.length; i < len; i++) {
    const comp = computations[i];
    if (!comp) continue;
    if (comp.variable === source && comp.isSource) {
      return `comp_${comp.id}`;
    }
  }
  return `var_${source.id}`;
}

/**
 * Derives a human-readable name for a computation.
 */
function computationName(comp: ComputationEntity): string {
  if (comp.variable) return comp.variable.name;

  const callback = comp.callback;
  if (callback?.name) return callback.name;
  if (callback?.variableName) return callback.variableName;

  return comp.kind;
}

const MERMAID_UNSAFE_G = /["`]/g;

/** Escapes a string for Mermaid node labels. */
function mermaidEscape(text: string): string {
  return text.replace(MERMAID_UNSAFE_G, "'");
}

/**
 * Serializes nodes and edges to a Mermaid flowchart.
 */
function toMermaid(nodes: readonly ReactiveGraphNode[], edges: readonly ReactiveGraphEdge[]): string {
  const lines: string[] = ["graph LR"];

  // Collect only dependency edges (ownership creates spaghetti)
  const depEdges: ReactiveGraphEdge[] = [];
  for (let i = 0, len = edges.length; i < len; i++) {
    const edge = edges[i];
    if (!edge) continue;
    if (edge.kind !== "ownership") depEdges.push(edge);
  }

  // Only include nodes that participate in at least one dependency edge
  const connected = new Set<string>();
  for (let i = 0, len = depEdges.length; i < len; i++) {
    const de = depEdges[i];
    if (!de) continue;
    connected.add(de.from);
    connected.add(de.to);
  }

  for (let i = 0, len = nodes.length; i < len; i++) {
    const n = nodes[i];
    if (!n) continue;
    if (!connected.has(n.id)) continue;
    const label = mermaidEscape(`${n.name}:${n.line}`);
    const shape = nodeShape(n.kind);
    lines.push(`  ${n.id}${shape[0]}"${label}"${shape[1]}`);
  }

  for (let i = 0, len = depEdges.length; i < len; i++) {
    const e = depEdges[i];
    if (!e) continue;
    const arrow = edgeArrow(e.kind);
    const label = e.label ? `|${mermaidEscape(e.label)}|` : "";
    lines.push(`  ${e.from} ${arrow}${label} ${e.to}`);
  }

  return lines.join("\n");
}

/** Returns Mermaid shape delimiters based on node kind. */
function nodeShape(kind: string): [string, string] {
  switch (kind) {
    case "signal":
    case "store":
    case "props":
    case "resource":
      return ["([", "])"];   // stadium shape for sources
    case "memo":
      return ["[[", "]]"];   // subroutine shape for dual nodes
    case "root":
      return ["{{", "}}"];   // hexagon for roots
    default:
      return ["[", "]"];     // rectangle for effects/computed
  }
}

/** Returns Mermaid arrow style based on edge kind. */
function edgeArrow(kind: string): string {
  switch (kind) {
    case "dependency": return "-->";
    case "untracked": return "-.->";
    case "ownership": return "-.->|owns|";
    default: return "-->";
  }
}

const DOT_UNSAFE_G = /["\\]/g;

/** Escapes a string for DOT labels. */
function dotEscape(text: string): string {
  return text.replace(DOT_UNSAFE_G, "\\$&");
}

/**
 * Serializes nodes and edges to a DOT (Graphviz) digraph.
 */
function toDot(nodes: readonly ReactiveGraphNode[], edges: readonly ReactiveGraphEdge[]): string {
  const lines: string[] = ["digraph ReactiveGraph {", "  rankdir=LR;"];

  for (let i = 0, len = nodes.length; i < len; i++) {
    const n = nodes[i];
    if (!n) continue;
    const label = dotEscape(`${n.name} (${n.kind}:${n.line})`);
    const shape = dotShape(n.kind);
    lines.push(`  ${n.id} [label="${label}" shape=${shape}];`);
  }

  for (let i = 0, len = edges.length; i < len; i++) {
    const e = edges[i];
    if (!e) continue;
    const style = dotEdgeStyle(e.kind, e.label);
    lines.push(`  ${e.from} -> ${e.to}${style};`);
  }

  lines.push("}");
  return lines.join("\n");
}

/** Returns DOT shape based on node kind. */
function dotShape(kind: string): string {
  switch (kind) {
    case "signal":
    case "store":
    case "props":
    case "resource":
      return "ellipse";
    case "memo":
      return "diamond";
    case "root":
      return "hexagon";
    default:
      return "box";
  }
}

const DQ = "\"";

/** Returns DOT edge style attributes based on edge kind and label. */
function dotEdgeStyle(kind: string, label: string): string {
  const base = label ? `label=${DQ}${dotEscape(label)}${DQ}` : "";
  switch (kind) {
    case "untracked": return ` [style=dashed ${base || `label=${DQ}untracked${DQ}`}]`;
    case "ownership": return ` [style=dotted label=${DQ}owns${DQ}]`;
    default: return base ? ` [${base}]` : "";
  }
}
