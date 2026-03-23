/**
 * Closure DOM Circular Reference Rule
 *
 * Detects event handler assignments on DOM element parameters where the
 * handler closure captures the element, creating a closure-DOM circular
 * reference. While modern engines handle this via GC, it remains a code
 * smell and can cause leaks in legacy engines or when the element is
 * removed from the DOM without clearing the handler.
 *
 * BAD:
 *   function setup(element: HTMLElement) {
 *     element.onclick = () => {
 *       element.classList.toggle("active"); // circular: closure -> element -> handler -> closure
 *     };
 *   }
 *
 * GOOD:
 *   function setup(element: HTMLElement) {
 *     element.addEventListener("click", function handler() {
 *       element.classList.toggle("active");
 *     });
 *     // Can later: element.removeEventListener("click", handler);
 *   }
 *   // Or use WeakRef / AbortController pattern
 */

import ts from "typescript"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getVariableByNameInScope } from "../../queries"

const EVENT_HANDLER_PROPS = new Set([
  "onclick", "ondblclick", "onmousedown", "onmouseup", "onmousemove",
  "onmouseenter", "onmouseleave", "onmouseover", "onmouseout",
  "onkeydown", "onkeyup", "onkeypress",
  "onfocus", "onblur", "oninput", "onchange", "onsubmit", "onreset",
  "onscroll", "onresize", "onwheel",
  "ondragstart", "ondrag", "ondragend", "ondragenter", "ondragleave", "ondragover", "ondrop",
  "ontouchstart", "ontouchmove", "ontouchend", "ontouchcancel",
  "onpointerdown", "onpointerup", "onpointermove", "onpointerenter", "onpointerleave",
  "onload", "onerror", "onabort",
  "oncontextmenu", "onselect", "onanimationend", "onanimationstart",
  "ontransitionend", "ontransitionstart",
])

/**
 * Web API constructors that support event handler properties but are NOT DOM
 * elements. These objects are never attached to the document tree, so
 * closure-DOM circular reference concerns do not apply — their lifecycle
 * is managed by explicit close/abort/terminate calls, not by DOM retention.
 */
const NON_DOM_EVENT_TARGETS = new Set([
  "EventSource",
  "WebSocket",
  "BroadcastChannel",
  "Worker",
  "SharedWorker",
  "XMLHttpRequest",
  "RTCPeerConnection",
  "RTCDataChannel",
  "AudioContext",
  "MediaSource",
  "MediaRecorder",
  "Notification",
  "FileReader",
])

/**
 * Whether a variable was initialized from a non-DOM Web API constructor.
 *
 * Checks declarations for `new EventSource(...)`, `new WebSocket(...)`, etc.
 * These objects support event handler properties (onerror, onopen, onmessage)
 * but are ephemeral — not retained in the document tree.
 *
 * @param v - The variable entity to check
 * @returns True if initialized from a non-DOM event target constructor
 */
function isNonDomEventTarget(v: VariableEntity): boolean {
  const declarations = v.declarations
  for (let i = 0, len = declarations.length; i < len; i++) {
    const decl = declarations[i];
    if (!decl) continue;
    const declarator = decl.parent
    if (!declarator || !ts.isVariableDeclaration(declarator)) continue
    const init = declarator.initializer
    if (!init) continue
    if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
      if (NON_DOM_EVENT_TARGETS.has(init.expression.text)) return true
    }
  }

  const assignments = v.assignments
  for (let i = 0, len = assignments.length; i < len; i++) {
    const assignment = assignments[i];
    if (!assignment) continue;
    const val = assignment.value
    if (ts.isNewExpression(val) && ts.isIdentifier(val.expression)) {
      if (NON_DOM_EVENT_TARGETS.has(val.expression.text)) return true
    }
  }

  return false
}

const messages = {
  circularRef:
    "Event handler on '{{param}}' creates a closure that captures '{{param}}', forming a closure-DOM circular reference. Use addEventListener with a named handler for easier cleanup.",
} as const

const options = {}

export const closureDomCircular = defineSolidRule({
  id: "closure-dom-circular",
  severity: "warn",
  messages,
  meta: {
    description: "Detect event handler property assignments that create closure-DOM circular references.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const assignments = graph.propertyAssignments

    for (let i = 0, len = assignments.length; i < len; i++) {
      const pa = assignments[i]
      if (!pa) continue;

      // Must be identifier.onXxx = <closure>
      if (!ts.isIdentifier(pa.object)) continue
      if (!ts.isIdentifier(pa.property)) continue

      const propName = pa.property.text.toLowerCase()
      if (!EVENT_HANDLER_PROPS.has(propName)) continue

      const value = pa.value
      if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) continue

      // Resolve the object to the specific variable entity in this scope
      const objName = pa.object.text
      const v = getVariableByNameInScope(graph, objName, pa.scope)
      if (!v) continue

      // Non-DOM Web API objects (EventSource, WebSocket, etc.) are ephemeral
      // and not retained in the document tree — no circular reference risk
      if (isNonDomEventTarget(v)) continue

      // Check if the closure captures the object variable
      const closureStart = value.getStart()
      const closureEnd = value.end
      const reads = v.reads

      for (let ri = 0, rlen = reads.length; ri < rlen; ri++) {
        const readEntry = reads[ri];
        if (!readEntry) continue;
        const readStart = readEntry.node.getStart()
        const readEnd = readEntry.node.end
        if (readStart >= closureStart && readEnd <= closureEnd) {
          emit(
            createDiagnostic(
              graph.filePath,
              pa.node,
              graph.sourceFile,
              "closure-dom-circular",
              "circularRef",
              resolveMessage(messages.circularRef, { param: objName }),
              "warn",
            ),
          )
          break
        }
      }
    }
  },
})
