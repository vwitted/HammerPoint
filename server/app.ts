import express from "express";
import rateLimit from "express-rate-limit";
import { registerAuctionRoutes } from "./routes/auctions";
import { registerImageProxyRoute } from "./routes/imageProxy";
import { sidecarUrl } from "./lib/sidecar";
import { getManagedSidecarStatus } from "./lib/sidecarProcess";

// Builds the Express app with all API routes. Environment variables are read here, so load
// .env before calling it. Serving the frontend is left to the caller (see server.ts).
export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Small ops endpoint: says whether this process can reach the Python sidecar, without exposing
  // the sidecar's URL credentials or the host's environment. Useful after a deploy where the
  // browser/HTTP transport silently fell back.
  app.get("/api/health", async (_req, res) => {
    const url = sidecarUrl();
    let origin: string | null = null;
    let health: any = null;
    if (url) {
      try {
        origin = new URL(url).origin;
        const probe = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        health = await probe.json();
      } catch (err: any) {
        health = { error: String(err?.message ?? err) };
      }
    }
    res.json({
      ok: true,
      node: process.version,
      sidecar: { configured: Boolean(url), origin, health, managed: getManagedSidecarStatus() },
    });
  });

  // Behind a reverse proxy (most hosts), set TRUST_PROXY to the number of proxy hops so
  // rate limits apply per client instead of to the proxy's IP.
  if (process.env.TRUST_PROXY) {
    app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  }

  // Each live search starts several scrapers, up to three of them headless Chrome instances.
  const searchLimiter = rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.SEARCH_RATE_LIMIT_PER_MINUTE) || 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many searches. Please wait a minute and try again." }
  });

  const imageProxyLimiter = rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.IMAGE_PROXY_RATE_LIMIT_PER_MINUTE) || 300,
    standardHeaders: "draft-7",
    legacyHeaders: false
  });

  registerAuctionRoutes(app, searchLimiter);
  registerImageProxyRoute(app, imageProxyLimiter);

  return app;
}
