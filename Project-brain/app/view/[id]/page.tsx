import VaultClient from "./VaultClient";

type Params = { id: string };

export async function generateStaticParams(): Promise<Params[]> {
  // Required for `output: "export"` (static HTML export).
  // Best-effort: fetch scheme ids from the backend at build time.
  try {
    const r = await fetch("http://localhost:8000/api/v1/schemes/all", { cache: "no-store" });
    const data = await r.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((s: any) => String(s?.scheme_id ?? s?.id ?? ""))
      .filter((id: string) => id && id !== "undefined" && id !== "null")
      .map((id: string) => ({ id }));
  } catch {
    return [];
  }
}

export default async function ViewSchemePage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const schemeId = Number(id);
  return <VaultClient schemeId={schemeId} />;
}
