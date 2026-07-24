"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Check,
  Database,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  DPMS_URL,
  dpmsApi,
  type DpmsRelationship,
  type DpmsStatus,
  type DpmsTable,
  type LinkSample,
} from "@/lib/dpms";
import { suggestBoardJoins, type JoinSuggestion } from "@/lib/dpmsSuggest";
import TableSchemaNode, { type TableSchemaData } from "./TableSchemaNode";
import RelationEdge, { type RelationEdgeData } from "./RelationEdge";
import JoinInspector from "./JoinInspector";

const nodeTypes = { tableSchema: TableSchemaNode };
const edgeTypes = { relation: RelationEdge };
const LS_KEY = "dpms_erd_layout_v1";
const MAX_BOARD = 10;

type JoinPreviewResult = {
  columns: string[];
  rows: Record<string, string | null>[];
  row_count: number;
  tables: string[];
  base_table?: string;
  note?: string;
  sql?: string;
  skipped_tables?: string[];
};

function groupColsByTable(cols: string[]): Record<string, string[]> {
  const g: Record<string, string[]> = {};
  cols.forEach((c) => {
    const t = c.split(".")[0];
    (g[t] = g[t] || []).push(c);
  });
  return g;
}

type LayoutMap = Record<string, { x: number; y: number }>;
type TableNode = Node<TableSchemaData, "tableSchema">;
type RelEdge = Edge<RelationEdgeData, "relation">;

function loadLayout(): LayoutMap {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}") as LayoutMap;
  } catch {
    return {};
  }
}

function saveLayout(nodes: Node[]) {
  const map: LayoutMap = {};
  nodes.forEach((n) => {
    map[n.id] = { x: n.position.x, y: n.position.y };
  });
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function slotPosition(index: number) {
  return { x: 40 + (index % 4) * 300, y: 40 + Math.floor(index / 4) * 460 };
}

function buildEdges(
  rels: DpmsRelationship[],
  suggestions: JoinSuggestion[],
  boardNames: Set<string>,
  checkedSuggest: Set<string>,
  handlers: {
    onReverse: (id: string) => void;
    onDelete: (id: string) => void;
    onDrill: (id: string) => void;
  }
): RelEdge[] {
  const edges: RelEdge[] = [];
  const seen = new Set<string>();

  // Saved / API relationships among board tables only
  for (const r of rels) {
    if (!boardNames.has(r.child_table) || !boardNames.has(r.parent_table)) continue;
    const id = r.id || dpmsApi.relId(r);
    if (seen.has(id)) continue;
    seen.add(id);
    const approved = r.status === "approved";
    const conf = r.confidence ?? 0;
    const color = approved ? "#047857" : conf >= 70 ? "#1d4ed8" : "#b91c1c";
    edges.push({
      id,
      type: "relation",
      source: r.child_table,
      target: r.parent_table,
      sourceHandle: r.child_col,
      targetHandle: r.parent_col,
      animated: !approved,
      reconnectable: true,
      selectable: true,
      focusable: true,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: { strokeWidth: approved ? 2.6 : 2.2, strokeDasharray: approved ? undefined : "6 4" },
      data: {
        childCol: r.child_col,
        parentCol: r.parent_col,
        status: r.status,
        confidence: r.confidence,
        relId: id,
        onReverse: handlers.onReverse,
        onDelete: handlers.onDelete,
        onDrill: handlers.onDrill,
      },
    });
  }

  // Suggested (not yet saved) joins — only checked ones draw as orange dashed arrows
  for (const s of suggestions) {
    if (s.saved || s.status === "approved") continue;
    if (!checkedSuggest.has(s.id)) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    edges.push({
      id: `suggest:${s.id}`,
      type: "relation",
      source: s.child_table,
      target: s.parent_table,
      sourceHandle: s.child_col,
      targetHandle: s.parent_col,
      animated: true,
      reconnectable: true,
      selectable: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#c2410c", width: 18, height: 18 },
      style: { strokeWidth: 2.4, strokeDasharray: "7 5", stroke: "#ea580c" },
      data: {
        childCol: s.child_col,
        parentCol: s.parent_col,
        status: "suggestion",
        confidence: s.confidence,
        relId: s.id,
        onReverse: handlers.onReverse,
        onDelete: handlers.onDelete,
        onDrill: handlers.onDrill,
      },
    });
  }

  return edges;
}

function linkedColsMap(rels: DpmsRelationship[], boardNames: Set<string>) {
  const map = new Map<string, Set<string>>();
  rels.forEach((r) => {
    if (!boardNames.has(r.child_table) || !boardNames.has(r.parent_table)) return;
    if (!map.has(r.child_table)) map.set(r.child_table, new Set());
    if (!map.has(r.parent_table)) map.set(r.parent_table, new Set());
    map.get(r.child_table)!.add(r.child_col);
    map.get(r.parent_table)!.add(r.parent_col);
  });
  return map;
}

function StudioInner() {
  const [status, setStatus] = useState<DpmsStatus | null>(null);
  const [tables, setTables] = useState<DpmsTable[]>([]);
  const [relationships, setRelationships] = useState<DpmsRelationship[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sample, setSample] = useState<{ rel: DpmsRelationship; data: LinkSample } | null>(null);
  const [joinView, setJoinView] = useState<JoinPreviewResult | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const joinOpenRef = useRef(false);
  const [joinFilter, setJoinFilter] = useState("");
  const [joinSort, setJoinSort] = useState<{ col: string | null; dir: 1 | -1 }>({ col: null, dir: 1 });
  const [joinHidden, setJoinHidden] = useState<Set<string>>(new Set());
  const [joinColsOpen, setJoinColsOpen] = useState(false);
  const [joinExporting, setJoinExporting] = useState(false);
  const [joinColFilters, setJoinColFilters] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<JoinSuggestion[]>([]);
  const [checkedSuggest, setCheckedSuggest] = useState<Set<string>>(new Set());
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelEdge>([]);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const bootRef = useRef(false);
  const tablesRef = useRef<DpmsTable[]>([]);
  const nodesRef = useRef<TableNode[]>([]);

  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const boardIds = useMemo(() => nodes.map((n) => n.id).sort().join("|"), [nodes]);
  const boardNames = useMemo(
    () => new Set(boardIds ? boardIds.split("|").filter(Boolean) : []),
    [boardIds]
  );

  const reverseRelRef = useRef<(id: string) => void>(() => {});
  const deleteRelRef = useRef<(id: string) => void>(() => {});
  const drillRelRef = useRef<(id: string) => void>(() => {});

  const refreshMeta = useCallback(async () => {
    setLoadingTables(true);
    setError(null);
    try {
      const [s, t, rels] = await Promise.all([
        dpmsApi.status(),
        dpmsApi.tables(),
        dpmsApi.relationships().catch(() => dpmsApi.links()),
      ]);
      const list = Array.isArray(t) ? t : [];
      setStatus(s);
      setTables(list);
      tablesRef.current = list;
      setRelationships(Array.isArray(rels) ? rels : []);
      if (!list.length) {
        setError("DPMS returned 0 tables. Check the CSV folder on the viewer service.");
      }
      return { s, t: list, rels: Array.isArray(rels) ? rels : [] };
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Cannot reach DPMS service on :8010";
      setError(msg);
      setTables([]);
      tablesRef.current = [];
      throw e;
    } finally {
      setLoadingTables(false);
    }
  }, []);

  const applyEdges = useCallback(
    (
      rels: DpmsRelationship[],
      board: Set<string>,
      sugg: JoinSuggestion[],
      checked: Set<string>
    ) => {
      const handlers = {
        onReverse: (id: string) => reverseRelRef.current(id),
        onDelete: (id: string) => deleteRelRef.current(id),
        onDrill: (id: string) => drillRelRef.current(id),
      };
      setEdges(buildEdges(rels, sugg, board, checked, handlers));
      const linked = linkedColsMap(rels, board);
      // also mark suggested cols
      sugg.forEach((s) => {
        if (!checked.has(s.id) || s.saved) return;
        if (!linked.has(s.child_table)) linked.set(s.child_table, new Set());
        if (!linked.has(s.parent_table)) linked.set(s.parent_table, new Set());
        linked.get(s.child_table)!.add(s.child_col);
        linked.get(s.parent_table)!.add(s.parent_col);
      });
      setNodes((nds) => {
        let changed = false;
        const next = nds.map((n) => {
          const cols = [...(linked.get(n.id) || [])].sort();
          const prev = [...(n.data.linkedCols || [])].sort();
          if (cols.join("|") === prev.join("|")) return n;
          changed = true;
          return { ...n, data: { ...n.data, linkedCols: cols } };
        });
        return changed ? next : nds;
      });
    },
    [setEdges, setNodes]
  );

  const recomputeSuggestions = useCallback(() => {
    const board = nodesRef.current.map((n) => n.id);
    if (board.length < 2) {
      setSuggestions([]);
      setCheckedSuggest(new Set());
      return;
    }
    const columnsByTable: Record<string, string[]> = {};
    nodesRef.current.forEach((n) => {
      columnsByTable[n.id] = n.data.columns || [];
    });
    const list = suggestBoardJoins({
      boardTables: board,
      columnsByTable,
      existing: relationships,
    });
    setSuggestions(list);
    // Auto-check high-confidence unsaved suggestions (common joins)
    setCheckedSuggest((prev) => {
      const next = new Set<string>();
      list.forEach((s) => {
        if (s.saved || s.status === "approved") return;
        // keep previous user choice if still present
        if (prev.has(s.id) || s.confidence >= 88) next.add(s.id);
      });
      return next;
    });
  }, [relationships]);

  const addTables = useCallback(
    async (names: string[], dropPos?: { x: number; y: number }) => {
      const current = nodesRef.current;
      const onBoard = new Set(current.map((n) => n.id));
      const unique = names.filter((n) => n && !onBoard.has(n));
      if (!unique.length) {
        showToast("Already on board");
        return;
      }
      const room = MAX_BOARD - current.length;
      if (room <= 0) {
        showToast(`Max ${MAX_BOARD} tables on canvas`);
        return;
      }
      const pick = unique.slice(0, room);
      const layout = loadLayout();
      const nextNodes: TableNode[] = [];
      const catalog = tablesRef.current;

      for (let i = 0; i < pick.length; i++) {
        const name = pick[i];
        const meta = catalog.find((t) => t.name === name);
        let columns: string[] = [];
        try {
          columns = (await dpmsApi.columns(name)).columns || [];
        } catch {
          columns = [];
        }
        const pos =
          dropPos && i === 0
            ? dropPos
            : layout[name] || slotPosition(current.length + i);
        nextNodes.push({
          id: name,
          type: "tableSchema",
          position: pos,
          dragHandle: ".dpms-drag-handle",
          draggable: true,
          selectable: true,
          connectable: true,
          data: {
            label: name,
            columns,
            rowCount: meta?.rows,
            linkedCols: [],
          },
        });
      }

      setNodes((nds) => {
        const merged = [...nds, ...nextNodes];
        nodesRef.current = merged;
        saveLayout(merged);
        return merged;
      });
      setSelected((prev) => {
        const n = new Set(prev);
        pick.forEach((p) => n.delete(p));
        return n;
      });
      showToast(
        `Placed ${pick.length} table${pick.length === 1 ? "" : "s"} — reviewing suggested joins…`
      );
      // Suggest after place
      setTimeout(() => recomputeSuggestions(), 50);
    },
    [setNodes, showToast, recomputeSuggestions]
  );

  useEffect(() => {
    recomputeSuggestions();
  }, [boardIds, relationships, recomputeSuggestions]);

  useEffect(() => {
    applyEdges(relationships, boardNames, suggestions, checkedSuggest);
  }, [relationships, boardIds, boardNames, suggestions, checkedSuggest, applyEdges]);

  const deleteRel = useCallback(
    async (id: string) => {
      // Unsaved suggestion — just uncheck
      const clean = id.replace(/^suggest:/, "");
      if (suggestions.some((s) => s.id === clean && !s.saved && s.status !== "approved")) {
        setCheckedSuggest((prev) => {
          const n = new Set(prev);
          n.delete(clean);
          return n;
        });
        showToast("Suggestion removed from board (not saved)");
        return;
      }
      try {
        setBusy(true);
        await dpmsApi.deleteRelationship(clean);
        setRelationships(await dpmsApi.relationships());
        setSample(null);
        showToast("Relationship deleted");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setBusy(false);
      }
    },
    [showToast, suggestions]
  );

  const reverseRel = useCallback(
    async (id: string) => {
      const rel = relationships.find((r) => (r.id || dpmsApi.relId(r)) === id);
      if (!rel) return;
      try {
        setBusy(true);
        await dpmsApi.deleteRelationship(id);
        await dpmsApi.saveRelationship({
          child_table: rel.parent_table,
          child_col: rel.parent_col,
          parent_table: rel.child_table,
          parent_col: rel.child_col,
          confidence: rel.confidence || 100,
          status: rel.status || "approved",
          source: "manual",
          note: "reversed in ERD",
        });
        setRelationships(await dpmsApi.relationships());
        showToast("Relationship reversed");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Reverse failed");
      } finally {
        setBusy(false);
      }
    },
    [relationships, showToast]
  );

  const drillRel = useCallback(
    async (id: string) => {
      const rel = relationships.find((r) => (r.id || dpmsApi.relId(r)) === id);
      if (!rel) return;
      try {
        setBusy(true);
        const data = await dpmsApi.linkSample(rel, 25);
        setSample({ rel, data });
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Sample failed");
      } finally {
        setBusy(false);
      }
    },
    [relationships, showToast]
  );

  reverseRelRef.current = (id) => void reverseRel(id);
  deleteRelRef.current = (id) => void deleteRel(id);
  drillRelRef.current = (id) => void drillRel(id);

  // Boot: load table tray. Restore last board only if user left tables there (2–3 workflow).
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    (async () => {
      try {
        setBusy(true);
        await refreshMeta();
        try {
          const layout = loadLayout();
          const saved = Object.keys(layout).filter(Boolean).slice(0, MAX_BOARD);
          // Restore only a small previous batch (≤4) so user can continue 2–3 table workflow
          if (saved.length > 0 && saved.length <= 4) {
            await addTables(saved);
            setTimeout(() => fitView({ padding: 0.15 }), 150);
          }
        } catch {
          /* board seed optional */
        }
      } catch {
        /* error already set in refreshMeta */
      } finally {
        setBusy(false);
      }
    })();
  }, [addTables, fitView, refreshMeta]);

  /** Save a new join (child.field → parent.field). Used by add + reconnect. */
  const saveJoin = useCallback(
    async (
      connection: Connection,
      opts?: { replaceId?: string; silentExisting?: boolean }
    ): Promise<boolean> => {
      if (
        !connection.source ||
        !connection.target ||
        !connection.sourceHandle ||
        !connection.targetHandle
      ) {
        return false;
      }
      if (connection.source === connection.target) {
        showToast("Link two different tables");
        return false;
      }
      const payload: DpmsRelationship = {
        child_table: connection.source,
        child_col: connection.sourceHandle,
        parent_table: connection.target,
        parent_col: connection.targetHandle,
        confidence: 100,
        status: "approved",
        source: "manual",
        note: "wired in React Flow ERD",
      };
      const id = dpmsApi.relId(payload);
      const existing = relationships.find(
        (r) =>
          dpmsApi.relId(r) === id ||
          (r.child_table === payload.parent_table &&
            r.child_col === payload.parent_col &&
            r.parent_table === payload.child_table &&
            r.parent_col === payload.child_col)
      );
      if (existing && existing.id !== opts?.replaceId && dpmsApi.relId(existing) !== opts?.replaceId) {
        if (!opts?.silentExisting) {
          showToast(
            `Already linked · ${existing.status || "candidate"}${
              existing.confidence != null ? ` · ${existing.confidence}%` : ""
            }`
          );
          void drillRel(existing.id || dpmsApi.relId(existing));
        }
        return false;
      }
      try {
        setBusy(true);
        if (opts?.replaceId) {
          await dpmsApi.deleteRelationship(opts.replaceId);
        }
        await dpmsApi.saveRelationship(payload);
        setRelationships(await dpmsApi.relationships());
        showToast(
          `Linked ${payload.child_table}.${payload.child_col} → ${payload.parent_table}.${payload.parent_col}`
        );
        // Show the joined result straight away. Drawing the line is the easy
        // part; whether the join actually matches anything is the question
        // that matters, and it should not need a second deliberate click.
        try {
          const data = await dpmsApi.linkSample(payload, 50);
          setSample({ rel: payload, data });
        } catch {
          /* preview is best-effort: the link itself is already saved */
        }
        return true;
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Link failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [relationships, showToast, drillRel]
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      void saveJoin(connection);
    },
    [saveJoin]
  );

  /** Drag either end of an existing arrow to a different field/table. */
  const onReconnect = useCallback(
    async (oldEdge: Edge, newConnection: Connection) => {
      const relId =
        (oldEdge.data as RelationEdgeData | undefined)?.relId || oldEdge.id;
      // Optimistic visual reconnect; API rewrite below
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds) as RelEdge[]);
      const ok = await saveJoin(newConnection, { replaceId: relId, silentExisting: true });
      if (!ok) {
        // Rebuild from server truth
        setRelationships(await dpmsApi.relationships().catch(() => relationships));
      }
    },
    [relationships, saveJoin, setEdges]
  );

  const boardEdgeCount = useMemo(
    () =>
      relationships.filter(
        (r) => boardNames.has(r.child_table) && boardNames.has(r.parent_table)
      ).length,
    [relationships, boardNames]
  );

  // Build a live joined-table preview from the wires currently on the board.
  const viewJoined = useCallback(async () => {
    const links = relationships
      .filter((r) => boardNames.has(r.child_table) && boardNames.has(r.parent_table))
      .map((r) => ({
        child_table: r.child_table, child_col: r.child_col,
        parent_table: r.parent_table, parent_col: r.parent_col,
      }));
    if (!links.length) {
      showToast("Wire at least one link between two board tables first");
      return;
    }
    setJoinBusy(true);
    try {
      const res = await fetch(`${DPMS_URL}/api/join-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links, limit: 200 }),
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Join failed");
      setJoinView(body as JoinPreviewResult);
      setJoinSort({ col: null, dir: 1 });
      setJoinHidden((prev) => new Set([...prev].filter((c) => (body.columns || []).includes(c))));
      setJoinColFilters((prev) => {
        const next: Record<string, string> = {};
        Object.entries(prev).forEach(([k, v]) => {
          if ((body.columns || []).includes(k)) next[k] = v;
        });
        return next;
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Join failed");
    } finally {
      setJoinBusy(false);
    }
  }, [relationships, boardNames, showToast]);

  const joinVisibleCols = useMemo(
    () => (joinView ? joinView.columns.filter((c) => !joinHidden.has(c)) : []),
    [joinView, joinHidden]
  );

  const joinRows = useMemo(() => {
    if (!joinView) return [];
    let rows = joinView.rows;
    const f = joinFilter.trim().toLowerCase();
    if (f) {
      rows = rows.filter((r) =>
        joinView.columns.some((c) => String(r[c] ?? "").toLowerCase().includes(f))
      );
    }
    const cfs = Object.entries(joinColFilters)
      .map(([c, v]) => [c, v.trim().toLowerCase()] as const)
      .filter(([, v]) => v);
    if (cfs.length) {
      rows = rows.filter((r) => cfs.every(([c, v]) => String(r[c] ?? "").toLowerCase().includes(v)));
    }
    if (joinSort.col) {
      const c = joinSort.col;
      const dir = joinSort.dir;
      rows = [...rows].sort((a, b) => {
        const av = a[c] ?? "";
        const bv = b[c] ?? "";
        const an = parseFloat(av as string);
        const bn = parseFloat(bv as string);
        let cmp: number;
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "") cmp = an - bn;
        else cmp = String(av).localeCompare(String(bv));
        return cmp * dir;
      });
    }
    return rows;
  }, [joinView, joinFilter, joinColFilters, joinSort]);

  const setColFilter = useCallback((c: string, v: string) => {
    setJoinColFilters((prev) => {
      const n = { ...prev };
      if (v) n[c] = v;
      else delete n[c];
      return n;
    });
  }, []);

  const toggleHiddenCol = useCallback((c: string) => {
    setJoinHidden((prev) => {
      const n = new Set(prev);
      if (n.has(c)) {
        n.delete(c);
      } else {
        n.add(c);
        setJoinColFilters((f) => {
          if (!(c in f)) return f;
          const nf = { ...f };
          delete nf[c];
          return nf;
        });
      }
      return n;
    });
  }, []);

  const exportJoin = useCallback(async () => {
    if (!joinView) return;
    const links = relationships
      .filter((r) => boardNames.has(r.child_table) && boardNames.has(r.parent_table))
      .map((r) => ({
        child_table: r.child_table, child_col: r.child_col,
        parent_table: r.parent_table, parent_col: r.parent_col,
      }));
    setJoinExporting(true);
    try {
      const res = await fetch(`${DPMS_URL}/api/join-preview/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          links, q: joinFilter.trim(), col_filters: joinColFilters,
          columns: joinVisibleCols, limit: 100000,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `join_${(joinView.tables || []).slice(0, 4).join("_")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast(`CSV exported · ${res.headers.get("X-Row-Count") || "?"} rows`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed");
    } finally {
      setJoinExporting(false);
    }
  }, [joinView, relationships, boardNames, joinFilter, joinColFilters, joinVisibleCols, showToast]);

  // Stepwise: while the joined-table panel is open, re-run it whenever the set
  // of wires on the board changes, so the user watches the join grow.
  useEffect(() => {
    joinOpenRef.current = joinView !== null;
  }, [joinView]);
  useEffect(() => {
    if (joinOpenRef.current) void viewJoined();
  }, [boardEdgeCount, viewJoined]);

  async function autoDiscover() {
    try {
      setBusy(true);
      showToast("Discovering joins… may take a minute");
      const j = await dpmsApi.discover();
      setRelationships(j.relationships || []);
      showToast(`${j.candidates || 0} candidates · ${(j.relationships || []).length} total`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Discover failed");
    } finally {
      setBusy(false);
    }
  }

  function placeSelected() {
    const names = [...selected];
    if (!names.length) {
      showToast("Check 1–10 tables in the left list first");
      return;
    }
    void addTables(names);
  }

  function selectLinked() {
    const counts = new Map<string, number>();
    relationships.forEach((r) => {
      counts.set(r.child_table, (counts.get(r.child_table) || 0) + 1);
      counts.set(r.parent_table, (counts.get(r.parent_table) || 0) + 1);
    });
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([n]) => n);
    setSelected(new Set(top));
    showToast("Selected top linked tables — click Place selected");
  }

  async function autoPlace() {
    const names: string[] = [];
    relationships.forEach((r) => {
      if (!names.includes(r.child_table)) names.push(r.child_table);
      if (!names.includes(r.parent_table)) names.push(r.parent_table);
    });
    setNodes([]);
    nodesRef.current = [];
    await addTables(names.slice(0, 8));
    setTimeout(() => fitView({ padding: 0.15 }), 150);
  }

  function clearBoard() {
    setNodes([]);
    nodesRef.current = [];
    setEdges([]);
    setSuggestions([]);
    setCheckedSuggest(new Set());
    saveLayout([]);
    setSample(null);
    showToast("Board cleared — saved relationships kept. Place next 2–3 tables.");
  }

  async function saveCheckedSuggestions() {
    const toSave = suggestions.filter(
      (s) => checkedSuggest.has(s.id) && !s.saved && s.status !== "approved"
    );
    if (!toSave.length) {
      showToast("No suggested joins checked to save");
      return;
    }
    try {
      setBusy(true);
      for (const s of toSave) {
        await dpmsApi.saveRelationship({
          child_table: s.child_table,
          child_col: s.child_col,
          parent_table: s.parent_table,
          parent_col: s.parent_col,
          confidence: s.confidence,
          status: "approved",
          source: "manual",
          note: `saved from board suggestion: ${s.reason}`,
        });
      }
      setRelationships(await dpmsApi.relationships());
      showToast(`Saved ${toSave.length} relationship${toSave.length === 1 ? "" : "s"}`);
      recomputeSuggestions();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function nextBatch() {
    clearBoard();
  }

  function exportJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      folder: status?.folder,
      tables: nodes.map((n) => ({
        name: n.id,
        position: n.position,
        columns: n.data.columns,
      })),
      relationships: relationships.filter(
        (r) => boardNames.has(r.child_table) && boardNames.has(r.parent_table)
      ),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dpms-erd-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("Exported ERD JSON");
  }

  function exportSql() {
    const boardRels = relationships.filter(
      (r) => boardNames.has(r.child_table) && boardNames.has(r.parent_table)
    );
    if (!boardRels.length) {
      showToast("No relationships on board to export");
      return;
    }
    const tablesOnBoard = [...boardNames];
    const root = tablesOnBoard[0];
    const lines = [
      "-- DPMS join sketch (review before running)",
      `-- Root: ${root}`,
      `SELECT *`,
      `FROM ${root}`,
    ];
    const joined = new Set([root]);
    for (const r of boardRels) {
      if (joined.has(r.child_table) && !joined.has(r.parent_table)) {
        lines.push(
          `LEFT JOIN ${r.parent_table} ON ${r.child_table}.${r.child_col} = ${r.parent_table}.${r.parent_col}`
        );
        joined.add(r.parent_table);
      } else if (joined.has(r.parent_table) && !joined.has(r.child_table)) {
        lines.push(
          `LEFT JOIN ${r.child_table} ON ${r.child_table}.${r.child_col} = ${r.parent_table}.${r.parent_col}`
        );
        joined.add(r.child_table);
      } else if (joined.has(r.child_table) && joined.has(r.parent_table)) {
        lines.push(
          `-- already joined: ${r.child_table}.${r.child_col} = ${r.parent_table}.${r.parent_col}`
        );
      } else {
        lines.push(
          `-- pending: ${r.child_table}.${r.child_col} → ${r.parent_table}.${r.parent_col}`
        );
      }
    }
    lines.push("LIMIT 100;");
    const blob = new Blob([lines.join("\n")], { type: "text/sql" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dpms-joins-${new Date().toISOString().slice(0, 10)}.sql`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("Exported join SQL sketch");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables.filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q) ||
        (t.file || "").toLowerCase().includes(q)
    );
  }, [tables, search]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const name =
        e.dataTransfer.getData("application/dpms-table") ||
        e.dataTransfer.getData("text/plain");
      if (!name) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      void addTables([name], position);
    },
    [addTables, screenToFlowPosition]
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "300px minmax(0, 1fr)",
        gap: 14,
        height: "calc(100vh - 56px)",
        minHeight: 640,
      }}
    >
      {/* ── LEFT: always-visible table tray ───────────────────── */}
      <aside
        style={{
          border: "1px solid var(--line, #cbd5e1)",
          borderRadius: 18,
          background: "var(--panel, #fff)",
          boxShadow: "var(--shadow, 0 12px 30px rgba(15,23,42,.08))",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          height: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--line, #cbd5e1)",
            background: "linear-gradient(180deg,#eff6ff,#fff)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 900,
              fontSize: 13,
            }}
          >
            <Database size={15} />
            Tables
            <span style={badge}>
              {loadingTables ? "…" : `${tables.length} loaded`}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "#64748b", lineHeight: 1.45 }}>
            Drag a table onto the canvas (or check a few → Place). Wire field dots to join.
          </p>
        </div>

        {/* Restored action buttons */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            padding: "8px 10px",
            borderBottom: "1px solid var(--line, #e2e8f0)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            style={btnPrimary}
            onClick={() => void refreshMeta().then(() => showToast("Tables reloaded"))}
            disabled={loadingTables}
            title="Reload table list from DPMS"
          >
            {loadingTables ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Reload tables
          </button>
          <a
            href={DPMS_URL}
            target="_blank"
            rel="noreferrer"
            style={{ ...btn, textDecoration: "none", flex: 1, justifyContent: "center" }}
            title="Open classic DPMS viewer"
          >
            <ExternalLink size={13} /> Open DPMS
          </a>
          <button type="button" style={btnPrimary} onClick={placeSelected}>
            <Plus size={13} /> Place selected
          </button>
          <button type="button" style={btn} onClick={selectLinked}>
            <Link2 size={13} /> Select linked
          </button>
          <button type="button" style={btn} onClick={clearBoard}>
            <Trash2 size={13} /> Clear board
          </button>
        </div>

        <div style={{ padding: 10, borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: 10, color: "#64748b" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tables…"
              style={{
                width: "100%",
                padding: "8px 10px 8px 30px",
                borderRadius: 10,
                border: "1px solid var(--line, #cbd5e1)",
                background: "#fff",
                fontSize: 12.5,
                color: "#0f172a",
              }}
            />
          </div>
        </div>

        {/* Scrollable table list — explicit flex child so it always shows */}
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 200,
            overflowY: "auto",
            overflowX: "hidden",
            padding: 8,
            background: "#f8fafc",
          }}
        >
          {loadingTables ? (
            <div style={{ padding: 16, fontSize: 12, color: "#64748b", display: "flex", gap: 8, alignItems: "center" }}>
              <Loader2 size={14} className="animate-spin" /> Loading tables from {DPMS_URL}…
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                padding: 12,
                fontSize: 12,
                color: "#b91c1c",
                lineHeight: 1.45,
                background: "#fef2f2",
                borderRadius: 10,
                marginBottom: 8,
              }}
            >
              <b>Could not load tables</b>
              <div style={{ marginTop: 4 }}>{error}</div>
              <button
                type="button"
                style={{ ...btnPrimary, marginTop: 8, width: "100%" }}
                onClick={() => void refreshMeta()}
              >
                Retry
              </button>
              <div style={{ marginTop: 8, fontSize: 11, color: "#7f1d1d" }}>
                Start service:
                <br />
                <code style={{ fontSize: 10 }}>
                  python dpms_viewer.py --folder F:\dpms_tables_… --port 8010
                </code>
              </div>
            </div>
          ) : null}

          {!loadingTables && !error && tables.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: "#64748b" }}>
              No tables found. Point DPMS at the CSV folder and click Reload tables.
            </div>
          ) : null}

          {!loadingTables && filtered.length === 0 && tables.length > 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: "#64748b" }}>
              No tables match “{search}”.
            </div>
          ) : null}

          {filtered.map((t) => {
            const on = boardNames.has(t.name);
            const checked = selected.has(t.name);
            return (
              <div
                key={t.name}
                draggable={!on}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/dpms-table", t.name);
                  e.dataTransfer.setData("text/plain", t.name);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDoubleClick={() => {
                  if (!on) void addTables([t.name]);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 9px",
                  borderRadius: 10,
                  marginBottom: 4,
                  border: on ? "1px solid #86efac" : "1px solid #e2e8f0",
                  background: on ? "#ecfdf5" : "#fff",
                  cursor: on ? "default" : "grab",
                  userSelect: "none",
                }}
                title={on ? "Already on board" : "Drag onto canvas or double-click"}
              >
                <input
                  type="checkbox"
                  checked={checked || on}
                  disabled={on}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(t.name);
                      else n.delete(t.name);
                      return n;
                    });
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#0f172a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.name}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>
                    {t.cols || "?"} cols
                    {t.rows ? ` · ${t.rows.toLocaleString()} rows` : ""}
                    {on ? " · on board" : ""}
                  </div>
                </div>
                {!on ? (
                  <button
                    type="button"
                    style={{ ...btn, padding: "4px 8px", fontSize: 11, flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void addTables([t.name]);
                    }}
                    title="Add to board"
                  >
                    +
                  </button>
                ) : (
                  <span style={{ fontSize: 10, color: "#047857", fontWeight: 800 }}>ON</span>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid #e2e8f0",
            fontSize: 10.5,
            color: "#64748b",
            flexShrink: 0,
            background: "#fff",
          }}
        >
          Showing {filtered.length} / {tables.length} · board {nodes.length}/{MAX_BOARD}
          {status?.folder ? (
            <div style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={status.folder}>
              {status.folder}
            </div>
          ) : null}
        </div>
      </aside>

      {/* ── RIGHT: React Flow canvas ──────────────────────────── */}
      <section
        style={{
          border: "1px solid var(--line, #cbd5e1)",
          borderRadius: 18,
          background: "var(--panel, #fff)",
          boxShadow: "var(--shadow, 0 12px 30px rgba(15,23,42,.08))",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          height: "100%",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "10px 12px",
            borderBottom: "1px solid var(--line, #cbd5e1)",
            background: "var(--panel-2, #f8fafc)",
            flexShrink: 0,
          }}
        >
          <Database size={16} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 900 }}>Join board · 2–3 tables at a time</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              Place tables → check suggestions → Save relationships → Next batch
              {" · "}
              {nodes.length} on board · {boardEdgeCount} saved arrows ·{" "}
              {suggestions.filter((s) => !s.saved && s.status !== "approved").length} suggestions
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              style={btnPrimary}
              onClick={() => void saveCheckedSuggestions()}
              disabled={busy || !checkedSuggest.size}
              title="Save checked suggested joins as approved relationships"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save relationships
            </button>
            <button
              type="button"
              style={btnPrimary}
              onClick={() => void viewJoined()}
              disabled={joinBusy || boardEdgeCount === 0}
              title="Join the wired board tables and preview the combined table — updates as you add links"
            >
              {joinBusy ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
              View joined table
            </button>
            <button type="button" style={btn} onClick={nextBatch} title="Clear board, keep saved links">
              Next batch
            </button>
            <button type="button" style={btn} onClick={() => recomputeSuggestions()} disabled={nodes.length < 2}>
              <Sparkles size={13} /> Re-suggest
            </button>
            <button type="button" style={btn} onClick={() => void autoPlace()} disabled={busy || !tables.length}>
              <Wand2 size={13} /> Auto-place
            </button>
            <button type="button" style={btn} onClick={exportJson} disabled={!nodes.length}>
              <Download size={13} /> JSON
            </button>
            <button type="button" style={btn} onClick={exportSql} disabled={!nodes.length}>
              <Download size={13} /> SQL
            </button>
          </div>
        </header>

        {/* Suggestion checklist */}
        {nodes.length >= 2 ? (
          <div
            style={{
              borderBottom: "1px solid #e2e8f0",
              background: "#fff7ed",
              padding: "8px 12px",
              flexShrink: 0,
              maxHeight: 160,
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <b style={{ fontSize: 12 }}>Suggested joins for tables on board</b>
              <span style={{ fontSize: 11, color: "#9a3412" }}>
                Orange dashed arrows = not saved yet. Uncheck to hide, rewire dots to change, then Save.
              </span>
              <button
                type="button"
                style={{ ...btn, marginLeft: "auto", padding: "4px 8px", fontSize: 11 }}
                onClick={() => {
                  const unsaved = suggestions.filter((s) => !s.saved && s.status !== "approved");
                  setCheckedSuggest(new Set(unsaved.map((s) => s.id)));
                }}
              >
                Check all
              </button>
              <button
                type="button"
                style={{ ...btn, padding: "4px 8px", fontSize: 11 }}
                onClick={() => setCheckedSuggest(new Set())}
              >
                Uncheck all
              </button>
            </div>
            {suggestions.length === 0 ? (
              <div style={{ fontSize: 12, color: "#78716c" }}>
                No common columns found. Drag field dots to add your own join, then it saves immediately.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {suggestions.map((s) => {
                  const saved = s.saved || s.status === "approved";
                  const checked = saved || checkedSuggest.has(s.id);
                  return (
                    <label
                      key={s.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        padding: "4px 6px",
                        borderRadius: 8,
                        background: saved ? "#ecfdf5" : checked ? "#ffedd5" : "#fff",
                        border: "1px solid " + (saved ? "#86efac" : checked ? "#fdba74" : "#e7e5e4"),
                        cursor: saved ? "default" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={saved}
                        onChange={(e) => {
                          setCheckedSuggest((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(s.id);
                            else n.delete(s.id);
                            return n;
                          });
                        }}
                      />
                      <span style={{ fontWeight: 750 }}>
                        {s.child_table}.{s.child_col}
                      </span>
                      <span style={{ color: "#78716c" }}>→</span>
                      <span style={{ fontWeight: 750 }}>
                        {s.parent_table}.{s.parent_col}
                      </span>
                      <span style={{ fontSize: 10, color: "#78716c" }}>
                        {s.reason} · {s.confidence}%
                      </span>
                      {saved ? (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 10,
                            fontWeight: 800,
                            color: "#047857",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <Check size={11} /> Saved
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onNodeDragStop={(_, __, all) => {
              nodesRef.current = all as TableNode[];
              saveLayout(all);
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            edgesReconnectable
            reconnectRadius={24}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={32}
            fitView
            snapToGrid
            snapGrid={[18, 18]}
            deleteKeyCode={["Backspace", "Delete"]}
            onNodesDelete={(deleted) => {
              const remaining = nodes.filter((n) => !deleted.some((d) => d.id === n.id));
              nodesRef.current = remaining;
              saveLayout(remaining);
              // Arrows auto-refresh via boardNames effect — only board tables keep edges
            }}
            onEdgesDelete={(deleted) => {
              // Persist deletes when user selects an arrow and presses Delete
              deleted.forEach((e) => {
                const rid = (e.data as RelationEdgeData | undefined)?.relId || e.id;
                void deleteRel(rid);
              });
            }}
            proOptions={{ hideAttribution: true }}
            style={{ background: "#f1f5f9", width: "100%", height: "100%" }}
            defaultEdgeOptions={{
              type: "relation",
              reconnectable: true,
              interactionWidth: 20,
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#cbd5e1" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeStrokeWidth={2}
              nodeColor={() => "#93c5fd"}
              maskColor="rgba(15,23,42,.08)"
            />
          </ReactFlow>

          {!nodes.length ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                color: "#64748b",
                fontSize: 13,
                textAlign: "center",
                padding: 40,
                lineHeight: 1.55,
              }}
            >
              <div>
                <b style={{ display: "block", fontSize: 15, color: "#0f172a", marginBottom: 6 }}>
                  Drop tables here
                </b>
                {loadingTables
                  ? "Loading table list…"
                  : tables.length
                    ? `${tables.length} tables ready on the left — drag 3–4 onto this board.`
                    : "Waiting for DPMS tables…"}
                <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
                  Arrows appear only between tables on this board.
                  <br />
                  Drag field dots to add · drag arrow ends to change · ⠿ header to move.
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                position: "absolute",
                left: 12,
                top: 12,
                zIndex: 5,
                pointerEvents: "none",
                background: "rgba(255,255,255,.92)",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 11,
                color: "#334155",
                lineHeight: 1.45,
                boxShadow: "0 6px 16px rgba(15,23,42,.08)",
                maxWidth: 320,
              }}
            >
              <b style={{ color: "#0f172a" }}>Board only:</b> {boardEdgeCount} arrow
              {boardEdgeCount === 1 ? "" : "s"} among {nodes.length} table
              {nodes.length === 1 ? "" : "s"}
              <br />
              ⠿ drag header = move · field dots = add arrow · drag arrow end = change · Del = remove
            </div>
          )}
        </div>

        {joinView ? (
          <div
            style={{
              flexShrink: 0,
              border: "1px solid var(--line, #cbd5e1)",
              borderRadius: 14,
              background: "#fff",
              marginTop: 10,
              overflow: "visible",
              boxShadow: "0 8px 24px rgba(15,23,42,.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderBottom: "1px solid #e2e8f0",
                background: "#f8fafc",
                flexWrap: "wrap",
                position: "relative",
              }}
            >
              <b style={{ fontSize: 13 }}>Joined table</b>
              <span style={{ fontSize: 11.5, color: "#0f172a", fontWeight: 700 }}>
                {(joinView.tables || []).join(" ⋈ ")}
              </span>
              <span style={{ fontSize: 11, color: "#64748b" }}>
                {joinRows.length}/{joinView.rows.length} rows · {joinVisibleCols.length}/{joinView.columns.length} cols
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ position: "relative" }}>
                  <Search size={12} style={{ position: "absolute", left: 8, top: 8, color: "#94a3b8" }} />
                  <input
                    value={joinFilter}
                    onChange={(e) => setJoinFilter(e.target.value)}
                    placeholder="Filter rows…"
                    style={{ padding: "6px 8px 6px 26px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12, width: 150 }}
                  />
                </div>
                <div style={{ position: "relative" }}>
                  <button type="button" style={btn} onClick={() => setJoinColsOpen((o) => !o)}>
                    Columns ▾
                  </button>
                  {joinColsOpen ? (
                    <div
                      style={{
                        position: "absolute", top: "110%", right: 0, zIndex: 60, background: "#fff",
                        border: "1px solid #cbd5e1", borderRadius: 10, boxShadow: "0 16px 40px rgba(15,23,42,.18)",
                        padding: 10, maxHeight: 320, overflow: "auto", minWidth: 240,
                      }}
                    >
                      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                        <button type="button" style={btn} onClick={() => setJoinHidden(new Set())}>Show all</button>
                        <button type="button" style={btn} onClick={() => setJoinHidden(new Set(joinView.columns))}>Hide all</button>
                      </div>
                      {Object.entries(groupColsByTable(joinView.columns)).map(([t, cols]) => (
                        <div key={t}>
                          <div style={{ fontWeight: 800, fontSize: 11, color: "#334155", margin: "6px 0 3px" }}>{t}</div>
                          {cols.map((c) => (
                            <label key={c} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, padding: "2px 0", cursor: "pointer" }}>
                              <input type="checkbox" checked={!joinHidden.has(c)} onChange={() => toggleHiddenCol(c)} />
                              {c.split(".").slice(1).join(".") || c}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  style={btn}
                  onClick={() => {
                    setJoinFilter("");
                    setJoinColFilters({});
                  }}
                >
                  Clear filters
                </button>
                <button type="button" style={btn} onClick={() => setJoinSort({ col: null, dir: 1 })}>
                  Clear sort
                </button>
                <button type="button" style={btnPrimary} onClick={() => void exportJoin()} disabled={joinExporting}>
                  {joinExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Export CSV
                </button>
                <button
                  type="button"
                  style={btn}
                  onClick={() => {
                    void navigator.clipboard?.writeText(joinView.sql || "");
                    showToast("Join SQL copied");
                  }}
                >
                  Copy SQL
                </button>
                <button type="button" style={btn} onClick={() => setJoinView(null)}>
                  Close
                </button>
              </div>
            </div>
            {joinView.note ? (
              <div style={{ fontSize: 11, color: "#64748b", padding: "6px 12px" }}>
                {joinView.note} · click a header to sort · Export = full join, visible columns, current filter.
              </div>
            ) : null}
            <div style={{ overflow: "auto", maxHeight: 360 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 11.5,
                  whiteSpace: "nowrap",
                  width: "max-content",
                  minWidth: "100%",
                }}
              >
                <thead>
                  <tr>
                    {joinVisibleCols.map((c) => (
                      <th
                        key={c}
                        title={c}
                        onClick={() =>
                          setJoinSort((s) => (s.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: 1 }))
                        }
                        style={{
                          position: "sticky",
                          top: 0,
                          background: c.split(".")[0] === joinView.base_table ? "#dbeafe" : "#eff6ff",
                          textAlign: "left",
                          padding: "6px 9px",
                          borderBottom: "1px solid #cbd5e1",
                          fontWeight: 800,
                          color: "#0f172a",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        {c}
                        {joinSort.col === c ? (joinSort.dir === 1 ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {joinVisibleCols.map((c) => (
                      <th
                        key={c}
                        style={{
                          position: "sticky",
                          top: 27,
                          background: "#f8fafc",
                          padding: "2px 4px",
                          zIndex: 1,
                          borderBottom: "1px solid #e2e8f0",
                        }}
                      >
                        <input
                          value={joinColFilters[c] || ""}
                          onChange={(e) => setColFilter(c, e.target.value)}
                          placeholder="filter…"
                          style={{
                            width: "100%",
                            minWidth: 70,
                            fontSize: 11,
                            padding: "3px 5px",
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {joinRows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      {joinVisibleCols.map((c) => (
                        <td
                          key={c}
                          title={String(r[c] ?? "")}
                          style={{
                            padding: "4px 9px",
                            borderBottom: "1px solid #eef2f7",
                            maxWidth: 240,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {r[c] == null || r[c] === "" ? <i style={{ color: "#94a3b8" }}>—</i> : String(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {sample ? (
          // No height cap or padding here: JoinInspector owns its own layout
          // and internal scrolling, and wrapping it in a 200px scroller
          // squashed the health metrics out of view.
          <div style={{ flexShrink: 0 }}>
            <JoinInspector
              rel={sample.rel}
              sample={sample.data}
              busy={busy}
              onClose={() => setSample(null)}
              onApprove={async () => {
                await dpmsApi.saveRelationship({
                  ...sample.rel, status: "approved",
                  confidence: sample.rel.confidence || 100,
                });
                setRelationships(await dpmsApi.relationships());
                setSample((s2) => (s2 ? { ...s2, rel: { ...s2.rel, status: "approved" } } : s2));
                showToast("Link approved");
              }}
              onReverse={() => {
                void reverseRel(sample.rel.id || dpmsApi.relId(sample.rel));
                setSample(null);
              }}
              onDelete={() => {
                void deleteRel(sample.rel.id || dpmsApi.relId(sample.rel));
                setSample(null);
              }}
            />
          </div>
        ) : null}
      </section>

      {toast ? (
        <div
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 100,
            background: "#0f172a",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 12,
            fontSize: 12.5,
            fontWeight: 700,
            boxShadow: "0 12px 30px rgba(0,0,0,.2)",
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export default function DpmsErdStudio() {
  return (
    <ReactFlowProvider>
      <StudioInner />
    </ReactFlowProvider>
  );
}

const badge: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  border: "1px solid #93c5fd",
  background: "#dbeafe",
  borderRadius: 999,
  padding: "1px 8px",
  color: "#0a0a0a",
};

const btn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 10,
  background: "var(--panel, #fff)",
  color: "var(--ink, #0f172a)",
  padding: "7px 10px",
  fontSize: 12,
  fontWeight: 750,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "#dbeafe",
  borderColor: "#93c5fd",
  color: "#0a0a0a",
  fontWeight: 850,
  flex: "1 1 auto",
};
