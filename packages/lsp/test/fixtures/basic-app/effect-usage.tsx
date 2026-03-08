import { createSignal, createEffect, createMemo, onCleanup } from "solid-js";

export function EffectDemo() {
  const [count, _setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);

  createEffect(() => {
    console.log("Count changed:", count());
    onCleanup(() => console.log("Cleaning up"));
  });

  return <div>Doubled: {doubled()}</div>;
}
