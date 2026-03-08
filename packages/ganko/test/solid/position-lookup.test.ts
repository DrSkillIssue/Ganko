import { describe, it, expect } from "vitest";
import { buildGraph } from "./test-utils";
import { getNodeAtPosition, getNodeAtPositionInFile } from "../../src/solid/queries/get";

describe("getNodeAtPosition", () => {
  it("returns identifier at exact position", () => {
    const code = "const foo = 1;";
    //            0123456789012
    //            col: 6 = 'f'
    const graph = buildGraph(code);
    // Only Expression nodes are indexed - 'foo' is in VariableDeclarator, not indexed
    // The Literal '1' at col 12 is indexed
    const node = getNodeAtPosition(graph, 1, 12);
    expect(node?.type).toBe("Literal");
  });

  it("returns smallest enclosing node for nested expressions", () => {
    const code = "fn(a.b)";
    //            0123456
    //            col 0-1 = 'fn', col 3 = 'a', col 4 = '.', col 5 = 'b'
    const graph = buildGraph(code);

    // Position on 'fn' should return Identifier 'fn'
    expect(getNodeAtPosition(graph, 1, 0)?.type).toBe("Identifier");

    // Position on 'a' should return Identifier 'a' (object of MemberExpression, visited)
    expect(getNodeAtPosition(graph, 1, 3)?.type).toBe("Identifier");

    // Position on '.' should return MemberExpression (dot is part of MemberExpression)
    expect(getNodeAtPosition(graph, 1, 4)?.type).toBe("MemberExpression");

    // Position on 'b' returns MemberExpression (non-computed property is NOT visited separately)
    expect(getNodeAtPosition(graph, 1, 5)?.type).toBe("MemberExpression");
  });

  it("returns null for position outside file bounds", () => {
    const graph = buildGraph("x");
    expect(getNodeAtPosition(graph, 1, 100)).toBeNull();
    expect(getNodeAtPosition(graph, 100, 0)).toBeNull();
    expect(getNodeAtPosition(graph, 0, 0)).toBeNull(); // line 0 invalid
    expect(getNodeAtPosition(graph, -1, 0)).toBeNull();
  });

  it("handles multiline files correctly", () => {
    const code = "a\nb\nc";
    //            Line 1: 'a' at offset 0
    //            Line 2: 'b' at offset 2 (after 'a\n')
    //            Line 3: 'c' at offset 4 (after 'a\nb\n')
    const graph = buildGraph(code);

    // Each single-char identifier is indexed as an Expression
    const nodeA = getNodeAtPosition(graph, 1, 0);
    const nodeB = getNodeAtPosition(graph, 2, 0);
    const nodeC = getNodeAtPosition(graph, 3, 0);

    expect(nodeA?.type).toBe("Identifier");
    expect(nodeB?.type).toBe("Identifier");
    expect(nodeC?.type).toBe("Identifier");
  });

  it("returns null for whitespace positions not covered by expression nodes", () => {
    const code = "{ x }";
    //            01234
    //            col 2 = 'x' (Identifier)
    const graph = buildGraph(code);

    // Position on 'x' returns Identifier
    expect(getNodeAtPosition(graph, 1, 2)?.type).toBe("Identifier");

    // Whitespace positions not covered by any indexed Expression
    expect(getNodeAtPosition(graph, 1, 1)).toBeNull();
    expect(getNodeAtPosition(graph, 1, 3)).toBeNull();
  });

  it("returns null for empty file", () => {
    const graph = buildGraph("");
    expect(getNodeAtPosition(graph, 1, 0)).toBeNull();
  });

  it("handles JSX correctly", () => {
    const code = "<div>text</div>";
    //            0123456789...
    const graph = buildGraph(code);

    // JSXElement is indexed as an Expression
    // Position on 'd' (col 1) is inside JSXOpeningElement which is part of JSXElement
    const node = getNodeAtPosition(graph, 1, 0);
    expect(node?.type).toBe("JSXElement");
  });

  it("handles unicode characters", () => {
    const code = "const x = 变量";
    //            0123456789...
    // '变量' starts at col 10
    const graph = buildGraph(code);

    // The identifier is an Expression
    const node = getNodeAtPosition(graph, 1, 10);
    expect(node?.type).toBe("Identifier");
  });

  it("getNodeAtPositionInFile returns null for wrong path", () => {
    const graph = buildGraph("x");
    expect(getNodeAtPositionInFile(graph, "/wrong/path.ts", 1, 0)).toBeNull();
  });

  it("returns call expression for function call position", () => {
    const code = "foo()";
    const graph = buildGraph(code);

    // Position on 'foo' returns Identifier
    expect(getNodeAtPosition(graph, 1, 0)?.type).toBe("Identifier");

    // Position on '(' returns CallExpression
    expect(getNodeAtPosition(graph, 1, 3)?.type).toBe("CallExpression");
  });

  describe("real-world Solid.js patterns", () => {
    it("Solid component with createSignal and createEffect", () => {
      const code = `function Counter() {
  const [count, setCount] = createSignal(0);
  createEffect(() => {
    console.log("Count:", count());
  });
  return <button onClick={() => setCount(c => c + 1)}>{count()}</button>;
}`;
      // Line 1: function Counter() {
      // Line 2:   const [count, setCount] = createSignal(0);
      //           0         1         2         3         4
      //           0123456789012345678901234567890123456789012
      // Line 3:   createEffect(() => {
      // Line 4:     console.log("Count:", count());
      // Line 5:   });
      // Line 6:   return <button onClick={() => setCount(c => c + 1)}>{count()}</button>;
      const graph = buildGraph(code);

      // Line 2: createSignal call - 'createSignal' starts at col 28
      const createSignalNode = getNodeAtPosition(graph, 2, 28);
      expect(createSignalNode?.type).toBe("Identifier");
      expect(createSignalNode?.name).toBe("createSignal");

      // Line 2: literal 0 at col 41
      const zeroLiteral = getNodeAtPosition(graph, 2, 41);
      expect(zeroLiteral?.type).toBe("Literal");

      // Line 3: createEffect identifier at col 2
      const createEffectNode = getNodeAtPosition(graph, 3, 2);
      expect(createEffectNode?.type).toBe("Identifier");
      expect(createEffectNode?.name).toBe("createEffect");

      // Line 4: console.log - 'console' at col 4
      const consoleNode = getNodeAtPosition(graph, 4, 4);
      expect(consoleNode?.type).toBe("Identifier");
      expect(consoleNode?.name).toBe("console");

      // Line 4: count() call - 'count' at col 26
      const countNode = getNodeAtPosition(graph, 4, 26);
      expect(countNode?.type).toBe("Identifier");
      expect(countNode?.name).toBe("count");

      // Line 6: JSXElement at col 9 (the '<' of <button>)
      const jsxNode = getNodeAtPosition(graph, 6, 9);
      expect(jsxNode?.type).toBe("JSXElement");
    });

    it("JSX with event handlers and dynamic expressions", () => {
      const code = `<div
  class={styles.container}
  onClick={(e) => handleClick(e)}
  data-active={isActive()}
>
  <span>{message()}</span>
  <Show when={visible()}>
    <p>Visible content</p>
  </Show>
</div>`;
      // Line 1: <div
      // Line 2:   class={styles.container}
      //           0         1         2
      //           012345678901234567890123
      // Line 3:   onClick={(e) => handleClick(e)}
      // Line 4:   data-active={isActive()}
      // Line 5: >
      // Line 6:   <span>{message()}</span>
      // Line 7:   <Show when={visible()}>
      const graph = buildGraph(code);

      // Line 2: MemberExpression styles.container - 'styles' at col 9
      const stylesNode = getNodeAtPosition(graph, 2, 9);
      expect(stylesNode?.type).toBe("Identifier");
      expect(stylesNode?.name).toBe("styles");

      // Line 3: Arrow function param 'e' at col 12 - params are part of ArrowFunctionExpression
      const paramE = getNodeAtPosition(graph, 3, 12);
      expect(paramE?.type).toBe("ArrowFunctionExpression");

      // Line 3: handleClick identifier at col 18
      const handleClickNode = getNodeAtPosition(graph, 3, 18);
      expect(handleClickNode?.type).toBe("Identifier");
      expect(handleClickNode?.name).toBe("handleClick");

      // Line 4: isActive call - 'isActive' at col 15
      const isActiveNode = getNodeAtPosition(graph, 4, 15);
      expect(isActiveNode?.type).toBe("Identifier");
      expect(isActiveNode?.name).toBe("isActive");

      // Line 6: message() call inside JSX - 'message' at col 9
      const messageNode = getNodeAtPosition(graph, 6, 9);
      expect(messageNode?.type).toBe("Identifier");
      expect(messageNode?.name).toBe("message");

      // Line 7: Show component - entire element at col 2
      const showElement = getNodeAtPosition(graph, 7, 2);
      expect(showElement?.type).toBe("JSXElement");

      // Line 7: visible() call at col 14
      const visibleNode = getNodeAtPosition(graph, 7, 14);
      expect(visibleNode?.type).toBe("Identifier");
      expect(visibleNode?.name).toBe("visible");
    });

    it("nested function calls and arrow functions", () => {
      const code = `createMemo(() =>
  items()
    .filter((item) => item.active)
    .map((item) => ({
      id: item.id,
      label: transform(item.name)
    }))
)`;
      // Line 1: createMemo(() =>
      //         0         1
      //         0123456789012345
      // Line 2:   items()
      // Line 3:     .filter((item) => item.active)
      // Line 4:     .map((item) => ({
      // Line 5:       id: item.id,
      // Line 6:       label: transform(item.name)
      const graph = buildGraph(code);

      // Line 1: createMemo at col 0
      const createMemoNode = getNodeAtPosition(graph, 1, 0);
      expect(createMemoNode?.type).toBe("Identifier");
      expect(createMemoNode?.name).toBe("createMemo");

      // Line 2: items identifier at col 2
      const itemsNode = getNodeAtPosition(graph, 2, 2);
      expect(itemsNode?.type).toBe("Identifier");
      expect(itemsNode?.name).toBe("items");

      // Line 3: filter is part of MemberExpression at col 5
      const filterMember = getNodeAtPosition(graph, 3, 5);
      expect(filterMember?.type).toBe("MemberExpression");

      // Line 3: item param at col 13 - params are part of ArrowFunctionExpression
      const itemParam = getNodeAtPosition(graph, 3, 13);
      expect(itemParam?.type).toBe("ArrowFunctionExpression");

      // Line 5: item.id - 'item' at col 10
      const itemIdObj = getNodeAtPosition(graph, 5, 10);
      expect(itemIdObj?.type).toBe("Identifier");
      expect(itemIdObj?.name).toBe("item");

      // Line 6: transform call - 'transform' at col 13
      const transformNode = getNodeAtPosition(graph, 6, 13);
      expect(transformNode?.type).toBe("Identifier");
      expect(transformNode?.name).toBe("transform");
    });

    it("multi-line object expressions", () => {
      const code = `const config = {
  apiUrl: "https://api.example.com",
  timeout: 5000,
  headers: {
    "Content-Type": contentType(),
    Authorization: getAuthHeader()
  },
  transform: (data) => data.result
}`;
      // Line 1: const config = {
      // Line 2:   apiUrl: "https://api.example.com",
      //           0         1         2         3
      //           01234567890123456789012345678901234
      // Line 3:   timeout: 5000,
      // Line 4:   headers: {
      // Line 5:     "Content-Type": contentType(),
      // Line 6:     Authorization: getAuthHeader()
      // Line 7:   },
      // Line 8:   transform: (data) => data.result
      const graph = buildGraph(code);

      // Line 2: string literal at col 10
      const apiUrlString = getNodeAtPosition(graph, 2, 10);
      expect(apiUrlString?.type).toBe("Literal");

      // Line 3: number 5000 at col 11
      const timeoutNum = getNodeAtPosition(graph, 3, 11);
      expect(timeoutNum?.type).toBe("Literal");

      // Line 5: contentType() call - 'contentType' at col 20
      const contentTypeNode = getNodeAtPosition(graph, 5, 20);
      expect(contentTypeNode?.type).toBe("Identifier");
      expect(contentTypeNode?.name).toBe("contentType");

      // Line 6: getAuthHeader() call at col 19
      const getAuthNode = getNodeAtPosition(graph, 6, 19);
      expect(getAuthNode?.type).toBe("Identifier");
      expect(getAuthNode?.name).toBe("getAuthHeader");

      // Line 8: data param at col 14 - params are part of ArrowFunctionExpression
      const dataParam = getNodeAtPosition(graph, 8, 14);
      expect(dataParam?.type).toBe("ArrowFunctionExpression");

      // Line 8: data.result MemberExpression - 'data' at col 23
      const dataObj = getNodeAtPosition(graph, 8, 23);
      expect(dataObj?.type).toBe("Identifier");
      expect(dataObj?.name).toBe("data");
    });

    it("template literals with expressions", () => {
      const code = `const greeting = \`Hello, \${name()}!
Your score is: \${score() * 10}.
Status: \${
  isAdmin()
    ? "Administrator"
    : "User"
}\`;`;
      // Line 1: const greeting = `Hello, ${name()}!
      //         0         1         2         3
      //         0123456789012345678901234567890123456
      // Line 2: Your score is: ${score() * 10}.
      // Line 3: Status: ${
      // Line 4:   isAdmin()
      // Line 5:     ? "Administrator"
      // Line 6:     : "User"
      // Line 7: }`;
      const graph = buildGraph(code);

      // Line 1: TemplateLiteral at col 17
      const templateNode = getNodeAtPosition(graph, 1, 17);
      expect(templateNode?.type).toBe("TemplateLiteral");

      // Line 1: name() call inside template - 'name' at col 27
      const nameNode = getNodeAtPosition(graph, 1, 27);
      expect(nameNode?.type).toBe("Identifier");
      expect(nameNode?.name).toBe("name");

      // Line 2: score() call - 'score' at col 17
      const scoreNode = getNodeAtPosition(graph, 2, 17);
      expect(scoreNode?.type).toBe("Identifier");
      expect(scoreNode?.name).toBe("score");

      // Line 2: number 10 at col 28
      const tenLiteral = getNodeAtPosition(graph, 2, 28);
      expect(tenLiteral?.type).toBe("Literal");

      // Line 4: isAdmin() call - 'isAdmin' at col 2
      const isAdminNode = getNodeAtPosition(graph, 4, 2);
      expect(isAdminNode?.type).toBe("Identifier");
      expect(isAdminNode?.name).toBe("isAdmin");

      // Line 5: "Administrator" string at col 6
      const adminString = getNodeAtPosition(graph, 5, 6);
      expect(adminString?.type).toBe("Literal");
    });

    it("complex component with stores and derived state", () => {
      const code = `function TodoList(props) {
  const [todos, setTodos] = createStore([]);
  const completed = createMemo(() =>
    todos.filter(t => t.done).length
  );
  const remaining = () => todos.length - completed();

  return (
    <For each={todos}>
      {(todo, i) => (
        <li class={todo.done ? "done" : ""}>
          {todo.text}
        </li>
      )}
    </For>
  );
}`;
      // Line 1: function TodoList(props) {
      // Line 2:   const [todos, setTodos] = createStore([]);
      //           0         1         2         3         4
      //           012345678901234567890123456789012345678901234
      // Line 3:   const completed = createMemo(() =>
      // Line 4:     todos.filter(t => t.done).length
      // Line 6:   const remaining = () => todos.length - completed();
      // Line 8:   return (
      // Line 9:     <For each={todos}>
      const graph = buildGraph(code);

      // Line 2: createStore at col 28
      const createStoreNode = getNodeAtPosition(graph, 2, 28);
      expect(createStoreNode?.type).toBe("Identifier");
      expect(createStoreNode?.name).toBe("createStore");

      // Line 3: createMemo at col 20
      const createMemoNode = getNodeAtPosition(graph, 3, 20);
      expect(createMemoNode?.type).toBe("Identifier");
      expect(createMemoNode?.name).toBe("createMemo");

      // Line 4: todos.filter - 'todos' at col 4
      const todosNode = getNodeAtPosition(graph, 4, 4);
      expect(todosNode?.type).toBe("Identifier");
      expect(todosNode?.name).toBe("todos");

      // Line 6: completed() call - 'completed' at col 42
      const completedNode = getNodeAtPosition(graph, 6, 42);
      expect(completedNode?.type).toBe("Identifier");
      expect(completedNode?.name).toBe("completed");

      // Line 9: For element at col 4
      const forElement = getNodeAtPosition(graph, 9, 4);
      expect(forElement?.type).toBe("JSXElement");

      // Line 9: todos in JSX attr at col 15
      const todosAttr = getNodeAtPosition(graph, 9, 15);
      expect(todosAttr?.type).toBe("Identifier");
      expect(todosAttr?.name).toBe("todos");

      // Line 10: arrow function param 'todo' at col 8 - params are part of ArrowFunctionExpression
      const todoParam = getNodeAtPosition(graph, 10, 8);
      expect(todoParam?.type).toBe("ArrowFunctionExpression");

      // Line 11: conditional expression - todo.done at col 19
      const todoDoneObj = getNodeAtPosition(graph, 11, 19);
      expect(todoDoneObj?.type).toBe("Identifier");
      expect(todoDoneObj?.name).toBe("todo");
    });
  });
});
