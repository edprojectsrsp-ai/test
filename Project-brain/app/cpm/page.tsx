import CpmAdvancedClient from "./CpmAdvancedClient";

async function loadProjects() {
  try {
    const response = await fetch("http://127.0.0.1:8000/api/scheduling/projects", {
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
