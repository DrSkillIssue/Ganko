import { createSignal, createMemo } from "solid-js";

export interface UseCounterOptions {
  initial?: number;
  min?: number;
  max?: number;
}

export interface UseCounterReturn {
  count: () => number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
  isMin: () => boolean;
  isMax: () => boolean;
}

export function useCounter(options: UseCounterOptions = {}): UseCounterReturn {
  const { initial = 0, min = -Infinity, max = Infinity } = options;
  const [count, setCount] = createSignal(initial);

  const increment = () => setCount((c) => Math.min(c + 1, max));
  const decrement = () => setCount((c) => Math.max(c - 1, min));
  const reset = () => setCount(initial);

  const isMin = createMemo(() => count() <= min);
  const isMax = createMemo(() => count() >= max);

  return {
    count,
    increment,
    decrement,
    reset,
    isMin,
    isMax,
  };
}
