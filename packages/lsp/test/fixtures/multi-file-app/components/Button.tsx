import type { JSX } from "solid-js";

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
