import type { SolidBuildContext } from "../../build-context"
import type { FileEntity } from "../../entities/file";
import type { FunctionEntity } from "../../entities/function";
import type { JSXElementEntity } from "../../entities/jsx";
import type { ClassEntity } from "../../entities/class";

export interface VisitorContext {
  readonly graph: SolidBuildContext;
  readonly file: FileEntity;
  
  // Mutable stacks (handlers push, visitors pop)
  readonly functionStack: FunctionEntity[];
  readonly jsxStack: JSXElementEntity[];
  readonly classStack: ClassEntity[];
  
  // Mutable depth counters
  loopDepth: number;
  conditionalDepth: number;
  
  // Output collection
  readonly componentFunctions: FunctionEntity[];
}

export function createVisitorContext(graph: SolidBuildContext): VisitorContext {
  return {
    graph,
    file: graph.fileEntity,
    functionStack: [],
    jsxStack: [],
    classStack: [],
    loopDepth: 0,
    conditionalDepth: 0,
    componentFunctions: [],
  };
}