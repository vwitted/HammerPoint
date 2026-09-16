import "dotenv/config";
import express from "express";
import path from "path";
import { createApp } from "./server/app";

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

// Vite integration for dev server or static serving for production
async function startServer() {
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

startServer();
