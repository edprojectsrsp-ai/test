"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

// The old "/reports/table" physical-progress placeholder was never built out.
// The real 9-column activity-wise progress report is the Statics Report at
// /reports/statics (with month selection), so redirect there and carry the
// scheme id through.
function RedirectToStatics() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const id = params.get("id");
    router.replace(`/reports/statics${id ? `?id=${encodeURIComponent(id)}` : ""}`);
  }, [router, params]);
  return (
    <div className="min-h-screen p-8" style={{ color: "var(--ink-3)" }}>
      Opening the Physical Progress report…
    </div>
  );
}

export default function ReportsDataTablePage() {
  return (
    <Suspense fallback={<div className="min-h-screen p-8" style={{ color: "var(--ink-3)" }}>Loading…</div>}>
      <RedirectToStatics />
    </Suspense>
  );
}
