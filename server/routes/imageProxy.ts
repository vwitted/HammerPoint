import type { Express, RequestHandler } from "express";
import { fetchPublicUrl, readBodyWithLimit, UnsafeUrlError } from "../safeFetch";

// GET /api/proxy/image: streams auction images through this server to avoid CDN referrer blocks.
const FALLBACK_IMAGE_URL = "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80";
const MAX_PROXIED_IMAGE_BYTES = 10 * 1024 * 1024;
// Raster formats only: SVG can carry script and would run on this app's origin.
const PROXYABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

export function registerImageProxyRoute(app: Express, imageProxyLimiter: RequestHandler) {
  app.get("/api/proxy/image", imageProxyLimiter, async (req, res) => {
    const imageUrl = typeof req.query.url === "string" ? req.query.url : "";
    if (!imageUrl) {
      return res.status(400).send("Invalid image URL");
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        // Parse host for custom referer
        const origin = new URL(imageUrl).origin;
        const upstreamRes = await fetchPublicUrl(imageUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/*;q=0.8",
            "Referer": `${origin}/`
          },
          signal: controller.signal
        });

        const contentType = (upstreamRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!upstreamRes.ok || !PROXYABLE_IMAGE_TYPES.has(contentType)) {
          return res.redirect(302, FALLBACK_IMAGE_URL);
        }

        const body = await readBodyWithLimit(upstreamRes, MAX_PROXIED_IMAGE_BYTES);
        res.setHeader("Content-Type", contentType);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=86400, immutable");
        res.send(body);
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return res.status(400).send("Image URL not allowed");
      }
      res.redirect(302, FALLBACK_IMAGE_URL);
    }
  });
}
