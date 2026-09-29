/**
 * Minimal Server-Sent Events parser (https://html.spec.whatwg.org/multipage/server-sent-events.html).
 *
 * Feed it text chunks as they arrive; complete events are returned. Lines
 * split across chunks are buffered, comments (": ping") are ignored.
 */
export type SseEvent = { event: string; data: string; id?: string };

export class SseParser {
  #buffer = "";
  #event = "";
  #data: string[] = [];
  #id: string | undefined;

  feed(chunk: string): SseEvent[] {
    this.#buffer += chunk;
    const events: SseEvent[] = [];

    let newline: number;
    while ((newline = this.#buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.#buffer.slice(0, newline);
      const separator = this.#buffer.startsWith("\r\n", newline) ? 2 : 1;
      this.#buffer = this.#buffer.slice(newline + separator);
      const event = this.#line(line);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  #line(line: string): SseEvent | undefined {
    if (line === "") {
      return this.#dispatch();
    }
    if (line.startsWith(":")) {
      return undefined;
    }
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    switch (field) {
      case "event":
        this.#event = value;
        break;
      case "data":
        this.#data.push(value);
        break;
      case "id":
        if (!value.includes("\0")) {
          this.#id = value;
        }
        break;
      default:
        // "retry" and unknown fields are ignored.
    }
    return undefined;
  }

  #dispatch(): SseEvent | undefined {
    const data = this.#data;
    const event = this.#event || "message";
    this.#event = "";
    this.#data = [];
    if (data.length === 0) {
      return undefined;
    }
    return { event, data: data.join("\n"), id: this.#id };
  }
}

/**
 * Reads an SSE response body until it ends or `signal` aborts, calling
 * `onEvent` for every event. Resolves when the stream ends; rejects on
 * network errors.
 */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void, signal: AbortSignal): Promise<void> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  const abort = () => reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) {
        return;
      }
      for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
        onEvent(event);
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
