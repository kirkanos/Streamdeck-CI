import { lastRunStatus, PROVIDER_LABEL, type Repo, type RunStatus, type Summary, type SummaryFilter } from "../ci/model";
import { background, mix, ringSegment, svg, text, toDataUrl, truncate, wrapText } from "./svg";
import { STATUS_COLOR, STATUS_LABEL, THEME } from "./theme";

/** Key images are drawn at 144×144 and scaled by Stream Deck. */
const S = 144;

function statusBackground(status: RunStatus, width: number, height: number): string {
  const color = STATUS_COLOR[status];
  if (status === "failure") {
    return background("bg", mix(color, "#000000", 0.05), mix(color, THEME.base, 0.55), width, height);
  }
  if (status === "success" || status === "running" || status === "pending") {
    return background("bg", mix(color, THEME.base, 0.72), THEME.base, width, height);
  }
  return background("bg", THEME.surface, THEME.base, width, height);
}

/** Row of the most recent runs (oldest left), colored by status; missing runs are dim. */
export function runStrip(statuses: RunStatus[], x: number, y: number, width: number, height: number, count: number): string {
  const gap = Math.max(2, Math.round(width / count / 4));
  const barWidth = (width - gap * (count - 1)) / count;
  const recent = statuses.slice(-count);
  const padded: (RunStatus | undefined)[] = [...Array(count - recent.length).fill(undefined), ...recent];
  return padded
    .map((status, i) => {
      const fill = status ? STATUS_COLOR[status] : THEME.muted;
      const opacity = status ? 1 : 0.6;
      return `<rect x="${(x + i * (barWidth + gap)).toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${height}" rx="${Math.min(2, barWidth / 2).toFixed(1)}" fill="${fill}" fill-opacity="${opacity}"/>`;
    })
    .join("");
}

/** Statuses of the runs for a strip, oldest first. */
export function stripStatuses(repo: Pick<Repo, "runs">): RunStatus[] {
  return [...repo.runs].reverse().map((r) => r.status);
}

export type RepoKey = {
  /** Repo name; omitted when the user shows their own title on the key. */
  name?: string;
  status: RunStatus;
  branch?: string;
  /** Formatted duration of the last run. */
  duration: string;
  /** Small line below the duration, e.g. "#42 · failed". */
  caption?: string;
  /** Statuses of the last runs, oldest first. */
  strip: RunStatus[];
};

// Baselines depending on the number of name lines (0, 1, 2).
const BRANCH_Y = [50, 47, 66];
const VALUE_Y = [84, 88, 98];
const CAPTION_Y = [104, 108, 114];

export function repoKey(k: RepoKey): string {
  const lines = k.name ? wrapText(k.name, 11, 2) : [];
  const nameSize = 19;
  const lineHeight = nameSize + 2;
  const color = STATUS_COLOR[k.status];

  const accent = k.status === "failure" ? "" : `<rect x="0" y="0" width="${S}" height="5" fill="${color}"/>`;
  const names = lines.map((line, i) => text(line, { x: S / 2, y: 28 + i * lineHeight, size: nameSize })).join("");
  const branch =
    k.branch
      ? text(truncate(k.branch, 16), { x: S / 2, y: BRANCH_Y[lines.length], size: 13, weight: 600, opacity: 0.75 })
      : "";

  const valueSize = Math.round((lines.length > 1 ? 26 : 32) * (k.duration.length > 6 ? 0.85 : 1));
  const value = text(k.duration, { x: S / 2, y: VALUE_Y[lines.length], size: valueSize, weight: 800 });
  const caption = k.caption ? text(truncate(k.caption, 18), { x: S / 2, y: CAPTION_Y[lines.length], size: 13, weight: 600, opacity: 0.75 }) : "";

  const strip = runStrip(k.strip, 10, 122, S - 20, 12, 12);
  return toDataUrl(svg(S, S, statusBackground(k.status, S, S) + accent + names + branch + value + caption + strip));
}

/** Header pill and short label of a summary key. */
function summaryLabel(filter: SummaryFilter): string {
  return filter === "all" ? "All CI" : filter === "github" ? "GitHub" : PROVIDER_LABEL[filter];
}

export function summaryKey(filter: SummaryFilter, summary: Summary): string {
  const hasFailed = summary.failed > 0;
  const bg = hasFailed
    ? background("bg", mix(STATUS_COLOR.failure, "#000000", 0.05), mix(STATUS_COLOR.failure, THEME.base, 0.55), S, S)
    : background("bg", THEME.surface, THEME.base, S, S);

  const header =
    `<rect x="8" y="8" width="${S - 16}" height="30" rx="9" fill="${hasFailed ? "#000000" : THEME.accent}" fill-opacity="${hasFailed ? 0.3 : 1}"/>` +
    text(truncate(summaryLabel(filter), 11), { x: S / 2, y: 29, size: 17 });

  // Donut: passed / failed / running / other.
  const cx = S / 2;
  const cy = 92;
  const r = 34;
  const stroke = 11;
  let ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${hasFailed ? "#000000" : THEME.muted}" stroke-opacity="${hasFailed ? 0.25 : 1}" stroke-width="${stroke}"/>`;
  const parts: [number, string][] = [
    [summary.success, STATUS_COLOR.success],
    [summary.failed, hasFailed ? "#FFFFFF" : STATUS_COLOR.failure],
    [summary.running, STATUS_COLOR.running],
    [summary.other, STATUS_COLOR.cancelled],
  ];
  let angle = 0;
  for (const [count, color] of parts) {
    if (count <= 0) {
      continue;
    }
    const sweep = (count / summary.total) * 360;
    ring +=
      sweep >= 359.9
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"/>`
        : `<path d="${ringSegment(cx, cy, r, angle + 1.5, angle + sweep - 1.5)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>`;
    angle += sweep;
  }

  const [number, label] = hasFailed
    ? [summary.failed, "failed"]
    : summary.total === 0
      ? [0, "repos"]
      : summary.running > 0
        ? [summary.running, "running"]
        : [summary.success, summary.success === summary.total ? "all green" : `of ${summary.total}`];

  const center =
    text(String(number), { x: cx, y: cy + 7, size: 28, weight: 800 }) +
    text(label, { x: cx, y: cy + 22, size: 11, weight: 600, opacity: 0.75 });

  return toDataUrl(svg(S, S, bg + header + ring + center));
}

/** One failed or running repo shown on the summary key while cycling through them (index counted from 1). */
export function detailRepoKey(repo: Repo, index: number, count: number): string {
  const run = repo.runs[0];
  const status: RunStatus = lastRunStatus(repo) === "running" ? "running" : "failure";
  const lines = wrapText(repo.name, 11, 2);
  const names = lines.map((line, i) => text(line, { x: S / 2, y: 62 + i * 21, size: 19 })).join("");
  const branch = run?.branch ? text(truncate(run.branch, 16), { x: S / 2, y: 62 + lines.length * 21, size: 13, weight: 600, opacity: 0.75 }) : "";

  return toDataUrl(
    svg(
      S,
      S,
      statusBackground(status, S, S) +
        `<rect x="8" y="8" width="${S - 16}" height="30" rx="9" fill="#000000" fill-opacity="0.3"/>` +
        text(`${index} / ${count} ${STATUS_LABEL[status]}`, { x: S / 2, y: 29, size: 16 }) +
        names +
        branch +
        runStrip(stripStatuses(repo), 10, 122, S - 20, 12, 12),
    ),
  );
}

/** Neutral key with two lines of text, e.g. "Select / a repo" or "Offline". */
export function messageKey(title: string, subtitle: string): string {
  return toDataUrl(
    svg(
      S,
      S,
      background("bg", THEME.surface, THEME.base, S, S) +
        `<rect x="3" y="3" width="${S - 6}" height="${S - 6}" rx="14" fill="none" stroke="${THEME.muted}" stroke-width="2"/>` +
        text(title, { x: S / 2, y: 68, size: 22, weight: 800 }) +
        text(subtitle, { x: S / 2, y: 92, size: 15, weight: 600, fill: THEME.subtle }),
    ),
  );
}

/** Caption under the duration: run number and status. */
export function runCaption(repo: Pick<Repo, "runs">): string {
  const run = repo.runs[0];
  return run ? `#${run.number} · ${STATUS_LABEL[run.status]}` : STATUS_LABEL.unknown;
}
