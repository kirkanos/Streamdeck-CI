import { describe, expect, it } from "vitest";
import { githubStatus, toGitHubRepo, toGitHubRun } from "./github";
import { parseEventRepoKey, toWoodpeckerRepo, toWoodpeckerRun, woodpeckerStatus } from "./woodpecker";

describe("woodpeckerStatus", () => {
  it("maps pipeline statuses", () => {
    expect(woodpeckerStatus("success")).toBe("success");
    expect(woodpeckerStatus("failure")).toBe("failure");
    expect(woodpeckerStatus("error")).toBe("failure");
    expect(woodpeckerStatus("running")).toBe("running");
    expect(woodpeckerStatus("started")).toBe("running");
    expect(woodpeckerStatus("pending")).toBe("pending");
    expect(woodpeckerStatus("blocked")).toBe("pending");
    expect(woodpeckerStatus("killed")).toBe("cancelled");
    expect(woodpeckerStatus("declined")).toBe("cancelled");
    expect(woodpeckerStatus("skipped")).toBe("skipped");
    expect(woodpeckerStatus("something-new")).toBe("unknown");
    expect(woodpeckerStatus(undefined)).toBe("unknown");
  });
});

describe("woodpecker mapping", () => {
  const repo = toWoodpeckerRepo("https://ci.example.com", { id: 7, owner: "kirkanos", name: "compose", full_name: "kirkanos/compose" });

  it("builds the repo with its web URL", () => {
    expect(repo).toEqual({
      key: "woodpecker/kirkanos/compose",
      provider: "woodpecker",
      id: "7",
      owner: "kirkanos",
      name: "compose",
      fullName: "kirkanos/compose",
      url: "https://ci.example.com/repos/7",
    });
  });

  it("converts unix second timestamps and takes the first message line", () => {
    const run = toWoodpeckerRun("https://ci.example.com", repo, {
      id: 99,
      number: 42,
      status: "failure",
      branch: "main",
      message: "fix: deploy\n\nlonger body",
      created: 1_700_000_000,
      started: 1_700_000_010,
      finished: 1_700_000_070,
    });
    expect(run).toMatchObject({
      id: "42",
      number: 42,
      status: "failure",
      branch: "main",
      title: "fix: deploy",
      url: "https://ci.example.com/repos/7/pipeline/42",
      createdAt: 1_700_000_000_000,
      startedAt: 1_700_000_010_000,
      finishedAt: 1_700_000_070_000,
    });
  });

  it("accepts the *_at timestamps of Woodpecker 1.x and treats 0 as not set", () => {
    const run = toWoodpeckerRun("https://ci.example.com", repo, { id: 1, number: 1, status: "pending", created_at: 1_700_000_000, started_at: 0, finished_at: 0 });
    expect(run.createdAt).toBe(1_700_000_000_000);
    expect(run.startedAt).toBeUndefined();
    expect(run.finishedAt).toBeUndefined();
  });

  it("extracts the repo key from stream events", () => {
    expect(parseEventRepoKey(JSON.stringify({ repo: { owner: "kirkanos", name: "compose" }, pipeline: { number: 3 } }))).toBe("woodpecker/kirkanos/compose");
    expect(parseEventRepoKey(JSON.stringify({ repo: { full_name: "kirkanos/compose" } }))).toBe("woodpecker/kirkanos/compose");
    expect(parseEventRepoKey("{}")).toBeUndefined();
    expect(parseEventRepoKey("not json")).toBeUndefined();
  });
});

describe("githubStatus", () => {
  it("maps completed runs by conclusion", () => {
    expect(githubStatus("completed", "success")).toBe("success");
    expect(githubStatus("completed", "failure")).toBe("failure");
    expect(githubStatus("completed", "timed_out")).toBe("failure");
    expect(githubStatus("completed", "startup_failure")).toBe("failure");
    expect(githubStatus("completed", "cancelled")).toBe("cancelled");
    expect(githubStatus("completed", "skipped")).toBe("skipped");
    expect(githubStatus("completed", "neutral")).toBe("skipped");
    expect(githubStatus("completed", "action_required")).toBe("pending");
    expect(githubStatus("completed", "stale")).toBe("unknown");
    expect(githubStatus("completed", null)).toBe("unknown");
  });

  it("maps unfinished runs by status", () => {
    expect(githubStatus("in_progress", null)).toBe("running");
    expect(githubStatus("queued", null)).toBe("pending");
    expect(githubStatus("waiting", null)).toBe("pending");
    expect(githubStatus("requested", null)).toBe("pending");
    expect(githubStatus("pending", null)).toBe("pending");
    expect(githubStatus(null, null)).toBe("unknown");
  });
});

describe("github mapping", () => {
  it("builds the repo key from the owner login", () => {
    expect(toGitHubRepo({ name: "kuma-glance", full_name: "kirkanos/kuma-glance", html_url: "https://github.com/kirkanos/kuma-glance", owner: { login: "kirkanos" } })).toEqual({
      key: "github/kirkanos/kuma-glance",
      provider: "github",
      id: "kirkanos/kuma-glance",
      owner: "kirkanos",
      name: "kuma-glance",
      fullName: "kirkanos/kuma-glance",
      url: "https://github.com/kirkanos/kuma-glance",
    });
  });

  it("parses ISO timestamps and only sets finishedAt for finished runs", () => {
    const base = {
      id: 123456,
      run_number: 17,
      name: "CI",
      display_title: "Bump deps",
      head_branch: "main",
      html_url: "https://github.com/kirkanos/kuma-glance/actions/runs/123456",
      created_at: "2026-09-29T10:00:00Z",
      run_started_at: "2026-09-29T10:00:05Z",
      updated_at: "2026-09-29T10:03:05Z",
    };
    const done = toGitHubRun({ ...base, status: "completed", conclusion: "success" });
    expect(done).toMatchObject({ id: "123456", number: 17, status: "success", branch: "main", title: "Bump deps" });
    expect(done.startedAt).toBe(Date.parse("2026-09-29T10:00:05Z"));
    expect(done.finishedAt).toBe(Date.parse("2026-09-29T10:03:05Z"));

    const running = toGitHubRun({ ...base, status: "in_progress", conclusion: null });
    expect(running.status).toBe("running");
    expect(running.finishedAt).toBeUndefined();
  });
});
