// Records why a source returned fewer lots than it might have (blocked, timed out, failed),
// without changing what providers return: they still return [] on failure.
//
// The search route runs each provider inside collectSourceIssues(); providers call the note*
// helpers at their network calls. Outside a collection the helpers do nothing, so providers can
// be called directly (tests, the starter-lots route) unchanged.
import { AsyncLocalStorage } from "node:async_hooks";

export type SourceIssueKind = "blocked" | "timeout" | "failed";

export interface SourceIssue {
  kind: SourceIssueKind;
  // What was being fetched, e.g. "search", "bid lookups", "search page (Chrome)".
  step: string;
  // Short reason, e.g. "Cloudflare challenge", "HTTP 429", "timed out".
  detail: string;
  // How many times this happened during the search (e.g. 12 lot lookups timed out).
  count: number;
}

const current = new AsyncLocalStorage<SourceIssue[]>();

export async function collectSourceIssues<T>(task: () => Promise<T>): Promise<{ result: T; issues: SourceIssue[] }> {
  const issues: SourceIssue[] = [];
  const result = await current.run(issues, task);
  return { result, issues };
}

export function reportSourceIssue(kind: SourceIssueKind, step: string, detail: string): void {
  const issues = current.getStore();
  if (!issues) return;
  const same = issues.find((i) => i.kind === kind && i.step === step && i.detail === detail);
  if (same) same.count++;
  else issues.push({ kind, step, detail, count: 1 });
}

// A response that means the site turned the request away, rather than had nothing to give.
export function blockReason(res: Response): string | null {
  if (res.headers.get("cf-mitigated") === "challenge") return "Cloudflare challenge";
  if (res.status === 429) return "rate limited (HTTP 429)";
  if (res.status === 401 || res.status === 403 || res.status === 503) return `HTTP ${res.status}`;
  return null;
}

// Notes a non-OK response: "blocked" if the site refused, otherwise "failed".
export function noteResponse(res: Response, step: string): void {
  if (res.ok) return;
  const blocked = blockReason(res);
  if (blocked) reportSourceIssue("blocked", step, blocked);
  else reportSourceIssue("failed", step, `HTTP ${res.status}`);
}

// Notes a thrown error. Cancellation (the visitor stopped the search) is not a problem with the
// site, so pass the search's cancel signal to have it ignored.
export function noteFailure(err: unknown, step: string, cancelSignal?: AbortSignal): void {
  if (cancelSignal?.aborted) return;
  const e = err as { name?: string; message?: string } | null;
  const message = String(e?.message ?? err ?? "unknown error");
  if (e?.name === "AbortError" || e?.name === "TimeoutError" || /timed? ?out|timeout/i.test(message)) {
    reportSourceIssue("timeout", step, "timed out");
  } else {
    // First line only, whitespace collapsed: some errors (e.g. Chrome failing to launch) run to
    // many lines, and this goes into one-line logs and status text.
    reportSourceIssue("failed", step, message.split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 120));
  }
}

// Page titles of the bot-check pages Chrome lands on instead of the real page.
// ("Human Verification" is AWS WAF's CAPTCHA page, seen on BidSpotter.)
const CHALLENGE_TITLE = /just a moment|attention required|access denied|human verification|verify(ing)? you are human|security check|pardon our interruption/i;

// Notes a page title that is a bot check rather than the site. Returns true if it is.
// Shared by the Chrome and the Camoufox sidecar paths.
export function noteChallengeTitle(title: string, step: string): boolean {
  if (!CHALLENGE_TITLE.test(title)) return false;
  reportSourceIssue("blocked", step, `bot check page ("${title.slice(0, 60)}")`);
  return true;
}

// Notes a Chrome page that is a bot check rather than the site. Returns true if it is.
export async function noteChallengePage(page: { title(): Promise<string> }, step: string): Promise<boolean> {
  return noteChallengeTitle(await page.title().catch(() => ""), step);
}

// One-line summary for logs and the status chip, e.g. "bid lookups blocked (Cloudflare challenge, 35×)".
export function describeIssue(issue: SourceIssue): string {
  const what = issue.kind === "timeout" ? "timed out" : issue.kind;
  const detail = issue.kind === "timeout" ? "" : issue.detail;
  const parts = [detail, issue.count > 1 ? `${issue.count}×` : ""].filter(Boolean).join(", ");
  return `${issue.step} ${what}${parts ? ` (${parts})` : ""}`;
}
