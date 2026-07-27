const RAW_PPE_BASE =
  process.env.PPE_API_URL ||
  process.env.NEXT_PUBLIC_PPE_API_URL ||
  "http://127.0.0.1:8004";

export const PPE_PROXY_BASE = "/api/ppe";
export const PPE_DIRECT_BASE = RAW_PPE_BASE.replace(/\/$/, "");

export function getPpeApiBase() {
  return PPE_PROXY_BASE;
}

export function buildPpeUrl(path = "") {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${getPpeApiBase()}${cleanPath}`;
}

export function buildDirectPpeUrl(path = "") {
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
