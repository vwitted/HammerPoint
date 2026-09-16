import express from "express";
import rateLimit from "express-rate-limit";
import { registerAuctionRoutes } from "./routes/auctions";
import { registerImageProxyRoute } from "./routes/imageProxy";

// Builds the Express app with all API routes. Environment variables are read here, so load
// .env before calling it. Serving the frontend is left to the caller (see server.ts).
export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
