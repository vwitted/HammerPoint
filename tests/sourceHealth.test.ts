// server/lib/sourceHealth.ts, and the problems providers report through it when run against
// real recordings.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectSourceIssues, describeIssue, noteChallengePage, noteFailure, noteResponse, reportSourceIssue } from "../server/lib/sourceHealth.ts";
import { fetchEasyLiveAuctionLots, easyLiveBidCache } from "../server/providers/easyLive.ts";
import { scrapeTheSaleroomLots } from "../server/providers/theSaleroom.ts";
import { loadFixture, startReplay } from "./helpers/replay.ts";

const response = (status: number, headers: Record<string, string> = {}) => new Response("", { status, headers });

describe("sourceHealth", () => {
  it("classifies refused responses as blocked and others as failed", async () => {
    const { issues } = await collectSourceIssues(async () => {
      noteResponse(response(403, { "cf-mitigated": "challenge" }), "search");
      noteResponse(response(429), "search");
      noteResponse(response(403), "search");
      noteResponse(response(500), "search");
      noteResponse(response(200), "search");
    });
    assert.deepEqual(issues.map((i) => [i.kind, i.detail]), [
      ["blocked", "Cloudflare challenge"],
      ["blocked", "rate limited (HTTP 429)"],
      ["blocked", "HTTP 403"],
      ["failed", "HTTP 500"],
    ]);
  });

  it("counts repeats instead of listing them, and summarises them in one line", async () => {
    const { issues } = await collectSourceIssues(async () => {
      for (let i = 0; i < 35; i++) noteResponse(response(403, { "cf-mitigated": "challenge" }), "bid lookups");
      noteFailure(new DOMException("This operation was aborted", "AbortError"), "search");
    });
    assert.equal(issues.length, 2);
    assert.equal(describeIssue(issues[0]), "bid lookups blocked (Cloudflare challenge, 35×)");
    assert.equal(describeIssue(issues[1]), "search timed out");
  });

  it("ignores failures caused by the visitor cancelling the search", async () => {
    const { issues } = await collectSourceIssues(async () => {
      noteFailure(new DOMException("This operation was aborted", "AbortError"), "search", AbortSignal.abort());
    });
    assert.deepEqual(issues, []);
  });

  it("recognises bot check pages in Chrome by their title", async () => {
    const { result, issues } = await collectSourceIssues(async () => [
      await noteChallengePage({ title: async () => "Just a moment..." }, "search page (Chrome)"),
      await noteChallengePage({ title: async () => "Search results | BidSpotter" }, "search page (Chrome)"),
      // AWS WAF CAPTCHA, as BidSpotter served it on 2 Nov 2026.
      await noteChallengePage({ title: async () => "Human Verification" }, "search page (Chrome)"),
    ]);
    assert.deepEqual(result, [true, false, true]);
    assert.equal(describeIssue(issues[0]), 'search page (Chrome) blocked (bot check page ("Just a moment..."))');
  });

  it("keeps each search's problems separate, even when they run at the same time", async () => {
    const [a, b] = await Promise.all([
      collectSourceIssues(async () => { await new Promise((r) => setTimeout(r, 10)); reportSourceIssue("blocked", "a", "x"); }),
      collectSourceIssues(async () => { reportSourceIssue("timeout", "b", "y"); }),
    ]);
    assert.deepEqual(a.issues.map((i) => i.step), ["a"]);
    assert.deepEqual(b.issues.map((i) => i.step), ["b"]);
  });

  it("does nothing outside a search", () => {
    assert.doesNotThrow(() => reportSourceIssue("blocked", "search", "x"));
  });
});

// Runs a provider against recorded responses and collects the problems it reports.
async function runCollecting(requests: ReturnType<typeof loadFixture>, task: () => Promise<any[]>) {
  easyLiveBidCache.clear();
  const replay = startReplay(requests);
  try {
    return await collectSourceIssues(task);
  } finally {
    replay.stop();
  }
}

describe("problems reported by providers", () => {
  it("Easy Live: nothing to report when the HTTP/2 fallback gets the bids", async () => {
    const { result, issues } = await runCollecting(loadFixture("easyLiveBlocked"), () => fetchEasyLiveAuctionLots("lawn mower", 35, 0));
    assert.equal(result.length, 5);
    assert.deepEqual(issues, []);
  });

  it("Easy Live: reports bid lookups failing when HTTP/2 doesn't work either", async () => {
    // The real recording, minus its HTTP/2 responses: the fetch probe is challenged and every
    // HTTP/2 lookup then fails.
    const withoutHttp2 = loadFixture("easyLiveBlocked").filter((r: any) => r.transport !== "http2");
    const { result, issues } = await runCollecting(withoutHttp2, () => fetchEasyLiveAuctionLots("lawn mower", 35, 0));
    assert.equal(result.length, 5, "lots are still returned, without bids");
    assert.ok(result.every((l) => l.currentPrice == null));
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, "failed");
    assert.equal(issues[0].step, "bid lookups");
    assert.equal(issues[0].count, 5);
  });

  it("Easy Live: reports the search failing when its search API can't be reached", async () => {
    const { result, issues } = await runCollecting([], () => fetchEasyLiveAuctionLots("lathe", 35, 0));
    assert.deepEqual(result, []);
    assert.deepEqual(issues.map((i) => [i.kind, i.step]), [["failed", "search"]]);
  });

  it("The Saleroom: a clean search reports nothing", async () => {
    const { issues } = await runCollecting(loadFixture("theSaleroom"), () => scrapeTheSaleroomLots("lathe"));
    assert.deepEqual(issues, []);
  });

  it("The Saleroom: reports Algolia failing when the Chrome fallback finds nothing either", async () => {
    // No recorded responses, and the replay helper points Puppeteer at a missing Chrome.
    const { result, issues } = await runCollecting([], () => scrapeTheSaleroomLots("lathe"));
    assert.deepEqual(result, []);
    assert.deepEqual(issues.map((i) => [i.kind, i.step]), [["failed", "search page (Chrome)"], ["failed", "search"]]);
  });
});

describe("sourceHealth: error text", () => {
  it("keeps only the first line of multi-line errors", async () => {
    const { issues } = await collectSourceIssues(async () => {
      noteFailure(new Error("Failed to launch the browser process:  Code: 127\n\nstderr:\nsh: not found"), "search page (Chrome)");
    });
    assert.equal(issues[0].detail, "Failed to launch the browser process: Code: 127");
  });
});
