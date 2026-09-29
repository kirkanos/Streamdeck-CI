import { describe, expect, it } from "vitest";
import { readSse, SseParser } from "./sse";

describe("SseParser", () => {
  it("parses a data-only event", () => {
    const parser = new SseParser();
    expect(parser.feed('data: {"a":1}\n\n')).toEqual([{ event: "message", data: '{"a":1}', id: undefined }]);
  });

  it("joins multiple data lines and keeps the event name and id", () => {
    const parser = new SseParser();
    expect(parser.feed("event: pipeline\nid: 7\ndata: first\ndata: second\n\n")).toEqual([{ event: "pipeline", data: "first\nsecond", id: "7" }]);
  });

  it("buffers lines split across chunks", () => {
    const parser = new SseParser();
    expect(parser.feed('data: {"repo":')).toEqual([]);
    expect(parser.feed('{"owner":"k"}}\n')).toEqual([]);
    expect(parser.feed("\n")).toEqual([{ event: "message", data: '{"repo":{"owner":"k"}}', id: undefined }]);
  });

  it("ignores comments and empty events", () => {
    const parser = new SseParser();
    expect(parser.feed(": ping\n\n")).toEqual([]);
    expect(parser.feed("event: nothing\n\n")).toEqual([]);
    expect(parser.feed("retry: 1000\ndata: x\n\n")).toEqual([{ event: "message", data: "x", id: undefined }]);
  });

  it("accepts CRLF line endings and values without a leading space", () => {
    const parser = new SseParser();
    expect(parser.feed("data:x\r\n\r\ndata: y\r\r")).toEqual([
      { event: "message", data: "x", id: undefined },
      { event: "message", data: "y", id: undefined },
    ]);
  });

  it("resets the event name after dispatch", () => {
    const parser = new SseParser();
    parser.feed("event: a\ndata: 1\n\n");
    expect(parser.feed("data: 2\n\n")[0].event).toBe("message");
  });
});

describe("readSse", () => {
  it("reads a stream to its end", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": ping\n\ndata: one\n\nda"));
        controller.enqueue(encoder.encode("ta: two\n\n"));
        controller.close();
      },
    });
    const seen: string[] = [];
    await readSse(body, (e) => seen.push(e.data), new AbortController().signal);
    expect(seen).toEqual(["one", "two"]);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined); // never delivers more data
      },
    });
    const done = readSse(body, () => undefined, controller.signal);
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  });
});
