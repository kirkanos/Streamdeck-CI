import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { summarize, type SummaryFilter } from "../ci/model";
import { ci } from "../ci/service";
import { PLUGIN_ID } from "../config";
import { LongPress } from "../press";
import { failedRepoKey, messageKey, summaryKey } from "../render/keys";
import { showImage, updates } from "../throttle";
import { runUrl } from "./repo";

export type SummarySettings = { provider?: SummaryFilter };

/** How long a failed repo stays on the key after a press before the summary returns. */
export const DETAIL_MS = 8_000;

type Detail = { index: number; timer: ReturnType<typeof setTimeout> };

/**
 * Number of repos whose last run failed; pressing the key cycles through the
 * failed repos, holding it opens the shown run in the browser.
 */
@action({ UUID: `${PLUGIN_ID}.summary` })
export class SummaryAction extends SingletonAction<SummarySettings> {
  readonly #settings = new Map<string, SummarySettings>();
  readonly #details = new Map<string, Detail>();
  readonly #press = new LongPress();

  override onWillAppear(ev: WillAppearEvent<SummarySettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<SummarySettings>): void {
    this.#settings.delete(ev.action.id);
    this.#clearDetail(ev.action.id);
    this.#press.cancel(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SummarySettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.#clearDetail(ev.action.id);
    return this.#render(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<SummarySettings>): void {
    this.#press.down(ev.action.id, async () => {
      const detail = this.#details.get(ev.action.id);
      const failed = summarize(ci.repos(), ev.payload.settings.provider).failedRepos;
      const repo = detail ? failed[detail.index] : undefined;
      if (repo) {
        await streamDeck.system.openUrl(runUrl(repo));
      } else {
        await ev.action.showAlert();
      }
    });
  }

  override async onKeyUp(ev: KeyUpEvent<SummarySettings>): Promise<void> {
    if (!this.#press.up(ev.action.id)) {
      return;
    }
    const id = ev.action.id;
    const failed = summarize(ci.repos(), ev.payload.settings.provider).failedRepos;
    const previous = this.#details.get(id);
    this.#clearDetail(id);
    if (failed.length === 0) {
      await this.#render(id);
      return;
    }
    const index = previous ? (previous.index + 1) % failed.length : 0;
    this.#details.set(id, {
      index,
      timer: setTimeout(() => {
        this.#details.delete(id);
        void this.#render(id);
      }, DETAIL_MS),
    });
    await this.#render(id);
  }

  /** Re-renders every summary key. */
  async refresh(): Promise<void> {
    for (const id of this.#settings.keys()) {
      await this.#render(id);
    }
  }

  #clearDetail(id: string): void {
    const detail = this.#details.get(id);
    if (detail) {
      clearTimeout(detail.timer);
      this.#details.delete(id);
    }
  }

  async #render(actionId: string): Promise<void> {
    const key = this.actions.find((a) => a.id === actionId);
    const filter = this.#settings.get(actionId)?.provider ?? "all";
    if (!key?.isKey()) {
      return;
    }

    if (!ci.isConfigured) {
      showImage(key, messageKey("Set up", "see settings"));
      return;
    }
    const summary = summarize(ci.repos(), filter);
    const detail = this.#details.get(actionId);
    const shown = detail ? summary.failedRepos[detail.index] : undefined;
    if (detail && shown) {
      showImage(key, failedRepoKey(shown, detail.index + 1, summary.failedRepos.length));
      return;
    }
    if (summary.total === 0) {
      const states = (filter === "all" ? (["woodpecker", "github"] as const) : [filter]).map((p) => ci.status(p).state);
      if (states.every((s) => s === "unconfigured")) {
        showImage(key, messageKey("Set up", filter === "github" ? "GitHub token" : "Woodpecker"));
        return;
      }
      if (!states.includes("connected")) {
        showImage(key, messageKey("Offline", states.includes("error") ? "check settings" : "connecting…"));
        return;
      }
    }
    showImage(key, summaryKey(filter, summary));
  }
}
