/**
 * dpmsJoin.ts — join quality analysis for the breadboard.
 *
 * Drawing a line between two columns is easy; knowing whether that line is a
 * real relationship is the hard part, and it is what the breadboard was not
 * telling anyone. A join that matches 4% of rows looks identical on the canvas
 * to one that matches 99%, and building a master table on the former quietly
 * produces a report with most of the project missing.
 *
 * These functions are pure and work off the sample the DPMS service returns, so
 * they can be unit-tested without the service running and without a DOM.
 *
 * Everything here is computed from a *sample*, never the full table, so the
 * figures are estimates and are labelled as such in the UI. An estimate the
 * user knows is an estimate beats a precise-looking number that is wrong.
 */

export type Cardinality = "1:1" | "1:N" | "N:1" | "N:N" | "unknown";
export type Verdict = "strong" | "usable" | "weak" | "broken" | "unknown";

export interface JoinSample {
  child_table: string;
  child_col: string;
  parent_table: string;
  parent_col: string;
  child_preview_columns?: string[];
  parent_preview_columns?: string[];
  rows: Record<string, unknown>[];
}

export interface JoinHealth {
  sampleRows: number;
  matchedRows: number;
  orphanRows: number;
  matchRate: number | null;      // 0..1, null when it cannot be determined
  nullKeys: number;
  distinctChildKeys: number;
  distinctParentKeys: number;
  cardinality: Cardinality;
  maxFanout: number;             // most child rows sharing a single child key
  maxParentsPerChild: number;    // most distinct parents a single child key hit
  verdict: Verdict;
  notes: string[];
}

/** Values that mean "no key" in a CSV dump, not a legitimate key. */
const NULLISH = new Set(["", "null", "NULL", "None", "nan", "NaN", "n/a", "N/A", "-"]);

export function isNullish(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  return NULLISH.has(String(v).trim());
}

/**
 * Normalise a key for comparison. DPMS sources are CSV dumps from different
 * systems, so the same id routinely appears as "00123", "123" and " 123 ".
 * Comparing raw strings reports those as orphans and makes a perfectly good
 * join look broken.
 */
export function normaliseKey(v: unknown): string {
  if (isNullish(v)) return "";
  const s = String(v).trim();
  // numeric-looking: strip leading zeros and a trailing .0 from float coercion
  if (/^-?\d+(\.0+)?$/.test(s)) {
    const n = s.replace(/\.0+$/, "");
    const neg = n.startsWith("-");
    const digits = (neg ? n.slice(1) : n).replace(/^0+(?=\d)/, "");
    return (neg ? "-" : "") + digits;
  }
  return s.toLowerCase();
}

function pickColumn(row: Record<string, unknown>, candidates: string[]): unknown {
  for (const c of candidates) {
    if (c in row) return row[c];
  }
  return undefined;
}

/**
 * Analyse a join sample.
 *
 * The DPMS service returns joined rows. A row where every parent-side column is
 * empty is an unmatched child row — that is how orphans surface without a
 * separate endpoint.
 */
export function analyseJoin(
  sample: JoinSample,
  meta: { containment?: number | null; parent_coverage?: number | null } = {},
): JoinHealth {
  const rows = sample.rows ?? [];
  const notes: string[] = [];
  const parentCols = (sample.parent_preview_columns ?? []).filter(
    (c) => rows.length === 0 || c in rows[0]);
  const childKeyNames = [sample.child_col, `${sample.child_table}.${sample.child_col}`,
    "link_value"];
  const parentKeyNames = [sample.parent_col, `${sample.parent_table}.${sample.parent_col}`];

  let matched = 0;
  let nullKeys = 0;
  // rows sharing each child key, and the distinct parents each child key hits
  const childKeys = new Map<string, number>();
  const parentsPerChild = new Map<string, Set<string>>();
  const parentKeys = new Set<string>();

  for (const row of rows) {
    const ck = normaliseKey(pickColumn(row, childKeyNames));
    if (!ck) {
      nullKeys++;
      continue;
    }
    childKeys.set(ck, (childKeys.get(ck) ?? 0) + 1);

    // matched when any parent-side column carries a value
    const hasParent = parentCols.length
      ? parentCols.some((c) => !isNullish(row[c]))
      : !isNullish(pickColumn(row, parentKeyNames));
    if (hasParent) {
      matched++;
      const pk = normaliseKey(pickColumn(row, parentKeyNames));
      if (pk) {
        parentKeys.add(pk);
        if (!parentsPerChild.has(ck)) parentsPerChild.set(ck, new Set());
        parentsPerChild.get(ck)!.add(pk);
      }
    }
  }

  const usable = rows.length - nullKeys;
  const matchRate = usable > 0 ? matched / usable : null;
  const maxFanout = childKeys.size ? Math.max(...childKeys.values()) : 0;

  // Cardinality, expressed child:parent.
  //
  // Two independent questions, which an earlier version conflated: do several
  // child ROWS share one parent (the ordinary foreign key, N:1), and does one
  // child KEY reach several different parents (1:N — the case that multiplies
  // rows and is nearly always a modelling error in a CSV dump).
  const parentsPerChildMax = parentsPerChild.size
    ? Math.max(...[...parentsPerChild.values()].map((s2) => s2.size))
    : 0;
  let cardinality: Cardinality = "unknown";
  if (childKeys.size > 0) {
    const manyChildrenPerParent = maxFanout > 1;
    const manyParentsPerChild = parentsPerChildMax > 1;
    if (!manyChildrenPerParent && !manyParentsPerChild) cardinality = "1:1";
    else if (manyChildrenPerParent && !manyParentsPerChild) cardinality = "N:1";
    else if (!manyChildrenPerParent && manyParentsPerChild) cardinality = "1:N";
    else cardinality = "N:N";
  }

  if (nullKeys > 0) {
    notes.push(`${nullKeys} of ${rows.length} sampled rows have an empty key — ` +
      "those rows can never join and will drop out of a master table.");
  }
  if (cardinality === "N:N" || cardinality === "1:N") {
    notes.push(`${cardinality}: one ${sample.child_table} key reaches ` +
      `${parentsPerChildMax} different ${sample.parent_table} rows, so joining ` +
      "on this multiplies rows. Usually the real key is a pair of columns.");
  }
  if (matchRate !== null && matchRate < 0.5 && usable > 0) {
    notes.push("Under half the sampled rows found a parent. Check for a " +
      "prefix, a different id system, or a wrong column.");
  }
  if (meta.parent_coverage != null && meta.parent_coverage < 0.2) {
    notes.push(`Only ${Math.round(meta.parent_coverage * 100)}% of the parent ` +
      "table is referenced — this may be a lookup against a much larger master.");
  }

  let verdict: Verdict = "unknown";
  if (matchRate !== null) {
    if (matchRate >= 0.95) verdict = "strong";
    else if (matchRate >= 0.7) verdict = "usable";
    else if (matchRate >= 0.4) verdict = "weak";
    else verdict = "broken";
  }

  return {
    sampleRows: rows.length,
    matchedRows: matched,
    orphanRows: Math.max(0, usable - matched),
    matchRate,
    nullKeys,
    distinctChildKeys: childKeys.size,
    distinctParentKeys: parentKeys.size,
    cardinality,
    maxFanout,
    maxParentsPerChild: parentsPerChildMax,
    verdict,
    notes,
  };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  strong: "Strong link",
  usable: "Usable link",
  weak: "Weak link",
  broken: "Broken link",
  unknown: "Not assessed",
};

export const VERDICT_COLOR: Record<Verdict, string> = {
  strong: "#0a8f5b",
  usable: "#3d7ea6",
  weak: "#b25e00",
  broken: "#c02b3c",
  unknown: "#7c8798",
};

/** Split joined columns by their source table, for a side-by-side view. */
export function splitColumns(sample: JoinSample): {
  child: string[]; parent: string[]; other: string[];
} {
  const rows = sample.rows ?? [];
  const all = rows.length ? Object.keys(rows[0]) : [];
  const childSet = new Set(sample.child_preview_columns ?? []);
  const parentSet = new Set(sample.parent_preview_columns ?? []);
  return {
    child: all.filter((c) => childSet.has(c)),
    parent: all.filter((c) => parentSet.has(c)),
    other: all.filter((c) => !childSet.has(c) && !parentSet.has(c)),
  };
}

/** Rows that failed to find a parent — the ones worth showing a user first. */
export function orphanRows(sample: JoinSample, limit = 10): Record<string, unknown>[] {
  const parentCols = sample.parent_preview_columns ?? [];
  if (!parentCols.length) return [];
  return (sample.rows ?? [])
    .filter((r) => parentCols.every((c) => isNullish(r[c])))
    .slice(0, limit);
}
