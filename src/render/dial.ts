import type { RunStatus } from "../ci/model";
import { runStrip } from "./keys";
import { background, mix, svg, text, toDataUrl, truncate } from "./svg";
import { STATUS_COLOR, THEME } from "./theme";

/** Touch strip segment of one dial (Stream Deck + / + XL). */
const W = 200;
const H = 100;

export type DialCanvas = {
  title: string;
  status: RunStatus;
  branch?: string;
  duration: string;
  caption?: string;
  strip: RunStatus[];
};

export function dialCanvas(d: DialCanvas): string {
  const color = STATUS_COLOR[d.status];
  const bg =
    d.status === "failure"
      ? background("bg", mix(color, "#000000", 0.05), mix(color, THEME.base, 0.55), W, H)
      : background("bg", mix(color, THEME.base, 0.8), THEME.base, W, H);

  const dot = `<circle cx="16" cy="19" r="5" fill="${d.status === "failure" ? "#FFFFFF" : color}"/>`;
  const title = text(truncate(d.title, 18), { x: 28, y: 25, size: 17, anchor: "start" });
  const branch = d.branch ? text(truncate(d.branch, 15), { x: 12, y: 44, size: 12, weight: 600, opacity: 0.75, anchor: "start" }) : "";
  // The value must end before the run strip (x = 122): shrink long values.
  const value = text(d.duration, {
    x: 12,
    y: 72,
    size: Math.min(28, Math.floor(104 / (d.duration.length * 0.62))),
    weight: 800,
    anchor: "start",
  });
  const caption = d.caption ? text(truncate(d.caption, 16), { x: 12, y: 91, size: 12, weight: 600, opacity: 0.7, anchor: "start" }) : "";
  const strip = runStrip(d.strip, 122, 50, 66, 18, 8);

  return toDataUrl(svg(W, H, bg + dot + title + branch + value + caption + strip));
}

export function dialMessage(title: string, subtitle: string): string {
  return toDataUrl(
    svg(
      W,
      H,
      background("bg", THEME.surface, THEME.base, W, H) +
        text(title, { x: 12, y: 44, size: 20, weight: 800, anchor: "start" }) +
        text(subtitle, { x: 12, y: 70, size: 14, weight: 600, fill: THEME.subtle, anchor: "start" }),
    ),
  );
}
