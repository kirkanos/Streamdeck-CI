/** Data model shared by both CI providers. */

export type ProviderId = "woodpecker" | "github";

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  woodpecker: "Woodpecker",
  github: "GitHub Actions",
};

/** Normalized outcome of a pipeline / workflow run. */
export type RunStatus = "success" | "failure" | "running" | "pending" | "cancelled" | "skipped" | "unknown";

export type Run = {
  /** Provider specific run id (Woodpecker pipeline number, GitHub run id). */
  id: string;
  /** Number shown to the user (#42). */
  number: number;
  status: RunStatus;
  branch: string;
  /** Commit message or workflow title. */
  title?: string;
  /** Run page in the provider's web UI. */
  url: string;
  /** Unix milliseconds. */
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
};

export type RepoInfo = {
  /** `provider/owner/name`, unique across providers. */
  key: string;
  provider: ProviderId;
  /** Provider specific repo id (Woodpecker repo id, GitHub full name). */
  id: string;
  owner: string;
  name: string;
  fullName: string;
  /** Repo page in the provider's web UI. */
  url: string;
};

export type Repo = RepoInfo & {
  /** Most recent runs, newest first. */
  runs: Run[];
};

export const MAX_RUNS = 12;

export function repoKey(provider: ProviderId, owner: string, name: string): string {
  return `${provider}/${owner}/${name}`;
}

/** Status of the most recent run; "unknown" without runs. */
export function lastRunStatus(repo: Pick<Repo, "runs">): RunStatus {
  return repo.runs[0]?.status ?? "unknown";
}

export const byName = (a: RepoInfo, b: RepoInfo) => a.fullName.localeCompare(b.fullName) || a.provider.localeCompare(b.provider);

/**
 * Duration of a run in milliseconds: finished − started, or elapsed time for
 * a run that is still going (relative to `now`). Undefined before the run started.
 */
export function runDuration(run: Run | undefined, now = Date.now()): number | undefined {
  if (!run?.startedAt) {
    return undefined;
  }
  const end = run.finishedAt ?? (run.status === "running" ? now : undefined);
  if (end === undefined || end < run.startedAt) {
    return undefined;
  }
  return end - run.startedAt;
}

/** "42s", "4m 12s", "1h 05m", "2d 3h"; "–" for unknown durations. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "–";
  }
  const totalSeconds = Math.round(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (totalHours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (totalMinutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export type SummaryFilter = ProviderId | "all";

export type Summary = {
  failed: number;
  success: number;
  running: number;
  /** Pending, cancelled, skipped, unknown. */
  other: number;
  total: number;
  /** Repos whose last run failed, sorted by name. */
  failedRepos: Repo[];
  /** Repos whose last run is still running, sorted by name. */
  runningRepos: Repo[];
};

/** Repos worth a look on the summary key: failed ones first, then running ones. */
export function attentionRepos(summary: Summary): Repo[] {
  return [...summary.failedRepos, ...summary.runningRepos];
}

/** Counts repos by the status of their most recent run. */
export function summarize(repos: Repo[], filter: SummaryFilter = "all"): Summary {
  const summary: Summary = { failed: 0, success: 0, running: 0, other: 0, total: 0, failedRepos: [], runningRepos: [] };
  for (const repo of [...repos].sort(byName)) {
    if (filter !== "all" && repo.provider !== filter) {
      continue;
    }
    summary.total++;
    switch (lastRunStatus(repo)) {
      case "failure":
        summary.failed++;
        summary.failedRepos.push(repo);
        break;
      case "success":
        summary.success++;
        break;
      case "running":
        summary.running++;
        summary.runningRepos.push(repo);
        break;
      default:
        summary.other++;
    }
  }
  return summary;
}
