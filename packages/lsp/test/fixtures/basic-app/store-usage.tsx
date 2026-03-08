import { createStore } from "solid-js/store";
import { For } from "solid-js";

interface Todo { id: number; text: string; done: boolean }

export function TodoList() {
  const [store, setStore] = createStore<{ todos: Todo[] }>({ todos: [] });

  const _addTodo = (text: string) => {
    setStore("todos", todos => [...todos, { id: Date.now(), text, done: false }]);
  };

  return (
    <ul>
      <For each={store.todos}>
        {(todo) => <li classList={{ done: todo.done }}>{todo.text}</li>}
      </For>
    </ul>
  );
}
