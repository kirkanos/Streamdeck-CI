import { MAX_RUNS, type RepoInfo, repoKey, type Run, type RunStatus } from "./model";
import { type CiProvider, fetchJson } from "./provider";

const API = "https://api.github.com";

export type GitHubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  owner: { login: string };
  archived?: boolean;
};

export type GitHubRun = {
  id: number;
  run_number: number;
  name?: string;
  display_title?: string;
  head_branch?: string | null;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  run_started_at?: string;
  updated_at?: string;
};

/** Maps a workflow run's status + conclusion to the shared status. */
export function githubStatus(status: string | null | undefined, conclusion: string | null | undefined): RunStatus {
  if (status === "completed") {
    switch (conclusion) {
      case "success":
        return "success";
      case "failure":
      case "timed_out":
      case "startup_failure":
        return "failure";
      case "cancelled":
        return "cancelled";
      case "skipped":
      case "neutral":
        return "skipped";
      case "action_required":
        return "pending";
      default:
        return "unknown";
    }
  }
  switch (status) {
    case "in_progress":
      return "running";
    case "queued":
    case "waiting":
    case "requested":
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

const iso = (value: string | undefined | null): number | undefined => {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
};

export function toGitHubRun(r: GitHubRun): Run {
  const status = githubStatus(r.status, r.conclusion);
  const done = status !== "running" && status !== "pending";
  return {
    id: String(r.id),
    number: r.run_number,
    status,
    branch: r.head_branch ?? "",
    title: r.display_title ?? r.name,
    url: r.html_url,
    createdAt: iso(r.created_at) ?? 0,
    startedAt: iso(r.run_started_at),
    // The API has no finished_at; updated_at is the last change of a completed run.
    finishedAt: done ? iso(r.updated_at) : undefined,
  };
}

export function toGitHubRepo(r: GitHubRepo): RepoInfo {
  return {
    key: repoKey("github", r.owner.login, r.name),
    provider: "github",
    id: r.full_name,
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    url: r.html_url,
  };
}

/** GitHub Actions: REST API with a fine-grained personal access token, polled by the service. */
export class GitHubProvider implements CiProvider {
  readonly id = "github" as const;
  readonly #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  get #headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.#token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "streamdeck-ci",
    };
  }

  /** Repos of the token's user that have at least one workflow. */
  async listRepos(): Promise<RepoInfo[]> {
    const repos: GitHubRepo[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await fetchJson<GitHubRepo[]>(`${API}/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner`, {
        headers: this.#headers,
      });
      repos.push(...batch);
      if (batch.length < 100) {
        break;
      }
    }
    const withWorkflows = await Promise.all(
      repos
        .filter((r) => !r.archived)
        .map(async (r) => {
          const workflows = await fetchJson<{ total_count: number }>(`${API}/repos/${r.full_name}/actions/workflows?per_page=1`, {
            headers: this.#headers,
          }).catch(() => ({ total_count: 0 }));
          return workflows.total_count > 0 ? toGitHubRepo(r) : undefined;
        }),
    );
    return withWorkflows.filter((r): r is RepoInfo => r !== undefined);
  }

  async latestRuns(repo: RepoInfo, limit = MAX_RUNS): Promise<Run[]> {
    const result = await fetchJson<{ workflow_runs: GitHubRun[] }>(`${API}/repos/${repo.id}/actions/runs?per_page=${limit}`, {
      headers: this.#headers,
    });
    return result.workflow_runs.map(toGitHubRun).sort((a, b) => b.createdAt - a.createdAt);
  }

  async restart(repo: RepoInfo, run: Run): Promise<void> {
    await fetchJson(`${API}/repos/${repo.id}/actions/runs/${run.id}/rerun`, { method: "POST", headers: this.#headers });
  }
}
