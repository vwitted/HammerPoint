// Render's native Node runtime ignores the Dockerfile, so point the app at the Python sidecar that
// scripts/install-sidecar.mjs installs beside the repo, and at the browsers it downloaded there.
//
// This module is imported before the server (and therefore before Puppeteer) so the cache path is
// in place when a provider launches a browser.
import path from "node:path";

if (process.env.RENDER === "true") {
  if (!process.env.SIDECAR_AUTOSTART) process.env.SIDECAR_AUTOSTART = "1";
  if (!process.env.SIDECAR_PYTHON) process.env.SIDECAR_PYTHON = "python3";

  const root = process.cwd();
  const libs = path.join(root, ".sidecar-libs");
  process.env.PYTHONPATH = [libs, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  if (process.env.SIDECAR_DOCKER !== "1") {
    // Native Render already sets XDG_CACHE_HOME to /opt/render/.cache; point it at the directory
    // the build script populated instead, so Camoufox/Chrome are found after a restart.
    process.env.XDG_CACHE_HOME = path.join(root, ".sidecar-cache");
    process.env.PUPPETEER_CACHE_DIR = path.join(root, ".sidecar-cache", "puppeteer");
  }
}
