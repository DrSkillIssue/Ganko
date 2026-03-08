import type { CSSGraph } from "../impl";
import type { DeclarationEntity } from "../entities";
import { isUtilityClass } from "./pattern";

export function getImportantDeclarationsNotInUtilities(graph: CSSGraph): readonly DeclarationEntity[] {
  const result: DeclarationEntity[] = [];
  const decls = graph.importantDeclarations;
  for (let i = 0, len = decls.length; i < len; i++) {
    const d = decls[i];
    if (!d) continue;
    const rule = d.rule;
    if (!rule) { result.push(d); continue; }
    let utility = false;
    const selectors = rule.selectors;
    for (let j = 0, slen = selectors.length; j < slen; j++) {
      const sel = selectors[j];
      if (!sel) continue;
      const parts = sel.parts;
      for (let k = 0, plen = parts.length; k < plen; k++) {
        const part = parts[k];
        if (part && part.type === "class" && isUtilityClass(part.value)) {
          utility = true;
          break;
        }
      }
      if (utility) break;
    }
    if (!utility) result.push(d);
  }
  return result;
}
