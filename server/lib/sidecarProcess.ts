// Starts the Python sidecar as a child process when SIDECAR_AUTOSTART=1 (the Docker image).
//
// Keeping the sidecar in the same container means a push to the deployed branch rebuilds and
// restarts both halves together, and there is no separate service URL or credential to manage.
// If it cannot start (for example a developer running plain `npm run dev` without Python), the
// server keeps running and providers fall back to Node fetch / Chrome.
import { spawn, type ChildProcess } from "node:child_process";
import { DEFAULT_SIDECAR_URL, sidecarUrl, waitForSidecar } from "./sidecar";

let child: ChildProcess | null = null;

function sidecarPort(): string {
  try {
    return new URL(DEFAULT_SIDECAR_URL).port || "8877";
  } catch {
    return "8877";
  }
}

// Called when the managed process is gone. Disabling autostart makes isSidecarEnabled() false, so
// the next provider does not wait for a connection that will never come.
function disableManagedSidecar(why: string): void {
  if (process.env.SIDECAR_URL?.trim()) return;
  process.env.SIDECAR_AUTOSTART = "0";
  console.warn(`[SIDECAR] ${why}; providers will use fallbacks`);
}

export async function startManagedSidecar(): Promise<void> {
  if (process.env.SIDECAR_AUTOSTART !== "1") return;
  if (process.env.SIDECAR_URL?.trim()) {
    // An explicitly configured URL wins; don't start a second copy.
    return;
  }

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
