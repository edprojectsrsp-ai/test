import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Confines the plant-PC build to the PPE module.
 *
 * The standalone console ships the whole Project Brain app -- all 63 routes.
 * PPE_STANDALONE=1 only ever set output:"standalone"; it never restricted what
 * was served. So a PPE customer's PC answered 200 on /billing/, /capex/, /dpr/,
 * /notesheet/ and /admin/, every one of them titled "Project Brain". The pages
 * mostly cannot load data (their backend is on :8002 and the PPE installer does
 * not ship it), so this is not a data breach -- but it hands a paying customer
 * the navigation of an internal tool that is nothing to do with what they
 * bought, and invites them to click into /admin/.
 *
 * Deliberately a denylist-by-default: anything not explicitly PPE goes to /ppe/.
 * A new module added later is therefore confined automatically, whereas an
 * allowlist of "modules to hide" would leak every route anyone forgets to add.
 *
 * Inert in the normal (Vercel) build -- PPE_LOCKDOWN is only set when
 * next.config.js sees PPE_STANDALONE=1, and it is inlined at build time because
 * the console service does not carry PPE_STANDALONE in its runtime environment.
 */

const LOCKED = process.env.PPE_LOCKDOWN === "1";

// Paths the PPE console itself needs. /api/ppe is the proxy the page uses to
// reach the agent, so cutting it off would break the console this exists to
// protect.
const ALLOWED_PREFIXES = ["/ppe", "/api/ppe"];

// Framework and asset routes. Blocking these serves a redirect instead of the
// JS chunk the page is waiting on, which presents as a blank screen.
const PASSTHROUGH_PREFIXES = ["/_next", "/__next", "/static", "/assets", "/icons"];

const PASSTHROUGH_FILES = [
  "/favicon.ico",
  "/manifest.json",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sw.js",
];

export function middleware(req: NextRequest) {
  if (!LOCKED) return NextResponse.next();

  const { pathname } = req.nextUrl;

  if (
    PASSTHROUGH_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PASSTHROUGH_FILES.includes(pathname) ||
    /\.(png|jpg|jpeg|svg|gif|webp|ico|css|js|map|woff2?|ttf)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Everything else -- including "/" -- lands on the console. A redirect rather
  // than a 404 because on this build there is exactly one thing to look at, and
  // a customer typing the bare hostname should get it.
  const url = req.nextUrl.clone();
  url.pathname = "/ppe/";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
