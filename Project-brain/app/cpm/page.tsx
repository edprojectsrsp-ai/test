import CpmAdvancedClient from "./CpmAdvancedClient";

const API_ROOT = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const SCHED_API = `${API_ROOT}/api/scheduling`;

async function loadProjects() {
  try {
    const response = await fetch(`${SCHED_API}/projects`, {
      cache: "no-store",
    });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

export default async function CpmPage() {
  const projects = await loadProjects();
  return <CpmAdvancedClient initialProjects={projects} />;
}
