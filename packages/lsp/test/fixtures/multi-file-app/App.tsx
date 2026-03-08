import { Show, createSignal, onMount } from "solid-js";
import { Counter, Button } from "./components";
import { useCounter } from "./hooks/useCounter";
import { createAppStore } from "./stores/appStore";
import "./styles.css";

export default function App() {
  const appStore = createAppStore();
  const counter = useCounter({ initial: 10, min: 0, max: 100 });
  const [showCounter, setShowCounter] = createSignal(true);

  onMount(() => {
    console.log("App mounted");
  });

  return (
    <div class="app">
      <header>
        <Show when={appStore.store.user.isLoggedIn}>
          <span>Welcome, {appStore.store.user.name}</span>
        </Show>
      </header>

      <main>
        <Button onClick={() => setShowCounter((s) => !s)}>Toggle Counter</Button>

        <Show when={showCounter()}>
          <Counter initialValue={counter.count()} />
        </Show>

        <div class="custom-counter">
          <Button onClick={counter.decrement} disabled={counter.isMin()}>
            -
          </Button>
          <span>{counter.count()}</span>
          <Button onClick={counter.increment} disabled={counter.isMax()}>
            +
          </Button>
        </div>
      </main>
    </div>
  );
}
