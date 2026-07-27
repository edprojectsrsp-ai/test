import { buildDirectPpeUrl, summarizeUpstreamHtml } from "../../../../lib/ppeApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "content-encoding",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function buildHeaders(source: Headers) {
  const headers = new Headers();
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(lower)) headers.set(key, value);
  });
  return headers;
}

async function proxy(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  const upstreamUrl = new URL(buildDirectPpeUrl(path.join("/")));
  const incomingUrl = new URL(req.url);
  upstreamUrl.search = incomingUrl.search;

  const init: RequestInit = {
    method: req.method,
    headers: buildHeaders(req.headers),
    redirect: "manual",
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (error) {
    return Response.json(
      {
        detail: `Could not reach PPE service at ${buildDirectPpeUrl("")}. ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!upstream.ok && contentType.includes("text/html")) {
    const html = await upstream.text();
    return Response.json(
      {
        detail: summarizeUpstreamHtml(upstream.status, upstream.statusText, html, `/${path.join("/")}`),
      },
      { status: upstream.status || 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildHeaders(upstream.headers),
  });
}

export async function GET(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(req, context);
}

export async function POST(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(req, context);
}

export async function PUT(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(req, context);
}

export async function DELETE(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(req, context);
}

export async function PATCH(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(req, context);
}
