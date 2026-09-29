import { MAX_RUNS, type RepoInfo, repoKey, type Run, type RunStatus } from "./model";
import { type CiProvider, fetchJson } from "./provider";
import { readSse } from "./sse";

export type WoodpeckerRepo = {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  forge_url?: string;
  active?: boolean;
};

/** Pipeline as returned by Woodpecker 2.x/3.x; 1.x used `*_at` timestamps. */
export type WoodpeckerPipeline = {
  id: number;
  number: number;
  status: string;
  branch?: string;
  message?: string;
  event?: string;
  created?: number;
  started?: number;
  finished?: number;
  created_at?: number;
  started_at?: number;
  finished_at?: number;
};

/** Maps a Woodpecker pipeline status to the shared status. */
export function woodpeckerStatus(status: string | undefined): RunStatus {
  switch (status) {
    case "success":
      return "success";
    case "failure":
    case "error":
      return "failure";
    case "running":
    case "started":
      return "running";
    case "pending":
    case "blocked":
    case "created":
      return "pending";
    case "killed":
    case "declined":
      return "cancelled";
    case "skipped":
      return "skipped";
    default:
      return "unknown";
  }
}

const seconds = (value: number | undefined): number | undefined => (value ? value * 1000 : undefined);

export function toWoodpeckerRun(baseUrl: string, repo: RepoInfo, p: WoodpeckerPipeline): Run {
  return {
    id: String(p.number),
    number: p.number,
    status: woodpeckerStatus(p.status),
    branch: p.branch ?? "",
    title: p.message?.split("\n")[0],
    url: `${baseUrl}/repos/${repo.id}/pipeline/${p.number}`,
    createdAt: seconds(p.created ?? p.created_at) ?? 0,
    startedAt: seconds(p.started ?? p.started_at),
    finishedAt: seconds(p.finished ?? p.finished_at),
  };
}

export function toWoodpeckerRepo(baseUrl: string, r: WoodpeckerRepo): RepoInfo {
  return {
    key: repoKey("woodpecker", r.owner, r.name),
    provider: "woodpecker",
    id: String(r.id),
    owner: r.owner,
    name: r.name,
    fullName: r.full_name || `${r.owner}/${r.name}`,
    url: `${baseUrl}/repos/${r.id}`,
  };
}

/** Woodpecker CI: REST API plus the `/api/stream/events` SSE stream. */
export class WoodpeckerProvider implements CiProvider {
  readonly id = "woodpecker" as const;
  readonly #url: string;
  readonly #token: string;

  constructor(url: string, token: string) {
    this.#url = url.replace(/\/+$/, "");
    this.#token = token;
  }

  get #headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.#token}`, Accept: "application/json" };
  }

  async listRepos(): Promise<RepoInfo[]> {
    const repos = await fetchJson<WoodpeckerRepo[]>(`${this.#url}/api/user/repos`, { headers: this.#headers });
    return repos.filter((r) => r.active !== false).map((r) => toWoodpeckerRepo(this.#url, r));
  }

  async latestRuns(repo: RepoInfo, limit = MAX_RUNS): Promise<Run[]> {
    const pipelines = await fetchJson<WoodpeckerPipeline[]>(`${this.#url}/api/repos/${repo.id}/pipelines?page=1&perPage=${limit}`, {
      headers: this.#headers,
    });
    return pipelines.map((p) => toWoodpeckerRun(this.#url, repo, p)).sort((a, b) => b.number - a.number);
  }

  async restart(repo: RepoInfo, run: Run): Promise<void> {
    await fetchJson(`${this.#url}/api/repos/${repo.id}/pipelines/${run.number}`, { method: "POST", headers: this.#headers });
  }

  async subscribe(onChange: (repoKey: string) => void, signal: AbortSignal): Promise<void> {
    const response = await fetch(`${this.#url}/api/stream/events`, {
      headers: { Authorization: `Bearer ${this.#token}`, Accept: "text/event-stream" },
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`${response.status} ${response.statusText} for /api/stream/events`);
    }
    await readSse(
      response.body,
      (event) => {
        const key = parseEventRepoKey(event.data);
        if (key) {
          onChange(key);
        }
      },
      signal,
    );
  }
}

/** Repo key of a stream event (`{"repo": {...}, "pipeline": {...}}`); undefined for anything else. */
export function parseEventRepoKey(data: string): string | undefined {
  try {
    const parsed = JSON.parse(data) as { repo?: Partial<WoodpeckerRepo> };
    const repo = parsed?.repo;
    if (repo?.owner && repo?.name) {
      return repoKey("woodpecker", repo.owner, repo.name);
    }
    if (repo?.full_name?.includes("/")) {
      const [owner, ...rest] = repo.full_name.split("/");
      return repoKey("woodpecker", owner, rest.join("/"));
    }
  } catch {
    // Not JSON (e.g. a ping), ignore.
  }
  return undefined;
}
