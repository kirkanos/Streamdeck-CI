import streamDeck, {
  action,
  type DialAction,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { formatDuration, lastRunStatus, runDuration } from "../ci/model";
import { ci } from "../ci/service";
import { PLUGIN_ID } from "../config";
import { dialCanvas, dialMessage } from "../render/dial";
import { runCaption, stripStatuses } from "../render/keys";
import { updates } from "../throttle";
import type { RepoSettings } from "./repo";
import { runUrl } from "./repo";

/** A dial browsing through all repos; push restarts the last run, tap opens it. */
@action({ UUID: `${PLUGIN_ID}.dial` })
export class DialRepoAction extends SingletonAction<RepoSettings> {
  readonly #settings = new Map<string, RepoSettings>();

  override onWillAppear(ev: WillAppearEvent<RepoSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<RepoSettings>): void {
    this.#settings.delete(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<RepoSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override async onDialRotate(ev: DialRotateEvent<RepoSettings>): Promise<void> {
    const repos = ci.repos();
    if (repos.length === 0) {
      return;
    }
    const settings = { ...ev.payload.settings };
    const current = repos.findIndex((r) => r.key === settings.repoKey);
    const next = (((current < 0 ? 0 : current + Math.sign(ev.payload.ticks)) % repos.length) + repos.length) % repos.length;
    settings.repoKey = repos[next].key;
    this.#settings.set(ev.action.id, settings);
    await ev.action.setSettings(settings);
    await this.#render(ev.action.id);
  }

  override async onDialDown(ev: DialDownEvent<RepoSettings>): Promise<void> {
    if (!(await ci.restart(ev.payload.settings.repoKey))) {
      await ev.action.showAlert();
    }
  }

  override async onTouchTap(ev: TouchTapEvent<RepoSettings>): Promise<void> {
    const repo = ci.repo(ev.payload.settings.repoKey);
    if (repo) {
      await streamDeck.system.openUrl(runUrl(repo));
    } else {
      await ev.action.showAlert();
    }
  }

  async refresh(repoKey?: string): Promise<void> {
    for (const [id, settings] of this.#settings) {
      if (repoKey === undefined || settings.repoKey === repoKey) {
        await this.#render(id);
      }
    }
  }

  async #render(actionId: string): Promise<void> {
    const dial = this.actions.find((a) => a.id === actionId) as DialAction<RepoSettings> | undefined;
    const settings = this.#settings.get(actionId);
    if (!dial?.isDial() || !settings) {
      return;
    }

    const repo = ci.repo(settings.repoKey);
    let canvas: string;
    if (!ci.isConfigured) {
      canvas = dialMessage("Set up", "open the dial settings");
    } else if (!repo) {
      const repos = ci.repos();
      const errors = (["woodpecker", "github"] as const).map((p) => ci.status(p)).filter((s) => s.state === "error");
      canvas =
        repos.length === 0 && errors.length > 0
          ? dialMessage("Offline", errors[0].error ?? "check settings")
          : dialMessage("Turn to select", `${repos.length} repos`);
    } else {
      const run = repo.runs[0];
      canvas = dialCanvas({
        title: repo.name,
        status: lastRunStatus(repo),
        branch: run?.branch,
        duration: formatDuration(runDuration(run)),
        caption: runCaption(repo),
        strip: stripStatuses(repo),
      });
    }
    updates.update(dial.id, canvas, (value) => dial.setFeedback({ canvas: value }));
  }
}
