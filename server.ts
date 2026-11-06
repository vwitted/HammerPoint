import "dotenv/config";
import "./server/lib/renderEnv";
import express from "express";
import path from "path";
import { createApp } from "./server/app";
import { startManagedSidecar, stopManagedSidecar } from "./server/lib/sidecarProcess";

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

// Vite integration for dev server or static serving for production
async function startServer() {
  // The sidecar is optional; startManagedSidecar() returns immediately unless SIDECAR_AUTOSTART=1.
  // Doing this before listen means the first search already has Camoufox/curl_cffi available.
  await startManagedSidecar();

  if (process.env.NODE_ENV !== "production") {
    // Loaded lazily so production doesn't need Vite installed.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Serve SPA index.html for all non-API paths
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.env.NODE_ENV !== "test") app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Containers stop with SIGTERM; take the sidecar's Firefox session with us.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    stopManagedSidecar();
    process.exit(0);
  });
}

startServer();
