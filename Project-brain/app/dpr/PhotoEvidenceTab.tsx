"use client";
/**
 * PhotoEvidenceTab — whether the photos behind billing claims will hold up.
 *
 * DPR entries already capture GPS live from the browser and store an attached
 * image, but nothing tied the two together: a gallery photo taken three weeks
 * ago at another site attached to a live-GPS entry and looked identical to one
 * taken on the spot. When a contractor disputes a measurement, "there is a
 * photo" is worth little; "this photo's own EXIF places it 12 m from the
 * recorded entry point, four minutes before the entry was saved" is worth a
 * great deal.
 *
 * The distinction this screen works hardest to make clear is between
 * *unverified* and *suspect*. Messaging apps strip EXIF routinely, so most
 * unverified photos are perfectly honest — treating them as fraud would push
 * engineers back to paper, which is a worse outcome than an uncorroborated
 * photo. Only "suspect" means the photo's own metadata disagrees.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const STATUS = {
  verified: {
    label: "Verified", cls: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
    blurb: "The photo's own location and timestamp agree with the entry.",
  },
  unverified: {
    label: "Unverified", cls: "text-zinc-300 border-zinc-600 bg-zinc-500/10",
    blurb: "No EXIF to check. WhatsApp and most messaging apps strip it, so this "
         + "is common and is not by itself evidence of anything.",
  },
  suspect: {
    label: "Suspect", cls: "text-rose-300 border-rose-500/30 bg-rose-500/10",
    blurb: "The photo carries EXIF and it disagrees with the entry — wrong place, "
         + "wrong day, or both. Worth looking at before certifying.",
  },
  conflicted: {
    label: "Conflicted", cls: "text-amber-300 border-amber-500/30 bg-amber-500/10",
    blurb: "The photo's own metadata is impossible, such as a timestamp in the "
         + "future. Usually a wrong camera clock rather than intent.",
  },
};

export default function PhotoEvidenceTab({ schemeId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!schemeId) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API}/dpr/photos/integrity/${schemeId}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.text()).slice(0, 180) || `HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [schemeId]);

  useEffect(() => { load(); }, [load]);

  if (!schemeId) {
    return <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-500">
      Select a scheme to check its photo evidence.
    </div>;
  }

  const by = data?.by_status || {};
  const total = data?.total_photos || 0;
  const pct = (n) => (total ? (n / total) * 100 : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <ShieldCheck className="h-5 w-5 text-amber-400" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">Photo evidence integrity</div>
          <div className="text-xs text-zinc-500">
            Whether the photos behind your billing claims can be shown to have been
            taken where and when the entry says.
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {data && total === 0 && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-500">
          No photos attached to entries for this scheme yet.
        </div>
      )}

      {data && total > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Photos</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-white">{total}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Defensible</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">
                {data.verified_pct == null ? "—" : `${data.verified_pct}%`}
              </div>
              <div className="mt-1 text-xs text-zinc-500">corroborated by their own EXIF</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Suspect</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums ${by.suspect ? "text-rose-300" : "text-zinc-500"}`}>
                {by.suspect || 0}
              </div>
              <div className="mt-1 text-xs text-zinc-500">metadata disagrees with the entry</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Reused images</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums ${data.reused_images?.length ? "text-rose-300" : "text-zinc-500"}`}>
                {data.reused_images?.length || 0}
              </div>
              <div className="mt-1 text-xs text-zinc-500">same file on more than one entry</div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 px-6 py-4 text-sm font-semibold text-white">
              Breakdown
            </div>
            <div className="space-y-4 p-6">
              {Object.entries(STATUS).map(([key, meta]) => {
                const n = by[key] || 0;
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center gap-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>
                        {meta.label}
                      </span>
                      <span className="text-sm tabular-nums text-zinc-300">{n}</span>
                      <span className="text-xs text-zinc-600">{pct(n).toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div className={`h-full rounded-full ${
                        key === "verified" ? "bg-emerald-500"
                          : key === "suspect" ? "bg-rose-500"
                            : key === "conflicted" ? "bg-amber-500" : "bg-zinc-600"}`}
                        style={{ width: `${pct(n)}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-zinc-500">{meta.blurb}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {data.reused_images?.length > 0 && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
              <div className="text-sm font-semibold text-rose-200">
                {data.reused_images.length} image(s) attached to more than one entry
              </div>
              <div className="mt-1 text-xs leading-relaxed text-rose-200/70">
                The same file appearing against separate entries is the clearest sign
                of a recycled photo, and it is only findable because the upload hash is
                stored. Worth checking before those entries are certified.
              </div>
              <div className="mt-3 space-y-1 font-mono text-[11px] text-rose-200/60">
                {data.reused_images.slice(0, 10).map((r) => (
                  <div key={r.sha256}>{r.sha256.slice(0, 16)}… — {r.entries} entries</div>
                ))}
              </div>
            </div>
          )}

          {data.note && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs leading-relaxed text-zinc-500">
              {data.note}
            </div>
          )}
        </>
      )}
    </div>
  );
}
