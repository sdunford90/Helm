// =============================================================================
// Helm frontend server
//
// One Node process serves two SPAs and routes by request `Host` header:
//
//   admin.*   -> ../admin/dist     (apps/admin)
//   default   -> ../web/dist       (apps/web)
//
// `/api/*` is reverse-proxied to API_PROXY_TARGET (defaults to the local
// dev API on :3001) so the SPAs can keep using same-origin `fetch('/api/...')`
// without CORS preflights.
//
// Each host has its own SPA fallback to its own `index.html` so deep links
// like `https://admin.tracktheturn.com/tenants/:id` survive a hard refresh.
// =============================================================================

import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProxyMiddleware } from "http-proxy-middleware";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? "5000", 10);
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? "http://localhost:3001";

const ADMIN_DIR = path.resolve(__dirname, "../admin/dist");
const WEB_DIR = path.resolve(__dirname, "../web/dist");

for (const [label, dir] of [
  ["admin", ADMIN_DIR],
  ["web", WEB_DIR],
]) {
  if (!existsSync(path.join(dir, "index.html"))) {
    console.error(
      `[helm-frontend] FATAL: ${label} bundle is missing index.html at ${dir}. ` +
        `Did the build step run \`pnpm --filter @helm/${label} build\`?`,
    );
    process.exit(1);
  }
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Decide which bundle to serve based on the request Host header.
function bundleRootFor(req) {
  const host = (req.headers.host ?? "").toLowerCase().split(":")[0];
  return host.startsWith("admin.") ? ADMIN_DIR : WEB_DIR;
}

// 1. Health check so the platform's load balancer can probe us.
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// 2. Reverse-proxy /api/* to the API service. Mounted before static so SPA
//    fallback never swallows API requests.
//
//    `pathFilter` (instead of express's `app.use('/api', ...)`) keeps the
//    full request path intact so `/api/health` proxies to
//    `${API_PROXY_TARGET}/api/health` rather than `${target}/health`.
app.use(
  createProxyMiddleware({
    pathFilter: ["/api/**"],
    target: API_PROXY_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    on: {
      error: (err, _req, res) => {
        console.error("[helm-frontend] API proxy error:", err.message);
        if (res && !res.headersSent && typeof res.writeHead === "function") {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "API upstream unavailable" }));
        }
      },
    },
  }),
);

// 3. Static assets — pick the right root per request and serve with long
//    immutable caching for hashed Vite assets.
app.use((req, res, next) => {
  const root = bundleRootFor(req);
  // Don't cache index.html (SPA shell); cache hashed assets aggressively.
  const isAsset = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|webp)$/.test(req.path);
  express.static(root, {
    maxAge: isAsset ? "1y" : 0,
    immutable: isAsset,
    index: false,
    fallthrough: true,
  })(req, res, next);
});

// 4. SPA fallback — any unmatched GET returns the host-appropriate index.html.
app.get("*", (req, res, next) => {
  if (req.method !== "GET") return next();
  const root = bundleRootFor(req);
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[helm-frontend] listening on :${PORT} ` +
      `(admin -> ${ADMIN_DIR}, web -> ${WEB_DIR}, /api -> ${API_PROXY_TARGET})`,
  );
});
