import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sourceChip } from "../src/utils/sourceStatus.ts";

describe("sourceChip", () => {
  it("shows a count for a clean search, including one that found nothing", () => {
    assert.deepEqual(sourceChip({ name: "BPI", status: "completed", count: 12 }), { tone: "ok", icon: "✓", label: "BPI (12)" });
    assert.deepEqual(sourceChip({ name: "BPI", status: "completed", count: 0, issues: [] }), { tone: "ok", icon: "✓", label: "BPI (0)" });
  });

  it("warns when there were results but something was blocked", () => {
    const chip = sourceChip({ name: "Easy Live", status: "completed", count: 35, issues: [{ kind: "blocked", summary: "bid lookups blocked (Cloudflare challenge, 35×)" }] });
    assert.deepEqual(chip, { tone: "warning", icon: "⚠", label: "Easy Live (35)" });
  });

  it("says why there are no results instead of showing 0, worst problem first", () => {
    assert.equal(sourceChip({ name: "BidSpotter", status: "completed", count: 0, issues: [{ kind: "timeout", summary: "x" }, { kind: "blocked", summary: "y" }] }).label, "BidSpotter: blocked");
    assert.equal(sourceChip({ name: "HiBid", status: "completed", count: 0, issues: [{ kind: "timeout", summary: "x" }] }).label, "HiBid: timed out");
    assert.equal(sourceChip({ name: "HiBid", status: "completed", count: 0, issues: [{ kind: "timeout", summary: "x" }] }).tone, "problem");
  });

  it("handles searching and server errors", () => {
    assert.equal(sourceChip({ name: "BPI", status: "searching" }).tone, "searching");
    assert.deepEqual(sourceChip({ name: "BPI", status: "error" }), { tone: "problem", icon: "✕", label: "BPI: failed" });
  });
});
