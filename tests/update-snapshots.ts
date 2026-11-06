// Entry point for `npm run test:update-snapshots`. Setting the variable here (rather than with
// POSIX "VAR=1 command" syntax) makes the script work on Windows too.
process.env.UPDATE_SNAPSHOTS = "1";

await import("./providers.test.ts");
await import("./atg.test.ts");
