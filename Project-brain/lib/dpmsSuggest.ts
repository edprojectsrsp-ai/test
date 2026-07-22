import type { DpmsRelationship } from "@/lib/dpms";

export type JoinSuggestion = {
  id: string;
  child_table: string;
  child_col: string;
  parent_table: string;
  parent_col: string;
  confidence: number;
  reason: string;
  /** already saved on server */
  saved?: boolean;
  status?: string;
};

function scoreNamePair(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 100;
  if (x.endsWith("_" + y) || y.endsWith("_" + x)) return 88;
  if (x.endsWith(y) || y.endsWith(x)) return 80;
  const tx = new Set(x.split(/[_\s]+/).filter(Boolean));
  const ty = new Set(y.split(/[_\s]+/).filter(Boolean));
  const inter = [...tx].filter((t) => ty.has(t));
  if (!inter.length) return 0;
  const union = new Set([...tx, ...ty]);
  return Math.round(70 * (inter.length / union.size));
}

function isKeyish(name: string) {
  return /(_id|_no|_code|_key|id$|no$|code$|key$)/i.test(name);
}

/**
 * Suggest common joins among tables currently on the board.
 * Prefers existing API relationships, then same-name / key-like columns.
 */
export function suggestBoardJoins(opts: {
  boardTables: string[];
  columnsByTable: Record<string, string[]>;
  existing: DpmsRelationship[];
}): JoinSuggestion[] {
  const board = new Set(opts.boardTables);
  if (board.size < 2) return [];

  const out: JoinSuggestion[] = [];
  const seen = new Set<string>();

  const push = (s: JoinSuggestion) => {
    const id =
      s.id ||
      [s.child_table, s.child_col, s.parent_table, s.parent_col].join("|");
    if (seen.has(id)) return;
    // also skip reverse duplicate of same pair if lower score
    const rev = [s.parent_table, s.parent_col, s.child_table, s.child_col].join("|");
    if (seen.has(rev)) return;
    seen.add(id);
    out.push({ ...s, id });
  };

  // 1) Existing relationships between board tables (saved or candidate)
  for (const r of opts.existing) {
    if (!board.has(r.child_table) || !board.has(r.parent_table)) continue;
    push({
      id: r.id || [r.child_table, r.child_col, r.parent_table, r.parent_col].join("|"),
      child_table: r.child_table,
      child_col: r.child_col,
      parent_table: r.parent_table,
      parent_col: r.parent_col,
      confidence: r.confidence ?? (r.status === "approved" ? 100 : 75),
      reason:
        r.status === "approved"
          ? "Already saved"
          : r.source === "auto"
            ? "Auto-discovered candidate"
            : "Existing relationship",
      saved: r.status === "approved",
      status: r.status,
    });
  }

  // 2) Name-based common columns across every pair on board
  const names = opts.boardTables;
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < names.length; j++) {
      if (i === j) continue;
      const child = names[i];
      const parent = names[j];
      const childCols = opts.columnsByTable[child] || [];
      const parentCols = opts.columnsByTable[parent] || [];
      for (const cc of childCols) {
        for (const pc of parentCols) {
          const score = scoreNamePair(cc, pc);
          if (score < 80) continue;
          // Prefer child key-ish → parent key-ish (or same name)
          if (!isKeyish(cc) && !isKeyish(pc) && score < 100) continue;
          // Prefer parent as the more "primary" looking side for equal names
          let childTable = child;
          let childCol = cc;
          let parentTable = parent;
          let parentCol = pc;
          if (score === 100 && isKeyish(cc) && isKeyish(pc)) {
            // if child table name appears in parent col, swap so FK points at parent
            if (pc.toLowerCase().includes(child.toLowerCase().replace(/s$/, ""))) {
              childTable = parent;
              childCol = pc;
              parentTable = child;
              parentCol = cc;
            }
          }
          push({
            id: [childTable, childCol, parentTable, parentCol].join("|"),
            child_table: childTable,
            child_col: childCol,
            parent_table: parentTable,
            parent_col: parentCol,
            confidence: Math.min(score, 99),
            reason:
              score === 100
                ? "Matching column name"
                : "Similar key-like column names",
            saved: false,
            status: "suggestion",
          });
        }
      }
    }
  }

  return out.sort((a, b) => {
    // saved first, then confidence
    if (!!a.saved !== !!b.saved) return a.saved ? -1 : 1;
    return b.confidence - a.confidence;
  });
}
