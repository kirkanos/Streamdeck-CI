import type { RunStatus } from "../ci/model";

/** Colors shared by all key and dial images. */
export const THEME = {
  base: "#0B1220",
  surface: "#1E293B",
  muted: "#334155",
  subtle: "#94A3B8",
  empty: "#070B14",
  accent: "#6366F1",
};

export const STATUS_COLOR: Record<RunStatus, string> = {
  success: "#22C55E",
  failure: "#EF4444",
  running: "#F59E0B",
  pending: "#3B82F6",
  cancelled: "#64748B",
  skipped: "#64748B",
  unknown: "#475569",
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  success: "passed",
  failure: "failed",
  running: "running",
  pending: "pending",
  cancelled: "cancelled",
  skipped: "skipped",
  unknown: "no runs",
};
