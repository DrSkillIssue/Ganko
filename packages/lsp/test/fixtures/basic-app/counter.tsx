import { createSignal } from "solid-js";

export function Counter() {
  const [count, setCount] = createSignal(0);
  const increment = () => setCount(c => c + 1);
  return (
    <div>
      <span>{count()}</span>
      <button onClick={increment}>+</button>
    </div>
  );
}
