/**
 * Cancellation primitives for diagnostic pipeline abort.
 *
 * Like typescript-language-server's GetErrRequest cancellation:
 * when a new document change batch arrives, the previous cancellation
 * source is cancelled, aborting any in-flight diagnostic pipeline run.
 * Diagnostic producers check the token between phases and between files.
 */

export interface CancellationToken {
  readonly isCancelled: boolean
  onCancelled(callback: () => void): void
}

export interface CancellationSource {
  readonly token: CancellationToken
  cancel(): void
}

export function createCancellationSource(): CancellationSource {
  let cancelled = false;
  const listeners: (() => void)[] = [];

  const token: CancellationToken = {
    get isCancelled() { return cancelled; },
    onCancelled(callback) {
      if (cancelled) { callback(); return; }
      listeners.push(callback);
    },
  };

  return {
    token,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (let i = 0; i < listeners.length; i++) {
        listeners[i]!();
      }
      listeners.length = 0;
    },
  };
}
