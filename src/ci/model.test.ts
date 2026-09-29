import { describe, expect, it } from "vitest";
import { formatDuration, lastRunStatus, type Repo, repoKey, type Run, runDuration, summarize } from "./model";

const run = (over: Partial<Run> = {}): Run => ({
  id: "1",
  number: 1,
  status: "success",
  branch: "main",
  url: "https://ci.example.com/repos/1/pipeline/1",
  createdAt: 1_000_000,
  startedAt: 1_000_000,
  finishedAt: 1_252_000,
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

describe("formatDuration", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_900_000)).toBe("1h 05m");
    expect(formatDuration(97_200_000)).toBe("1d 3h");
  });

  it("rounds to whole seconds", () => {
    expect(formatDuration(1_499)).toBe("1s");
    expect(formatDuration(59_600)).toBe("1m 00s");
  });

  it("shows a dash for unknown durations", () => {
    expect(formatDuration(undefined)).toBe("–");
    expect(formatDuration(-5)).toBe("–");
    expect(formatDuration(Number.NaN)).toBe("–");
  });
});

describe("runDuration", () => {
  it("uses finished - started for completed runs", () => {
    expect(runDuration(run())).toBe(252_000);
  });

  it("uses the elapsed time for running pipelines", () => {
    expect(runDuration(run({ status: "running", finishedAt: undefined }), 1_030_000)).toBe(30_000);
  });

  it("is unknown before the run started or for pending runs", () => {
    expect(runDuration(run({ startedAt: undefined }))).toBeUndefined();
    expect(runDuration(run({ status: "pending", finishedAt: undefined }))).toBeUndefined();
    expect(runDuration(undefined)).toBeUndefined();
  });
});

describe("summarize", () => {
  const repos = [
    repo({ key: "woodpecker/kirkanos/a", name: "a", fullName: "kirkanos/a" }),
    repo({ key: "woodpecker/kirkanos/b", name: "b", fullName: "kirkanos/b", runs: [run({ status: "failure" })] }),
    repo({ key: "github/kirkanos/c", provider: "github", name: "c", fullName: "kirkanos/c", runs: [run({ status: "running" }), run({ status: "failure" })] }),
    repo({ key: "github/kirkanos/d", provider: "github", name: "d", fullName: "kirkanos/d", runs: [] }),
    repo({ key: "github/kirkanos/e", provider: "github", name: "e", fullName: "kirkanos/e", runs: [run({ status: "failure" })] }),
  ];

  it("counts repos by their most recent run", () => {
    const summary = summarize(repos);
    expect(summary).toMatchObject({ failed: 2, success: 1, running: 1, other: 1, total: 5 });
    expect(summary.failedRepos.map((r) => r.name)).toEqual(["b", "e"]);
  });

  it("filters by provider", () => {
    expect(summarize(repos, "github")).toMatchObject({ failed: 1, success: 0, running: 1, other: 1, total: 3 });
    expect(summarize(repos, "woodpecker")).toMatchObject({ failed: 1, success: 1, total: 2 });
  });

  it("is empty without repos", () => {
    expect(summarize([])).toEqual({ failed: 0, success: 0, running: 0, other: 0, total: 0, failedRepos: [] });
  });
});

describe("repo keys", () => {
  it("are unique across providers", () => {
    expect(repoKey("github", "kirkanos", "kuma-glance")).toBe("github/kirkanos/kuma-glance");
    expect(repoKey("woodpecker", "kirkanos", "kuma-glance")).not.toBe(repoKey("github", "kirkanos", "kuma-glance"));
  });

  it("report unknown without runs", () => {
    expect(lastRunStatus(repo({ runs: [] }))).toBe("unknown");
    expect(lastRunStatus(repo())).toBe("success");
  });
});
