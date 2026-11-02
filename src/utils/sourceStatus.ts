// How each source's search status is shown (the chips under the search box).

export type SourceIssueKind = "blocked" | "timeout" | "failed";

export interface SourceIssueSummary {
  kind: SourceIssueKind;
  // e.g. "bid lookups blocked (Cloudflare challenge, 35×)"
  summary: string;
}

export interface SourceStreamStatus {
  name: string;
  status: "searching" | "completed" | "error";
  count?: number;
  issues?: SourceIssueSummary[];
}

export type ChipTone = "ok" | "searching" | "warning" | "problem";

const KIND_LABEL: Record<SourceIssueKind, string> = { blocked: "blocked", timeout: "timed out", failed: "failed" };
const KIND_PRIORITY: SourceIssueKind[] = ["blocked", "timeout", "failed"];

// ok: results, no problems. warning: results, but something was blocked or timed out (some lots
// may be missing or lack bids). problem: no results because of a problem, which is different
// from a clean search that found nothing.
export function sourceChip(source: SourceStreamStatus): { tone: ChipTone; icon: string; label: string } {
  if (source.status === "searching") return { tone: "searching", icon: "⏳", label: source.name };
  if (source.status === "error") return { tone: "problem", icon: "✕", label: `${source.name}: failed` };

  const count = source.count ?? 0;
  const issues = source.issues ?? [];
  if (issues.length === 0) return { tone: "ok", icon: "✓", label: `${source.name} (${count})` };
  if (count > 0) return { tone: "warning", icon: "⚠", label: `${source.name} (${count})` };

  const worst = KIND_PRIORITY.find((kind) => issues.some((i) => i.kind === kind)) ?? "failed";
  return { tone: "problem", icon: "✕", label: `${source.name}: ${KIND_LABEL[worst]}` };
}
