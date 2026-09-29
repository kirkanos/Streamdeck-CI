import streamDeck from "@elgato/streamdeck";
import { DialRepoAction } from "./actions/dial";
import { RepoAction } from "./actions/repo";
import { SummaryAction } from "./actions/summary";
import { PROVIDER_LABEL, type ProviderId } from "./ci/model";
import { ci, type CiSettings } from "./ci/service";

type JsonValue = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

streamDeck.logger.setLevel("info");

const repo = new RepoAction();
const dial = new DialRepoAction();
const summary = new SummaryAction();

streamDeck.actions.registerAction(repo);
streamDeck.actions.registerAction(dial);
streamDeck.actions.registerAction(summary);

// Keep every visible key and dial in sync with the CI providers.

ci.on("repo", (key) => {
  void repo.refresh(key);
  void dial.refresh(key);
  void summary.refresh();
});

function refreshAll(): void {
  void repo.refresh();
  void dial.refresh();
  void summary.refresh();
}

ci.on("repos", () => {
  refreshAll();
  // Property inspectors with a hot-reloading repo list pick this up.
  sendToPropertyInspector({ event: "getRepos", items: repoItems() });
});

ci.on("state", () => {
  for (const id of ["woodpecker", "github"] as const) {
    const status = ci.status(id);
    if (status.state !== "unconfigured") {
      streamDeck.logger.info(`${id}: ${status.state}${status.error ? ` (${status.error})` : ""}`);
    }
  }
  refreshAll();
  sendToPropertyInspector(statusMessage());
});

// Messages from the property inspectors (ui/*.html).

type UiMessage = { event: "getRepos" | "getStatus" } | { event: "configure"; settings: CiSettings };

streamDeck.ui.onSendToPlugin<UiMessage>(async (ev) => {
  const message = ev.payload;
  switch (message.event) {
    case "getRepos":
      sendToPropertyInspector({ event: "getRepos", items: repoItems() });
      break;
    case "getStatus":
      sendToPropertyInspector(statusMessage());
      break;
    case "configure":
      await saveSettings(message.settings);
      break;
  }
});

/** Repo picker entries, grouped by provider. */
function repoItems(): JsonValue {
  const groups: { label: string; children: { label: string; value: string }[] }[] = [];
  for (const id of ["woodpecker", "github"] as ProviderId[]) {
    const children = ci
      .repos()
      .filter((r) => r.provider === id)
      .map((r) => ({ label: r.fullName, value: r.key }));
    if (children.length > 0) {
      groups.push({ label: PROVIDER_LABEL[id], children });
    }
  }
  return groups;
}

function statusMessage(): JsonValue {
  const settings = ci.settings;
  return {
    event: "status",
    configured: ci.isConfigured,
    woodpecker: { ...ci.status("woodpecker"), url: settings.woodpeckerUrl ?? "", token: settings.woodpeckerToken ?? "" },
    github: { ...ci.status("github"), token: settings.githubToken ?? "" },
  };
}

function sendToPropertyInspector(payload: JsonValue): void {
  if (streamDeck.ui.action) {
    streamDeck.ui.sendToPropertyInspector(payload).catch(() => undefined);
  }
}

async function saveSettings(settings: CiSettings): Promise<void> {
  const clean: CiSettings = {
    woodpeckerUrl: settings.woodpeckerUrl?.trim().replace(/\/+$/, "") || undefined,
    woodpeckerToken: settings.woodpeckerToken?.trim() || undefined,
    githubToken: settings.githubToken?.trim() || undefined,
  };
  await streamDeck.settings.setGlobalSettings(clean);
  ci.configure(clean);
  sendToPropertyInspector(statusMessage());
}

streamDeck.settings.onDidReceiveGlobalSettings<CiSettings>((ev) => ci.configure(ev.settings));

await streamDeck.connect();
ci.configure(await streamDeck.settings.getGlobalSettings<CiSettings>());
