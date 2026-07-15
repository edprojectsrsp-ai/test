"use client";

/**
 * 4D BIM Studio — 3D model (IFC / GLB) + live plan_activities schedule.
 *
 * The 4th dimension: a date scrubber drives element appearance from the linked
 * activity's dates (actuals win over planned) — future work is ghosted, work in
 * progress glows amber, completed work renders solid. Elements are linked to
 * activities by clicking them in the viewer; links persist on the backend
 * (/api/v1/bim/*). A procedural demo structure is available so the 4D engine
 * can be exercised against real scheme dates before a real model is uploaded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  Box, Boxes, Calendar, Link2, Loader2, Pause, Play, Trash2, Upload, Wand2, X,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";
const DAY_MS = 86400000;

type Scheme = { id: number; name: string };
type BimModel = {
  model_id: number; scheme_id: number; scheme_name: string; model_name: string;
  file_name: string; file_format: "ifc" | "glb" | "gltf"; file_size_mb: number;
  link_count: number;
};
type ActivityRow = {
  activity_id: number; activity_name: string; activity_category: string | null;
  planned_start_date: string | null; planned_finish_date: string | null;
  actual_start_date: string | null; actual_finish_date: string | null;
  expected_finish_date: string | null; weight_pct: number | null;
  scope_qty: number | null; actuals_till_last_fy: number | null;
  actual_monthly?: { month_date: string; qty: number }[];
  package_id: number; package_name: string; pkg_weight: number | null;
  element_keys?: string[];
};

type ElementStatus =
  | "future" | "active" | "done" | "unlinked"          // 4D status mode
  | "ahead" | "ontrack" | "behind" | "nodata";          // plan-vs-actual mode
const STATUS_COLOR: Record<ElementStatus, string> = {
  future: "#475569", active: "#f59e0b", done: "#22c55e", unlinked: "#94a3b8",
  ahead: "#22c55e", ontrack: "#3b82f6", behind: "#ef4444", nodata: "#94a3b8",
};
const STATUS_LABEL: Record<ElementStatus, string> = {
  future: "Not started", active: "In progress", done: "Completed", unlinked: "Unlinked",
  ahead: "Ahead of plan", ontrack: "On track", behind: "Behind plan", nodata: "No actuals",
};
const MODE_LEGEND: Record<"status" | "variance", ElementStatus[]> = {
  status: ["future", "active", "done", "unlinked"],
  variance: ["future", "ahead", "ontrack", "behind", "nodata", "unlinked"],
};

/* ------------------------------------------------------------------ dates */

function actStart(a: ActivityRow): number | null {
  const d = a.actual_start_date || a.planned_start_date;
  return d ? new Date(d).getTime() : null;
}
function actFinish(a: ActivityRow): number | null {
  const d = a.actual_finish_date || a.expected_finish_date || a.planned_finish_date;
  return d ? new Date(d).getTime() : null;
}
function statusAt(a: ActivityRow | undefined, t: number): ElementStatus {
  if (!a) return "unlinked";
  const s = actStart(a), f = actFinish(a);
  if (s == null || f == null) return "unlinked";
  if (t < s) return "future";
  if (t > f) return "done";
  return "active";
}

/** Time-phased planned fraction complete at t (0..1). */
function plannedFracAt(a: ActivityRow, t: number): number | null {
  const s = actStart(a), f = actFinish(a);
  if (s == null || f == null) return null;
  if (f <= s) return t >= f ? 1 : 0;
  return Math.min(1, Math.max(0, (t - s) / (f - s)));
}

/** Actual fraction complete at t from monthly-bucketed daily_actuals + FY carry-forward. */
function actualFracAt(a: ActivityRow, t: number): number | null {
  const scope = Number(a.scope_qty) || 0;
  if (scope <= 0) return null;
  const carry = Number(a.actuals_till_last_fy) || 0;
  const rows = a.actual_monthly || [];
  if (!rows.length && carry <= 0) return null;
  let sum = carry;
  for (const r of rows) {
    if (new Date(r.month_date).getTime() <= t) sum += Number(r.qty) || 0;
  }
  return Math.min(1, sum / scope);
}

/** Plan-vs-actual variance status at t (±5% band = on track). */
function varianceAt(a: ActivityRow | undefined, t: number): ElementStatus {
  if (!a) return "unlinked";
  const planned = plannedFracAt(a, t);
  if (planned == null) return "nodata";
  if (statusAt(a, t) === "future") return "future";
  const actual = actualFracAt(a, t);
  if (actual == null) return "nodata";
  const diff = actual - planned;
  if (diff > 0.05) return "ahead";
  if (diff < -0.05) return "behind";
  return "ontrack";
}
function fmtDate(t: number) {
  return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/* --------------------------------------------------- name → activity match */

// Construction vocabulary → tokens expected in activity/category names.
const SYNONYMS: [RegExp, string[]][] = [
  [/foundation|footing|pile|slab|pedestal|concrete|excavat|civil/i, ["civil"]],
  [/column|beam|deck|truss|girder|steel|roof|clad|sheet|shed|structur/i, ["steel", "structur", "building", "sheeting"]],
  [/furnace|tank|conveyor|stack|junction|pump|mill|shell|mechanical|equipment|erect/i, ["mechanical", "plant", "equipment", "erection", "supply"]],
  [/cable|transformer|control|panel|electric|light|instrument/i, ["electrical"]],
  [/refractor|brick|lining/i, ["refractor"]],
  [/commission|test/i, ["commission"]],
];

function scoreMatch(elementName: string, a: ActivityRow): number {
  const atext = `${a.activity_name} ${a.activity_category || ""}`.toLowerCase();
  let score = 0;
  for (const t of elementName.toLowerCase().split(/[^a-z]+/)) {
    if (t.length >= 4 && atext.includes(t)) score += 3;
  }
  for (const [re, keys] of SYNONYMS) {
    if (re.test(elementName)) for (const k of keys) if (atext.includes(k)) score += 2;
  }
  return score;
}

/** Family name for "select similar": text before the first digit/# suffix. */
function familyOf(name: string): string {
  return name.replace(/[\d#].*$/, "").trim().toLowerCase();
}

/* --------------------------------------------------------- three.js world */

type ElementRec = {
  key: string;
  name: string;
  meshes: THREE.Mesh[];
};

class World {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  modelGroup = new THREE.Group();
  elements = new Map<string, ElementRec>();
  groups = new Map<string, string[]>(); // group label -> element keys (storeys, types, families)
  raycaster = new THREE.Raycaster();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color("#09090b");
    this.scene.fog = new THREE.Fog("#09090b", 400, 1200);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    this.camera.position.set(60, 45, 60);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(80, 120, 60);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8899ff, 0.35);
    fill.position.set(-60, 40, -80);
    this.scene.add(fill);

    const grid = new THREE.GridHelper(400, 40, 0x27272a, 0x18181b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(grid);
    this.scene.add(this.modelGroup);

    const loop = () => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clearModel() {
    this.modelGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat?.dispose());
      }
    });
    this.modelGroup.clear();
    this.elements.clear();
    this.groups.clear();
  }

  addToGroup(label: string, key: string) {
    if (!this.groups.has(label)) this.groups.set(label, []);
    this.groups.get(label)!.push(key);
  }

  /** Group elements by name family ("Column C1".."Column C24" → "column"). */
  buildFamilyGroups() {
    this.elements.forEach((rec, key) => {
      const fam = familyOf(rec.name);
      if (fam) this.addToGroup(fam, key);
    });
    // drop singleton groups — they add noise, not selection power
    for (const [label, keys] of [...this.groups]) {
      if (keys.length < 2) this.groups.delete(label);
    }
  }

  registerMesh(key: string, name: string, mesh: THREE.Mesh) {
    const mat = mesh.material as THREE.MeshLambertMaterial;
    mesh.userData.elementKey = key;
    mesh.userData.orig = { color: mat.color.getHex(), opacity: mat.opacity, transparent: mat.transparent };
    let rec = this.elements.get(key);
    if (!rec) {
      rec = { key, name, meshes: [] };
      this.elements.set(key, rec);
    }
    rec.meshes.push(mesh);
  }

  fitCamera() {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z);
    this.camera.position.set(center.x + radius * 0.9, center.y + radius * 0.7, center.z + radius * 0.9);
    this.camera.far = radius * 20 + 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.scene.fog = new THREE.Fog("#09090b", radius * 4, radius * 12);
  }

  pick(ndcX: number, ndcY: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(this.modelGroup.children, true);
    for (const h of hits) {
      const key = h.object.userData?.elementKey;
      const mat = (h.object as THREE.Mesh).material as THREE.MeshLambertMaterial;
      if (key && mat && mat.opacity > 0.12) return key as string;
    }
    return hits.length ? (hits[0].object.userData?.elementKey as string) || null : null;
  }

  /** Apply 4D shading: per element status + selection highlight. */
  shade(statusOf: (key: string) => ElementStatus, selectedKeys: Set<string>, dimUnlinked: boolean) {
    this.elements.forEach((rec) => {
      const st = statusOf(rec.key);
      const selected = selectedKeys.has(rec.key);
      rec.meshes.forEach((mesh) => {
        const mat = mesh.material as THREE.MeshLambertMaterial;
        const orig = mesh.userData.orig as { color: number; opacity: number; transparent: boolean };
        if (st === "done") {
          mat.color.setHex(orig.color);
          mat.opacity = orig.opacity;
          mat.transparent = orig.transparent;
        } else if (st === "future") {
          mat.color.set(STATUS_COLOR.future);
          mat.opacity = 0.07;
          mat.transparent = true;
        } else if (st === "unlinked" || st === "nodata") {
          mat.color.setHex(st === "nodata" ? 0x94a3b8 : orig.color);
          mat.opacity = dimUnlinked ? 0.25 : orig.opacity;
          mat.transparent = dimUnlinked ? true : orig.transparent;
        } else {
          // active / ahead / ontrack / behind — solid state color
          mat.color.set(STATUS_COLOR[st]);
          mat.opacity = 1;
          mat.transparent = false;
        }
        mat.emissive.set(selected ? "#2563eb" : "#000000");
        mat.emissiveIntensity = selected ? 0.9 : 0;
        mat.depthWrite = mat.opacity > 0.5;
        mat.needsUpdate = true;
      });
    });
  }

  dispose() {
    this.disposed = true;
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

/* ----------------------------------------------------------- IFC loading */

async function loadIfcIntoWorld(world: World, data: Uint8Array, onProgress: (n: number) => void) {
  const WebIFC = await import("web-ifc");
  const ifc = new WebIFC.IfcAPI();
  ifc.SetWasmPath("/", true);
  await ifc.Init();
  const modelID = ifc.OpenModel(data);
  let count = 0;
  try {
    ifc.StreamAllMeshes(modelID, (flatMesh: any) => {
      const key = String(flatMesh.expressID);
      const n = flatMesh.geometries.size();
      for (let i = 0; i < n; i++) {
        const placed = flatMesh.geometries.get(i);
        const geomData = ifc.GetGeometry(modelID, placed.geometryExpressID);
        const verts = ifc.GetVertexArray(geomData.GetVertexData(), geomData.GetVertexDataSize());
        const indices = ifc.GetIndexArray(geomData.GetIndexData(), geomData.GetIndexDataSize());
        const geometry = new THREE.BufferGeometry();
        const buf = new THREE.InterleavedBuffer(new Float32Array(verts), 6);
        geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(buf, 3, 0));
        geometry.setAttribute("normal", new THREE.InterleavedBufferAttribute(buf, 3, 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        const c = placed.color;
        const material = new THREE.MeshLambertMaterial({
          color: new THREE.Color(c.x, c.y, c.z),
          transparent: c.w < 1,
          opacity: c.w,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.matrix.fromArray(placed.flatTransformation);
        mesh.matrixAutoUpdate = false;
        world.modelGroup.add(mesh);
        world.registerMesh(key, `IFC #${key}`, mesh);
        // @ts-ignore web-ifc geometry handles expose delete()
        geomData.delete?.();
      }
      count++;
      if (count % 100 === 0) onProgress(count);
    });
    // Try to name elements from IFC properties (best-effort, capped for speed),
    // and group them by IFC entity type (IfcColumn, IfcWall, …).
    let named = 0;
    for (const key of world.elements.keys()) {
      if (named >= 3000) break;
      try {
        const line: any = ifc.GetLine(modelID, Number(key));
        const nm = line?.Name?.value || line?.ObjectType?.value;
        if (nm) world.elements.get(key)!.name = String(nm);
        const typeName = ifc.GetNameFromTypeCode?.(ifc.GetLineType(modelID, Number(key)));
        if (typeName) world.addToGroup(String(typeName).replace(/^IFC/i, "Ifc"), key);
      } catch { /* geometry-only ids are fine unnamed */ }
      named++;
    }
    // Group by building storey (IfcRelContainedInSpatialStructure).
    try {
      const relIds = ifc.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
      for (let i = 0; i < relIds.size(); i++) {
        const rel: any = ifc.GetLine(modelID, relIds.get(i));
        const storeyId = rel?.RelatingStructure?.value;
        if (!storeyId) continue;
        let label = `Level ${storeyId}`;
        try {
          const s: any = ifc.GetLine(modelID, storeyId);
          label = s?.Name?.value ? String(s.Name.value) : label;
        } catch { /* unnamed storey */ }
        for (const h of rel?.RelatedElements || []) {
          const key = String(h?.value ?? "");
          if (world.elements.has(key)) world.addToGroup(`Storey: ${label}`, key);
        }
      }
    } catch { /* models without spatial structure still render fine */ }
  } finally {
    ifc.CloseModel(modelID);
  }
  return count;
}

async function loadGlbIntoWorld(world: World, data: ArrayBuffer) {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(data, "");
  let idx = 0;
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const src of meshes) {
    const geometry = (src.geometry as THREE.BufferGeometry).clone();
    geometry.applyMatrix4(src.matrixWorld);
    const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial;
    const material = new THREE.MeshLambertMaterial({
      color: srcMat?.color ? srcMat.color.clone() : new THREE.Color("#a1a1aa"),
      transparent: (srcMat?.opacity ?? 1) < 1,
      opacity: srcMat?.opacity ?? 1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const key = src.name || `mesh_${idx}`;
    world.modelGroup.add(mesh);
    world.registerMesh(key, src.name || key, mesh);
    idx++;
  }
  world.buildFamilyGroups();
  return meshes.length;
}

/* ------------------------------------------------- procedural demo plant */

function buildDemoPlant(world: World): string[] {
  const add = (key: string, name: string, geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z);
    world.modelGroup.add(mesh);
    world.registerMesh(key, name, mesh);
  };
  const keys: string[] = [];
  const K = (k: string) => { keys.push(k); return k; };

  // Foundations
  for (let i = 0; i < 6; i++)
    add(K(`fdn_${i}`), `Foundation F${i + 1}`, new THREE.BoxGeometry(9, 1.2, 9), "#78716c", (i % 3) * 14 - 14, 0.6, i < 3 ? -8 : 8);
  // Columns
  let c = 0;
  for (const px of [-14, 0, 14]) for (const pz of [-8, 8]) for (const dx of [-3.5, 3.5]) for (const dz of [-3.5, 3.5])
    add(K(`col_${c++}`), `Column C${c}`, new THREE.BoxGeometry(0.8, 14, 0.8), "#64748b", px + dx, 8.2, pz + dz);
  // Beams / floors
  for (let i = 0; i < 3; i++) {
    add(K(`flr_${i}a`), `Deck L${i + 1} North`, new THREE.BoxGeometry(38, 0.6, 9), "#475569", 0, 6 + i * 4.5, -8);
    add(K(`flr_${i}b`), `Deck L${i + 1} South`, new THREE.BoxGeometry(38, 0.6, 9), "#475569", 0, 6 + i * 4.5, 8);
  }
  // Building shell
  add(K("shell_roof"), "Shed Roof", new THREE.BoxGeometry(40, 0.8, 26), "#334155", 0, 15.6, 0);
  add(K("shell_wall_n"), "Cladding North", new THREE.BoxGeometry(40, 9, 0.4), "#3b82f6", 0, 10.5, -12.8);
  add(K("shell_wall_s"), "Cladding South", new THREE.BoxGeometry(40, 9, 0.4), "#3b82f6", 0, 10.5, 12.8);
  // Equipment
  add(K("eq_furnace"), "Furnace Shell", new THREE.CylinderGeometry(4, 4.6, 10, 24), "#b45309", -10, 6.2, 0);
  add(K("eq_stack"), "Stack", new THREE.CylinderGeometry(1.2, 1.6, 26, 20), "#9ca3af", -10, 14, -4.5);
  add(K("eq_tank1"), "Storage Tank 1", new THREE.CylinderGeometry(3, 3, 6, 24), "#0ea5e9", 22, 3.2, -14);
  add(K("eq_tank2"), "Storage Tank 2", new THREE.CylinderGeometry(3, 3, 6, 24), "#0ea5e9", 30, 3.2, -14);
  add(K("eq_conveyor"), "Conveyor Gallery", new THREE.BoxGeometry(26, 1.6, 2.4), "#eab308", 22, 9, 4);
  add(K("eq_junction"), "Junction House", new THREE.BoxGeometry(5, 8, 5), "#f97316", 34, 4.2, 4);
  // E&I / commissioning items
  add(K("ei_ctrl"), "Control Room", new THREE.BoxGeometry(8, 4, 6), "#8b5cf6", 12, 2.2, 18);
  add(K("ei_transformer"), "Transformer Yard", new THREE.BoxGeometry(6, 3, 5), "#a78bfa", 24, 1.7, 18);
  add(K("ei_cabling"), "Cable Trestle", new THREE.BoxGeometry(20, 0.8, 1.2), "#c4b5fd", 18, 5.5, 18);
  world.buildFamilyGroups();
  return keys;
}

/* ================================================================== page */

export default function BimStudio() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<World | null>(null);

  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [schemeId, setSchemeId] = useState<string>("");
  const [models, setModels] = useState<BimModel[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [links, setLinks] = useState<Map<string, number>>(new Map()); // elementKey -> activity_id
  const [demoMode, setDemoMode] = useState(false);
  const [loading, setLoading] = useState("");
  const [err, setErr] = useState("");
  const [elementCount, setElementCount] = useState(0);

  const [selKeys, setSelKeys] = useState<string[]>([]);
  const [linkActivityId, setLinkActivityId] = useState("");
  const [dimUnlinked, setDimUnlinked] = useState(true);
  const [mode, setMode] = useState<"status" | "variance">("status");
  const [groups, setGroups] = useState<{ label: string; count: number }[]>([]);

  const captureGroups = () => {
    const world = worldRef.current;
    setGroups(world ? [...world.groups].map(([label, keys]) => ({ label, count: keys.length })) : []);
  };

  // timeline
  const [dayIdx, setDayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3); // days per tick
  const [showUpload, setShowUpload] = useState(false);

  const actById = useMemo(() => {
    const m = new Map<number, ActivityRow>();
    activities.forEach((a) => m.set(a.activity_id, a));
    return m;
  }, [activities]);

  const window4d = useMemo(() => {
    let min = Infinity, max = -Infinity;
    activities.forEach((a) => {
      const s = actStart(a), f = actFinish(a);
      if (s != null) { min = Math.min(min, s); }
      if (f != null) { max = Math.max(max, f); }
    });
    if (!isFinite(min) || !isFinite(max) || max <= min) return null;
    return { min, max, days: Math.ceil((max - min) / DAY_MS) };
  }, [activities]);

  const currentT = window4d ? window4d.min + dayIdx * DAY_MS : Date.now();

  /* ---------- three.js lifecycle ---------- */
  useEffect(() => {
    if (!canvasRef.current) return;
    const world = new World(canvasRef.current);
    worldRef.current = world;
    const onResize = () => {
      const el = wrapRef.current;
      if (el) world.resize(el.clientWidth, el.clientHeight);
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { ro.disconnect(); world.dispose(); worldRef.current = null; };
  }, []);

  /* ---------- data loading ---------- */
  useEffect(() => {
    authFetch(`${API}/dashboard/scheme-cards`).then((r) => r.json()).then((d) => {
      if (!Array.isArray(d)) return;
      setSchemes(d.map((s: any) => ({ id: s.id, name: s.name })));
      setSchemeId((c) => c || String(d.find((s: any) => s.id === 74)?.id || d[0]?.id || ""));
    }).catch(() => {});
  }, []);

  const refreshModels = useCallback(() => {
    if (!schemeId) return;
    authFetch(`${API}/bim/models?scheme_id=${schemeId}`).then((r) => r.json())
      .then((d) => setModels(d.models || [])).catch(() => setModels([]));
  }, [schemeId]);

  useEffect(() => {
    refreshModels();
    setModelId(""); setDemoMode(false); setSelKeys([]);
    worldRef.current?.clearModel();
    setElementCount(0); setLinks(new Map()); setGroups([]);
    if (!schemeId) return;
    authFetch(`${API}/bim/schemes/${schemeId}/activities`).then((r) => r.json())
      .then((d) => setActivities(d.activities || [])).catch(() => setActivities([]));
  }, [schemeId, refreshModels]);

  useEffect(() => { setDayIdx(window4d ? window4d.days : 0); }, [window4d]);

  /* ---------- model loading ---------- */
  const loadModel = useCallback(async (mid: string) => {
    const world = worldRef.current;
    const model = models.find((m) => String(m.model_id) === mid);
    if (!world || !model) return;
    setErr(""); setDemoMode(false); setSelKeys([]);
    setLoading("Downloading model…");
    try {
      const res = await authFetch(`${API}/bim/models/${mid}/file`);
      if (!res.ok) throw new Error(`file fetch failed (${res.status})`);
      const buf = await res.arrayBuffer();
      world.clearModel();
      setLoading("Building geometry…");
      if (model.file_format === "ifc") {
        await loadIfcIntoWorld(world, new Uint8Array(buf), (n) => setLoading(`Building geometry… ${n} elements`));
      } else {
        await loadGlbIntoWorld(world, buf);
      }
      world.fitCamera();
      setElementCount(world.elements.size);
      captureGroups();
      const lr = await authFetch(`${API}/bim/models/${mid}/links`).then((r) => r.json());
      const m = new Map<string, number>();
      (lr.links || []).forEach((l: any) => m.set(l.element_key, l.activity_id));
      setLinks(m);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading("");
    }
  }, [models]);

  useEffect(() => { if (modelId) loadModel(modelId); }, [modelId, loadModel]);

  const loadDemo = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    setModelId(""); setErr(""); setSelKeys([]);
    world.clearModel();
    buildDemoPlant(world);
    world.fitCamera();
    setElementCount(world.elements.size);
    captureGroups();
    setDemoMode(true);
    setLinks(new Map()); // start unlinked — Auto-match or click-to-link from here
  }, []);

  /* ---------- auto-match ---------- */
  const autoMatch = useCallback(async () => {
    const world = worldRef.current;
    if (!world || world.elements.size === 0) return;
    setErr("");
    const dated = activities.filter((a) => actStart(a) != null && actFinish(a) != null)
      .sort((a, b) => actStart(a)! - actStart(b)!);
    const proposed: { element_key: string; activity_id: number; element_name: string }[] = [];
    world.elements.forEach((rec, key) => {
      if (links.has(key)) return;
      let best: ActivityRow | null = null;
      let bestScore = 0;
      for (const a of dated) {
        const s = scoreMatch(rec.name, a);
        if (s > bestScore) { best = a; bestScore = s; }
      }
      if (best && bestScore >= 2) {
        proposed.push({ element_key: key, activity_id: best.activity_id, element_name: rec.name });
      }
    });
    if (!proposed.length) { setErr("Auto-match: no element names matched activity names"); return; }
    if (!demoMode && modelId) {
      try {
        const res = await authFetch(`${API}/bim/models/${modelId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proposed),
        });
        if (!res.ok) throw new Error("auto-match save failed");
        refreshModels();
      } catch (e: any) { setErr(String(e?.message || e)); return; }
    }
    setLinks((m) => {
      const n = new Map(m);
      proposed.forEach((l) => n.set(l.element_key, l.activity_id));
      return n;
    });
  }, [activities, links, demoMode, modelId, refreshModels]);

  /* ---------- 4D shading ---------- */
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.shade(
      (key) => {
        const a = actById.get(links.get(key) ?? -1);
        return mode === "variance" ? varianceAt(a, currentT) : statusAt(a, currentT);
      },
      new Set(selKeys),
      dimUnlinked,
    );
  }, [links, actById, currentT, selKeys, dimUnlinked, elementCount, mode]);

  /* ---------- playback ---------- */
  useEffect(() => {
    if (!playing || !window4d) return;
    const id = setInterval(() => {
      setDayIdx((d) => {
        if (d + speed >= window4d.days) { setPlaying(false); return window4d.days; }
        return d + speed;
      });
    }, 90);
    return () => clearInterval(id);
  }, [playing, speed, window4d]);

  /* ---------- picking ---------- */
  const downPos = useRef<[number, number] | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { downPos.current = [e.clientX, e.clientY]; };
  const onPointerUp = (e: React.PointerEvent) => {
    const world = worldRef.current;
    const start = downPos.current;
    downPos.current = null;
    if (!world || !start || !canvasRef.current) return;
    if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return; // it was an orbit drag
    const rect = canvasRef.current.getBoundingClientRect();
    const key = world.pick(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!key) {
      if (!e.ctrlKey) setSelKeys([]);
      return;
    }
    setSelKeys((prev) =>
      e.ctrlKey
        ? prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        : [key],
    );
    const aid = links.get(key);
    setLinkActivityId(aid ? String(aid) : "");
  };

  const selectSimilar = () => {
    const world = worldRef.current;
    if (!world || !selKeys.length) return;
    const fam = familyOf(world.elements.get(selKeys[selKeys.length - 1])?.name || "");
    if (!fam) return;
    const keys: string[] = [];
    world.elements.forEach((rec, key) => { if (familyOf(rec.name) === fam) keys.push(key); });
    setSelKeys(keys);
  };

  /* ---------- linking ---------- */
  const saveLink = async () => {
    if (!selKeys.length || !linkActivityId) return;
    const aid = Number(linkActivityId);
    const world = worldRef.current;
    if (!demoMode && modelId) {
      try {
        // drop stale links for elements being re-linked to a different activity
        const lr = await authFetch(`${API}/bim/models/${modelId}/links`).then((r) => r.json());
        const stale = (lr.links || []).filter(
          (l: any) => selKeys.includes(l.element_key) && l.activity_id !== aid,
        );
        for (const old of stale) {
          await authFetch(`${API}/bim/links/${old.link_id}`, { method: "DELETE" });
        }
        const payload = selKeys.map((k) => ({
          element_key: k, activity_id: aid, element_name: world?.elements.get(k)?.name || k,
        }));
        const res = await authFetch(`${API}/bim/models/${modelId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("link save failed");
        refreshModels();
      } catch (e: any) { setErr(String(e?.message || e)); return; }
    }
    setLinks((m) => {
      const n = new Map(m);
      selKeys.forEach((k) => n.set(k, aid));
      return n;
    });
  };

  const removeLink = async () => {
    if (!selKeys.length) return;
    if (!demoMode && modelId) {
      try {
        const lr = await authFetch(`${API}/bim/models/${modelId}/links`).then((r) => r.json());
        for (const old of (lr.links || []).filter((l: any) => selKeys.includes(l.element_key))) {
          await authFetch(`${API}/bim/links/${old.link_id}`, { method: "DELETE" });
        }
      } catch { /* keep UI consistent regardless */ }
    }
    setLinks((m) => { const n = new Map(m); selKeys.forEach((k) => n.delete(k)); return n; });
    setLinkActivityId("");
  };

  /* ---------- upload ---------- */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const doUpload = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f || !schemeId) return;
    setUploading(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("scheme_id", schemeId);
      fd.append("model_name", uploadName || f.name);
      fd.append("file", f);
      const res = await authFetch(`${API}/bim/models`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.detail || "upload failed");
      setShowUpload(false); setUploadName("");
      refreshModels();
      setModelId(String(d.model_id));
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setUploading(false); }
  };

  /** Clear current model from DB + disk, or wipe all BIM uploads for the scheme. */
  const clearViewerLocal = useCallback(() => {
    setModelId("");
    setDemoMode(false);
    setSelKeys([]);
    setLinks(new Map());
    setElementCount(0);
    setGroups([]);
    worldRef.current?.clearModel();
  }, []);

  const deleteCurrentModel = async () => {
    if (!modelId) return;
    const model = models.find((m) => String(m.model_id) === modelId);
    const label = model?.model_name || `model #${modelId}`;
    if (!window.confirm(`Delete BIM model “${label}” from the database?\n\nThis removes the uploaded file and all element↔activity links. Plan schedule data is kept.`)) {
      return;
    }
    setClearing(true); setErr("");
    try {
      const res = await authFetch(`${API}/bim/models/${modelId}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = typeof d?.detail === "string" ? d.detail : JSON.stringify(d?.detail || d);
        throw new Error(detail || `delete failed (${res.status})`);
      }
      clearViewerLocal();
      refreshModels();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setClearing(false);
    }
  };

  const clearSchemeBimData = async () => {
    if (!schemeId) return;
    const schemeName = schemes.find((s) => String(s.id) === schemeId)?.name || `scheme #${schemeId}`;
    const n = models.length;
    if (!window.confirm(
      `Clear ALL 4D BIM data for “${schemeName}”?\n\n` +
      `This permanently deletes ${n || "all"} uploaded model(s), disk files, and element links from the database.\n` +
      `Plan / schedule activities are NOT deleted.\n\nThis cannot be undone.`,
    )) {
      return;
    }
    setClearing(true); setErr("");
    try {
      const res = await authFetch(`${API}/bim/schemes/${schemeId}/data`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = typeof d?.detail === "string" ? d.detail : JSON.stringify(d?.detail || d);
        throw new Error(detail || `clear failed (${res.status})`);
      }
      clearViewerLocal();
      refreshModels();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setClearing(false);
    }
  };

  /* ---------- derived UI data ---------- */
  const statusCounts = useMemo(() => {
    const counts = {} as Record<ElementStatus, number>;
    (Object.keys(STATUS_LABEL) as ElementStatus[]).forEach((s) => { counts[s] = 0; });
    const world = worldRef.current;
    if (!world) return counts;
    world.elements.forEach((_, key) => {
      const a = actById.get(links.get(key) ?? -1);
      counts[mode === "variance" ? varianceAt(a, currentT) : statusAt(a, currentT)]++;
    });
    return counts;
  }, [links, actById, currentT, elementCount, mode]);

  const primaryKey = selKeys.length ? selKeys[selKeys.length - 1] : null;
  const primaryName = primaryKey ? worldRef.current?.elements.get(primaryKey)?.name || primaryKey : "";
  const selectedActivity = primaryKey ? actById.get(links.get(primaryKey) ?? -1) : undefined;

  // Weight-based progress at the scrubbed date: activity weight_pct normalized
  // within its package, packages rolled up by scheme_rollup_weight / package
  // value (same convention as the S-curve). Plan = time-phased; Actual =
  // daily_actuals quantities vs scope.
  const progressRollup = useMemo(() => {
    const byPkg = new Map<number, ActivityRow[]>();
    activities.forEach((a) => {
      if (actStart(a) != null && actFinish(a) != null) {
        if (!byPkg.has(a.package_id)) byPkg.set(a.package_id, []);
        byPkg.get(a.package_id)!.push(a);
      }
    });
    if (!byPkg.size) return null;
    let pkgWTotal = 0;
    const pkgW = new Map<number, number>();
    byPkg.forEach((acts, pid) => {
      const w = Number(acts[0].pkg_weight) || 1;
      pkgW.set(pid, w);
      pkgWTotal += w;
    });
    let plan = 0, actual = 0;
    let anyActual = false;
    byPkg.forEach((acts, pid) => {
      let wTot = 0;
      acts.forEach((a) => { wTot += Number(a.weight_pct) || 0; });
      let p = 0, ac = 0;
      acts.forEach((a) => {
        const w = wTot > 0 ? (Number(a.weight_pct) || 0) / wTot : 1 / acts.length;
        p += w * (plannedFracAt(a, currentT) ?? 0);
        const af = actualFracAt(a, currentT);
        if (af != null) anyActual = true;
        ac += w * (af ?? 0);
      });
      const pw = pkgW.get(pid)! / pkgWTotal;
      plan += pw * p;
      actual += pw * ac;
    });
    return { plan: plan * 100, actual: anyActual ? actual * 100 : null };
  }, [activities, currentT]);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-amber-400" />
          <span className="text-sm font-bold tracking-wide">4D BIM Studio</span>
        </div>
        <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs">
          {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={modelId} onChange={(e) => setModelId(e.target.value)}
          className="min-w-[180px] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs">
          <option value="">— select 3D model —</option>
          {models.map((m) => (
            <option key={m.model_id} value={m.model_id}>
              {m.model_name} ({m.file_format.toUpperCase()}, {m.file_size_mb} MB, {m.link_count} links)
            </option>
          ))}
        </select>
        <button onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs hover:border-amber-500">
          <Upload className="h-3.5 w-3.5" /> Upload IFC / GLB
        </button>
        <button onClick={loadDemo}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs hover:border-amber-500">
          <Box className="h-3.5 w-3.5" /> Demo structure
        </button>
        <button onClick={autoMatch} disabled={elementCount === 0}
          title="Link unlinked elements to activities by name (construction vocabulary matching)"
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs hover:border-amber-500 disabled:opacity-40">
          <Wand2 className="h-3.5 w-3.5" /> Auto-match
        </button>
        <button
          onClick={deleteCurrentModel}
          disabled={!modelId || clearing || demoMode}
          title="Delete the selected uploaded model from the database (file + links)"
          className="flex items-center gap-1.5 rounded-md border border-red-900/60 bg-red-950/40 px-2.5 py-1.5 text-xs text-red-300 hover:border-red-500 hover:bg-red-900/50 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {clearing ? "Deleting…" : "Delete model"}
        </button>
        <button
          onClick={clearSchemeBimData}
          disabled={!schemeId || clearing || models.length === 0}
          title="Remove all uploaded BIM models and links for this scheme from the database"
          className="flex items-center gap-1.5 rounded-md border border-red-800 bg-red-950/60 px-2.5 py-1.5 text-xs font-semibold text-red-200 hover:border-red-500 hover:bg-red-900/70 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {clearing ? "Clearing…" : "Clear BIM data"}
        </button>
        <div className="ml-auto flex overflow-hidden rounded-md border border-zinc-700 text-[11px]">
          <button onClick={() => setMode("status")}
            className={`px-2.5 py-1.5 ${mode === "status" ? "bg-amber-600 font-semibold text-zinc-950" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}>
            4D Status
          </button>
          <button onClick={() => setMode("variance")}
            className={`px-2.5 py-1.5 ${mode === "variance" ? "bg-amber-600 font-semibold text-zinc-950" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}>
            Plan vs Actual
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <input type="checkbox" checked={dimUnlinked} onChange={(e) => setDimUnlinked(e.target.checked)} />
          Dim unlinked
        </label>
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {loading}
          </span>
        )}
        {err && <span className="max-w-[300px] truncate text-xs text-red-400">{err}</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* viewport */}
        <div ref={wrapRef} className="relative min-w-0 flex-1">
          <canvas ref={canvasRef} className="block h-full w-full"
            onPointerDown={onPointerDown} onPointerUp={onPointerUp} />
          {elementCount === 0 && !loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-6 py-4 text-center text-xs text-zinc-400">
                <Boxes className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
                Select or upload a 3D model (.ifc / .glb),<br />
                or load the <span className="text-amber-400">demo structure</span> to see the 4D
                simulation on live plan dates.
              </div>
            </div>
          )}
          {/* status legend */}
          {elementCount > 0 && (
            <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-950/80 p-2.5 text-[11px]">
              {MODE_LEGEND[mode].map((st) => (
                <span key={st} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[st] }} />
                  {STATUS_LABEL[st]} <span className="text-zinc-500">({statusCounts[st]})</span>
                </span>
              ))}
              {demoMode && <span className="mt-1 text-amber-500">demo — links not persisted</span>}
            </div>
          )}
        </div>

        {/* side panel */}
        <div className="flex w-[320px] flex-col border-l border-zinc-800">
          {/* selection / linking */}
          <div className="border-b border-zinc-800 p-3">
            <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <Link2 className="h-3.5 w-3.5" /> Element ↔ Activity link
            </p>
            {primaryKey ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-zinc-200">
                    {primaryName}
                    {selKeys.length > 1 && <span className="text-amber-400"> +{selKeys.length - 1} more</span>}
                  </span>
                  <button onClick={() => setSelKeys([])} className="text-zinc-500 hover:text-zinc-300">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500">
                  key: {primaryKey} · Ctrl+click adds to selection
                </div>
                <button onClick={selectSimilar}
                  className="w-full rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:border-amber-500">
                  Select similar ("{familyOf(primaryName) || primaryName}")
                </button>
                <select value={linkActivityId} onChange={(e) => setLinkActivityId(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs">
                  <option value="">— choose activity —</option>
                  {activities.map((a) => (
                    <option key={a.activity_id} value={a.activity_id}>
                      [{a.package_name}] {a.activity_name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button onClick={saveLink} disabled={!linkActivityId}
                    className="flex-1 rounded-md bg-amber-600 px-2 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-500 disabled:opacity-40">
                    Link {selKeys.length > 1 ? `${selKeys.length} elements` : ""}
                  </button>
                  {selKeys.some((k) => links.has(k)) && (
                    <button onClick={removeLink}
                      className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-red-400 hover:border-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {selectedActivity && (
                  <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-[11px] text-zinc-400">
                    <div className="font-semibold text-zinc-300">{selectedActivity.activity_name}</div>
                    <div>{selectedActivity.planned_start_date} → {selectedActivity.planned_finish_date}</div>
                    <div className="mt-0.5" style={{ color: STATUS_COLOR[statusAt(selectedActivity, currentT)] }}>
                      {STATUS_LABEL[statusAt(selectedActivity, currentT)]} at {fmtDate(currentT)}
                    </div>
                    <div className="mt-0.5">
                      Plan {((plannedFracAt(selectedActivity, currentT) ?? 0) * 100).toFixed(0)}%
                      {actualFracAt(selectedActivity, currentT) != null && (
                        <> · Actual {(actualFracAt(selectedActivity, currentT)! * 100).toFixed(0)}%</>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500">
                Click an element in the viewer to inspect it and link it to a plan activity.
              </p>
            )}
          </div>

          {/* element groups (IFC storeys / types, name families) */}
          {groups.length > 0 && (
            <div className="max-h-44 overflow-y-auto border-b border-zinc-800 p-3">
              <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                <Boxes className="h-3.5 w-3.5" /> Groups — click to select
              </p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => (
                  <button key={g.label}
                    onClick={() => {
                      const keys = worldRef.current?.groups.get(g.label);
                      if (keys?.length) {
                        setSelKeys(keys);
                        const aid = links.get(keys[keys.length - 1]);
                        setLinkActivityId(aid ? String(aid) : "");
                      }
                    }}
                    className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:border-amber-500">
                    {g.label} <span className="text-zinc-500">{g.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* activity schedule at current date */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <Calendar className="h-3.5 w-3.5" /> Schedule @ {fmtDate(currentT)}
            </p>
            <div className="space-y-1">
              {activities.map((a) => {
                const st = statusAt(a, currentT);
                const nLinked = [...links.values()].filter((v) => v === a.activity_id).length;
                return (
                  <button key={a.activity_id}
                    onClick={() => { if (selKeys.length) setLinkActivityId(String(a.activity_id)); }}
                    className="flex w-full items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/40 px-2 py-1.5 text-left text-[11px] hover:border-zinc-700">
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: STATUS_COLOR[st] }} />
                    <span className="min-w-0 flex-1 truncate text-zinc-300">{a.activity_name}</span>
                    {nLinked > 0 && <span className="text-[10px] text-amber-500">{nLinked}⬡</span>}
                  </button>
                );
              })}
              {activities.length === 0 && (
                <p className="text-[11px] text-zinc-500">No current locked/draft plan activities for this scheme.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* timeline bar */}
      <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-2.5">
        <button onClick={() => setPlaying((p) => !p)} disabled={!window4d}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-600 text-zinc-950 hover:bg-amber-500 disabled:opacity-30">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[11px]">
          <option value={1}>1 d/tick</option>
          <option value={3}>3 d/tick</option>
          <option value={7}>7 d/tick</option>
          <option value={15}>15 d/tick</option>
        </select>
        {window4d ? (
          <>
            <span className="text-[11px] text-zinc-500">{fmtDate(window4d.min)}</span>
            <input type="range" min={0} max={window4d.days} value={dayIdx}
              onChange={(e) => { setPlaying(false); setDayIdx(Number(e.target.value)); }}
              className="flex-1 accent-amber-500" />
            <span className="text-[11px] text-zinc-500">{fmtDate(window4d.max)}</span>
            <span className="w-[100px] text-right text-xs font-bold text-amber-400">{fmtDate(currentT)}</span>
            {progressRollup != null && (
              <span className="flex items-center gap-2"
                title="Weight-based rollup (weight_pct within package, packages by value). Plan = time-phased; Actual = daily_actuals qty vs scope.">
                <span className="relative h-2.5 w-28 overflow-hidden rounded-full bg-zinc-800">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-emerald-600/50"
                    style={{ width: `${progressRollup.plan}%` }} />
                  {progressRollup.actual != null && (
                    <span className={`absolute left-0 top-0.5 h-1.5 rounded-full ${progressRollup.actual >= progressRollup.plan - 5 ? "bg-sky-400" : "bg-red-500"}`}
                      style={{ width: `${progressRollup.actual}%` }} />
                  )}
                </span>
                <span className="text-xs font-bold text-emerald-400">Plan {progressRollup.plan.toFixed(1)}%</span>
                {progressRollup.actual != null && (
                  <span className={`text-xs font-bold ${progressRollup.actual >= progressRollup.plan - 5 ? "text-sky-400" : "text-red-400"}`}>
                    Actual {progressRollup.actual.toFixed(1)}%
                  </span>
                )}
              </span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-zinc-500">No dated activities in the current plan — timeline disabled.</span>
        )}
      </div>

      {/* upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[380px] rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold">Upload 3D model</span>
              <button onClick={() => setShowUpload(false)}><X className="h-4 w-4 text-zinc-500" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <input value={uploadName} onChange={(e) => setUploadName(e.target.value)}
                placeholder="Model name (e.g. COB-7 Battery Structure)"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5" />
              <input ref={fileRef} type="file" accept=".ifc,.glb,.gltf"
                className="w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-zinc-800 file:px-2 file:py-1.5 file:text-xs file:text-zinc-200" />
              <button onClick={doUpload} disabled={uploading}
                className="w-full rounded-md bg-amber-600 px-2 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-500 disabled:opacity-40">
                {uploading ? "Uploading…" : "Upload to scheme"}
              </button>
              <p className="text-[10px] text-zinc-500">
                IFC 2x3 / IFC4 (.ifc) or glTF binary (.glb). The model is stored on the backend
                and element links are saved per model.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
