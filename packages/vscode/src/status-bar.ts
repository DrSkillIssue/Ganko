/**
 * StatusBarItem state machine.
 *
 * Maps client state to icon/tooltip/visibility.
 */
import { window, StatusBarAlignment, type StatusBarItem, type ExtensionContext } from "vscode";
import { State } from "vscode-languageclient/node";

export type StatusBarState = State | "starting" | "error";

/** Create and register a status bar item. */
export function createStatusBar(context: ExtensionContext): StatusBarItem {
  const bar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  bar.name = "Solid LSP";
  bar.command = "solid.showOutput";
  context.subscriptions.push(bar);
  return bar;
}

/** Update the status bar based on client state. */
export function updateStatusBar(bar: StatusBarItem, state: StatusBarState): void {
  switch (state) {
    case "starting":
    case State.Starting:
      bar.text = "$(loading~spin) Solid LSP";
      bar.tooltip = "Solid LSP: Starting...";
      bar.command = "solid.showOutput";
      break;
    case State.Running:
      bar.text = "$(check) Solid LSP";
      bar.tooltip = "Solid LSP: Running";
      bar.command = "solid.showOutput";
      break;
    case State.Stopped:
      bar.text = "$(circle-slash) Solid LSP";
      bar.tooltip = "Solid LSP: Stopped";
      bar.command = "solid.showOutput";
      break;
    case "error":
      bar.text = "$(error) Solid LSP";
      bar.tooltip = "Solid LSP: Error - Click to restart";
      bar.command = "solid.restartServer";
      break;
    default:
      bar.text = "$(question) Solid LSP";
      bar.tooltip = "Solid LSP: Unknown state";
      bar.command = "solid.showOutput";
  }
  bar.show();
}
