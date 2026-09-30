# Streamdeck-CI

Stream Deck plugin `com.kirkanos.ci`. Status: M1–M4 done, released 1.0.0.

## Goal

Build and deploy status for all repos in one place. Woodpecker CI deploys the Compose stacks, GitHub Actions builds the tool repos (kuma-glance, winTangle, mcp-http-bridge). Today that means two web UIs.

## Keys & dials

- **Repo** key: color by last run (green success, red failure, yellow running, gray unknown), branch name and duration, a strip of the last runs like the heartbeat strip in Kuma Glance. Press opens the run in the browser, long press restarts it.
- **Summary** key: number of repos whose last run failed, red as soon as one is red. Press opens a folder profile with one key per repo (reuse the tag-folder mechanism from Kuma Glance).
- **Dial**: turn browses repos, push restarts, touch opens the run.

## Data source & API

- One interface `CiProvider { listRepos(), latestRuns(repo), restart(run), subscribe(cb)? }` with two implementations:
  - **Woodpecker**: REST `/api/repos`, `/api/repos/{id}/pipelines?page=1&perPage=10`, restart `POST /api/repos/{id}/pipelines/{number}`; live updates from the SSE stream `/api/stream/events` (token auth via `Authorization: Bearer`).
  - **GitHub Actions**: REST `/repos/{owner}/{repo}/actions/runs?per_page=10`, rerun `POST /repos/{owner}/{repo}/actions/runs/{id}/rerun`; poll every 60 s. Repo list from `/user/repos` filtered to repos that have workflows.
- Merge both lists into one model keyed by `provider/owner/repo`.

## Settings

- Woodpecker base URL and personal token.
- GitHub fine-grained PAT with actions read/write.
- Repo picker as `sdpi-select` fed by a plugin datasource (same pattern as the monitor picker in Kuma Glance).

## Open questions

- Check whether Woodpecker sits behind an SSO reverse proxy; if so the token has to pass the forward-auth middleware or the proxy needs a bypass rule for `/api/`.
- Does the SSE stream work through the reverse proxy without buffering? Otherwise fall back to polling.

## Milestones

- M1: GitHub Actions provider, Repo key, tests for status mapping.
- M2: Woodpecker provider with SSE, restart action.
- M3: Summary key with folder profile, dial.
- M4: CI workflows, release `v1.0.0`.

## Scaffold

Copy the tooling from [Kuma Glance](https://github.com/kirkanos/kuma-glance) (`../Streamdeck-Uptime-Kuma`), not from Termine:

- `@elgato/streamdeck` ^3, `@elgato/cli`, TypeScript, rollup via `scripts/build.mjs` and `createRollupConfig()` from its `rollup.config.mjs`; `tsconfig` extends `@tsconfig/node20`, `moduleResolution: Bundler`, `customConditions: ["node"]`.
- Manifest: SDKVersion 3, Nodejs 24, `Software.MinimumVersion` 7.1, version `0.0.0.0` (the build fills it in).
- Layout: `plugin/` (manifest, `ui/`, `layouts/`, icons), `src/plugin.ts`, `src/actions/`, `src/<service>/`, `src/render/` (reuse `svg.ts` and `theme.ts`).
- Dev variant `<uuid>-dev` via `--dev`, `npm run link:dev`, `npm run watch:dev`.
- Settings pages: static HTML with vendored sdpi-components 4.0.1 in `plugin/ui/`.
- CI: `.github/workflows/ci.yml` (typecheck, vitest, pack, artifact) and `release.yml` (tag `v*`, `PLUGIN_VERSION`, `gh release create`).
- Tests: vitest for model and render code, like `render.test.ts` in Kuma Glance.
- Secrets live in the action settings, never in global settings. Passwords are exchanged for a token once and not stored.
- No license for now.
