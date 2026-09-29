import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type TitleParametersDidChangeEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { formatDuration, lastRunStatus, type Repo, runDuration } from "../ci/model";
import { ci } from "../ci/service";
import { PLUGIN_ID } from "../config";
import { LongPress } from "../press";
import { messageKey, repoKey, runCaption, stripStatuses } from "../render/keys";
import { showImage, updates } from "../throttle";

export type RepoSettings = { repoKey?: string };

/** Image for keys that cannot show a repo (not configured, offline, nothing selected). */
export function unavailableImage(key: string | undefined): string | undefined {
  if (!ci.isConfigured) {
    return messageKey("Set up", "see settings");
  }
  if (!key) {
    return messageKey("Select", "a repo");
  }
  const repo = ci.repo(key);
  if (repo) {
    return undefined;
  }
  const provider = key.split("/")[0] as "woodpecker" | "github";
  const status = ci.status(provider);
  if (status.state === "unconfigured") {
    return messageKey("Set up", provider === "github" ? "GitHub token" : "Woodpecker");
  }
  if (status.state !== "connected") {
    return messageKey("Offline", status.state === "error" ? "check settings" : "connecting…");
  }
  return messageKey("Unknown", "repo");
}

/** URL opened for a repo: its latest run, or the repo page without runs. */
export function runUrl(repo: Repo): string {
  return repo.runs[0]?.url ?? repo.url;
}

/** A key showing one repo; pressing it opens the last run, holding it restarts the run. */
@action({ UUID: `${PLUGIN_ID}.repo` })
export class RepoAction extends SingletonAction<RepoSettings> {
  readonly #settings = new Map<string, RepoSettings>();
  /** Keys with a user-defined title: the name is not drawn into the image then. */
  readonly #hasTitle = new Map<string, boolean>();
  readonly #press = new LongPress();

  override onWillAppear(ev: WillAppearEvent<RepoSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<RepoSettings>): void {
    this.#settings.delete(ev.action.id);
    this.#hasTitle.delete(ev.action.id);
    this.#press.cancel(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<RepoSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<RepoSettings>): Promise<void> {
    this.#hasTitle.set(ev.action.id, ev.payload.title.trim() !== "");
    return this.#render(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<RepoSettings>): void {
    this.#press.down(ev.action.id, async () => {
      const ok = await ci.restart(ev.payload.settings.repoKey);
      await (ok ? ev.action.showOk() : ev.action.showAlert());
    });
  }

  override async onKeyUp(ev: KeyUpEvent<RepoSettings>): Promise<void> {
    if (!this.#press.up(ev.action.id)) {
      return;
    }
    const repo = ci.repo(ev.payload.settings.repoKey);
    if (repo) {
      await streamDeck.system.openUrl(runUrl(repo));
    } else {
      await ev.action.showAlert();
    }
  }

  /** Re-renders all visible keys, or only those showing `repoKey`. */
  async refresh(repoKey?: string): Promise<void> {
    for (const [id, settings] of this.#settings) {
      if (repoKey === undefined || settings.repoKey === repoKey) {
        await this.#render(id);
      }
    }
  }

  async #render(actionId: string): Promise<void> {
    const key = this.actions.find((a) => a.id === actionId) as KeyAction<RepoSettings> | undefined;
    const settings = this.#settings.get(actionId);
    if (!key || !settings) {
      return;
    }

    const unavailable = unavailableImage(settings.repoKey);
    const repo = ci.repo(settings.repoKey);
    if (unavailable || !repo) {
      showImage(key, unavailable);
      return;
    }

    const run = repo.runs[0];
    showImage(
      key,
      repoKey({
        name: this.#hasTitle.get(actionId) ? undefined : repo.name,
        status: lastRunStatus(repo),
        branch: run?.branch,
        duration: formatDuration(runDuration(run)),
        caption: runCaption(repo),
        strip: stripStatuses(repo),
      }),
    );
  }
}
