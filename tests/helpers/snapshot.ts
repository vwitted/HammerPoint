// Minimal JSON snapshot assertions. Snapshots live in tests/__snapshots__/<name>.json.
// When output changes on purpose, review the diff and run `npm run test:update-snapshots`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../__snapshots__/", import.meta.url);

export function assertMatchesSnapshot(name: string, value: unknown) {
  const file = new URL(`${name}.json`, dir);
  const actual = JSON.parse(JSON.stringify(value));

  if (process.env.UPDATE_SNAPSHOTS === "1") {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
    return;
  }
  if (!existsSync(file)) {
    assert.fail(`Missing snapshot ${name}.json. Run \`npm run test:update-snapshots\` to create it, then review it.`);
  }
  assert.deepStrictEqual(actual, JSON.parse(readFileSync(file, "utf8")), `Output differs from snapshot ${name}.json`);
}
