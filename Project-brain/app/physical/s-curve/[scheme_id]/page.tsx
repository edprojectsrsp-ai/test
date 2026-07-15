import SCurveClient from "./SCurveClient";

// Next.js `output: "export"` requires dynamic routes to provide static params.
// We know the restored dump has scheme_ids 1..74.
export function generateStaticParams() {
  return Array.from({ length: 74 }, (_, i) => ({ scheme_id: String(i + 1) }));
}

export default function Page() {
  return <SCurveClient />;
}
