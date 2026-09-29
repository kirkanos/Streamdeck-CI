/** Milliseconds a key must be held to count as a long press. */
export const LONG_PRESS_MS = 600;

/**
 * Tells short presses from long presses per key. `down()` starts the timer
 * and runs `onLong` when it fires; `up()` returns true when the key was
 * released before that (a short press).
 */
export class LongPress {
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly holdMs = LONG_PRESS_MS) {}

  down(id: string, onLong: () => void): void {
    this.cancel(id);
    this.#timers.set(
      id,
      setTimeout(() => {
        this.#timers.delete(id);
        onLong();
      }, this.holdMs),
    );
  }

  up(id: string): boolean {
    const timer = this.#timers.get(id);
    if (timer === undefined) {
      return false;
    }
    clearTimeout(timer);
    this.#timers.delete(id);
    return true;
  }

  cancel(id: string): void {
    const timer = this.#timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
  }
}
