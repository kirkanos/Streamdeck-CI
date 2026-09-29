import { EventEmitter } from "node:events";
import { GitHubProvider } from "./github";
import { byName, lastRunStatus, MAX_RUNS, type ProviderId, type Repo, type RepoInfo } from "./model";
import { type CiProvider, describeError, type ProviderState } from "./provider";
import { WoodpeckerProvider } from "./woodpecker";

export type CiSettings = {
  woodpeckerUrl?: string;
  woodpeckerToken?: string;
  githubToken?: string;
};

export type ProviderStatus = { state: ProviderState; error?: string; repoCount: number };

/** Runs are polled this often; Woodpecker additionally pushes changes over SSE. */
export const POLL_MS = 60_000;
/** The repo lists are reloaded this often (new repos, removed repos). */
export const REPOS_MS = 15 * 60_000;
/** Elapsed time of running pipelines is redrawn this often. */
export const TICK_MS = 10_000;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

type Runtime = {
  provider: CiProvider;
  state: ProviderState;
  error?: string;
  repos: RepoInfo[];
  reposLoadedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  abort: AbortController;
  retryMs: number;
  /** Repo keys whose runs should be reloaded on the next SSE-triggered refresh. */
  dirty: Set<string>;
  dirtyTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Keeps the live state of all repos of the configured providers.
 *
 * Events:
 *   "repo" (key)  the runs of one repo changed
 *   "repos"       the repo list changed
 *   "state"       a provider's connection state changed
 */
export class CiService extends EventEmitter<{ repo: [string]; repos: []; state: [] }> {
  #settings: CiSettings = {};
  readonly #runtimes = new Map<ProviderId, Runtime>();
  readonly #repos = new Map<string, Repo>();
  #ticker: ReturnType<typeof setInterval> | undefined;

  get settings(): CiSettings {
    return this.#settings;
  }

  /** True once at least one provider has a token. */
  get isConfigured(): boolean {
    return this.#runtimes.size > 0;
  }

  status(provider: ProviderId): ProviderStatus {
    const runtime = this.#runtimes.get(provider);
    if (!runtime) {
      return { state: "unconfigured", repoCount: 0 };
    }
    return { state: runtime.state, error: runtime.error, repoCount: runtime.repos.length };
  }

  repo(key: string | undefined): Repo | undefined {
    return key === undefined ? undefined : this.#repos.get(key);
  }

  /** All repos of all providers, sorted by name. */
  repos(): Repo[] {
    return [...this.#repos.values()].sort(byName);
  }

  /** Applies new settings; providers whose settings changed are restarted. */
  configure(settings: CiSettings): void {
    const next: CiSettings = {
      woodpeckerUrl: settings.woodpeckerUrl?.trim().replace(/\/+$/, "") || undefined,
      woodpeckerToken: settings.woodpeckerToken?.trim() || undefined,
      githubToken: settings.githubToken?.trim() || undefined,
    };
    const previous = this.#settings;
    this.#settings = next;

    if (next.woodpeckerUrl !== previous.woodpeckerUrl || next.woodpeckerToken !== previous.woodpeckerToken || !this.#runtimes.has("woodpecker")) {
      this.#stop("woodpecker");
      if (next.woodpeckerUrl && next.woodpeckerToken) {
        this.#start(new WoodpeckerProvider(next.woodpeckerUrl, next.woodpeckerToken));
      }
    }
    if (next.githubToken !== previous.githubToken || !this.#runtimes.has("github")) {
      this.#stop("github");
      if (next.githubToken) {
        this.#start(new GitHubProvider(next.githubToken));
      }
    }
    this.emit("state");
    this.emit("repos");
    this.#ticker ??= setInterval(() => this.#tick(), TICK_MS);
  }

  /** Reloads the runs of one repo now (after a restart or an SSE event). */
  async refreshRepo(key: string): Promise<void> {
    const repo = this.#repos.get(key);
    const runtime = repo && this.#runtimes.get(repo.provider);
    if (!repo || !runtime) {
      return;
    }
    try {
      repo.runs = await runtime.provider.latestRuns(repo, MAX_RUNS);
      this.#setState(runtime, "connected");
      this.emit("repo", key);
    } catch (err) {
      this.#setState(runtime, "error", describeError(err));
    }
  }

  /** Restarts the most recent run of a repo; false if that is not possible. */
  async restart(key: string | undefined): Promise<boolean> {
    const repo = this.repo(key);
    const runtime = repo && this.#runtimes.get(repo.provider);
    const run = repo?.runs[0];
    if (!repo || !runtime || !run) {
      return false;
    }
    try {
      await runtime.provider.restart(repo, run);
      // Show the change right away; the provider confirms it with the next update.
      setTimeout(() => void this.refreshRepo(repo.key), 1_500);
      return true;
    } catch {
      return false;
    }
  }

  #start(provider: CiProvider): void {
    const runtime: Runtime = {
      provider,
      state: "connecting",
      repos: [],
      reposLoadedAt: 0,
      abort: new AbortController(),
      retryMs: RETRY_MIN_MS,
      dirty: new Set(),
    };
    this.#runtimes.set(provider.id, runtime);
    void this.#poll(runtime);
    if (provider.subscribe) {
      void this.#subscribe(runtime);
    }
  }

  #stop(id: ProviderId): void {
    const runtime = this.#runtimes.get(id);
    if (!runtime) {
      return;
    }
    runtime.abort.abort();
    clearTimeout(runtime.timer);
    clearTimeout(runtime.dirtyTimer);
    this.#runtimes.delete(id);
    for (const [key, repo] of this.#repos) {
      if (repo.provider === id) {
        this.#repos.delete(key);
      }
    }
  }

  /** Loads the repo list (when stale) and the runs of every repo, then schedules the next poll. */
  async #poll(runtime: Runtime): Promise<void> {
    if (runtime.abort.signal.aborted) {
      return;
    }
    try {
      if (Date.now() - runtime.reposLoadedAt > REPOS_MS) {
        runtime.repos = (await runtime.provider.listRepos()).sort(byName);
        runtime.reposLoadedAt = Date.now();
        this.#mergeRepos(runtime);
      }
      await Promise.all(
        runtime.repos.map(async (info) => {
          const repo = this.#repos.get(info.key);
          if (!repo) {
            return;
          }
          const runs = await runtime.provider.latestRuns(repo, MAX_RUNS);
          if (!runtime.abort.signal.aborted) {
            repo.runs = runs;
            this.emit("repo", repo.key);
          }
        }),
      );
      if (runtime.abort.signal.aborted) {
        return;
      }
      runtime.retryMs = RETRY_MIN_MS;
      this.#setState(runtime, "connected");
      runtime.timer = setTimeout(() => void this.#poll(runtime), POLL_MS);
    } catch (err) {
      if (runtime.abort.signal.aborted) {
        return;
      }
      this.#setState(runtime, "error", describeError(err));
      runtime.timer = setTimeout(() => void this.#poll(runtime), runtime.retryMs);
      runtime.retryMs = Math.min(runtime.retryMs * 2, RETRY_MAX_MS);
    }
  }

  /** Keeps the SSE subscription alive; changed repos are reloaded shortly after the event. */
  async #subscribe(runtime: Runtime): Promise<void> {
    const signal = runtime.abort.signal;
    let backoff = RETRY_MIN_MS;
    while (!signal.aborted) {
      try {
        await runtime.provider.subscribe?.((key) => {
          runtime.dirty.add(key);
          runtime.dirtyTimer ??= setTimeout(() => {
            runtime.dirtyTimer = undefined;
            const keys = [...runtime.dirty];
            runtime.dirty.clear();
            for (const dirty of keys) {
              void this.refreshRepo(dirty);
            }
          }, 500);
        }, signal);
        backoff = RETRY_MIN_MS;
      } catch {
        // Reported by the poll; the stream is retried with backoff.
        backoff = Math.min(backoff * 2, RETRY_MAX_MS);
      }
      if (!signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  /** Adds new repos of a provider and removes the ones that disappeared. */
  #mergeRepos(runtime: Runtime): void {
    const present = new Set(runtime.repos.map((r) => r.key));
    let changed = false;
    for (const [key, repo] of this.#repos) {
      if (repo.provider === runtime.provider.id && !present.has(key)) {
        this.#repos.delete(key);
        changed = true;
      }
    }
    for (const info of runtime.repos) {
      const existing = this.#repos.get(info.key);
      if (existing) {
        Object.assign(existing, info);
      } else {
        this.#repos.set(info.key, { ...info, runs: [] });
        changed = true;
      }
    }
    if (changed) {
      this.emit("repos");
    }
  }

  /** Redraws repos with a running pipeline so the elapsed time keeps moving. */
  #tick(): void {
    for (const repo of this.#repos.values()) {
      if (lastRunStatus(repo) === "running") {
        this.emit("repo", repo.key);
      }
    }
  }

  #setState(runtime: Runtime, state: ProviderState, error?: string): void {
    if (runtime.state === state && runtime.error === error) {
      return;
    }
    runtime.state = state;
    runtime.error = error;
    this.emit("state");
  }
}

export const ci = new CiService();
