// Render's native Node runtime ignores the Dockerfile, so install the Python sidecar here too.
// This runs only on Render (or when SIDECAR_INSTALL=1), never in a normal local `npm install`.
//
// curl_cffi is the important part and has no system dependencies. The two browser downloads are
// best-effort: if the build environment lacks disk, time or libraries, the Node providers fall
// back to whatever browser is available (and the sidecar still serves /fetch).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

if (process.env.SIDECAR_DOCKER === "1") {
  // The Dockerfile installs the sidecar into /app/.venv itself.
  process.exit(0);
}
if (process.env.RENDER !== "true" && process.env.SIDECAR_INSTALL !== "1") {
  process.exit(0);
}

const root = process.cwd();
const libs = path.join(root, ".sidecar-libs");
const cache = path.join(root, ".sidecar-cache");
const python = process.env.SIDECAR_INSTALL_PYTHON || (process.platform === "win32" ? "python" : "python3");
const puppeteerCli = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "puppeteer.cmd" : "puppeteer");
const wantCamoufox = process.env.SIDECAR_CAMOUFOX === "1";
mkdirSync(libs, { recursive: true });
mkdirSync(cache, { recursive: true });

const requirements = wantCamoufox ? "sidecar/requirements.txt" : "sidecar/requirements-http.txt";

function run(label, command, args, env = {}) {
  console.log(`[sidecar-install] ${label}`);
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: libs, XDG_CACHE_HOME: cache, HOME: root, ...env },
  });
}

try {
  run("installing Python dependencies", python, [
    "-m", "pip", "install",
    "--disable-pip-version-check",
    "--no-cache-dir",
    "--target", libs,
    "-r", requirements,
  ]);
} catch (err) {
  // Without Python packages the app still runs; /fetch and /scrape fall back to Node/Chrome.
  console.warn(`[sidecar-install] Python dependencies failed: ${err.message}`);
  process.exit(0);
}

if (process.env.SIDECAR_BROWSERS === "0") {
  console.log("[sidecar-install] SIDECAR_BROWSERS=0; installed curl_cffi only");
  process.exit(0);
}

// Render's native runtime has no package manager, so Camoufox's Firefox (GTK etc.) usually cannot
// run there. The Dockerfile installs the full sidecar with system dependencies. Set
// SIDECAR_CAMOUFOX=1 to try it anyway on a native host.
if (wantCamoufox) {
  try {
    run("downloading the Camoufox browser", python, ["-m", "camoufox", "fetch"]);
  } catch (err) {
    console.warn(`[sidecar-install] Camoufox browser download failed; /scrape will use Chrome: ${err.message}`);
  }
} else {
  console.log("[sidecar-install] HTTP-only sidecar (set SIDECAR_CAMOUFOX=1 to install Camoufox)");
}

try {
  run("downloading the Puppeteer Chrome fallback", puppeteerCli, [
    "browsers", "install", "chrome",
  ], { PUPPETEER_CACHE_DIR: path.join(cache, "puppeteer") });
} catch (err) {
  console.warn(`[sidecar-install] Chrome download failed: ${err.message}`);
}
