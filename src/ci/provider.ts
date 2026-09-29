import type { ProviderId, RepoInfo, Run } from "./model";

export type ProviderState = "unconfigured" | "connecting" | "connected" | "error";

/**
 * A CI backend. Providers are stateless HTTP clients; the CiService owns the
 * repo list, the polling and the live subscription.
 */
export interface CiProvider {
  readonly id: ProviderId;
  /** Repos that run pipelines, sorted by name. */
  listRepos(): Promise<RepoInfo[]>;
  /** Most recent runs of a repo, newest first. */
  latestRuns(repo: RepoInfo, limit: number): Promise<Run[]>;
  /** Restarts / reruns a run. */
  restart(repo: RepoInfo, run: Run): Promise<void>;
  /**
   * Optional live updates. Resolves when the connection ends (the service
   * reconnects); `onChange` is called with the key of the changed repo.
   */
  subscribe?(onChange: (repoKey: string) => void, signal: AbortSignal): Promise<void>;
}

/** Error with the HTTP status, so that 401/403 can be reported as a token problem. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  const response = await fetch(url, { ...rest, signal: rest.signal ?? AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new HttpError(response.status, `${response.status} ${response.statusText} for ${new URL(url).pathname}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Short user-facing text for a failed request. */
export function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) {
      return "Check the token";
    }
    if (err.status === 404) {
      return "Not found (check the URL)";
    }
    return err.message;
  }
  const message = (err as Error)?.message ?? String(err);
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  return cause?.code ? `${message} (${cause.code})` : message;
}
