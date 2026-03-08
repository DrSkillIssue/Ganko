import { describe, it, expect } from "vitest";
import { buildGraph, at } from "./test-utils";
import { getCallsByPrimitive, getVariablesByName } from "../../src/solid/queries/get";

/**
 * Real-world complex tests that stress the SolidGraph implementation.
 * These should break if the implementation is incomplete or buggy.
 */
describe("Real-world Solid patterns", () => {
  describe("complex component patterns", () => {
    it("handles component with multiple signals and effects", () => {
      const graph = buildGraph(`
        import { createSignal, createEffect, createMemo, onCleanup } from "solid-js";
        
        function TodoApp() {
          const [todos, setTodos] = createSignal([]);
          const [filter, setFilter] = createSignal("all");
          const [newTodo, setNewTodo] = createSignal("");
          
          const filteredTodos = createMemo(() => {
            const f = filter();
            const t = todos();
            if (f === "all") return t;
            if (f === "active") return t.filter(todo => !todo.done);
            return t.filter(todo => todo.done);
          });
          
          const activeTodoCount = createMemo(() => 
            todos().filter(t => !t.done).length
          );
          
          createEffect(() => {
            console.log("Todos changed:", todos().length);
            onCleanup(() => console.log("Cleanup"));
          });
          
          const addTodo = () => {
            const text = newTodo().trim();
            if (!text) return;
            setTodos(prev => [...prev, { id: Date.now(), text, done: false }]);
            setNewTodo("");
          };
          
          return (
            <div class="todo-app">
              <header>
                <h1>Todos</h1>
                <input 
                  value={newTodo()} 
                  onInput={e => setNewTodo(e.target.value)}
                  onKeyPress={e => e.key === "Enter" && addTodo()}
                />
              </header>
              <main>
                <ul>
                  {filteredTodos().map(todo => (
                    <li class={todo.done ? "done" : ""}>
                      <input 
                        type="checkbox" 
                        checked={todo.done}
                        onChange={() => setTodos(prev => 
                          prev.map(t => t.id === todo.id ? {...t, done: !t.done} : t)
                        )}
                      />
                      <span>{todo.text}</span>
                    </li>
                  ))}
                </ul>
              </main>
              <footer>
                <span>{activeTodoCount()} items left</span>
                <div class="filters">
                  <button onClick={() => setFilter("all")}>All</button>
                  <button onClick={() => setFilter("active")}>Active</button>
                  <button onClick={() => setFilter("completed")}>Completed</button>
                </div>
              </footer>
            </div>
          );
        }
      `);
      
      // Should have TodoApp + multiple arrow functions
      expect(graph.functions.length).toBeGreaterThanOrEqual(5);
      
      // Should detect all signals
      const signals = graph.variables.filter(v => v.reactiveKind === "signal");
      expect(signals.length).toBeGreaterThanOrEqual(3);
      
      // Should detect memos
      const memos = graph.variables.filter(v => v.reactiveKind === "memo");
      expect(memos.length).toBeGreaterThanOrEqual(2);
      
      // Should have many JSX elements
      expect(graph.jsxElements.length).toBeGreaterThanOrEqual(10);
      
      // Should have proper imports
      expect(graph.imports.length).toBe(1);
      const solidImport = at(graph.imports, 0);
      expect(solidImport.specifiers.length).toBe(4);
    });

    it("handles component with resource and suspense", () => {
      const graph = buildGraph(`
        import { createResource, Suspense, Show, For } from "solid-js";
        
        async function fetchUsers() {
          const res = await fetch("/api/users");
          return res.json();
        }
        
        function UserList() {
          const [users, { refetch, mutate }] = createResource(fetchUsers);
          
          return (
            <Suspense fallback={<div>Loading...</div>}>
              <Show when={!users.error} fallback={<div>Error: {users.error?.message}</div>}>
                <ul>
                  <For each={users()}>
                    {(user, index) => (
                      <li>
                        <span>{index() + 1}. {user.name}</span>
                        <button onClick={() => mutate(prev => prev.filter(u => u.id !== user.id))}>
                          Delete
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
                <button onClick={refetch}>Refresh</button>
              </Show>
            </Suspense>
          );
        }
      `);
      
      // Should have resource variable
      const resourceVar = graph.variables.find(v => v.name === "users");
      expect(resourceVar?.reactiveKind).toBe("resource");
      
      // Should detect component
      expect(graph.componentFunctions.length).toBeGreaterThanOrEqual(1);
    });

    it("handles store patterns", () => {
      const graph = buildGraph(`
        import { createStore, produce } from "solid-js/store";
        
        function createTodoStore() {
          const [store, setStore] = createStore({
            todos: [],
            filter: "all",
            editingId: null
          });
          
          return {
            store,
            addTodo: (text) => setStore("todos", todos => [...todos, { id: Date.now(), text, done: false }]),
            toggleTodo: (id) => setStore("todos", todo => todo.id === id, "done", done => !done),
            removeTodo: (id) => setStore("todos", todos => todos.filter(t => t.id !== id)),
            setFilter: (filter) => setStore("filter", filter),
            editTodo: (id, text) => setStore(
              produce(state => {
                const todo = state.todos.find(t => t.id === id);
                if (todo) todo.text = text;
              })
            )
          };
        }
      `);
      
      // Should detect store variable
      const storeVar = graph.variables.find(v => v.name === "store");
      expect(storeVar?.reactiveKind).toBe("store");
    });

    it("handles context patterns", () => {
      const graph = buildGraph(`
        import { createContext, useContext, createSignal, ParentComponent } from "solid-js";
        
        const ThemeContext = createContext({ theme: "light", toggle: () => {} });
        
        const ThemeProvider: ParentComponent = (props) => {
          const [theme, setTheme] = createSignal("light");
          
          const value = {
            get theme() { return theme(); },
            toggle: () => setTheme(t => t === "light" ? "dark" : "light")
          };
          
          return (
            <ThemeContext.Provider value={value}>
              {props.children}
            </ThemeContext.Provider>
          );
        };
        
        function ThemedButton() {
          const ctx = useContext(ThemeContext);
          return <button class={ctx.theme}>Click me</button>;
        }
      `);
      
      expect(graph.functions.length).toBeGreaterThanOrEqual(2);
      expect(graph.componentFunctions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("complex JSX patterns", () => {
    it("handles deeply nested JSX with conditionals", () => {
      const graph = buildGraph(`
        import { Show, Switch, Match, For } from "solid-js";
        
        function Dashboard(props) {
          return (
            <div class="dashboard">
              <Show when={props.isLoading} fallback={
                <Switch fallback={<div>Unknown state</div>}>
                  <Match when={props.error}>
                    <div class="error">
                      <h2>Error</h2>
                      <p>{props.error.message}</p>
                      <button onClick={props.retry}>Retry</button>
                    </div>
                  </Match>
                  <Match when={props.data}>
                    <div class="content">
                      <header>
                        <h1>{props.data.title}</h1>
                        <Show when={props.data.subtitle}>
                          <h2>{props.data.subtitle}</h2>
                        </Show>
                      </header>
                      <main>
                        <For each={props.data.items}>
                          {(item, index) => (
                            <div class="item" data-index={index()}>
                              <Show when={item.icon}>
                                <span class="icon">{item.icon}</span>
                              </Show>
                              <span class="label">{item.label}</span>
                              <Show when={item.actions?.length}>
                                <div class="actions">
                                  <For each={item.actions}>
                                    {action => <button onClick={action.handler}>{action.label}</button>}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </main>
                    </div>
                  </Match>
                </Switch>
              }>
                <div class="loading">
                  <span class="spinner" />
                  <span>Loading...</span>
                </div>
              </Show>
            </div>
          );
        }
      `);
      
      // Should have many JSX elements
      expect(graph.jsxElements.length).toBeGreaterThan(20);
      
      // Should have proper parent/child relationships
      const divs = graph.jsxElements.filter(e => e.tag === "div");
      expect(divs.length).toBeGreaterThan(5);
      
      // Some divs should have children
      const divsWithChildren = divs.filter(d => d.childElements.length > 0);
      expect(divsWithChildren.length).toBeGreaterThan(0);
    });

    it("handles JSX spread attributes", () => {
      const graph = buildGraph(`
        function Button(props) {
          const { children, variant, ...rest } = props;
          return (
            <button class={variant} {...rest}>
              {children}
            </button>
          );
        }
        
        function App() {
          const buttonProps = { disabled: true, type: "submit" };
          return <Button variant="primary" {...buttonProps}>Submit</Button>;
        }
      `);
      
      expect(graph.functions.length).toBeGreaterThanOrEqual(2);
      expect(graph.jsxElements.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("edge cases", () => {
    it("handles empty component", () => {
      const graph = buildGraph(`
        function Empty() {
          return null;
        }
      `);
      
      expect(graph.functions.length).toBe(1);
      expect(graph.jsxElements.length).toBe(0);
    });

    it("handles component returning fragment with only text", () => {
      const graph = buildGraph(`
        function TextOnly() {
          return <>Hello World</>;
        }
      `);
      
      expect(graph.jsxElements.length).toBe(1);
      expect(at(graph.jsxElements, 0).tag).toBeNull(); // fragment
    });

    it("handles self-closing elements", () => {
      const graph = buildGraph(`
        function Form() {
          return (
            <form>
              <input type="text" />
              <input type="email" />
              <br />
              <hr />
              <img src="logo.png" alt="Logo" />
            </form>
          );
        }
      `);
      
      expect(graph.jsxElements.length).toBe(6);
    });

    it("handles computed property access in JSX", () => {
      const graph = buildGraph(`
        function Dynamic(props) {
          const key = "dynamicProp";
          return <div class={props[key]} style={props.styles?.[key]}>{props.children}</div>;
        }
      `);
      
      expect(graph.jsxElements.length).toBe(1);
    });

    it("handles IIFE in JSX", () => {
      const graph = buildGraph(`
        function App() {
          return (
            <div>
              {(() => {
                const items = [];
                for (let i = 0; i < 10; i++) {
                  items.push(<span key={i}>{i}</span>);
                }
                return items;
              })()}
            </div>
          );
        }
      `);
      
      expect(graph.functions.length).toBeGreaterThanOrEqual(2);
    });

    it("handles multiple return statements", () => {
      const graph = buildGraph(`
        function Conditional(props) {
          if (props.error) {
            return <div class="error">{props.error}</div>;
          }
          
          if (props.loading) {
            return <div class="loading">Loading...</div>;
          }
          
          return <div class="content">{props.children}</div>;
        }
      `);
      
      const fn = graph.functions.find(f => f.name === "Conditional");
      expect(fn).toBeDefined();
      // Function has multiple JSX returns - hasJSXReturn should be true
      expect(fn?.hasJSXReturn).toBe(true);
      // Note: returnStatements tracking not yet implemented
    });

    it("handles signals in loops", () => {
      const graph = buildGraph(`
        import { createSignal, For } from "solid-js";
        
        function MultiCounter() {
          const counters = [];
          for (let i = 0; i < 5; i++) {
            const [count, setCount] = createSignal(0);
            counters.push({ count, setCount, id: i });
          }
          
          return (
            <div>
              <For each={counters}>
                {(counter) => (
                  <div>
                    <span>{counter.count()}</span>
                    <button onClick={() => counter.setCount(c => c + 1)}>+</button>
                  </div>
                )}
              </For>
            </div>
          );
        }
      `);
      
      // Should detect the signals created in loop
      const signalCalls = getCallsByPrimitive(graph, "createSignal");
      expect(signalCalls.length).toBe(1);
    });

    it("handles class components (uncommon in Solid but valid)", () => {
      const graph = buildGraph(`
        class Counter {
          count = 0;
          
          increment() {
            this.count++;
          }
          
          render() {
            return (
              <div>
                <span>{this.count}</span>
                <button onClick={() => this.increment()}>+</button>
              </div>
            );
          }
        }
      `);
      
      expect(graph.classes.length).toBe(1);
      expect(at(graph.classes, 0).name).toBe("Counter");
    });

    it("handles async component patterns", () => {
      const graph = buildGraph(`
        import { createResource, Suspense } from "solid-js";
        
        async function fetchData(id) {
          const res = await fetch(\`/api/data/\${id}\`);
          return res.json();
        }
        
        function AsyncComponent(props) {
          const [data] = createResource(() => props.id, fetchData);
          
          return (
            <Suspense fallback={<div>Loading...</div>}>
              <div>{data()?.name}</div>
            </Suspense>
          );
        }
      `);
      
      const asyncFn = graph.functions.find(f => f.name === "fetchData");
      expect(asyncFn?.async).toBe(true);
    });

    it("handles generator functions", () => {
      const graph = buildGraph(`
        function* idGenerator() {
          let id = 0;
          while (true) {
            yield id++;
          }
        }
        
        const gen = idGenerator();
      `);
      
      const genFn = graph.functions.find(f => f.name === "idGenerator");
      expect(genFn?.generator).toBe(true);
    });
  });

  describe("scope and variable resolution", () => {
    it("resolves variables across nested scopes", () => {
      const graph = buildGraph(`
        const globalVar = "global";
        
        function outer() {
          const outerVar = "outer";
          
          function middle() {
            const middleVar = "middle";
            
            function inner() {
              const innerVar = "inner";
              return globalVar + outerVar + middleVar + innerVar;
            }
            
            return inner;
          }
          
          return middle;
        }
      `);
      
      const innerFn = graph.functions.find(f => f.name === "inner");
      expect(innerFn?.captures.length).toBeGreaterThan(0);
    });

    it("handles shadowed variables", () => {
      const graph = buildGraph(`
        const x = 1;
        
        function foo() {
          const x = 2;
          
          function bar() {
            const x = 3;
            return x;
          }
          
          return x + bar();
        }
      `);
      
      const xVars = getVariablesByName(graph, "x");
      expect(xVars.length).toBe(3);
    });

    it("handles destructuring patterns", () => {
      const graph = buildGraph(`
        import { createSignal } from "solid-js";
        
        function Component() {
          const [{ a, b }, setObj] = createSignal({ a: 1, b: 2 });
          const [arr, setArr] = createSignal([1, 2, 3]);
          const [[first], setNested] = createSignal([[1], [2]]);
          
          return <div>{a} {b} {first}</div>;
        }
      `);
      
      // Should create variables for destructured bindings
      expect(graph.variables.find(v => v.name === "a")).toBeDefined();
      expect(graph.variables.find(v => v.name === "b")).toBeDefined();
    });
  });
});
