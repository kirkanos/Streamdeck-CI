import { describe, expect, it } from "vitest";
import type { Repo, Run } from "../ci/model";
import { dialCanvas, dialMessage } from "./dial";
import { failedRepoKey, messageKey, repoKey, runCaption, runStrip, stripStatuses, summaryKey } from "./keys";
import { escapeXml, mix, wrapText } from "./svg";
import { STATUS_COLOR } from "./theme";

const decode = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");

const run = (over: Partial<Run> = {}): Run => ({
  id: "1",
  number: 42,
  status: "success",
  branch: "main",
  url: "https://ci.example.com/repos/1/pipeline/42",
  createdAt: 0,
  ...over,
});

const repo = (over: Partial<Repo> = {}): Repo => ({
  key: "woodpecker/kirkanos/compose",
  provider: "woodpecker",
  id: "1",
  owner: "kirkanos",
  name: "compose",
  fullName: "kirkanos/compose",
  url: "https://ci.example.com/repos/1",
  runs: [run()],
  ...over,
});

describe("wrapText", () => {
  it("keeps short names on one line", () => {
    expect(wrapText("compose", 11, 2)).toEqual(["compose"]);
  });

  it("breaks after separators", () => {
    expect(wrapText("kuma-glance", 11, 2)).toEqual(["kuma-glance"]);
    expect(wrapText("mcp-http-bridge", 11, 2)).toEqual(["mcp-http-", "bridge"]);
  });

  it("ends overflowing text with an ellipsis", () => {
    expect(wrapText("streamdeck-uptime-kuma-plugin", 11, 2)).toEqual(["streamdeck-", "uptime-…"]);
  });
});

describe("repo key", () => {
  it("is a 144x144 SVG data URL with name, branch, duration and caption", () => {
    const image = repoKey({ name: "compose", status: "success", branch: "main", duration: "4m 12s", caption: "#42 · passed", strip: ["success"] });
    expect(image.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = decode(image);
    expect(svg).toContain('width="144" height="144"');
    expect(svg).toContain(">compose<");
    expect(svg).toContain(">main<");
    expect(svg).toContain(">4m 12s<");
    expect(svg).toContain("#42 · passed");
  });

  it("colors the accent bar by status and drops it for failures", () => {
    expect(decode(repoKey({ status: "running", duration: "12s", strip: [] }))).toContain(`height="5" fill="${STATUS_COLOR.running}"`);
    expect(decode(repoKey({ status: "failure", duration: "12s", strip: [] }))).not.toContain('height="5"');
  });

  it("leaves the name out when the user has a title", () => {
    const svg = decode(repoKey({ status: "success", branch: "main", duration: "1s", strip: [] }));
    expect(svg).not.toContain("compose");
    expect(svg).toContain(">main<");
  });

  it("escapes names and branches", () => {
    expect(escapeXml(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
    const svg = decode(repoKey({ name: "R&D <prod>", status: "success", branch: "feat/<x>", duration: "1s", strip: [] }));
    expect(svg).toContain("R&amp;D");
    expect(svg).not.toContain("<prod>");
    expect(svg).not.toContain("<x>");
  });
});

describe("run strip", () => {
  it("draws one bar per slot, newest on the right, and dims missing runs", () => {
    const strip = runStrip(["failure", "success"], 10, 122, 124, 12, 4);
    const bars = strip.match(/<rect/g) ?? [];
    expect(bars).toHaveLength(4);
    const fills = [...strip.matchAll(/fill="(#[0-9A-F]{6})" fill-opacity="([\d.]+)"/g)].map((m) => [m[1], m[2]]);
    expect(fills[0][1]).toBe("0.6");
    expect(fills[2]).toEqual([STATUS_COLOR.failure, "1"]);
    expect(fills[3]).toEqual([STATUS_COLOR.success, "1"]);
  });

  it("orders the repo runs oldest first", () => {
    const r = repo({ runs: [run({ status: "running" }), run({ status: "failure" }), run({ status: "success" })] });
    expect(stripStatuses(r)).toEqual(["success", "failure", "running"]);
  });

  it("captions with the run number and status", () => {
    expect(runCaption(repo())).toBe("#42 · passed");
    expect(runCaption(repo({ runs: [run({ status: "failure" })] }))).toBe("#42 · failed");
    expect(runCaption(repo({ runs: [] }))).toBe("no runs");
  });
});

describe("summary key", () => {
  it("draws a full green ring and 'all green' when nothing failed", () => {
    const svg = decode(summaryKey("all", { failed: 0, success: 3, running: 0, other: 0, total: 3, failedRepos: [] }));
    expect(svg).toContain("all green");
    expect(svg).toContain(">All CI<");
    expect(svg).not.toContain("<path");
  });

  it("shows the failed count on a red background", () => {
    const svg = decode(summaryKey("github", { failed: 2, success: 1, running: 0, other: 0, total: 3, failedRepos: [] }));
    expect(svg).toContain(">2<");
    expect(svg).toContain(">failed<");
    expect(svg).toContain(">GitHub<");
    expect(svg).toContain(`stop-color="${mix(STATUS_COLOR.failure, "#000000", 0.05)}"`);
    // Failed slice in white on the red background, passed slice in green.
    expect(svg).toContain('stroke="#FFFFFF" stroke-width="11"');
    expect((svg.match(/<path/g) ?? []).length).toBe(2);
  });

  it("shows running pipelines when nothing failed", () => {
    const svg = decode(summaryKey("woodpecker", { failed: 0, success: 1, running: 1, other: 0, total: 2, failedRepos: [] }));
    expect(svg).toContain(">running<");
    expect(svg).toContain(">Woodpecker<");
  });

  it("shows a failed repo with its position while cycling", () => {
    const svg = decode(failedRepoKey(repo({ runs: [run({ status: "failure", branch: "release" })] }), 2, 3));
    expect(svg).toContain("2 / 3 failed");
    expect(svg).toContain(">compose<");
    expect(svg).toContain(">release<");
  });
});

describe("messages and dial", () => {
  it("renders message keys", () => {
    const svg = decode(messageKey("Select", "a repo"));
    expect(svg).toContain(">Select<");
    expect(svg).toContain(">a repo<");
  });

  it("renders the 200x100 dial canvas", () => {
    const svg = decode(dialCanvas({ title: "kuma-glance", status: "failure", branch: "main", duration: "2m 03s", caption: "#7 · failed", strip: ["failure"] }));
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain(">kuma-glance<");
    expect(svg).toContain(">2m 03s<");
    expect(svg).toContain("#7 · failed");
    expect(decode(dialMessage("Turn to select", "3 repos"))).toContain("3 repos");
  });
});
