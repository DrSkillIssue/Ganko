import { createSignal, JSX } from "solid-js";

export interface ButtonProps {
  children: JSX.Element;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}

export function Button(props: ButtonProps) {
  return (
    <button
      class={`btn btn-${props.variant ?? "primary"}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export interface CounterProps {
  initialValue?: number;
  step?: number;
}

export function Counter(props: CounterProps) {
  const [count, setCount] = createSignal(props.initialValue ?? 0);
  const step = () => props.step ?? 1;

  const increment = () => setCount(c => c + step());
  const decrement = () => setCount(c => c - step());

  return (
    <div class="counter">
      <Button onClick={decrement} variant="secondary">-</Button>
      <span class="count">{count()}</span>
      <Button onClick={increment}>+</Button>
    </div>
  );
}