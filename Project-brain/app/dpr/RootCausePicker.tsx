"use client";
/**
 * RootCausePicker — why an activity fell short of plan.
 *
 * The Ministry's first question after "how much did you do" is "why not more",
 * and until now the repo had nowhere to record the answer. It lived in free
 * text if it was recorded at all, which cannot be aggregated: three engineers
 * write "rain", "heavy rains" and "weather" for one cause and no amount of
 * grouping recovers the number afterwards.
 *
 * So this is a closed list with a free-text note beside it rather than instead
 * of it. The note captures the specifics; the code makes the quarter countable.
 *
 * It only appears when a deviation actually exists. Asking for a reason on a
 * day that met plan is noise, and an engineer who is asked pointless questions
 * starts picking the first option to get past the form.
 */
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1";

const RESP_LABEL = {
  owner: "Owner",
  contractor: "Contractor",
  external: "External",
  shared: "Shared",
};

const RESP_STYLE = {
  owner: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  contractor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  external: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  shared: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

export default function RootCausePicker({
  value, note, daysLost, onChange, compact = false,
}) {
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API}/dpr/root-causes`, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setGroups(d.groups || []))
      .catch((e) => setError(e.message));
  }, []);

  const flat = useMemo(
    () => groups.flatMap((g) => g.causes.map((c) => ({ ...c, group: g.group }))),
    [groups]);
  const selected = flat.find((c) => c.code === value) || null;

  // The taxonomy marks which causes are meaningless without an explanation.
  const noteRequired = selected?.note_required && !(note || "").trim();

  if (error) {
    return <div className="text-xs text-rose-300">
      Could not load the cause list ({error}). Record the reason in remarks for now.
    </div>;
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
            selected
              ? "border-zinc-700 bg-zinc-950 text-zinc-100"
              : "border-amber-500/40 bg-amber-500/5 text-amber-300"
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            {!selected && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            {selected ? selected.label : "Why the shortfall?"}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
            {value && (
              <button
                type="button"
                onClick={() => { onChange({ root_cause: null, root_cause_note: "" }); setOpen(false); }}
                className="w-full px-3 py-2 text-left text-xs text-zinc-500 hover:bg-zinc-800"
              >
                Clear selection
              </button>
            )}
            {groups.map((g) => (
              <div key={g.group}>
                <div className="sticky top-0 bg-zinc-900/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  {g.group}
                </div>
                {g.causes.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    title={c.hint}
                    onClick={() => { onChange({ root_cause: c.code }); setOpen(false); }}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-zinc-800 ${
                      c.code === value ? "bg-amber-500/10" : ""
                    }`}
                  >
                    <span className="flex-1">
                      <span className="block text-sm text-zinc-100">{c.label}</span>
                      {!compact && (
                        <span className="block text-[11px] leading-snug text-zinc-500">{c.hint}</span>
                      )}
                    </span>
                    <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${RESP_STYLE[c.responsibility]}`}>
                      {RESP_LABEL[c.responsibility]}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`rounded-full border px-2 py-0.5 font-semibold ${RESP_STYLE[selected.responsibility]}`}>
              {RESP_LABEL[selected.responsibility]}
            </span>
            <span className={selected.excusable ? "text-emerald-300" : "text-zinc-500"}>
              {selected.excusable ? "Usually supports an EOT claim" : "Usually not excusable"}
            </span>
            <span className="text-zinc-600">
              — a starting point for analysis, not a contractual finding
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              Days lost
              <input
                type="number" min={0} step={0.5}
                value={daysLost ?? ""}
                onChange={(e) => onChange({ days_lost: e.target.value })}
                className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-amber-400"
              />
            </label>
            <input
              type="text"
              placeholder={noteRequired ? "Explanation required for this cause" : "Note (optional)"}
              value={note || ""}
              onChange={(e) => onChange({ root_cause_note: e.target.value })}
              className={`min-w-[200px] flex-1 rounded-lg border bg-zinc-950 px-3 py-1 text-sm text-zinc-100 outline-none ${
                noteRequired ? "border-rose-500/60 focus:border-rose-400" : "border-zinc-700 focus:border-amber-400"
              }`}
            />
          </div>

          {noteRequired && (
            <div className="text-[11px] text-rose-300">
              “{selected.label}” tells a reviewer nothing on its own — add a line
              saying what actually happened, or pick a more specific cause.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Validation the save path can call before posting. */
export function validateRootCause(entry, causes) {
  const cause = (causes || []).find((c) => c.code === entry.root_cause);
  if (!cause) return null;
  if (cause.note_required && !(entry.root_cause_note || "").trim()) {
    return `"${cause.label}" needs an explanatory note.`;
  }
  return null;
}
