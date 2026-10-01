# CI Glance

Your [Woodpecker CI](https://woodpecker-ci.org) pipelines and [GitHub Actions](https://github.com/features/actions) workflows at a glance on your Elgato Stream Deck.

Unofficial plugin, not affiliated with the Woodpecker CI project or GitHub.

## Features

* **Repo** key for one repo:
  * The status of the last run as background color: 🟩 passed, 🟥 failed, 🟨 running, 🟦 pending, ⬛ cancelled / skipped / no runs.
  * The repo name (left out if you set your own title on the key), the branch and the duration of the last run (elapsed time while it is running).
  * A strip with the most recent runs.
  * Pressing the key opens the run in the browser, holding it restarts the run.
* **Summary** key: how many repos have a failed last run, with a ring of passed / failed / running repos. The key turns red as soon as one repo has failed. Pressing it cycles through the failed repos and then the running ones (red or amber, with branch and run strip); holding it opens the shown run. Optionally limited to one provider.
  * Pressing it cycles through the failed repos on the key (name, branch, recent runs); holding it opens the shown run in the browser. After a few seconds the key returns to the summary.
* **Dial Repo** (Stream Deck + / + XL): turn the dial to browse the repos, push to restart the last run, tap the touch strip to open it. The touch strip shows name, branch, duration and the recent runs.
* Both providers side by side in one repo picker:
  * **Woodpecker CI**: live updates over the Woodpecker event stream (`/api/stream/events`), plus a poll every minute as a safety net.
  * **GitHub Actions**: every repo of your account that has a workflow, polled every minute.

## Installation

Download the [latest release](https://github.com/kirkanos/Streamdeck-CI/releases/latest) and open `com.kirkanos.ci.streamDeckPlugin`. Requires Stream Deck 7.1 or newer.

Then add a key, open its settings and enter the Woodpecker URL and token and/or a GitHub token (see below). Save the connection and pick a repo.

### Prerequisites for Woodpecker behind a reverse proxy

The plugin talks to the Woodpecker API with an `Authorization: Bearer` header and keeps one long-lived request to `/api/stream/events` open.

* If Woodpecker sits behind a forward-auth middleware (e.g. Authelia), `/api/` must be reachable with the Woodpecker token, i.e. the middleware needs a bypass rule for `/api/` (Woodpecker checks the token itself).
* The reverse proxy must not buffer the event stream (Traefik does not by default; for nginx set `proxy_buffering off` for `/api/stream/`). If the stream does not work, the plugin still updates every minute through polling.

## Settings

All keys and dials share one connection, stored in the plugin's global settings on this computer. Leave a provider empty to disable it. The tokens are only sent to the Woodpecker server you enter and to `api.github.com`.

### Woodpecker CI

* **URL**: the address of your Woodpecker server, e.g. `https://ci.example.com`.
* **Token**: your personal access token. In Woodpecker, click your avatar (top right) → *User settings* → *General* and copy the *Personal Access Token*. Woodpecker tokens have no scopes; the token has the same rights as your user. Restarting a pipeline requires push access to the repo.

The plugin lists the active repos of your user (`/api/user/repos`).

### GitHub Actions

* **Token**: a fine-grained personal access token. On GitHub open *Settings* → *Developer settings* → *Personal access tokens* → *Fine-grained tokens* → *Generate new token*:
  * **Repository access**: *Only select repositories* and pick the repos you want on the Stream Deck (or *All repositories*).
  * **Repository permissions**: *Actions* → **Read and write** (Read is enough if you never restart a run from the Stream Deck). *Metadata* → Read-only is added automatically.
  * Choose an expiration; the plugin reports *Check the token* when it has expired.

The plugin lists the repos the token can see that have at least one workflow.

## Development

CI Glance is a Node.js plugin built with the official [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/) (`@elgato/streamdeck`, TypeScript, rollup). The settings pages use [sdpi-components](https://sdpi-components.dev). Both providers are plain `fetch` clients; the Woodpecker event stream is parsed by a small SSE parser.

| Path | Content |
| --- | --- |
| `src/actions/` | One class per Stream Deck action (repo key, summary key, dial) |
| `src/ci/` | The `CiProvider` interface, the Woodpecker and GitHub providers, the SSE parser and the service holding the repo state |
| `src/render/` | SVG images for keys and touch strips |
| `plugin/` | Static plugin files: manifest, icons, settings pages (`ui/`), dial layout |
| `assets/` | Plugin icon source (rendered to PNG by the build) |
| `scripts/` | Build script |

```sh
npm install
npm test               # unit tests
npm run typecheck

# Development: a parallel-installable copy "CI Glance (dev)"
npm run link:dev       # build + link into Stream Deck (once)
npm run watch:dev      # rebuild and restart the plugin on every change

npm run validate       # build + streamdeck validate
npm run pack           # Release/com.kirkanos.ci.streamDeckPlugin
```

Linking and restarting need the Stream Deck developer mode (`npx streamdeck dev`, then restart the Stream Deck app once). Plugin logs are written to `dist/<plugin id>.sdPlugin/logs/`.

GitHub Actions builds and tests every push (`.github/workflows/ci.yml`) and publishes a release with the packed plugin for tags like `v1.0.0` (`.github/workflows/release.yml`).

The plugin package includes `THIRD_PARTY_NOTICES.txt` with the licenses of the bundled libraries.

## Troubleshooting

* **Keys show "Set up":** open the settings of any key and enter the Woodpecker URL and token and/or a GitHub token.
* **Keys show "Offline / check settings":** the settings page shows the error per provider. *Check the token* means the token was rejected (401/403); *Not found* usually means a wrong Woodpecker URL.
* **Woodpecker updates only every minute:** the event stream is blocked by a proxy (see the prerequisites above); polling still works.
* Anything else: [open an issue](https://github.com/kirkanos/Streamdeck-CI/issues).
