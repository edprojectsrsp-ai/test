/** @type {import('next').NextConfig} */

// PPE_STANDALONE=1 produces .next/standalone — a self-contained Node server the
// plant PC installer ships and runs on the LAN, so wall TVs and phones can open
// the console over plain http.
//
// Why standalone rather than a static export: an HTTPS page cannot call the
// agent on a plain-http LAN address (browsers exempt loopback from mixed-content
// blocking, never a LAN IP). Serving the console over http from the plant PC
// puts page and agent on the same scheme, which is what makes the TV work at
// all. Static export was the other option and is blocked anyway — the /api/ppe
// proxy route and the SSG pages that call the :8000 backend at build time both
// prevent it.
//
// Left undefined on Vercel, which does its own thing with the standard build.
const nextConfig = {
  output: process.env.PPE_STANDALONE === "1" ? "standalone" : undefined,
  // Inlined at build time for middleware.ts, which confines the plant-PC build
  // to /ppe. It cannot read PPE_STANDALONE at request time: the PPEConsole
  // service starts node with only HOSTNAME/PORT/NODE_ENV/NEXT_PUBLIC_*, so the
  // flag has to be baked into the bundle or the lockdown silently does nothing.
  env: {
    PPE_LOCKDOWN: process.env.PPE_STANDALONE === "1" ? "1" : "",
  },
  // Without this, Next infers the workspace root from the nearest node_modules
  // — which is the repo root, one level up — and emits
  // .next/standalone/pkntest/Project-brain/server.js instead of
  // .next/standalone/server.js. The installer would then package a tree with no
  // server.js where it expects one, and the console service would simply never
  // start. Pin the root so the layout is flat and predictable.
  outputFileTracingRoot: __dirname,
  images: { unoptimized: true },
  trailingSlash: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};
module.exports = nextConfig;
