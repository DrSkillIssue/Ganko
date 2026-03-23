import type { CSSWorkspaceView as CSSGraph } from "../workspace-view"
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
      const compounds = sel.compounds;
      for (let k = 0, clen = compounds.length; k < clen; k++) {
        const compound = compounds[k];
        if (!compound) continue;
        const cls = compound.classes;
        for (let m = 0, mlen = cls.length; m < mlen; m++) {
          const className = cls[m];
          if (className && isUtilityClass(className)) {
            utility = true;
            break;
          }
        }
        if (utility) break;
      }
      if (utility) break;
    }
    if (!utility) result.push(d);
  }
  return result;
}
