// Starts the Python sidecar as a child process when SIDECAR_AUTOSTART=1. Both supported hosts do:
// the Docker image sets it in the environment, and server/lib/renderEnv.ts sets it on Render's
// native Node runtime (where scripts/install-sidecar.mjs installed the Python packages).
//
// Keeping the sidecar in the same service means a push rebuilds and restarts both halves together,
// and there is no separate service URL or credential to manage. If it cannot start (for example a
// developer running plain `npm run dev` without Python), the server keeps running and providers
// fall back to Node fetch / Chrome.
import { spawn, type ChildProcess } from "node:child_process";
import { DEFAULT_SIDECAR_URL, sidecarUrl, waitForSidecar } from "./sidecar";

let child: ChildProcess | null = null;

// Exposed through GET /api/health so a deployment can be checked without the platform's logs.
const managedStatus: { started: boolean; ready: boolean; error: string | null } = {
  started: false,
  ready: false,
  error: null,
};

export function getManagedSidecarStatus() {
  return { ...managedStatus, autostart: process.env.SIDECAR_AUTOSTART === "1" };
}

function disableManagedSidecar(why: string): void {
  if (process.env.SIDECAR_URL?.trim()) return;
  process.env.SIDECAR_AUTOSTART = "0";
  managedStatus.ready = false;
  managedStatus.error = why;
  console.warn(`[SIDECAR] ${why}; providers will use fallbacks`);
}

function sidecarPort(): string {
  try {
    return new URL(DEFAULT_SIDECAR_URL).port || "8877";
  } catch {
    return "8877";
  }
}

export async function startManagedSidecar(): Promise<void> {
  if (process.env.SIDECAR_AUTOSTART !== "1") return;
  if (process.env.SIDECAR_URL?.trim()) {
    // An explicitly configured URL wins; don't start a second copy.
    return;
  }
  managedStatus.started = true;

  const python = process.env.SIDECAR_PYTHON || "/app/.venv/bin/python";
  const port = sidecarPort();
  const args = ["-m", "uvicorn", "sidecar.main:app", "--host", "127.0.0.1", "--port", port, "--workers", "1"];

  console.log(`[SIDECAR] starting ${python} ${args.join(" ")}`);
  let processHandle: ChildProcess;
  try {
    processHandle = spawn(python, args, {
      cwd: process.cwd(),
      // inherit rather than pipe: the sidecar's logs belong in the platform log, and some sandboxes
      // refuse piped child stdio.
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
  } catch (err: any) {
    disableManagedSidecar(`could not start (${err?.message ?? err})`);
    return;
  }
  child = processHandle;

  const exited = new Promise<boolean>((resolve) => {
    processHandle.once("error", (err) => {
      console.warn(`[SIDECAR] failed to start: ${err.message}`);
      child = null;
      managedStatus.error = err.message;
      resolve(false);
    });
    processHandle.once("exit", (code, signal) => {
      console.warn(`[SIDECAR] exited (code=${code ?? "null"}, signal=${signal ?? "none"})`);
      child = null;
      disableManagedSidecar("exited");
      resolve(false);
    });
  });

  const ready = await Promise.race([waitForSidecar(30_000), exited]);
  if (ready) {
    managedStatus.ready = true;
    managedStatus.error = null;
    console.log(`[SIDECAR] ready at ${sidecarUrl()}`);
  } else {
    disableManagedSidecar("not available");
  }
}

// Called on SIGTERM/SIGINT so a container stop doesn't leave Firefox running.
export function stopManagedSidecar(): void {
  if (!child) return;
  const current = child;
  child = null;
  try {
    current.kill("SIGTERM");
  } catch {
    // already gone
  }
}
