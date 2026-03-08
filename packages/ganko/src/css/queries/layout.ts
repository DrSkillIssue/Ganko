import type { SelectorEntity } from "../entities"
import type { CSSGraph } from "../impl"

export function getSelectorsTargetingCheckbox(graph: CSSGraph): readonly SelectorEntity[] {
  return graph.selectorsTargetingCheckbox
}

export function getSelectorsTargetingTableCell(graph: CSSGraph): readonly SelectorEntity[] {
  return graph.selectorsTargetingTableCell
}

export function getSelectorsBySubjectTag(graph: CSSGraph, tag: string): readonly SelectorEntity[] {
  return graph.selectorsBySubjectTag.get(tag.toLowerCase()) ?? []
}

export function getSelectorsWithoutSubjectTag(graph: CSSGraph): readonly SelectorEntity[] {
  return graph.selectorsWithoutSubjectTag
}
