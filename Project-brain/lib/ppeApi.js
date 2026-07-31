const RAW_PPE_BASE =
  process.env.PPE_API_URL ||
  process.env.NEXT_PUBLIC_PPE_API_URL ||
  "http://127.0.0.1:8004";

export const PPE_PROXY_BASE = "/api/ppe";
export const PPE_DIRECT_BASE = RAW_PPE_BASE.replace(/\/$/, "");

/**
 * Next.js is configured with trailingSlash: true. Paths without a trailing
 * slash get a 308 redirect. Browser GET follows it, but PUT/POST can lose the
 * body or fail in some clients — so always normalize before calling the proxy.
 * File-like endpoints (stream.mjpg, snapshot.jpg) are left alone.
 */
export function normalizePpePath(path = "") {
  if (!path) return "/";
  if (/^https?:\/\//i.test(path)) return path;
  let p = path.startsWith("/") ? path : `/${path}`;
  const qIdx = p.indexOf("?");
  let pathname = qIdx >= 0 ? p.slice(0, qIdx) : p;
  const query = qIdx >= 0 ? p.slice(qIdx) : "";
  if (/\.(mjpg|mjpeg|jpg|jpeg|png|webp|gif|mp4|pt|onnx|cgi)$/i.test(pathname)) {
    return pathname + query;
  }
  if (!pathname.endsWith("/")) pathname += "/";
  return pathname + query;
}

export function getPpeApiBase() {
  return PPE_PROXY_BASE;
}

export function buildPpeUrl(path = "") {
  if (/^https?:\/\//i.test(path)) return path;
  return `${getPpeApiBase()}${normalizePpePath(path)}`;
}

export function buildDirectPpeUrl(path = "") {
  if (/^https?:\/\//i.test(path)) return path;
  // Upstream FastAPI does not require trailing slashes
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${PPE_DIRECT_BASE}${cleanPath}`;
}

export function summarizeUpstreamHtml(status, statusText, html, fallbackPath = "") {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const bodyMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const messageMatch = html.match(/<div>\s*This service is currently unavailable\.[^<]*<\/div>/i);
  const requestIdMatch = html.match(/Request ID:\s*([^<\s]+)/i);
  const parts = [];
  parts.push(bodyMatch?.[1] || titleMatch?.[1] || `${status} ${statusText}`.trim());
  if (messageMatch) parts.push("Upstream PPE service is unavailable.");
  if (fallbackPath) parts.push(`Path: ${fallbackPath}`);
  if (requestIdMatch?.[1]) parts.push(`Request ID: ${requestIdMatch[1]}`);
  return parts.join(" ");
}
