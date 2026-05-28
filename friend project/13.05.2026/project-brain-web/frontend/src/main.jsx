import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  BadgeIndianRupee,
  BarChart3,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Calculator,
  CalendarDays,
  ClipboardList,
  Download,
  Factory,
  FileText,
  FolderKanban,
  HelpCircle,
  Home,
  Eye,
  Info,
  IndianRupee,
  ListChecks,
  LayoutDashboard,
  Lock,
  Pencil,
  Pin,
  Plus,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Settings,
  X,
  Table2,
  Trash2,
  Upload,
  User,
  UserCog,
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
const API_BASE_FALLBACKS = API_BASE === "http://127.0.0.1:8001" ? ["http://127.0.0.1:8000"] : [];
const PLANT_AMR_VISIBLE_COLUMNS_KEY = "projectBrain.plantLevelAmr.visibleColumns";
const AUTH_USER_KEY = "projectBrain.authUser";
const PLANT_AMR_REMARKS_LIMIT = 600;
const BASE_DEPARTMENT_OPTIONS = [
  "OFFICE OF DIRECTOR I/c",
  "HUMAN RESOURCE",
  "MINES DEVELOPMENT,CMLLO",
  "ED(WORKS) OFFICE",
  "MATERIALS MGT.",
  "MINES,OGOM,CMLLO",
  "PROJECTS",
  "SERVICES",
  "MAINTENANCE",
  "SMS - I",
  "RP & E,OGOM,CMLLO",
  "POWER",
  "MM(PURCHASE)",
  "MINES(PROJECTS),OGOM,CMLLO",
  "PLATE MILL & SPP",
  "INSTRUMENT. & AUTOMATION",
  "NPM & DIGITALIZATION",
  "PP & C",
  "BIM,KIM& TALDIH,OGOM,CMLLO",
  "CO & CCD",
  "L & D",
  "HSMs & AUX.",
  "M & HS",
  "BOM,OGOM,CMLLO",
  "TE & HORT.",
  "UTILITIES & ENVIRONMENT",
  "TRAFFIC",
  "BLAST FURNACES",
  "F & A",
  "CE(S)",
  "REFRACTORIES & LDBP",
  "SAFETY & FIRE SERVICES",
  "SMS-II",
  "MECHANICAL",
  "TOWN SERVICES & CSR",
  "SINTERING PLANTS",
  "PROJECTS & MOD",
  "CONTRACT CELL",
  "PROJECTS-COMML",
  "CPP I",
  "CENTRALIZED ELECT.MAINT.",
  "MM(STORES)",
  "RMHP",
  "HSM - 2",
  "PLATE MILL",
  "R/C LAB.",
  "TOWN ENGG.-W.S.(TOWN)",
  "COAL CHEMICALS",
  "COKE OVENS",
  "ROLL SHOP",
  "MARKETING",
  "POWER DISTBN.",
  "DESIGN &SHOPS(MECH&FNDRS)",
  "INTERNAL AUDIT",
  "SSM",
  "SHOPS (RSM)",
  "ENVIRONMENTAL ENGG.",
  "CENT. MECH. MAINT.",
  "SPP",
  "TECHNICAL CELL",
  "WATER MANAGEMENT",
  "SINTERING PLANT II",
  "T & RM",
  "AMRM & SPECIAL CELL",
  "SINTERING PLANT III",
  "BE & IED & HA",
  "NEW PLATE MILL",
  "TOWN SERVICES",
  "TOWN ENGG.-CIVIL",
  "ENERGY MGT.",
  "TOWN ENGG.-ELECTRICAL",
  "OXYGEN PLANT",
  "SAFETY ENGG.",
  "MAINT. SYS. & SERV.",
  "TOWN ENGG.",
  "VIGILANCE",
  "FM & TM",
  "C & IT",
  "MEDICAL",
  "PIPE PLANT",
  "LAW DEPT.",
  "COMM.ENGG.",
  "MRD",
  "OGOM,CMLLO",
  "INDUSTRIAL ENGG.",
  "BUSINESS EXCELLENCE",
  "C S R",
  "BIM,OGOM,CMLLO",
  "CC(IM),OGOM,CMLLO",
  "SHOPS (FOUNDRIES)",
  "SINTERING PLANT - I",
  "PUBLIC RELATIONS",
  "CC,BIM,KIM &T,OGOM,CMLLO",
  "PHS, SW & AIRPORT",
  "LIAISON",
  "CALCINING PLANT-II",
  "FIRE SERVICE",
  "HORTICULTURE",
  "TOWN ENGG.(PUBLIC HEALTH)",
  "KIM,OGOM,CMLLO",
  "OHSC",
  "DIGITALIZATION",
  "DESIGN",
  "SHOPS (MECH.SHOP)",
  "SHOPS (STRL & FAB)",
  "SHOPS (PC[S])",
  "SPORTS",
  "BIM & KIM,OGOM,CMLLO",
  "PROTOCOL/HOSPITALITY",
  "PHS & SW",
  "CET, RSP CENTRE",
  "RDCIS, RSP CENTRE",
];

const modules = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "registration", label: "Project Registration", icon: ClipboardList },
  { key: "project_details", label: "Project Details", icon: FileText },
  { key: "ongoing", label: "Ongoing Projects", icon: FolderKanban },
  { key: "daily_progress", label: "Daily Progress Report", icon: Table2 },
  { key: "capex", label: "CAPEX", icon: BarChart3 },
  { key: "billing_schedule", label: "Billing Schedule", icon: BadgeIndianRupee },
  { key: "schedule", label: "Schedule", icon: ClipboardList },
  { key: "reports", label: "Reports", icon: FileText },
  { key: "repository", label: "Repository", icon: FolderKanban },
  { key: "admin", label: "Admin Panel", icon: UserCog },
];

function parseAppDateValue(value) {
  if (!value) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const storageMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (storageMatch) {
    const year = Number(storageMatch[1]);
    const month = Number(storageMatch[2]);
    const day = Number(storageMatch[3]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }
  const displayMatch = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (displayMatch) {
    const day = Number(displayMatch[1]);
    const month = Number(displayMatch[2]);
    const year = Number(displayMatch[3].length === 2 ? `20${displayMatch[3]}` : displayMatch[3]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  if (!value) return "";
  const date = parseAppDateValue(value);
  if (!date) return String(value);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" }).replaceAll("/", "-");
}

function scheduleMonthsBetween(startValue, finishValue) {
  const start = parseAppDateValue(startValue);
  const finish = parseAppDateValue(finishValue);
  if (!start || !finish || finish < start) return "";
  let months = (finish.getFullYear() - start.getFullYear()) * 12 + (finish.getMonth() - start.getMonth());
  if (finish.getDate() < start.getDate()) months -= 1;
  return String(Math.max(0, months));
}

function stageDateInput(value) {
  if (!value) return "";
  const date = parseAppDateValue(value);
  if (date) return formatDate(date);
  return String(value).replaceAll("/", "-");
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed)
    ? parsed.toLocaleString("en-IN")
    : parsed.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function number2(value) {
  const parsed = Number(value || 0);
  return parsed.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => String(cell || "").trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => String(cell || "").trim())) rows.push(row);
  return rows;
}

function projectHasChildren(row, rows = []) {
  if (row?.has_children !== undefined) return Boolean(row.has_children);
  const rowId = String(row?.id ?? "");
  return Boolean(rowId) && rows.some((item) => String(item?.parent_project_id ?? "") === rowId);
}

function normalizePlantTemplateHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ");
}

async function api(path, options) {
  let lastNetworkError = null;
  for (const baseUrl of [API_BASE, ...API_BASE_FALLBACKS]) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, options);
    } catch (err) {
      lastNetworkError = err;
      continue;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Request failed");
    }
    return response.json();
  }
  throw lastNetworkError || new Error("Request failed");
}

async function apiBlob(path, options) {
  let lastNetworkError = null;
  for (const baseUrl of [API_BASE, ...API_BASE_FALLBACKS]) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, options);
    } catch (err) {
      lastNetworkError = err;
      continue;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Request failed");
    }
    return response.blob();
  }
  throw lastNetworkError || new Error("Request failed");
}

function pdfText(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replace(/\s+/g, " ")
    .trim();
}

function latinBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index] = code <= 255 ? code : 63;
  }
  return bytes;
}

function buildSimplePdfBlob(title, subtitle, columns, rows) {
  const pageWidth = 1190.55;
  const pageHeight = 841.89;
  const margin = 28;
  const titleHeight = 42;
  const rowHeight = 18;
  const exportColumns = columns.slice(0, 18);
  const exportRows = rows.map((row) => row.slice(0, exportColumns.length));
  const usableWidth = pageWidth - margin * 2;
  const columnWidth = usableWidth / Math.max(1, exportColumns.length);
  const rowsPerPage = Math.max(1, Math.floor((pageHeight - margin - titleHeight - rowHeight - margin) / rowHeight));
  const pages = [];
  for (let start = 0; start < Math.max(1, exportRows.length); start += rowsPerPage) {
    pages.push(exportRows.slice(start, start + rowsPerPage));
  }
  if (!pages.length) pages.push([]);
  const cellText = (value, limit = 32) => {
    const text = pdfText(value);
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
  };
  const streams = pages.map((pageRows) => {
    const commands = [
      "0.95 0.98 1 rg",
      `${margin} ${pageHeight - margin - titleHeight - rowHeight} ${usableWidth} ${rowHeight} re f`,
      "0 0 0 RG 0.5 w",
      "BT /F1 16 Tf 0 0.19 0.53 rg",
      `1 0 0 1 ${margin} ${pageHeight - margin - 14} Tm (${pdfText(title)}) Tj ET`,
      "BT /F1 8 Tf 0.2 0.25 0.33 rg",
      `1 0 0 1 ${margin} ${pageHeight - margin - 30} Tm (${pdfText(subtitle)}) Tj ET`,
    ];
    let y = pageHeight - margin - titleHeight;
    exportColumns.forEach((label, index) => {
      const x = margin + index * columnWidth;
      commands.push(`${x} ${y - rowHeight} ${columnWidth} ${rowHeight} re S`);
      commands.push("BT /F1 6 Tf 0 0 0 rg");
      commands.push(`1 0 0 1 ${x + 3} ${y - 12} Tm (${cellText(label, 28)}) Tj ET`);
    });
    y -= rowHeight;
    pageRows.forEach((row) => {
      exportColumns.forEach((_label, index) => {
        const x = margin + index * columnWidth;
        commands.push(`${x} ${y - rowHeight} ${columnWidth} ${rowHeight} re S`);
        commands.push("BT /F1 5.5 Tf 0 0 0 rg");
        commands.push(`1 0 0 1 ${x + 3} ${y - 12} Tm (${cellText(row[index], 34)}) Tj ET`);
      });
      y -= rowHeight;
    });
    return commands.join("\n");
  });
  const kids = streams.map((_stream, index) => `${4 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${streams.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  streams.forEach((stream, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const streamLength = latinBytes(stream).length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`);
  });
  const chunks = [];
  let totalLength = 0;
  const push = (text) => {
    const bytes = latinBytes(text);
    chunks.push(bytes);
    totalLength += bytes.length;
  };
  const offsets = [0];
  push("%PDF-1.4\n");
  objects.forEach((object, index) => {
    offsets.push(totalLength);
    push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xrefOffset = totalLength;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => push(`${String(offset).padStart(10, "0")} 00000 n \n`));
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, cursor);
    cursor += chunk.length;
  });
  return new Blob([output], { type: "application/pdf" });
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) {
      setError(err.message || "Invalid username or password");
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <h1>Rourkela Steel Plant</h1>
        <p>Project Department Login</p>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <div className="error">{error}</div> : null}
        <button type="submit">Login</button>
      </form>
    </main>
  );
}

function DataTable({ columns, rows, empty = "No records available.", onRowClick, onCellDoubleClick, selectedRowId, scrollRef }) {
  if (false) return (
    <div className="table-scroll" ref={scrollRef}>
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr
              key={row.id || `${row.unique_id || row.file_name || row.username}-${index}`}
              className={`${onRowClick ? "clickable-row" : ""} ${selectedRowId === row.id ? "selected-row" : ""}`.trim()}
              onClick={onRowClick ? (event) => onRowClick(row, event) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  onDoubleClick={onCellDoubleClick ? (event) => onCellDoubleClick(row, column, event) : undefined}
                >
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          )) : (
            <tr><td colSpan={columns.length} className="empty">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DashboardView({ refreshKey }) {
  const [summary, setSummary] = useState(null);
  const [searchText, setSearchText] = useState("");
  useEffect(() => {
    api("/api/dashboard/summary").then(setSummary).catch(() => setSummary(null));
  }, [refreshKey]);
  const cards = summary?.cards || {};
  const dashboard = summary?.dashboard || {};
  const kpis = dashboard.kpis || {};
  const projects = dashboard.projectList || summary?.projects || [];
  const capexTrend = dashboard.capexTrend || [];
  const stages = dashboard.stageRows || [];
  const heatmapRows = dashboard.heatmapRows || [];
  const fyStartRows = dashboard.fyStartClassification || [];
  const statusRows = dashboard.statusRows?.length ? dashboard.statusRows : [
    { label: "On Time", value: 0, cost: 0, color: "#2ca83f" },
    { label: "Delay < 1 Year", value: 0, cost: 0, color: "#f5c400" },
    { label: "Delay > 1 Year", value: 0, cost: 0, color: "#ff6a1a" },
    { label: "Completed this FY", value: 0, cost: 0, color: "#0b65d8" },
  ];
  const capexSummary = dashboard.capexSummary || {};
  const totalCost = Number(kpis.totalProjectCost || cards.totalProjectCost || 0);
  const maxTrendValue = Math.max(1, ...capexTrend.flatMap((item) => [Number(item.be || 0), Number(item.actual || 0)]));
  const maxStatusCost = Math.max(1, ...statusRows.map((row) => Number(row.cost || 0)));
  const filteredProjects = projects.filter((row) => {
    const query = searchText.trim().toLowerCase();
    return !query || `${row.unique_id || ""} ${row.project_name || ""} ${row.status || ""}`.toLowerCase().includes(query);
  }).slice(0, 8);
  return (
    <div className="dashboard-window">
      <section className="dashboard-main">
        <div className="dashboard-head">
          <div>
            <h1>Strategic CAPEX &amp; Project Performance Dashboard</h1>
            <p>Integrated View of Capital Spend, Project Progress &amp; Delivery Status</p>
          </div>
          <div className="dashboard-filters">
            <label>Financial Year<select><option>{dashboard.financialYear || "Current FY"}</option></select></label>
            <label>Month<select><option>{dashboard.monthRange || "Current FY"}</option></select></label>
            <label>Project List<select><option>All Projects</option></select></label>
            <button type="button"><Download size={16} /> Export</button>
          </div>
        </div>

        <div className="dashboard-kpis">
          <div className="dashboard-kpi"><span className="blue"><BarChart3 size={30} /></span><small>Total CAPEX (BE/RE)<br />(Rs in Cr)</small><strong>{number(kpis.totalCapex || 0)}</strong><p>backend CAPEX</p></div>
          <div className="dashboard-kpi"><span className="green"><IndianRupee size={30} /></span><small>Total Actual CAPEX (YTD)<br />(Rs in Cr)</small><strong>{number(kpis.actualCapex || 0)}</strong><p>backend CAPEX</p></div>
          <div className="dashboard-kpi"><span className="purple"><BarChart3 size={30} /></span><small>Achievement %<br />(Actual vs BE/RE)</small><strong>{Number(kpis.achievementPercent || 0).toFixed(1)}%</strong><p>backend calculated</p></div>
          <div className="dashboard-kpi project-count-kpi">
            <span className="blue"><FolderKanban size={30} /></span>
            <small>Total No. of Projects</small>
            <strong>{kpis.totalProjects || cards.totalProjects || 0}</strong>
            <p><b>Corporate AMR</b> {kpis.corporateProjects || 0} <b>Plant Level AMR</b> {kpis.plantLevelProjects || 0}</p>
          </div>
          {fyStartRows.map((row) => (
            <div className="dashboard-kpi" key={row.label}><span className={row.color === "green" ? "green" : row.color === "neutral" ? "blue" : "orange"}><CalendarDays size={30} /></span><small>{row.label}</small><strong>{row.value || 0}</strong><p>backend FY classification</p></div>
          ))}
          <div className="dashboard-kpi"><span className="green"><IndianRupee size={30} /></span><small>Total Project Cost<br />(Rs in Cr)</small><strong>{number(totalCost)}</strong><p>from project costs</p></div>
          <div className="dashboard-kpi"><span className="orange"><CheckCircle size={30} /></span><small>Completed Projects<br />This FY</small><strong>{kpis.completedProjects || 0}</strong><p>from completion dates</p></div>
        </div>

        <div className="dashboard-grid-top">
          <section className="dashboard-card capex-chart">
            <h2>CAPEX (BE/RE vs Actual YTD)</h2>
            <div className="mini-bar-chart">
              {(capexTrend.length ? capexTrend : [{ month: "Apr", be: 0, actual: 0 }]).map((row) => (
                <div key={row.month}>
                  <span className="be" style={{ height: `${Math.max(4, (Number(row.be || 0) / maxTrendValue) * 100)}%` }} />
                  <span className="actual" style={{ height: `${Math.max(4, (Number(row.actual || 0) / maxTrendValue) * 100)}%` }} />
                  <small>{row.month}</small>
                </div>
              ))}
            </div>
          </section>
          <section className="dashboard-card status-donut-card">
            <h2>Project Status <small>(No. of Projects)</small></h2>
            <div className="status-donut" style={{ "--green": `${statusRows[0].value * 3.6}deg`, "--yellow": `${(statusRows[0].value + statusRows[1].value) * 3.6}deg`, "--orange": `${(statusRows[0].value + statusRows[1].value + statusRows[2].value) * 3.6}deg` }}>
              <strong>{cards.totalProjects || 0}</strong><span>Total Projects</span>
            </div>
            <div className="status-legend">{statusRows.map((row) => <p key={row.label}><i style={{ background: row.color }} />{row.label}<b>{row.value}</b></p>)}</div>
          </section>
          <section className="dashboard-card status-cost-card">
            <h2>Project Status <small>(By Cost)</small></h2>
            {statusRows.map((row) => (
              <div className="status-cost-row" key={row.label}><span>{row.label}</span><b style={{ width: `${(Number(row.cost || 0) / maxStatusCost) * 80}%`, background: row.color }} /><em>{number(row.cost || 0)}</em></div>
            ))}
          </section>
        </div>

        <div className="dashboard-grid-mid">
          <section className="dashboard-card">
            <h2>No. of Projects under Different Stages</h2>
            <table className="dashboard-small-table"><thead><tr><th>Stage</th><th>No. of Projects</th><th>Total Project Cost</th></tr></thead><tbody>{stages.map((stage) => <tr key={stage.stage}><td>{stage.stage}</td><td>{stage.projects}</td><td>{number(stage.cost)}</td></tr>)}<tr><td>Total</td><td>{cards.totalProjects || 0}</td><td>{number(totalCost)}</td></tr></tbody></table>
          </section>
          <section className="dashboard-card">
            <h2>Delay Heatmap <small>(No. of Projects)</small></h2>
            <table className="dashboard-heatmap"><thead><tr><th>Stage</th><th>On Time</th><th>Delay &lt; 1 Year</th><th>Delay &gt; 1 Year</th><th>Completed This FY</th></tr></thead><tbody>{heatmapRows.map((row) => <tr key={row.Stage}><td>{row.Stage}</td><td>{row["On Time"]}</td><td>{row["Delay < 1 Year"]}</td><td>{row["Delay > 1 Year"]}</td><td>{row["Completed This FY"]}</td></tr>)}</tbody></table>
          </section>
          <section className="dashboard-card capex-summary">
            <h2>CAPEX Summary (YTD)</h2>
            <div><span>Total BE / RE<strong>{number(capexSummary.totalBeRe || 0)}</strong></span><span>Total Actual<strong>{number(capexSummary.totalActual || 0)}</strong></span><span>Variance<strong>{number(capexSummary.variance || 0)}</strong></span><span>Variance %<strong>{Number(capexSummary.variancePercent || 0).toFixed(1)}%</strong></span></div>
          </section>
        </div>

        <section className="dashboard-card dashboard-project-list">
          <div className="dashboard-list-head"><h2>Project List <small>(Drill down for Details)</small></h2><label><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search Project..." /><Search size={17} /></label></div>
          <div className="dashboard-project-table-wrap">
            <table className="dashboard-project-table">
              <thead><tr><th>Project ID</th><th>Project Name</th><th>Stage</th><th>FY Start</th><th>Total Project Cost</th><th>Actual (YTD)</th><th>Achievement %</th><th>Status</th><th>Schedule</th><th>Completion</th></tr></thead>
              <tbody>{filteredProjects.map((row) => {
                const cost = Number(row.gross_cost || 0);
                const achievement = Number(row.achievement_percent || 0);
                return <tr key={row.id} className={projectHasChildren(row, projects) ? "project-parent-row" : ""}><td>{row.unique_id}</td><td>{row.project_name}</td><td><span>{row.status}</span></td><td><span className={`fy-classification ${row.fy_classification_color === "green" ? "started" : row.fy_classification_color === "neutral" ? "neutral" : "ongoing-last"}`}>{row.fy_classification || "-"}</span></td><td>{number(cost)}</td><td>{number(row.actual_ytd || 0)}</td><td><div className="dash-progress"><b style={{ width: `${Math.min(100, achievement)}%` }} />{achievement.toFixed(1)}%</div></td><td>{row.delivery_status || "-"}</td><td>{row.schedule || "-"}</td><td>{row.schedule_completion || "-"}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

function Metric({ title, value, tone = "" }) {
  return (
    <section className={`metric ${tone}`}>
      <span>{title}</span>
      <strong>{number(value)}</strong>
    </section>
  );
}

function RegistrationView({ onChanged, onOpenProject, onHome }) {
  const [tables, setTables] = useState({ corporate: [], plant: [] });
  const [selected, setSelected] = useState(null);
  const [selectedRowIds, setSelectedRowIds] = useState([]);
  const [form, setForm] = useState({ project_type: "Corporate AMR", project_name: "" });
  const uploadInputRef = useRef(null);
  const tableScrollRefs = useRef({});
  const scrollPositionsRef = useRef({});
  const [filters, setFilters] = useState({
    corporate: { field: "project_name", value: "" },
    plant: { field: "project_name", value: "" },
  });
  const [tableSearch, setTableSearch] = useState({ corporate: "", plant: "" });
  const [tablePage, setTablePage] = useState({ corporate: 1, plant: 1 });
  const [rowsPerPage, setRowsPerPage] = useState({ corporate: 10, plant: 10 });
  const [message, setMessage] = useState("");
  const selectedRows = useMemo(() => {
    const selectedIds = new Set(selectedRowIds.map((id) => String(id)));
    return [...(tables.corporate || []), ...(tables.plant || [])].filter((row) => selectedIds.has(String(row.id)));
  }, [selectedRowIds, tables]);

  async function load() {
    const data = await api("/api/registration");
    setTables(data || { corporate: [], plant: [] });
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ project_type: "Corporate AMR", project_name: "" });
      setMessage("Project registered successfully with generated unique ID.");
      await load();
      onChanged();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function addChildProject() {
    if (!selected || selectedRows.length !== 1) return setMessage("Select one parent project first.");
    const projectName = window.prompt("Child Project Name");
    if (!projectName?.trim()) return;
    const stage2CostText = window.prompt("Stage-2 Gross Cost", "0");
    if (stage2CostText === null) return;
    const stage2Cost = Number(stage2CostText || 0);
    if (Number.isNaN(stage2Cost) || stage2Cost < 0) {
      setMessage("Stage-2 gross cost must be a valid non-negative number.");
      return;
    }
    try {
      await api("/api/registration/child", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_project_id: selected.id,
          project_name: projectName.trim(),
          stage2_gross_cost: stage2Cost,
        }),
      });
      setMessage("Child project added successfully.");
      await load();
      onChanged();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function refreshList() {
    await load();
    setMessage("Project list refreshed.");
  }

  function captureRegistrationScroll(tableKey, event) {
    const pageScroll = event?.currentTarget?.closest("main") || document.querySelector("main");
    const tablePositions = {};
    Object.entries(tableScrollRefs.current).forEach(([key, node]) => {
      if (!node) return;
      tablePositions[key] = {
        top: node.scrollTop,
        left: node.scrollLeft,
      };
    });
    const activeTable = event?.currentTarget?.closest(".table-scroll");
    if (activeTable) {
      tablePositions[tableKey] = {
        top: activeTable.scrollTop,
        left: activeTable.scrollLeft,
      };
    }
    scrollPositionsRef.current = {
      tableKey,
      tablePositions,
      pageNode: pageScroll,
      pageTop: pageScroll?.scrollTop || 0,
      pageLeft: pageScroll?.scrollLeft || 0,
      windowTop: window.scrollY || 0,
      windowLeft: window.scrollX || 0,
    };
  }

  function restoreRegistrationScroll() {
    const stored = scrollPositionsRef.current;
    if (!stored?.tablePositions) return;
    Object.entries(stored.tablePositions).forEach(([key, position]) => {
      const node = tableScrollRefs.current[key];
      if (!node || !position) return;
      node.scrollTop = position.top;
      node.scrollLeft = position.left;
    });
    if (stored.pageNode) {
      stored.pageNode.scrollTop = stored.pageTop;
      stored.pageNode.scrollLeft = stored.pageLeft;
    }
    window.scrollTo(stored.windowLeft || 0, stored.windowTop || 0);
  }

  useLayoutEffect(() => {
    restoreRegistrationScroll();
  }, [selected?.id, selectedRowIds]);

  function selectRegistrationRow(row, tableKey, event) {
    event.preventDefault();
    captureRegistrationScroll(tableKey, event);
    const rowId = String(row.id);
    if (event.ctrlKey || event.metaKey) {
      const hasRow = selectedRowIds.map((id) => String(id)).includes(rowId);
      const nextSelectedIds = hasRow ? selectedRowIds.filter((id) => String(id) !== rowId) : [...selectedRowIds, row.id];
      const nextPrimaryId = hasRow ? nextSelectedIds.at(-1) : row.id;
      const allRows = [...(tables.corporate || []), ...(tables.plant || [])];
      setSelectedRowIds(nextSelectedIds);
      setSelected(allRows.find((item) => String(item.id) === String(nextPrimaryId)) || null);
    } else {
      setSelected(row);
      setSelectedRowIds([row.id]);
    }
    restoreRegistrationScroll();
    requestAnimationFrame(restoreRegistrationScroll);
    requestAnimationFrame(() => requestAnimationFrame(restoreRegistrationScroll));
    window.setTimeout(restoreRegistrationScroll, 60);
  }

  function openProjectFromName(row, tableKey, event) {
    event.preventDefault();
    event.stopPropagation();
    selectRegistrationRow(row, tableKey, event);
    onOpenProject?.({ ...row, tableKey });
  }

  async function removeSelected() {
    const rowsToDelete = selectedRows.length ? selectedRows : selected ? [selected] : [];
    if (!rowsToDelete.length) return setMessage("Select project first.");
    const confirmText = rowsToDelete.length === 1
      ? `Delete ${rowsToDelete[0].raw_project_name}? This removes all related project data.`
      : `Delete ${rowsToDelete.length} selected projects? This removes all related project data.`;
    if (!window.confirm(confirmText)) return;
    try {
      for (const row of rowsToDelete) {
        await api(`/api/projects/${row.id}`, { method: "DELETE" });
      }
      setSelected(null);
      setSelectedRowIds([]);
      setMessage(rowsToDelete.length === 1 ? "Project deleted." : `${rowsToDelete.length} projects deleted.`);
      await load();
      onChanged();
    } catch (err) {
      setMessage(err.message);
    }
  }

  const uploadStageColumns = [
    "DIC Recommendation Date",
    "COD Date",
    "Stage-1 Date",
    "Stage-1 Cost",
    "Expected TOD Date",
    "Final TOD Date",
    "Stage-2 Date",
    "Stage-2 Cost",
  ];

  async function downloadTemplate() {
    let approvalColumns = [];
    try {
      approvalColumns = (await api("/api/approval-fields/template")).columns || [];
    } catch {
      approvalColumns = [];
    }
    const approvalHeaders = approvalColumns.map((column) => column.header);
    const headers = ["Project Type", "Project Name", ...approvalHeaders];
    const sampleRows = [
      ["Corporate AMR", "Sample Corporate AMR Project", ...approvalHeaders.map((header) => header.toLowerCase().includes("cost") || header.toLowerCase().includes("amount") ? "10" : "01-04-26")],
      ["Plant Level AMR", "Sample Plant Level AMR Project", ...approvalHeaders.map(() => "")],
    ];
    const csv = [headers, ...sampleRows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "project-registration-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function normalizeUploadHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[._]/g, " ")
      .replace(/\s+/g, " ");
  }

  function uploadCell(row, headerMap, names) {
    for (const name of names) {
      const index = headerMap.get(normalizeUploadHeader(name));
      if (index !== undefined) return String(row[index] || "").trim();
    }
    return "";
  }

  function normalizeYesNo(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "";
    if (["y", "yes", "true", "1"].includes(text)) return "Y";
    if (["n", "no", "false", "0"].includes(text)) return "N";
    throw new Error(`Use Y or N for cleared fields, received "${value}".`);
  }

  function validateUploadDate(value, label) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (!parseAppDateValue(text)) throw new Error(`${label} must be a valid date in DD-MM-YY format.`);
    return stageDateInput(text);
  }

  function validateUploadCost(value, label) {
    const text = String(value || "").trim();
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a valid non-negative number.`);
    return parsed;
  }

  function buildUploadStagePayload(row, headerMap) {
    const dicDate = validateUploadDate(uploadCell(row, headerMap, ["DIC Recommendation Date", "DIC Date"]), "DIC Recommendation Date");
    const codDate = validateUploadDate(uploadCell(row, headerMap, ["COD Date"]), "COD Date");
    const stage1Date = validateUploadDate(uploadCell(row, headerMap, ["Stage-1 Date", "Stage 1 Date"]), "Stage-1 Date");
    const stage1CostText = uploadCell(row, headerMap, ["Stage-1 Cost", "Stage 1 Cost"]);
    const expectedTodDate = validateUploadDate(uploadCell(row, headerMap, ["Expected TOD Date", "Expected Tender Opening Date"]), "Expected TOD Date");
    const finalTodDate = validateUploadDate(uploadCell(row, headerMap, ["Final TOD Date", "Final Tender Opening Date"]), "Final TOD Date");
    const stage2Date = validateUploadDate(uploadCell(row, headerMap, ["Stage-2 Date", "Stage 2 Date"]), "Stage-2 Date");
    const stage2CostText = uploadCell(row, headerMap, ["Stage-2 Cost", "Stage 2 Cost"]);
    const codCleared = normalizeYesNo(uploadCell(row, headerMap, ["COD Cleared"]));
    const stage1Cleared = normalizeYesNo(uploadCell(row, headerMap, ["Stage-1 Cleared", "Stage 1 Cleared"]));
    const stage2Cleared = normalizeYesNo(uploadCell(row, headerMap, ["Stage-2 Cleared", "Stage 2 Cleared"]));
    const stage1Cost = validateUploadCost(stage1CostText, "Stage-1 Cost");
    const stage2Cost = validateUploadCost(stage2CostText, "Stage-2 Cost");

    if ((stage1Date || stage1CostText) && (!stage1Date || stage1Cost === null)) {
      throw new Error("Stage-1 upload requires both Stage-1 Date and Stage-1 Cost.");
    }
    if ((stage2Date || stage2CostText) && (!stage2Date || stage2Cost === null)) {
      throw new Error("Stage-2 upload requires both Stage-2 Date and Stage-2 Cost.");
    }
    if (stage1Date && !codDate && !codCleared) {
      throw new Error("Stage-1 upload requires COD Date before Stage-1 can be auto-pushed.");
    }
    if (stage2Date && !finalTodDate) {
      throw new Error("Stage-2 upload requires Final TOD Date before Stage-2 can be auto-pushed.");
    }

    const payload = {};
    if (dicDate) payload.dic_recommendation_date = dicDate;
    if (codDate) payload.cod_date = codDate;
    if (codCleared) payload.cod_cleared = codCleared;
    if (stage1Date) payload.stage1_date = stage1Date;
    if (stage1Cost !== null) payload.stage1_cost = stage1Cost;
    if (stage1Cleared) payload.stage1_cleared = stage1Cleared;
    if (expectedTodDate) payload.expected_tod_date = expectedTodDate;
    if (finalTodDate) payload.final_tod_date = finalTodDate;
    if (stage2Date) payload.stage2_date = stage2Date;
    if (stage2Cost !== null) payload.stage2_cost = stage2Cost;
    if (stage2Cleared) payload.stage2_cleared = stage2Cleared;
    return payload;
  }

  async function buildUploadApprovalPayload(row, headerMap) {
    const template = await api("/api/approval-fields/template");
    const values = {};
    for (const column of template.columns || []) {
      const cell = uploadCell(row, headerMap, [column.header]);
      if (!cell) continue;
      if (column.dataField === "Date") {
        values[column.fieldKey] = validateUploadDate(cell, column.header);
      } else if (column.dataField === "Amount") {
        const amount = validateUploadCost(cell, column.header);
        if (amount !== null) values[column.fieldKey] = amount;
      } else {
        values[column.fieldKey] = cell;
      }
    }
    return values;
  }

  async function uploadSheet(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage("");
    try {
      const rows = parseCsvRows(await file.text());
      const [headers, ...dataRows] = rows;
      if (!headers?.length) throw new Error("Upload file is empty.");
      const headerMap = new Map(headers.map((header, index) => [normalizeUploadHeader(header), index]));
      const typeIndex = headerMap.get("project type");
      const nameIndex = headerMap.get("project name");
      if (typeIndex === undefined || nameIndex === undefined) {
        throw new Error("Upload must include Project Type and Project Name columns.");
      }
      const uploadRows = dataRows.filter((row) => row.some((cell) => String(cell || "").trim()));
      if (uploadRows.length > 100) {
        throw new Error(`Upload limit is 100 rows at a time. This file has ${uploadRows.length} rows.`);
      }
      let imported = 0;
      let rejected = 0;
      let duplicate = 0;
      const approvalTemplate = await api("/api/approval-fields/template").catch(() => ({ columns: [] }));
      for (const row of uploadRows) {
        const project_type = String(row[typeIndex] || "").trim();
        const project_name = String(row[nameIndex] || "").trim();
        if (!project_type || !project_name) {
          rejected += 1;
          continue;
        }
        let stagePayload = {};
        let approvalPayload = {};
        try {
          stagePayload = buildUploadStagePayload(row, headerMap);
          for (const column of approvalTemplate.columns || []) {
            const cell = uploadCell(row, headerMap, [column.header]);
            if (!cell) continue;
            if (column.dataField === "Date") {
              approvalPayload[column.fieldKey] = validateUploadDate(cell, column.header);
            } else if (column.dataField === "Amount") {
              const amount = validateUploadCost(cell, column.header);
              if (amount !== null) approvalPayload[column.fieldKey] = amount;
            } else {
              approvalPayload[column.fieldKey] = cell;
            }
          }
        } catch (err) {
          rejected += 1;
          continue;
        }
        try {
          const created = await api("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_type, project_name }),
          });
          if (created?.id && Object.keys(stagePayload).length) {
            await api(`/api/projects/${created.id}/stage`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(stagePayload),
            });
          }
          if (created?.id && Object.keys(approvalPayload).length) {
            await api(`/api/projects/${created.id}/approval-fields?auto_stage=true`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ values: approvalPayload }),
            });
          }
          imported += 1;
        } catch (err) {
          const detail = String(err?.message || "").toLowerCase();
          if (detail.includes("already exists") || detail.includes("duplicate")) {
            duplicate += 1;
          } else {
            rejected += 1;
          }
        }
      }
      await load();
      onChanged();
      const summary = `Upload Summary\n\nUploaded: ${imported}\nRejected: ${rejected}\nDuplicate: ${duplicate}`;
      window.alert(summary);
      setMessage(`Upload complete. Uploaded ${imported}, rejected ${rejected}, duplicate ${duplicate}.`);
    } catch (err) {
      setMessage(err.message || "Upload failed.");
    }
  }

  const registrationColumns = [
    { key: "sr", label: "Sr. No." },
    { key: "unique_id", label: "Unique ID" },
    { key: "project_name", label: "Project Name" },
    { key: "gross_cost", label: "Gross Cost (₹ Cr)", render: (row) => row.gross_cost ? number(row.gross_cost) : "-" },
    { key: "registration_date", label: "Date of Registration" },
    { key: "status", label: "Current Status" },
  ];

  function filteredRows(tableKey) {
    const filter = filters[tableKey];
    const value = String(filter.value || "").trim().toLowerCase();
    const search = String(tableSearch[tableKey] || "").trim().toLowerCase();
    const rows = tables[tableKey] || [];
    return rows.filter((row) => {
      const matchesFilter = !value || String(row[filter.field] || "").toLowerCase().includes(value);
      const matchesSearch = !search || `${row.unique_id || ""} ${row.project_name || ""} ${row.raw_project_name || ""}`.toLowerCase().includes(search);
      return matchesFilter && matchesSearch;
    });
  }

  function setTableFilter(tableKey, nextFilter) {
    setFilters({ ...filters, [tableKey]: nextFilter });
    setTablePage({ ...tablePage, [tableKey]: 1 });
  }

  function statusClass(status) {
    return String(status || "").trim().toLowerCase().replaceAll(" ", "-") || "unknown";
  }

  function RegistrationTable({ title, tableKey }) {
    const filter = filters[tableKey];
    const rows = filteredRows(tableKey);
    const count = rowsPerPage[tableKey] || 10;
    const pageCount = Math.max(1, Math.ceil(rows.length / count));
    const currentPage = Math.min(tablePage[tableKey] || 1, pageCount);
    const visibleRows = rows.slice((currentPage - 1) * count, currentPage * count);
    const fromRow = rows.length ? (currentPage - 1) * count + 1 : 0;
    const toRow = Math.min(currentPage * count, rows.length);

    function updatePage(nextPage) {
      setTablePage({ ...tablePage, [tableKey]: Math.min(pageCount, Math.max(1, nextPage)) });
    }

    return (
      <section className="registration-section">
        <div className="registration-section-head">
          <h2><ClipboardList size={24} /> {title}</h2>
          <div className="registration-table-tools">
            <label className="registration-search">
              <input
                value={tableSearch[tableKey]}
                onChange={(event) => {
                  setTableSearch({ ...tableSearch, [tableKey]: event.target.value });
                  setTablePage({ ...tablePage, [tableKey]: 1 });
                }}
                placeholder="Search project name or ID..."
              />
              <Search size={17} />
            </label>
            <button type="button" className="registration-icon-refresh" onClick={refreshList} title="Refresh table">
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        <div className="registration-filter">
          <label>Filter By:</label>
          <select value={filter.field} onChange={(event) => setTableFilter(tableKey, { ...filter, field: event.target.value })}>
            <option value="project_name">Project Name</option>
            <option value="unique_id">Unique ID</option>
            <option value="registration_date">Date of Registration</option>
            <option value="status">Current Status</option>
          </select>
          <label>Value:</label>
          <input
            value={filter.value}
            onChange={(event) => setTableFilter(tableKey, { ...filter, value: event.target.value })}
            placeholder="Enter value"
          />
          <button type="button" onClick={() => setTableFilter(tableKey, { ...filter, value: "" })}>
            <X size={16} /> Clear
          </button>
        </div>

        <div
          className="registration-table-wrap"
          ref={(node) => {
            tableScrollRefs.current[tableKey] = node;
          }}
        >
          <table className="registration-data-table">
            <thead>
              <tr>
                {registrationColumns.map((column) => (
                  <th key={column.key}>{column.label}{column.key !== "sr" ? <ChevronDown size={13} /> : null}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row, index) => (
                <tr
                  key={row.id || `${row.unique_id}-${index}`}
                  className={`${selectedRowIds.map((id) => String(id)).includes(String(row.id)) ? "selected-row" : ""} ${projectHasChildren(row, rows) ? "project-parent-row" : ""}`.trim()}
                  onClick={(event) => selectRegistrationRow(row, tableKey, event)}
                  onDoubleClick={(event) => openProjectFromName(row, tableKey, event)}
                  title="Double click to open this project's current status"
                >
                  <td>{(currentPage - 1) * count + index + 1}</td>
                  <td>{row.unique_id}</td>
                  <td>{row.project_name}</td>
                  <td>{row.gross_cost ? number(row.gross_cost) : "-"}</td>
                  <td>{row.registration_date}</td>
                  <td><span className={`registration-status ${statusClass(row.status)}`}>{row.status || "Registered"}</span></td>
                  <td>
                    <div className="registration-row-actions">
                      <button
                        type="button"
                        title="View project"
                        onClick={(event) => openProjectFromName(row, tableKey, event)}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        title="Edit project"
                        onClick={(event) => openProjectFromName(row, tableKey, event)}
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={registrationColumns.length + 1} className="empty">No records available.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="registration-table-footer">
          <span>Showing {fromRow} to {toRow} of {rows.length} entries</span>
          <div className="registration-footer-controls">
            <label>
              Rows per page:
              <select
                value={count}
                onChange={(event) => {
                  setRowsPerPage({ ...rowsPerPage, [tableKey]: Number(event.target.value) });
                  setTablePage({ ...tablePage, [tableKey]: 1 });
                }}
              >
                {[10, 25, 50].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="registration-pagination">
              <button type="button" onClick={() => updatePage(1)} disabled={currentPage === 1}><ChevronsLeft size={16} /></button>
              <button type="button" onClick={() => updatePage(currentPage - 1)} disabled={currentPage === 1}><ChevronLeft size={16} /></button>
              <strong>{currentPage}</strong>
              <button type="button" onClick={() => updatePage(currentPage + 1)} disabled={currentPage === pageCount}><ChevronRight size={16} /></button>
              <button type="button" onClick={() => updatePage(pageCount)} disabled={currentPage === pageCount}><ChevronsRight size={16} /></button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="registration-window">
      <div className="registration-page-title">
        <h1><ClipboardList size={31} /> Project Registration <span>(Tabular Form)</span></h1>
        <button type="button" className="registration-home-btn" onClick={onHome}>
          <Home size={17} /> Home
        </button>
      </div>

      <div className="registration-create-card">
        <form className="registration-form" onSubmit={submit}>
          <h2><FileText size={24} /> Register New Project</h2>
          <div className="registration-form-grid">
            <label>
              Project Type <sup>*</sup>
              <select value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })}>
                <option value=""></option>
                <option>Corporate AMR</option>
                <option>Plant Level AMR</option>
              </select>
            </label>
            <label>
              Project Name <sup>*</sup>
              <input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} placeholder="Enter project name" />
            </label>
            <button type="submit"><PlusCircle size={17} /> Register Project</button>
          </div>
        </form>

        <div className="registration-template-row">
          <div className="registration-template-buttons">
            <button type="button" className="download-btn" onClick={downloadTemplate}><Download size={17} /> Download Template</button>
            <button type="button" className="upload-btn" onClick={() => uploadInputRef.current?.click()}><Upload size={17} /> Upload</button>
          </div>
          <input ref={uploadInputRef} type="file" accept=".csv,text/csv" className="hidden-input" onChange={uploadSheet} />
          <span>Template includes mandatory stage fields for auto stage push</span>
        </div>
      </div>

      {message ? <div className="notice registration-notice">{message}</div> : null}

      <RegistrationTable title="Corporate AMR Projects" tableKey="corporate" />
      <RegistrationTable title="Plant Level AMR Projects" tableKey="plant" />

      <div className="registration-bottom-actions">
        <button type="button" className="registration-delete-btn" onClick={removeSelected} disabled={!selectedRows.length} title="Delete selected project">
          <Trash2 size={17} /> Delete
        </button>
        <button type="button" className="registration-child-btn" onClick={addChildProject} disabled={!selected || selectedRows.length !== 1}>
          <PlusCircle size={16} /> Add Child
        </button>
        <button type="button" className="registration-refresh-btn" onClick={refreshList}>
          <RefreshCw size={16} /> Refresh List
        </button>
      </div>
    </div>
  );
}

function ProjectTable({ rows, compact = false }) {
  const columns = [
    { key: "unique_id", label: "Unique ID" },
    { key: "project_name", label: "Project Name" },
    { key: "project_type", label: "Type" },
    { key: "stage1_cleared", label: "Stage-1" },
    { key: "stage2_cleared", label: "Stage-2" },
  ];
  if (!compact) {
    columns.push(
      { key: "registration_date", label: "Registration", render: (row) => formatDate(row.registration_date) },
      { key: "schedule_completion", label: "Schedule Completion", render: (row) => formatDate(row.schedule_completion) },
    );
  }
  return <DataTable columns={columns} rows={rows} />;
}

function StageTrackingView({ onChanged, onHome, onBack, project, user, initialStage = "formulation" }) {
  const emptyStages = { formulation: [], stage1: [], tendering: [], stage2: [] };
  const [stages, setStages] = useState(emptyStages);
  const [activeStage, setActiveStage] = useState("formulation");
  const [selectedRow, setSelectedRow] = useState(null);
  const [stageForm, setStageForm] = useState(null);
  const [loadingStageForm, setLoadingStageForm] = useState(false);
  const [message, setMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [droppedFilter, setDroppedFilter] = useState("All");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);

  const stageTabs = [
    ["formulation", "Under Formulation", "Edit Under Formulation Details", FileText],
    ["stage1", "Stage-1", "Edit Stage-1 Details", ClipboardList],
    ["tendering", "Tendering", "Edit Tendering Details", Settings],
    ["stage2", "Stage-2", "Edit Stage-2 Details", Table2],
  ];
  const activeTab = stageTabs.find(([key]) => key === activeStage) || stageTabs[0];
  const rows = stages[activeStage] || [];
  const filteredRows = rows.filter((row) => {
    const query = searchText.trim().toLowerCase();
    const matchesSearch = !query || `${row.unique_id || ""} ${row.project_name || ""}`.toLowerCase().includes(query);
    const matchesType = typeFilter === "All" || row.project_type === typeFilter;
    const matchesStatus = statusFilter === "All" || statusFilter === activeTab[1];
    const droppedValue = row.project_dropped === "Y" ? "Yes" : "No";
    const matchesDropped = droppedFilter === "All" || droppedFilter === droppedValue;
    return matchesSearch && matchesType && matchesStatus && matchesDropped;
  });
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const activeRows = rows.filter((row) => row.project_dropped !== "Y").length;
  const droppedRows = rows.filter((row) => row.project_dropped === "Y").length;
  const lastUpdated = new Date();
  const projectTypes = ["All", ...Array.from(new Set(rows.map((row) => row.project_type).filter(Boolean)))];
  const statusOptions = ["All", ...stageTabs.map(([, label]) => label)];

  async function load() {
    const data = await api("/api/projects/stages");
    setStages(data || emptyStages);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (initialStage && initialStage !== activeStage) {
      setActiveStage(initialStage);
    }
  }, [initialStage]);

  useEffect(() => {
    setSelectedRow(null);
    setStageForm(null);
    setSearchText("");
    setTypeFilter("All");
    setStatusFilter("All");
    setDroppedFilter("All");
    setPage(1);
  }, [activeStage]);

  useEffect(() => {
    setPage(1);
  }, [searchText, typeFilter, statusFilter, droppedFilter, rowsPerPage]);

  useEffect(() => {
    if (!project?.id) return;
    const projectIndex = filteredRows.findIndex((row) => String(row.id) === String(project.id));
    if (projectIndex < 0) return;
    setSelectedRow(filteredRows[projectIndex]);
    setPage(Math.floor(projectIndex / rowsPerPage) + 1);
  }, [project?.id, activeStage, stages, searchText, typeFilter, statusFilter, droppedFilter, rowsPerPage]);

  async function patchProject(projectId, payload, successMessage) {
    await api(`/api/projects/${projectId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await load();
    onChanged?.();
    setMessage(successMessage);
  }

  async function toggleDropped(row) {
    const nextValue = row.project_dropped === "Y" ? "N" : "Y";
    const promptText = nextValue === "Y"
      ? `Mark project ${row.unique_id} as dropped?`
      : `Remove Project Dropped mark for project ${row.unique_id}?`;
    if (!window.confirm(promptText)) return;
    try {
      await patchProject(row.id, { project_dropped: nextValue }, "Project dropped status updated.");
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function openStageForm(rowOverride = null) {
    const targetRow = rowOverride || selectedRow;
    if (!targetRow) {
      setMessage("Please select a project row first.");
      return;
    }
    setSelectedRow(targetRow);
    setLoadingStageForm(true);
    setStageForm({
      row: targetRow,
      stageKey: activeStage,
      workflow: null,
      workflowStage: null,
      values: {},
      loading: true,
      error: "",
    });
    try {
      const data = await api(`/api/projects/${targetRow.id}/approval-fields`);
      const activeWorkflowStage = (data.workflow?.stages || []).find((item) => item.key === activeStage);
      const values = {};
      (activeWorkflowStage?.steps || []).forEach((step) => {
        values[step.fieldKey] = step.value || "";
      });
      setStageForm({
        row: targetRow,
        stageKey: activeStage,
        workflow: data.workflow,
        workflowStage: activeWorkflowStage,
        values,
        loading: false,
        error: "",
      });
    } catch (err) {
      const errorMessage = err.message || "Unable to load approval fields.";
      setMessage(errorMessage);
      setStageForm((current) => (
        current?.row?.id === targetRow.id
          ? { ...current, loading: false, error: errorMessage }
          : current
      ));
    } finally {
      setLoadingStageForm(false);
    }
  }

  function updateStageForm(key, value) {
    setStageForm((current) => (
      current
        ? { ...current, values: { ...current.values, [key]: value } }
        : current
    ));
  }

  function updateStageAmountGroup(fieldKey, part, value) {
    setStageForm((current) => {
      if (!current) return current;
      const values = { ...current.values, [`${fieldKey}.${part}`]: value };
      const amount = Number(values[`${fieldKey}.amount`] || 0);
      const netItc = Number(values[`${fieldKey}.net_itc`] || 0);
      values[fieldKey] = amount || netItc ? String(amount + netItc) : "";
      return { ...current, values };
    });
  }

  async function saveStageForm(event) {
    event.preventDefault();
    if (!stageForm?.row) return;
    const { row, values, workflowStage } = stageForm;
    const invalidAmount = (workflowStage?.steps || []).some((step) => (
      step.dataField === "Amount"
      && [step.fieldKey, `${step.fieldKey}.amount`, `${step.fieldKey}.net_itc`].some((key) => (
        values[key] !== "" && Number.isNaN(Number(values[key]))
      ))
    ));
    if (invalidAmount) {
      setMessage("Amount fields must be valid numbers.");
      return;
    }

    try {
      await api(`/api/projects/${row.id}/approval-fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      await load();
      onChanged?.();
      setMessage("Approval stage fields saved.");
      setStageForm(null);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function refreshList() {
    await load();
    setMessage("Project list refreshed.");
  }

  async function clearActiveStage(rowOverride = null) {
    const targetRow = rowOverride || selectedRow;
    if (!targetRow) {
      setMessage("Select a project row first.");
      return;
    }
    if (user?.role !== "admin") {
      setMessage("Only admin can clear approval stages.");
      return;
    }
    if (!window.confirm(`Mark ${activeTab[1]} as Stage Cleared for ${targetRow.unique_id}?`)) return;
    try {
      await api(`/api/projects/${targetRow.id}/approval-stage-clearance/${activeStage}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requested_by_role: user?.role || "" }),
      });
      await load();
      onChanged?.();
      setSelectedRow(null);
      setStageForm(null);
      setMessage(`${activeTab[1]} Stage Cleared. Project moved to the next stage.`);
    } catch (err) {
      setMessage(err.message || "Unable to clear approval stage.");
    }
  }

  function clearFilters() {
    setSearchText("");
    setTypeFilter("All");
    setStatusFilter("All");
    setDroppedFilter("All");
  }

  return (
    <section className="project-details-redesign">
      <div className="project-details-topbar">
        <div>
          <h1>Project Details</h1>
        </div>
        <div className="project-details-top-actions">
          {onBack ? (
            <button type="button" className="project-details-back" onClick={onBack}>
              <ArrowLeft size={16} /> Back
            </button>
          ) : null}
          <button type="button" className="project-details-refresh" onClick={refreshList}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button type="button" className="project-details-home" onClick={onHome}>
            <Home size={17} /> Home
          </button>
        </div>
      </div>

      <div className="stage-tracking project-details-stage">
        <div className="project-details-title">
          <h2>Project Details - Stage-wise Tracking</h2>
          <p>Track the current status of the project across different stages.</p>
        </div>

        <div className="stage-tabs">
          {stageTabs.map(([key, label, , Icon]) => (
            <button
              key={key}
              className={activeStage === key ? "active" : ""}
              onClick={() => setActiveStage(key)}
            >
              <Icon size={20} />
              {label}
            </button>
          ))}
        </div>

        <div className="stage-metrics">
          <div className="stage-metric-card blue">
            <span><FolderKanban size={30} /></span>
            <div><small>Total Projects</small><strong>{rows.length}</strong><p>In {activeTab[1]}</p></div>
          </div>
          <div className="stage-metric-card green">
            <span><CheckCircle size={30} /></span>
            <div><small>Active Projects</small><strong>{activeRows}</strong><p>Not Dropped</p></div>
          </div>
          <div className="stage-metric-card orange">
            <span><Trash2 size={30} /></span>
            <div><small>Dropped Projects</small><strong>{droppedRows}</strong><p>In This Stage</p></div>
          </div>
          <div className="stage-metric-card purple">
            <span><CalendarDays size={30} /></span>
            <div>
              <small>Last Updated</small>
              <strong>{lastUpdated.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replaceAll(" ", "-")}</strong>
              <p>{lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          </div>
        </div>

        <div className="stage-filter-bar">
          <label className="stage-search">
            <Search size={21} />
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search by Project Name or Unique ID..." />
          </label>
          <label>
            Project Type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              {projectTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            Current Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label>
            Project Dropped
            <select value={droppedFilter} onChange={(event) => setDroppedFilter(event.target.value)}>
              {["All", "Yes", "No"].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <button type="button" className="stage-clear-filters" onClick={clearFilters}>
            <ListChecks size={17} /> Clear Filters
          </button>
          {user?.role === "admin" ? (
            <button type="button" className="stage-clear-filters" onClick={() => clearActiveStage()}>
              <CheckCircle size={17} /> Stage Clearance
            </button>
          ) : null}
        </div>

        <div className="stage-table-wrap">
          <table className="stage-table">
            <thead>
              <tr>
                <th>Unique ID <ChevronDown size={14} /></th>
                <th>Project Name <ChevronDown size={14} /></th>
                <th>Project Type <ChevronDown size={14} /></th>
                <th>Current Status <ChevronDown size={14} /></th>
                <th>Project Dropped <ChevronDown size={14} /></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row) => (
                <tr
                  key={row.id}
                  className={selectedRow?.id === row.id ? "selected-row" : ""}
                  onClick={() => setSelectedRow(row)}
                  onDoubleClick={() => openStageForm(row)}
                >
                  <td>{row.unique_id}</td>
                  <td>{row.project_name}</td>
                  <td><span className="stage-pill type">{row.project_type}</span></td>
                  <td><span className="stage-pill status">{activeTab[1]}</span></td>
                  <td>
                    <button
                      type="button"
                      className={row.project_dropped === "Y" ? "stage-drop-pill yes" : "stage-drop-pill no"}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleDropped(row);
                      }}
                    >
                      {row.project_dropped === "Y" ? "Yes" : "No"}
                    </button>
                  </td>
                  <td>
                    <div className="stage-row-actions">
                      <button
                        type="button"
                        title="View project"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedRow(row);
                          setMessage(`${row.unique_id} selected.`);
                        }}
                      >
                        <Eye size={17} />
                      </button>
                      <button
                        type="button"
                        title="Edit stage details"
                        onClick={(event) => {
                          event.stopPropagation();
                          openStageForm(row);
                        }}
                      >
                        <Settings size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan="6" className="empty">No projects available in this stage.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="stage-table-footer">
          <span>
            Showing {filteredRows.length ? (currentPage - 1) * rowsPerPage + 1 : 0} to {Math.min(currentPage * rowsPerPage, filteredRows.length)} of {filteredRows.length} entries
          </span>
          <div className="stage-pagination">
            <button type="button" onClick={() => setPage(1)} disabled={currentPage === 1}>{"<<"}</button>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}>{"<"}</button>
            <strong>{currentPage}</strong>
            <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount}>{">"}</button>
            <button type="button" onClick={() => setPage(pageCount)} disabled={currentPage === pageCount}>{">>"}</button>
          </div>
          <label className="stage-rows-select">
            Rows per page:
            <select value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))}>
              {[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        </div>

        {message ? <div className="notice stage-notice">{message}</div> : null}
        {loadingStageForm ? <div className="notice stage-notice">Loading approval fields...</div> : null}
      </div>
      {stageForm ? (
        <div className="stage-form-backdrop" onMouseDown={() => setStageForm(null)}>
          <form className="stage-edit-modal" onSubmit={saveStageForm} onMouseDown={(event) => event.stopPropagation()}>
            <h3>{activeTab[2]}</h3>
            <div className="stage-form-project">
              <span>{stageForm.row.unique_id}</span>
              <strong>{stageForm.row.project_name}</strong>
              <em>{stageForm.workflow?.categoryLabel}</em>
            </div>

            <div className="approval-field-grid">
              <div className="approval-field-head">
                <span>Sl. No.</span>
                <span>Workflow Activity / Approval Step</span>
                <span>Responsible Agency</span>
                <span>Data Field</span>
                <span>Value</span>
              </div>
              {stageForm.loading ? (
                <div className="approval-field-empty">Loading approval fields...</div>
              ) : null}
              {stageForm.error ? (
                <div className="approval-field-empty error">{stageForm.error}</div>
              ) : null}
              {(stageForm.workflowStage?.steps || []).map((step) => (
                <div className={step.applicable ? "approval-field-row" : "approval-field-row not-applicable"} key={step.fieldKey}>
                  <span>{step.no}</span>
                  <span>{step.name}</span>
                  <span>{step.applicable ? step.responsibleAgency : "-"}</span>
                  <span>{step.dataField}</span>
                  {step.applicable ? (
                    step.dataField === "Amount" ? (
                      <div className="approval-amount-group">
                        <input
                          value={stageForm.values[`${step.fieldKey}.amount`] || ""}
                          onChange={(event) => updateStageAmountGroup(step.fieldKey, "amount", event.target.value)}
                          placeholder="Amount"
                          inputMode="decimal"
                        />
                        <input
                          value={stageForm.values[`${step.fieldKey}.net_itc`] || ""}
                          onChange={(event) => updateStageAmountGroup(step.fieldKey, "net_itc", event.target.value)}
                          placeholder="Net of ITC"
                          inputMode="decimal"
                        />
                        <input value={stageForm.values[step.fieldKey] || ""} readOnly placeholder="Gross Cost" />
                      </div>
                    ) : (
                      <input
                        value={stageForm.values[step.fieldKey] || ""}
                        onChange={(event) => updateStageForm(step.fieldKey, event.target.value)}
                        placeholder="DD-MM-YY"
                        inputMode="text"
                      />
                    )
                  ) : (
                    <input value="" disabled placeholder="Not Applicable" />
                  )}
                </div>
              ))}
            </div>

            <div className="stage-edit-actions">
              <button type="submit">Save</button>
              {user?.role === "admin" ? (
                <button type="button" className="stage-cleared-action" onClick={() => clearActiveStage(stageForm.row)}>
                  Stage Cleared
                </button>
              ) : null}
              <button type="button" onClick={() => setStageForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function ProjectDetailsView({ onChanged, onHome, onBack, project, user, initialStage }) {
  return <StageTrackingView onChanged={onChanged} onHome={onHome} onBack={onBack} project={project} user={user} initialStage={initialStage} />;
}

const appendixActivityGroups = {
  "Design & Engineering": ["Basic Engineering", "Detailed Design Engineering"],
  "Civil Work": ["Civil Execution"],
  "Supply / Delivery": [
    "Building Steel Structures & Sheeting",
    "Mechanical Plant & Equipment - Imported",
    "Mechanical Plant & Equipment - Indigenous",
    "Electrical Plant & Equipment - Imported",
    "Electrical Plant & Equipment - Indigenous",
    "Refractories - Imported",
    "Refractories - Indigenous",
  ],
  Erection: [
    "Building Steel Structures & Sheeting",
    "Mechanical Plant & Equipment",
    "Electrical Plant & Equipment",
    "Refractories",
  ],
  "Testing & Commissioning": ["Preliminary Acceptance", "Commissioning"],
};

const emptyAppendixForm = {
  s_no: "",
  category: "Design & Engineering",
  item: "Basic Engineering",
  commencement_months: "",
  completion_months: "",
};

function ContractDetailsView({ project, user, onBack, onHome }) {
  const [details, setDetails] = useState(null);
  const [appendixRows, setAppendixRows] = useState([]);
  const [activitiesVisible, setActivitiesVisible] = useState(false);
  const [activityFormOpen, setActivityFormOpen] = useState(false);
  const [activityForm, setActivityForm] = useState(emptyAppendixForm);
  const uploadInputRef = useRef(null);
  const [contractForm, setContractForm] = useState({
    contractor_name: "",
    loa_date: "",
    effective_date: "",
    schedule_months: "",
    schedule_completion: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadContractDetails() {
    if (!project?.id) return;
    setDetails(null);
    setAppendixRows([]);
    setError("");
    setMessage("");
    try {
      const [projectData, appendixData] = await Promise.all([
      api(`/api/projects/${project.id}`),
      api(`/api/projects/${project.id}/appendix`),
      ]);
      const loadedProject = projectData.project || null;
      setDetails(loadedProject);
      const loadedForm = {
        contractor_name: loadedProject?.contractor_name || "",
        loa_date: stageDateInput(loadedProject?.loa_date),
        effective_date: stageDateInput(loadedProject?.effective_date),
        schedule_months: loadedProject?.schedule_months || "",
        schedule_completion: stageDateInput(loadedProject?.schedule_completion),
        expected_finish: stageDateInput(loadedProject?.expected_finish),
      };
      loadedForm.schedule_completion = calculateScheduleCompletion(loadedForm);
      loadedForm.expected_finish = loadedForm.expected_finish || loadedForm.schedule_completion;
      setContractForm(loadedForm);
      setAppendixRows(normalizeAppendixRowDates(loadedForm, appendixData.rows || []));
    } catch (err) {
      setError(err.message || "Unable to load contract details.");
    }
  }

  useEffect(() => {
    loadContractDetails();
  }, [project?.id]);

  if (!project) return <EmptySelect />;
  if (error) return <div className="error">{error}</div>;
  if (!details) return <div className="loading">Loading contract details...</div>;

  function parseContractDate(value) {
    return parseAppDateValue(value);
  }

  function formatContractDate(date) {
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).replaceAll("/", "-");
  }

  function addMonthsToDate(baseDate, monthsValue) {
    const months = Number(monthsValue);
    if (!baseDate || !Number.isFinite(months)) return null;
    const wholeMonths = Math.trunc(months);
    const targetMonthIndex = baseDate.getMonth() + wholeMonths;
    const targetYear = baseDate.getFullYear() + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    const result = new Date(targetYear, targetMonth, Math.min(baseDate.getDate(), lastDay));
    const fractionalMonth = months - wholeMonths;
    if (Math.abs(fractionalMonth) > 1e-9) {
      result.setDate(result.getDate() + Math.round(fractionalMonth * 30));
    }
    return result;
  }

  function calculateScheduleCompletion(form) {
    const effectiveDate = parseContractDate(form.effective_date);
    const completion = addMonthsToDate(effectiveDate, form.schedule_months || 0);
    if (!completion || Number(form.schedule_months || 0) <= 0) return "";
    return formatContractDate(completion);
  }

  function calculateAppendixDate(form, monthsValue) {
    const effectiveDate = parseContractDate(form.effective_date);
    const date = addMonthsToDate(effectiveDate, monthsValue);
    if (!date) return "";
    return formatContractDate(date);
  }

  function normalizeAppendixRowDates(form, rows) {
    return (rows || []).map((row) => ({
      ...row,
      schedule_start: calculateAppendixDate(form, row.commencement_months),
      schedule_finish: calculateAppendixDate(form, row.completion_months),
    }));
  }

  function updateContractField(key, value) {
    setContractForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "effective_date" || key === "schedule_months") {
        next.schedule_completion = calculateScheduleCompletion(next);
        if (!current.expected_finish || current.expected_finish === current.schedule_completion) {
          next.expected_finish = next.schedule_completion;
        }
      }
      if (key === "effective_date") {
        setAppendixRows((rows) => normalizeAppendixRowDates(next, rows));
      }
      return next;
    });
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizePlantTemplateHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[._]/g, " ")
      .replace(/\s+/g, " ");
  }

  const defaultParentNames = Object.keys(appendixActivityGroups);
  const dropdownDefaultRows = defaultParentNames.flatMap((parent) => (
    (appendixActivityGroups[parent] || []).map((child) => [
      "Dropdown Defaults",
      "",
      "",
      "",
      parent,
      child,
      "",
      "",
      "",
      "",
    ])
  ));

  function resolveDefaultAppendixActivity(parentValue, childValue) {
    const parentText = String(parentValue || "").trim();
    const childText = String(childValue || "").trim();
    let parent = defaultParentNames.find((name) => name.toLowerCase() === parentText.toLowerCase()) || "";
    if (!parent && childText) {
      parent = defaultParentNames.find((name) => (
        (appendixActivityGroups[name] || []).some((child) => child.toLowerCase() === childText.toLowerCase())
      )) || "";
    }
    if (!parent) {
      throw new Error(`Invalid Default Parent Name: ${parentText || "(blank)"}`);
    }
    const childOptions = appendixActivityGroups[parent] || [];
    const child = childOptions.find((name) => name.toLowerCase() === childText.toLowerCase()) || childOptions[0] || "";
    if (!child || (childText && child.toLowerCase() !== childText.toLowerCase())) {
      throw new Error(`Invalid Default Child Name "${childText}" for parent "${parent}".`);
    }
    return { parent, child };
  }

  function downloadContractTemplate() {
    const rows = [
      ["Section", "Field", "Value", "S.No.", "Default Parent Name", "Default Child Name", "Commencement Months", "Completion Months", "Schedule Start", "Schedule Finish"],
      ["Contract Details", "Project UID", details.unique_id, "", "", "", "", "", "", ""],
      ["Contract Details", "Project Name", details.project_name, "", "", "", "", "", "", ""],
      ["Contract Details", "Contractor Name", contractForm.contractor_name, "", "", "", "", "", "", ""],
      ["Contract Details", "LOA Date", contractForm.loa_date, "", "", "", "", "", "", ""],
      ["Contract Details", "Effective Date of Contract", contractForm.effective_date, "", "", "", "", "", "", ""],
      ["Contract Details", "Project Schedule in Months", contractForm.schedule_months, "", "", "", "", "", "", ""],
      ["Contract Details", "Schedule Completion Date", contractForm.schedule_completion, "", "", "", "", "", "", ""],
      ...appendixRows.map((row) => [
        "Appendix-2",
        "",
        "",
        row.s_no,
        row.category,
        row.item,
        row.commencement_months,
        row.completion_months,
        stageDateInput(row.schedule_start),
        stageDateInput(row.schedule_finish),
      ]),
      ["Dropdown Defaults", "Use these values in Appendix-2 rows", "", "", "", "", "", "", "", ""],
      ...dropdownDefaultRows,
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(details.unique_id || "contract").replaceAll("/", "_")}_contract_appendix_template_with_dropdown_defaults.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Template downloaded with default parent/child dropdown values.");
  }

  async function saveContract(nextForm = contractForm, nextAppendixRows = appendixRows) {
    return api(`/api/projects/${details.id}/contract`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractor_name: nextForm.contractor_name,
        loa_date: nextForm.loa_date,
        effective_date: nextForm.effective_date,
        schedule_months: nextForm.schedule_months ? Number(nextForm.schedule_months) : null,
        expected_finish: nextForm.expected_finish,
        appendix_rows: (nextAppendixRows || []).map((row) => ({
          s_no: row.s_no || "",
          category: row.category || "",
          item: row.item || "",
          commencement_months: row.commencement_months === "" || row.commencement_months == null ? null : Number(row.commencement_months),
          completion_months: row.completion_months === "" || row.completion_months == null ? null : Number(row.completion_months),
        })),
      }),
    });
  }

  async function uploadContractTemplate(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage("");
    try {
      const rows = parseCsvRows(await file.text());
      const [headers, ...dataRows] = rows;
      const headerMap = Object.fromEntries((headers || []).map((header, index) => [String(header || "").trim().toLowerCase(), index]));
      const fieldIndex = headerMap.field;
      const valueIndex = headerMap.value;
      const sectionIndex = headerMap.section;
      if (fieldIndex == null || valueIndex == null || sectionIndex == null) {
        throw new Error("Upload CSV must include Section, Field, and Value columns.");
      }
      const nextForm = { ...contractForm };
      const nextAppendixRows = [];
      for (const row of dataRows) {
        const section = String(row[sectionIndex] || "").trim().toLowerCase();
        if (section === "contract details") {
          const field = String(row[fieldIndex] || "").trim().toLowerCase();
          const value = String(row[valueIndex] || "").trim();
          if (field === "contractor name") nextForm.contractor_name = value;
          if (field === "loa date") nextForm.loa_date = value;
          if (field === "effective date of contract") nextForm.effective_date = value;
          if (field === "project schedule in months") nextForm.schedule_months = value;
        }
        if (section === "appendix-2") {
          const parentValue = row[headerMap["default parent name"]] || row[headerMap.parent] || "";
          const childValue = row[headerMap["default child name"]] || row[headerMap["item of work"]] || "";
          const resolved = resolveDefaultAppendixActivity(parentValue, childValue);
          nextAppendixRows.push({
            id: `uploaded-${nextAppendixRows.length}`,
            s_no: row[headerMap["s.no."]] || row[headerMap["s.no"]] || "",
            category: resolved.parent,
            item: resolved.child,
            commencement_months: row[headerMap["commencement months"]] || "",
            completion_months: row[headerMap["completion months"]] || "",
            schedule_start: row[headerMap["schedule start"]] || "",
            schedule_finish: row[headerMap["schedule finish"]] || "",
          });
        }
      }
      nextForm.schedule_completion = calculateScheduleCompletion(nextForm);
      const rowsToSave = nextAppendixRows.length ? nextAppendixRows : appendixRows;
      const normalizedRowsToSave = normalizeAppendixRowDates(nextForm, rowsToSave);
      await saveContract(nextForm, normalizedRowsToSave);
      setContractForm(nextForm);
      setAppendixRows(normalizedRowsToSave);
      setMessage("Template uploaded and saved.");
      await loadContractDetails();
    } catch (err) {
      setMessage(err.message || "Upload failed.");
    }
  }

  function promptDate(field, label) {
    const value = window.prompt(label, contractForm[field] || "");
    if (value !== null) updateContractField(field, value.trim());
  }

  function addMonthsToContractDate(monthsValue) {
    return calculateAppendixDate(contractForm, monthsValue);
  }

  async function saveCurrentContract() {
    setMessage("");
    try {
      await saveContract(contractForm, appendixRows);
      setMessage("Contract details saved.");
      await loadContractDetails();
    } catch (err) {
      setMessage(err.message || "Save failed.");
    }
  }

  function openAppendixActivityForm() {
    const defaultCategory = Object.keys(appendixActivityGroups)[0];
    setActivityForm({
      s_no: String((appendixRows.length || 0) + 1),
      category: defaultCategory,
      item: appendixActivityGroups[defaultCategory][0],
      commencement_months: "",
      completion_months: "",
    });
    setActivityFormOpen(true);
  }

  function updateActivityForm(key, value) {
    setActivityForm((current) => {
      if (key === "category") {
        return {
          ...current,
          category: value,
          item: appendixActivityGroups[value]?.[0] || "",
        };
      }
      return { ...current, [key]: value };
    });
  }

  async function submitAppendixActivity(event) {
    event.preventDefault();
    setMessage("");
    if (!activityForm.category.trim() || !activityForm.item.trim()) {
      setMessage("Select default parent and child activity names.");
      return;
    }
    const commencement = Number(activityForm.commencement_months);
    const completion = Number(activityForm.completion_months);
    if (!Number.isFinite(commencement) || !Number.isFinite(completion)) {
      setMessage("Start and finish month must be valid numbers.");
      return;
    }
    if (completion < commencement) {
      setMessage("Finish month cannot be before start month.");
      return;
    }
    const nextRows = [
      ...appendixRows,
      {
        id: `new-${Date.now()}`,
        s_no: activityForm.s_no.trim(),
        category: activityForm.category.trim(),
        item: activityForm.item.trim(),
        commencement_months: String(commencement),
        completion_months: String(completion),
        schedule_start: calculateAppendixDate(contractForm, commencement),
        schedule_finish: calculateAppendixDate(contractForm, completion),
      },
    ];
    setAppendixRows(nextRows);
    setActivitiesVisible(true);
    setActivityFormOpen(false);
    try {
      await saveContract(contractForm, nextRows);
      setMessage("Activity added and saved.");
      await loadContractDetails();
      setActivitiesVisible(true);
    } catch (err) {
      setMessage(err.message || "Activity added. Use Save to persist changes.");
    }
  }

  const scheduleMonths = Number(contractForm.schedule_months || 0);
  const completionDate = parseContractDate(contractForm.schedule_completion);
  const expectedFinishDate = parseContractDate(contractForm.expected_finish) || completionDate;
  const today = new Date();
  const remainingDays = expectedFinishDate
    ? Math.max(0, Math.ceil((expectedFinishDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  const progressPercent = scheduleMonths > 0
    ? Math.min(100, Math.max(0, Math.round((appendixRows.length / Math.max(appendixRows.length + 20, 1)) * 100)))
    : 0;
  const delayDays = completionDate && expectedFinishDate
    ? Math.ceil((expectedFinishDate.getTime() - completionDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const delayStatus = delayDays <= 0 ? "On Time" : delayDays <= 365 ? "Delay < 1 Year" : "Delay > 1 Year";
  const delayTone = delayDays <= 0 ? "ontime" : delayDays <= 365 ? "delay-lt-year" : "delay-gt-year";
  const canEditExpectedFinish = String(user?.role || "").trim().toLowerCase() === "admin";
  const appendixRowsByParent = appendixRows.reduce((groups, row) => {
    const parentName = row.category || "Other Activities";
    if (!groups[parentName]) groups[parentName] = [];
    groups[parentName].push(row);
    return groups;
  }, {});
  const appendixParentSchedule = Object.fromEntries(Object.entries(appendixRowsByParent).map(([parentName, rows]) => {
    const starts = rows.map((row) => parseAppDateValue(row.schedule_start)).filter(Boolean);
    const finishes = rows.map((row) => parseAppDateValue(row.schedule_finish)).filter(Boolean);
    const minStart = starts.length ? new Date(Math.min(...starts.map((value) => value.getTime()))) : null;
    const maxFinish = finishes.length ? new Date(Math.max(...finishes.map((value) => value.getTime()))) : null;
    return [parentName, { start: minStart, finish: maxFinish }];
  }));

  return (
    <div className="contract-window">
      <div className="contract-top-actions">
        <button type="button" className="contract-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <button type="button" className="contract-home" onClick={onHome}><Home size={16} /> Home</button>
        <button type="button" className="contract-refresh" onClick={loadContractDetails}><RefreshCw size={15} /> Refresh</button>
        <button type="button" className="contract-template" onClick={downloadContractTemplate}><FileText size={15} /> Template</button>
        <button type="button" className="contract-upload" onClick={() => uploadInputRef.current?.click()}><Upload size={15} /> Upload</button>
        <input ref={uploadInputRef} type="file" accept=".csv,text/csv" className="hidden-input" onChange={uploadContractTemplate} />
      </div>
      <h1>Contract Details &amp; Appendix-2</h1>
      <h2>{details.project_name}</h2>
      <div className="contract-title-rule"><span /></div>

      <div className="contract-dashboard-grid">
        <section className="contract-modern-card">
          <div className="contract-card-head blue">
            <span><ClipboardList size={20} /></span>
            <h3>Contract Details</h3>
          </div>
          <div className="contract-card-body">
            <label className="contract-field wide">
              <span>Contractor Name</span>
              <input
                value={contractForm.contractor_name}
                onChange={(event) => updateContractField("contractor_name", event.target.value)}
              />
            </label>

            <div className="contract-date-row">
              <label className="contract-field date-field">
                <span>LOA Date (DD-MM-YY)</span>
                <div>
                  <input
                    value={contractForm.loa_date}
                    onChange={(event) => updateContractField("loa_date", event.target.value)}
                  />
                  <button type="button" title="Select LOA date" onClick={() => promptDate("loa_date", "LOA Date (DD-MM-YY)")}>
                    <CalendarDays size={15} />
                  </button>
                </div>
              </label>

              <label className="contract-field date-field">
                <span>Effective Date of Contract (DD-MM-YY)</span>
                <div>
                  <input
                    value={contractForm.effective_date}
                    onChange={(event) => updateContractField("effective_date", event.target.value)}
                  />
                  <button type="button" title="Select effective date" onClick={() => promptDate("effective_date", "Effective Date of Contract (DD-MM-YY)")}>
                    <CalendarDays size={15} />
                  </button>
                </div>
              </label>
            </div>
          </div>
        </section>

        <section className="contract-modern-card">
          <div className="contract-card-head green">
            <span><BarChart3 size={20} /></span>
            <h3>Schedule Summary</h3>
          </div>
          <div className="contract-card-body">
            <div className="schedule-top-grid">
              <label className="contract-field months-field">
                <span>Project Schedule in Months</span>
                <input
                  value={contractForm.schedule_months}
                  onChange={(event) => updateContractField("schedule_months", event.target.value)}
                />
                <b>Months</b>
              </label>

              <label className="contract-field completion-field">
                <span>Schedule Completion Date (DD-MM-YY)</span>
                <div>
                  <strong>{contractForm.schedule_completion || "---"}</strong>
                </div>
              </label>

              <label className="contract-field expected-finish-field">
                <span>Expected Finish Date (DD-MM-YY)</span>
                <div>
                  <input
                    value={contractForm.expected_finish || ""}
                    readOnly={!canEditExpectedFinish}
                    onChange={(event) => updateContractField("expected_finish", event.target.value)}
                  />
                  <button
                    type="button"
                    title="Select expected finish date"
                    disabled={!canEditExpectedFinish}
                    onClick={() => promptDate("expected_finish", "Expected Finish Date (DD-MM-YY)")}
                  >
                    <CalendarDays size={15} />
                  </button>
                </div>
              </label>
            </div>

            <div className="schedule-metric-row">
              <div className={`status-pill ${delayTone}`}>
                <CheckCircle size={22} />
                <span>{delayStatus}</span>
              </div>
              <div className="schedule-stat">
                <span>Baseline Completion Date</span>
                <strong>{contractForm.schedule_completion || "---"}</strong>
                <small>(Auto Calculated)</small>
              </div>
              <div className="schedule-stat">
                <span>Expected Finish Date</span>
                <strong>{contractForm.expected_finish || contractForm.schedule_completion || "---"}</strong>
                <small>{canEditExpectedFinish ? "Admin Editable" : "Admin Only"}</small>
              </div>
              <div className="schedule-stat">
                <span>Remaining Duration</span>
                <strong>{remainingDays}</strong>
                <small>Days</small>
              </div>
              <div className="progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` }}>
                <b>{progressPercent}%</b>
                <small>(Approx.)</small>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="contract-actions-row">
        <button type="button" className="contract-save" onClick={saveCurrentContract}>
          Save Contract Details &amp; Appendix-2
        </button>
        {message ? <div className="contract-message">{message}</div> : null}
      </div>

      <section className="contract-appendix-panel">
        <div className="appendix-panel-head">
          <div className="appendix-title-block">
            <span><FolderKanban size={22} /></span>
            <div>
              <h3>Appendix-2 (Schedule Activities)</h3>
              <p>Define and manage the detailed schedule activities as per Appendix-2 format.</p>
            </div>
          </div>
          <div className="appendix-actions">
            <button type="button" onClick={openAppendixActivityForm}><Plus size={18} /> Add Activity</button>
            <button type="button" onClick={() => setActivitiesVisible((value) => !value)}>
              <ListChecks size={18} /> {activitiesVisible ? "Hide Activities" : "View Activities"}
            </button>
          </div>
        </div>
        <div className="appendix-note">
          <span>i</span>
          <b>Note:</b>
          <p>After adding activities, you can view, edit, and monitor progress from the Activities section.</p>
        </div>
        {activitiesVisible ? (
          <div className="contract-appendix-table">
            <table>
              <thead>
                <tr>
                  <th>S.No.</th>
                  <th>Parent</th>
                  <th>Item of Work</th>
                  <th>Commencement<br />(Months)</th>
                  <th>Completion<br />(Months)</th>
                  <th>Schedule Start</th>
                  <th>Schedule Finish</th>
                </tr>
              </thead>
              <tbody>
                {appendixRows.length ? Object.entries(appendixRowsByParent).map(([parentName, rows]) => (
                  <React.Fragment key={parentName}>
                    <tr className="appendix-parent-row">
                      <td></td>
                      <td>
                        <FolderKanban size={16} />
                        <strong>{parentName}</strong>
                        <span>{rows.length} activities</span>
                      </td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td>{formatDate(appendixParentSchedule[parentName]?.start) || "-"}</td>
                      <td>{formatDate(appendixParentSchedule[parentName]?.finish) || "-"}</td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.id} className="appendix-child-row">
                        <td>{row.s_no}</td>
                        <td>{row.category}</td>
                        <td>{row.item}</td>
                        <td>{row.commencement_months}</td>
                        <td>{row.completion_months}</td>
                        <td>{formatDate(row.schedule_start)}</td>
                        <td>{formatDate(row.schedule_finish)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                )) : (
                  <tr><td colSpan="7" className="empty">No Appendix-2 activities available.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      {activityFormOpen ? (
        <div className="appendix-modal-backdrop">
          <form className="appendix-activity-modal" onSubmit={submitAppendixActivity}>
            <div className="appendix-modal-head">
              <div>
                <h3>Add Appendix-2 Activity</h3>
                <p>Define parent, child activity, schedule start month, and finish month.</p>
              </div>
              <button type="button" onClick={() => setActivityFormOpen(false)}>Close</button>
            </div>

            <div className="appendix-form-grid">
              <label>
                <span>S.No.</span>
                <input
                  value={activityForm.s_no}
                  onChange={(event) => updateActivityForm("s_no", event.target.value)}
                />
              </label>
              <label className="appendix-form-wide">
                <span>Default Parent Name</span>
                <select
                  value={activityForm.category}
                  onChange={(event) => updateActivityForm("category", event.target.value)}
                >
                  {Object.keys(appendixActivityGroups).map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label className="appendix-form-wide">
                <span>Default Child Name</span>
                <select
                  value={activityForm.item}
                  onChange={(event) => updateActivityForm("item", event.target.value)}
                >
                  {(appendixActivityGroups[activityForm.category] || []).map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Schedule Start Month</span>
                <input
                  type="number"
                  min="0"
                  value={activityForm.commencement_months}
                  onChange={(event) => updateActivityForm("commencement_months", event.target.value)}
                  placeholder="e.g. 4"
                />
              </label>
              <label>
                <span>Schedule Finish Month</span>
                <input
                  type="number"
                  min="0"
                  value={activityForm.completion_months}
                  onChange={(event) => updateActivityForm("completion_months", event.target.value)}
                  placeholder="e.g. 12"
                />
              </label>
              <div className="appendix-calculated-date">
                <span>Schedule Start Date</span>
                <strong>{activityForm.commencement_months !== "" ? addMonthsToContractDate(activityForm.commencement_months) || "---" : "---"}</strong>
              </div>
              <div className="appendix-calculated-date">
                <span>Schedule Finish Date</span>
                <strong>{activityForm.completion_months !== "" ? addMonthsToContractDate(activityForm.completion_months) || "---" : "---"}</strong>
              </div>
            </div>

            <div className="appendix-modal-actions">
              <button type="button" onClick={() => setActivityFormOpen(false)}>Cancel</button>
              <button type="submit">Add Activity</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ScurvePlanningView({ project, user, onBack, onHome }) {
  const [data, setData] = useState(null);
  const [activePlan, setActivePlan] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [financialYear, setFinancialYear] = useState("");
  const [planVersion, setPlanVersion] = useState("");
  const [editableActivities, setEditableActivities] = useState([]);
  const [editableMonthly, setEditableMonthly] = useState({});
  const [busyPlanAction, setBusyPlanAction] = useState("");
  const [scurveAddModal, setScurveAddModal] = useState(null);
  const [scurvePlanModal, setScurvePlanModal] = useState(null);
  const importInputRef = useRef(null);
  const scurvePlanVersions = data?.ui?.planVersions || [];
  const isAdmin = String(user?.role || "").trim().toLowerCase() === "admin"
    || String(user?.username || "").trim().toLowerCase() === "admin";
  const canEditExpectedFinish = isAdmin || Boolean(user?.permissions?.scurve_expected_finish?.edit);

  function defaultFinancialYear() {
    return data?.ui?.defaultFinancialYear || "";
  }

  function allowedFinancialYears() {
    return data?.ui?.allowedFinancialYears || [];
  }

  function financialYearOptions() {
    return data?.ui?.financialYearOptions || allowedFinancialYears().map((year) => ({ value: year, label: year }));
  }

  function extractFinancialYear(planName) {
    const record = (data?.planRecords || []).find((item) => item.plan_name === planName);
    return record?.financial_year || defaultFinancialYear();
  }

  function extractPlanVersion(planName) {
    const record = (data?.planRecords || []).find((item) => item.plan_name === planName);
    return record?.plan_version || "Original Plan";
  }

  function planDisplayLabel(planName) {
    return data?.ui?.planLabels?.[planName] || planName || "No plans saved";
  }

  function splitScurveActivity(activity) {
    const rawName = String(activity?.activity_type || "");
    const parts = rawName.split("->").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { parent: activity?.parent || parts[0], child: activity?.child || parts.slice(1).join(" -> ") };
    }
    return {
      parent: activity?.parent || progressCategoryLabel(rawName),
      child: activity?.child || rawName,
    };
  }

  function progressCategoryLabel(activityType) {
    const text = String(activityType || "").toLowerCase();
    if (text.includes("design") || text.includes("engineering")) return "Design & Engineering";
    if (text.includes("civil")) return "Civil Work";
    if (text.includes("supply") || text.includes("delivery")) return "Supply / Delivery";
    if (text.includes("erection")) return "Erection";
    if (text.includes("testing") || text.includes("commissioning")) return "Testing & Commissioning";
    return "Other Activities";
  }

  function parentLookupKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function appendixScheduleForActivity(activity) {
    const split = splitScurveActivity(activity);
    const parentKey = parentLookupKey(split.parent);
    const childKey = parentLookupKey(split.child);
    const appendixRowsForParent = (data?.appendixRows || []).filter((row) => parentLookupKey(row.category) === parentKey);
    const childMatch = appendixRowsForParent.find((row) => parentLookupKey(row.item) === childKey);
    if (childMatch) {
      return {
        start: childMatch.schedule_start || "",
        finish: childMatch.schedule_finish || "",
      };
    }
    if (!childKey || childKey === parentKey) {
      const parentSchedule = getParentSchedule(split.parent) || {};
      return {
        start: parentSchedule.start || "",
        finish: parentSchedule.finish || "",
      };
    }
    return null;
  }

  function applyDefaultActivityDates(activity) {
    const appendixSchedule = appendixScheduleForActivity(activity);
    if (!appendixSchedule) return { ...activity };
    const startDate = activity.start_date || appendixSchedule.start || "";
    const finishDate = activity.finish_date || appendixSchedule.finish || "";
    return {
      ...activity,
      start_date: startDate,
      finish_date: finishDate,
      expected_finish: activity.expected_finish || finishDate,
    };
  }

  function monthLabelStart(monthLabel) {
    const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const [monthText, yearText] = String(monthLabel || "").split("-");
    if (!(monthText in monthMap) || !yearText) return null;
    const year = 2000 + Number(yearText);
    return Number.isFinite(year) ? new Date(year, monthMap[monthText], 1) : null;
  }

  function scurveMonthSort(monthLabel) {
    const date = monthLabelStart(monthLabel);
    return date ? date.getFullYear() * 12 + date.getMonth() : 0;
  }

  function fiscalMonthsForYear(financialYearValue) {
    const match = String(financialYearValue || "").match(/(\d{4})/);
    if (!match) return [];
    const start = Number(match[1]);
    const end = start + 1;
    return [
      ...["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month) => `${month}-${String(start).slice(-2)}`),
      ...["Jan", "Feb", "Mar"].map((month) => `${month}-${String(end).slice(-2)}`),
    ];
  }

  function monthStart(value) {
    const parsed = parseAppDateValue(value);
    return parsed ? new Date(parsed.getFullYear(), parsed.getMonth(), 1) : null;
  }

  function parentScheduleFor(activity) {
    const parentName = splitScurveActivity(activity).parent;
    return getParentSchedule(parentName);
  }

  function getParentSchedule(parentName) {
    return effectiveParentScheduleByName[parentName] || parentScheduleByKey[parentLookupKey(parentName)] || null;
  }

  function appendixChildrenForParent(parentName) {
    const parentKey = parentLookupKey(parentName);
    return (data.appendixRows || []).filter((row) => parentLookupKey(row.category) === parentKey);
  }

  function isMonthInActivityRange(activity, monthLabel) {
    const parentSchedule = parentScheduleFor(activity);
    const monthDate = monthLabelStart(monthLabel);
    const parentStart = monthStart(parentSchedule?.start);
    const parentFinish = monthStart(parentSchedule?.finish);
    if (monthDate && parentStart && monthDate < parentStart) return false;
    if (monthDate && parentFinish && monthDate > parentFinish) return false;
    return data?.ui?.monthLockByPlan?.[activePlan]?.[activity.activity_type]?.[monthLabel] === false;
  }

  function isMonthAllowedForPlanning(activity, monthLabel) {
    const parentSchedule = parentScheduleFor(activity);
    const monthDate = monthLabelStart(monthLabel);
    const parentStart = monthStart(parentSchedule?.start);
    const activityStart = monthStart(activity?.start_date);
    const activityFinish = monthStart(activity?.expected_finish || activity?.finish_date);
    if (monthDate && parentStart && monthDate < parentStart) return false;
    if (monthDate && activityStart && monthDate < activityStart) return false;
    if (monthDate && activityFinish && monthDate > activityFinish) return false;
    return true;
  }

  function isExpectedFinishExtensionMonth(activity, monthLabel) {
    const monthDate = monthLabelStart(monthLabel);
    const activityFinish = monthStart(activity?.finish_date);
    const expectedFinish = monthStart(activity?.expected_finish || activity?.finish_date);
    return Boolean(monthDate && activityFinish && expectedFinish && expectedFinish > activityFinish && monthDate > activityFinish && monthDate <= expectedFinish);
  }

  function isExpectedFinishBeyondParent(activity) {
    const activityFinish = monthStart(activity?.finish_date);
    const expectedFinish = monthStart(activity?.expected_finish || activity?.finish_date);
    return Boolean(activityFinish && expectedFinish && expectedFinish > activityFinish);
  }

  function isLockedField(activity, fieldName) {
    if (fieldName === "weight_percent") return false;
    if (["activity_type", "uom", "scope_qty", "actuals_till_last_fy"].includes(fieldName)) return true;
    if (isAdmin) return false;
    if (fieldName === "expected_finish") return !canEditExpectedFinish;
    const locked = activity.locked_fields || ["activity_type", "uom", "scope_qty", "actuals_till_last_fy", "start_date", "finish_date"];
    return locked.includes(fieldName);
  }

  useEffect(() => {
    if (!project?.id) return;
    setData(null);
    setActivePlan("");
    setError("");
    api(`/api/projects/${project.id}/scurve`)
      .then((payload) => {
        setData(payload);
        const nextPlan = payload.latestPlan || payload.plans?.[0] || "";
        const nextRecord = (payload.planRecords || []).find((item) => item.plan_name === nextPlan);
        setActivePlan(nextPlan);
        setFinancialYear(nextRecord?.financial_year || payload.ui?.defaultFinancialYear || "");
        setPlanVersion(nextRecord?.plan_version || "");
      })
      .catch((err) => setError(err.message || "Unable to load S-Curve planning."));
  }, [project?.id]);

  useEffect(() => {
    setPage(1);
  }, [activePlan]);

  function loadScurveDraft(showMessage = true) {
    if (!data) return;
    setEditableActivities((data.activitiesByPlan?.[activePlan] || []).map((row) => applyDefaultActivityDates({ ...row })));
    setEditableMonthly({ ...(data.monthlyByPlan?.[activePlan] || {}) });
    setScurvePlanModal(null);
    if (showMessage) setMessage("Unsaved S-Curve changes reset to the last saved draft.");
  }

  function resetScurveDraft(showMessage = true) {
    setEditableMonthly((current) => {
      const next = { ...current };
      editableActivities.forEach((activity) => {
        next[activity.activity_type] = {
          ...(next[activity.activity_type] || {}),
          ...Object.fromEntries(months.map((month) => [month, ""])),
        };
      });
      return next;
    });
    if (showMessage) setMessage("All month-wise planned quantities cleared. Save & Lock to keep this reset.");
  }

  useEffect(() => {
    if (!data) return;
    loadScurveDraft(false);
    if (activePlan) {
      setFinancialYear(extractFinancialYear(activePlan));
      setPlanVersion(extractPlanVersion(activePlan));
    }
  }, [data, activePlan]);

  if (!project) return <EmptySelect />;
  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Loading S-Curve planning...</div>;

  const plans = data.plans || [];
  const activities = editableActivities;
  const monthlyValues = editableMonthly;
  const planFiscalMonths = fiscalMonthsForYear(financialYear || extractFinancialYear(activePlan));
  const baseMonths = (data.ui?.monthsByPlan?.[activePlan] || []).filter((month) => !planFiscalMonths.length || planFiscalMonths.includes(month));
  const months = (() => {
    const monthSet = new Set(baseMonths.length ? baseMonths : planFiscalMonths);
    const sortedBase = [...baseMonths].sort((a, b) => scurveMonthSort(a) - scurveMonthSort(b));
    const firstMonth = monthLabelStart(sortedBase[0] || planFiscalMonths[0]) || monthStart(editableActivities[0]?.start_date);
    if (!firstMonth) return baseMonths.length ? baseMonths : planFiscalMonths;
    let lastMonth = monthLabelStart(sortedBase[sortedBase.length - 1] || planFiscalMonths[planFiscalMonths.length - 1]) || firstMonth;
    editableActivities.forEach((activity) => {
      const expected = monthStart(activity.expected_finish || activity.finish_date);
      if (expected && expected > lastMonth) lastMonth = expected;
    });
    let current = new Date(firstMonth.getFullYear(), firstMonth.getMonth(), 1);
    while (current <= lastMonth) {
      monthSet.add(current.toLocaleString("en-US", { month: "short" }) + "-" + String(current.getFullYear()).slice(-2));
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    }
    return [...monthSet].sort((a, b) => scurveMonthSort(a) - scurveMonthSort(b));
  })();
  const parentScheduleByName = (data.appendixRows || []).reduce((groups, row) => {
    const parentName = row.category || "Other Activities";
    const current = groups[parentName] || { start: row.schedule_start || "", finish: row.schedule_finish || "", count: 0 };
    const nextStart = parseAppDateValue(row.schedule_start);
    const nextFinish = parseAppDateValue(row.schedule_finish);
    const currentStart = parseAppDateValue(current.start);
    const currentFinish = parseAppDateValue(current.finish);
    groups[parentName] = {
      start: !currentStart || (nextStart && nextStart < currentStart) ? row.schedule_start : current.start,
      finish: !currentFinish || (nextFinish && nextFinish > currentFinish) ? row.schedule_finish : current.finish,
      count: current.count + 1,
    };
    return groups;
  }, {});
  const backendParentSchedules = data.parentSchedules || {};
  const normalizedBackendParentSchedules = Object.fromEntries(
    Object.entries(backendParentSchedules).map(([parentName, schedule]) => [parentName, {
      start: schedule?.start || "",
      finish: schedule?.finish || "",
      count: schedule?.count || 0,
    }]),
  );
  const effectiveParentScheduleByName = Object.fromEntries(
    Array.from(new Set([...Object.keys(parentScheduleByName), ...Object.keys(normalizedBackendParentSchedules)])).map((parentName) => {
      const frontendSchedule = parentScheduleByName[parentName] || {};
      const backendSchedule = normalizedBackendParentSchedules[parentName] || {};
      return [parentName, {
        start: backendSchedule.start || frontendSchedule.start || "",
        finish: backendSchedule.finish || frontendSchedule.finish || "",
        count: backendSchedule.count || frontendSchedule.count || 0,
      }];
    }),
  );
  const parentScheduleByKey = Object.fromEntries(
    Object.entries(effectiveParentScheduleByName).map(([parentName, schedule]) => [parentLookupKey(parentName), schedule]),
  );
  const activePlanSummary = data.ui?.planSummaries?.[activePlan] || {};
  const activePlanRecord = (data.planRecords || []).find((item) => item.plan_name === activePlan);
  const planLockedRaw = Boolean(data.ui?.planLocked?.[activePlan] || activePlanRecord?.is_locked === "Y" || activePlanSummary.isLocked);
  const planIsLocked = planLockedRaw && !isAdmin;
  const createReady = Boolean(financialYear && planVersion && !busyPlanAction);
  const pageCount = Math.max(1, Math.ceil(activities.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visibleActivities = activities.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  function scurveNumber(value) {
    const parsed = Number(String(value ?? "").replaceAll(",", "").replace("%", "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatScurveWeightage(value) {
    if (value === null || value === undefined || String(value).trim() === "") return "";
    const numeric = scurveNumber(value);
    return `${number(numeric)}%`;
  }

  function plannedTotal(activity, monthlySource = monthlyValues) {
    if (!activity?.activity_type) return 0;
    const activityMonthly = monthlySource[activity.activity_type] || {};
    return months.reduce((total, month) => total + scurveNumber(activityMonthly[month]), 0);
  }

  function openScurvePlanModal(activityIndex) {
    const activity = editableActivities[activityIndex];
    if (!activity) return;
    setScurvePlanModal({ activityIndex });
  }

  function closeScurvePlanModal() {
    setScurvePlanModal(null);
  }

  async function createPlanFromFinancialYear() {
    if (!financialYear) {
      setMessage("Select Financial Year before creating a plan.");
      return;
    }
    if (!planVersion) {
      setMessage("Select Plan Type before creating a plan.");
      return;
    }
    const selectedFinancialYear = financialYear;
    const selectedPlanVersion = planVersion;
    try {
      setBusyPlanAction("create");
      const result = await api(`/api/projects/${project.id}/scurve/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financial_year: selectedFinancialYear,
          plan_version: selectedPlanVersion,
          source_plan_name: activePlan || "",
        }),
      });
      const payload = await api(`/api/projects/${project.id}/scurve`);
      setData(payload);
      setActivePlan(result.planName || "");
      setFinancialYear(selectedFinancialYear);
      setPlanVersion(selectedPlanVersion);
      const label = payload.ui?.planLabels?.[result.planName] || result.planName || "S-Curve plan";
      setMessage(result.status === "exists" ? `${label} already exists and is now selected.` : result.status === "copied" ? `${label} created as a copy of ${planDisplayLabel(result.sourcePlanName)}.` : `${label} created from Appendix-2.`);
    } catch (err) {
      setMessage(err.message || "Unable to create S-Curve plan.");
    } finally {
      setBusyPlanAction("");
    }
  }

  function updateScurveActivity(index, key, value) {
    if (key === "expected_finish" && !canEditExpectedFinish) {
      setMessage("Only admin or permitted users can edit Expected Finish.");
      return;
    }
    if (key === "start_date" || key === "finish_date" || key === "expected_finish") {
      const activity = editableActivities[index] || {};
      const parentSchedule = parentScheduleFor(activity);
      const parsedValue = parseAppDateValue(value);
      const parentStart = parseAppDateValue(parentSchedule?.start);
      const parentFinish = parseAppDateValue(parentSchedule?.finish);
      if (parsedValue && parentStart && parsedValue < parentStart) {
        setMessage(`Activity date cannot be before parent start date ${formatDate(parentSchedule.start)}.`);
        return;
      }
      if (key !== "expected_finish" && parsedValue && parentFinish && parsedValue > parentFinish) {
        setMessage(`Activity date cannot be after parent finish date ${formatDate(parentSchedule.finish)}.`);
        return;
      }
      if (key === "expected_finish") {
        const activityStart = parseAppDateValue(activity.start_date);
        if (parsedValue && activityStart && parsedValue < activityStart) {
          setMessage("Expected Finish cannot be before activity start date.");
          return;
        }
      }
    }
    if (key === "scope_qty") {
      const activity = editableActivities[index] || {};
      const nextScope = scurveNumber(value);
      const currentPlanned = plannedTotal(activity);
      const currentActual = scurveNumber(activity.actuals_till_last_fy);
      const committedTotal = currentActual + currentPlanned;
      if (nextScope > 0 && committedTotal > nextScope) {
        setMessage(`Scope Qty cannot be less than Actuals Till Last FY + Planned Total ${number(committedTotal)} for ${splitScurveActivity(activity).child || activity.activity_type}.`);
        return;
      }
    }
    setEditableActivities((rows) => {
      const nextRows = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row));
      if (key === "activity_type") {
        const oldName = rows[index]?.activity_type;
        if (oldName && oldName !== value) {
          setEditableMonthly((current) => {
            const next = { ...current, [value]: current[oldName] || Object.fromEntries(months.map((month) => [month, 0])) };
            delete next[oldName];
            return next;
          });
        }
      }
      return nextRows;
    });
  }

  function normalizeScurveActivityDate(index, key) {
    setEditableActivities((rows) => rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const value = row[key];
      const parsed = parseAppDateValue(value);
      return parsed ? { ...row, [key]: formatDate(parsed) } : row;
    }));
  }

  function updateScurveActivityChild(index, value) {
    const activity = editableActivities[index] || {};
    const split = splitScurveActivity(activity);
    const nextValue = split.parent && split.parent !== "Other Activities"
      ? `${split.parent} -> ${value}`
      : value;
    updateScurveActivity(index, "activity_type", nextValue);
  }

  function openScurveAddActivity(parentName) {
    if (planIsLocked) {
      setMessage("This plan is locked. Create a new revision for further changes.");
      return;
    }
    const children = appendixChildrenForParent(parentName);
    const firstChild = children[0] || null;
    const parentSchedule = getParentSchedule(parentName) || {};
    setScurveAddModal({
      parentName,
      mode: firstChild ? String(firstChild.id) : "others",
      otherName: "",
      weight: 10,
      startDate: firstChild?.schedule_start || parentSchedule.start || "",
      finishDate: firstChild?.schedule_finish || parentSchedule.finish || "",
    });
  }

  function closeScurveAddActivity() {
    setScurveAddModal(null);
  }

  function updateScurveAddModal(key, value) {
    setScurveAddModal((current) => {
      if (!current) return current;
      if (key === "mode") {
        const selected = appendixChildrenForParent(current.parentName).find((row) => String(row.id) === String(value));
        const parentSchedule = getParentSchedule(current.parentName) || {};
        return {
          ...current,
          mode: value,
          startDate: selected?.schedule_start || parentSchedule.start || "",
          finishDate: selected?.schedule_finish || parentSchedule.finish || "",
          otherName: value === "others" ? current.otherName : "",
        };
      }
      return { ...current, [key]: value };
    });
  }

  function submitScurveAddActivity(event) {
    event.preventDefault();
    if (!scurveAddModal) return;
    const parentSchedule = getParentSchedule(scurveAddModal.parentName) || {};
    const parentStart = parseAppDateValue(parentSchedule.start);
    const parentFinish = parseAppDateValue(parentSchedule.finish);
    const children = appendixChildrenForParent(scurveAddModal.parentName);
    const selectedChild = children.find((row) => String(row.id) === String(scurveAddModal.mode));
    const childName = scurveAddModal.mode === "others"
      ? String(scurveAddModal.otherName || "").trim()
      : String(selectedChild?.item || "").trim();
    const startDate = selectedChild?.schedule_start || scurveAddModal.startDate;
    const finishDate = selectedChild?.schedule_finish || scurveAddModal.finishDate;
    const parsedStart = parseAppDateValue(startDate);
    const parsedFinish = parseAppDateValue(finishDate);
    if (!childName) {
      setMessage("Enter activity name.");
      return;
    }
    if (!parsedStart || !parsedFinish) {
      setMessage("Enter valid activity start and finish dates.");
      return;
    }
    if (parsedFinish < parsedStart) {
      setMessage("Activity finish date cannot be before start date.");
      return;
    }
    if (parentStart && parsedStart < parentStart) {
      setMessage(`Activity start date cannot be before parent start ${formatDate(parentSchedule.start)}.`);
      return;
    }
    if (parentFinish && parsedFinish > parentFinish) {
      setMessage(`Activity finish date cannot be after parent finish ${formatDate(parentSchedule.finish)}.`);
      return;
    }
    const activityType = `${scurveAddModal.parentName} -> ${childName}`;
    const newActivity = {
      id: `new-${Date.now()}`,
      activity_type: activityType,
      uom: "",
      scope_qty: "",
      weight_percent: scurveAddModal.weight || 10,
      actuals_till_last_fy: 0,
      start_date: startDate,
      finish_date: finishDate,
      expected_finish: finishDate,
      locked_fields: selectedChild ? ["activity_type", "actuals_till_last_fy", "start_date", "finish_date"] : ["actuals_till_last_fy"],
    };
    setEditableActivities((rows) => {
      const lastSiblingIndex = rows.reduce((lastIndex, row, index) => (
        parentLookupKey(splitScurveActivity(row).parent) === parentLookupKey(scurveAddModal.parentName) ? index : lastIndex
      ), -1);
      const insertAt = lastSiblingIndex >= 0 ? lastSiblingIndex + 1 : rows.length;
      return [...rows.slice(0, insertAt), newActivity, ...rows.slice(insertAt)];
    });
    setEditableMonthly((current) => ({
      ...current,
      [activityType]: Object.fromEntries(months.map((month) => [month, 0])),
    }));
    setMessage(`Added activity under ${scurveAddModal.parentName}. Planning months are restricted to the activity start/finish range.`);
    closeScurveAddActivity();
  }

  function deleteScurveActivity(index) {
    if (planIsLocked) {
      setMessage("This plan is locked. Create a new revision for further changes.");
      return;
    }
    const activity = editableActivities[index];
    if (!activity) return;
    const split = splitScurveActivity(activity);
    const confirmed = window.confirm(`Delete activity "${split.child || activity.activity_type}" from S-Curve plan?`);
    if (!confirmed) return;
    setEditableActivities((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    setEditableMonthly((current) => {
      const next = { ...current };
      delete next[activity.activity_type];
      return next;
    });
    setMessage(`Deleted activity "${split.child || activity.activity_type}". Save the plan to keep this deletion.`);
  }

  function updateScurveMonth(activityType, month, value) {
    const activity = editableActivities.find((row) => row.activity_type === activityType);
    const nextValue = scurveNumber(value);
    if (nextValue < 0) {
      setMessage("Monthly planned quantity cannot be negative.");
      return;
    }
    if (activity) {
      const scopeQty = scurveNumber(activity.scope_qty);
      const actualTillLastFy = scurveNumber(activity.actuals_till_last_fy);
      const currentValues = monthlyValues[activityType] || {};
      const currentTotal = months.reduce((total, currentMonth) => total + scurveNumber(currentValues[currentMonth]), 0);
      const proposedTotal = months.reduce((total, currentMonth) => {
        const cellValue = currentMonth === month ? nextValue : scurveNumber(currentValues[currentMonth]);
        return total + cellValue;
      }, 0);
      if (scopeQty > 0 && actualTillLastFy + proposedTotal > scopeQty && proposedTotal >= currentTotal) {
        const remaining = Math.max(0, scopeQty - actualTillLastFy - (proposedTotal - nextValue));
        setMessage(`Actuals Till Last FY + Planned Total cannot exceed Scope Qty ${number(scopeQty)}. Balance available for this row is ${number(remaining)}.`);
        return;
      }
    }
    setEditableMonthly((current) => ({
      ...current,
      [activityType]: {
        ...(current[activityType] || {}),
        [month]: value,
      },
    }));
  }

  async function savePlan() {
    if (!activePlan) {
      setMessage("Create or select a plan before saving.");
      return;
    }
    if (planIsLocked) {
      setMessage("This plan is locked. Create a new revision for further changes.");
      return;
    }
    const selectedFinancialYear = financialYear;
    const selectedPlanVersion = planVersion || extractPlanVersion(activePlan);
    const planName = activePlan || `FY ${selectedFinancialYear} | ${selectedPlanVersion}`;
    const scopeViolation = editableActivities.find((activity) => {
      const scopeQty = scurveNumber(activity.scope_qty);
      if (scopeQty <= 0) return false;
      const allowedPlannedTotal = months.reduce((total, month) => (
        total + (isMonthAllowedForPlanning(activity, month) ? scurveNumber(monthlyValues[activity.activity_type]?.[month]) : 0)
      ), 0);
      return scurveNumber(activity.actuals_till_last_fy) + allowedPlannedTotal > scopeQty;
    });
    if (scopeViolation) {
      const activityName = splitScurveActivity(scopeViolation).child || scopeViolation.activity_type;
      setMessage(`${activityName}: Actuals Till Last FY + planned quantity total cannot exceed Scope Qty ${number(scopeViolation.scope_qty)}.`);
      return;
    }
    try {
      setBusyPlanAction("save");
      await api(`/api/projects/${project.id}/scurve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_name: planName,
          financial_year: selectedFinancialYear,
          plan_version: selectedPlanVersion,
          requested_by_role: isAdmin ? "admin" : (user?.role || ""),
          requested_by_username: user?.username || "",
          requested_by_user_id: user?.id || null,
          activities: editableActivities.map((activity) => ({
            activity_type: activity.activity_type,
            uom: activity.uom,
            scope_qty: activity.scope_qty,
            weight_percent: scurveNumber(activity.weight_percent),
            actuals_till_last_fy: activity.actuals_till_last_fy,
            start_date: activity.start_date,
            finish_date: activity.finish_date,
            expected_finish: activity.expected_finish || activity.finish_date,
            monthly: Object.fromEntries(
              months.map((month) => [
                month,
                isMonthAllowedForPlanning(activity, month) ? (monthlyValues[activity.activity_type]?.[month] || 0) : 0,
              ]),
            ),
          })),
        }),
      });
      const payload = await api(`/api/projects/${project.id}/scurve`);
      setData(payload);
      setActivePlan(planName);
      setMessage("S-Curve plan saved and locked. Use Set Active to make it active for this financial year.");
    } catch (err) {
      setMessage(err.message || "Unable to save S-Curve plan.");
    } finally {
      setBusyPlanAction("");
    }
  }

  async function deletePlan() {
    if (!activePlan) {
      setMessage("Select a plan to delete.");
      return;
    }
    if (!window.confirm(`Delete S-Curve plan "${activePlan}"? This removes saved activities and monthly planning values for this plan.`)) return;
    const planToDelete = activePlan;
    try {
      setBusyPlanAction("delete");
      await api(`/api/projects/${project.id}/scurve?plan_name=${encodeURIComponent(planToDelete)}&requested_by_role=${encodeURIComponent(user?.role || "")}`, { method: "DELETE" });
      const payload = await api(`/api/projects/${project.id}/scurve`);
      const nextPlan = payload.activePlan || payload.plans?.[0] || "";
      const nextRecord = (payload.planRecords || []).find((item) => item.plan_name === nextPlan);
      setData(payload);
      setActivePlan(nextPlan);
      setFinancialYear(nextRecord?.financial_year || "");
      setPlanVersion(nextRecord?.plan_version || "");
      setMessage(`S-Curve plan ${planToDelete} deleted.`);
    } catch (err) {
      setMessage(err.message || "Unable to delete S-Curve plan.");
    } finally {
      setBusyPlanAction("");
    }
  }

  async function deleteAllPlans() {
    if (!isAdmin) {
      setMessage("Only admin can delete all S-Curve plans.");
      return;
    }
    if (!plans.length) {
      setMessage("No S-Curve plans are available to delete.");
      return;
    }
    if (!window.confirm(`Delete ALL S-Curve plans for this project? This removes every saved plan, activity, monthly value, and related daily actual for these plans.`)) return;
    try {
      setBusyPlanAction("deleteAll");
      await api(`/api/projects/${project.id}/scurve/all?requested_by_role=${encodeURIComponent(user?.role || "")}`, { method: "DELETE" });
      const payload = await api(`/api/projects/${project.id}/scurve`);
      setData(payload);
      setActivePlan("");
      setFinancialYear(payload.ui?.defaultFinancialYear || "");
      setPlanVersion("");
      setMessage("All S-Curve plans deleted for this project.");
    } catch (err) {
      setMessage(err.message || "Unable to delete all S-Curve plans.");
    } finally {
      setBusyPlanAction("");
    }
  }

  async function makeActivePlan() {
    if (!activePlan) {
      setMessage("Select a plan to make active.");
      return;
    }
    if (!planLockedRaw) {
      setMessage("Save the plan first. Only locked plans can be marked active.");
      return;
    }
    const planToActivate = activePlan;
    try {
      setBusyPlanAction("active");
      await api(`/api/projects/${project.id}/scurve/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planToActivate }),
      });
      const payload = await api(`/api/projects/${project.id}/scurve`);
      setData(payload);
      setActivePlan(planToActivate);
      setMessage(`${planToActivate} is now active for ${extractFinancialYear(planToActivate)}.`);
    } catch (err) {
      setMessage(err.message || "Unable to make plan active.");
    } finally {
      setBusyPlanAction("");
    }
  }

  function exportPlan() {
    const headers = ["#", "Parent Activity", "Activity", "Weightage", "UOM", "Scope Qty", "Actuals Till Last FY", "Start", "Finish", "Expected Finish", "Planned Total", ...months];
    const rows = activities.map((activity, index) => [
      index + 1,
      splitScurveActivity(activity).parent,
      splitScurveActivity(activity).child,
      formatScurveWeightage(activity.weight_percent || 10),
      activity.uom || "",
      activity.scope_qty || "",
      activity.actuals_till_last_fy || "",
      formatDate(activity.start_date),
      formatDate(activity.finish_date),
      formatDate(activity.expected_finish || activity.finish_date),
      plannedTotal(activity),
      ...months.map((month) => monthlyValues[activity.activity_type]?.[month] || 0),
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(project.unique_id || "scurve").replaceAll("/", "_")}_${String(activePlan || "plan").replaceAll(" ", "_")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("S-Curve plan exported.");
  }

  function importPlan(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage("Import file selected. Backend save mapping is not enabled yet.");
  }

  const scurvePlanModalActivity = scurvePlanModal ? editableActivities[scurvePlanModal.activityIndex] : null;
  const scurvePlanModalSplit = scurvePlanModalActivity ? splitScurveActivity(scurvePlanModalActivity) : null;

  return (
    <div className="scurve-window">
      <div className="scurve-page-head">
        <div className="scurve-title-block">
          <span><BarChart3 size={32} /></span>
          <div>
            <h1>S-Curve Planning</h1>
            <p>{project.project_name} ({project.unique_id})</p>
          </div>
        </div>
        <div className="scurve-top-actions">
          <button type="button" className="scurve-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="scurve-active" onClick={makeActivePlan} disabled={!activePlan || !planLockedRaw || Boolean(busyPlanAction)}>{busyPlanAction === "active" ? "Activating..." : "Set Active"}</button>
          <button type="button" className="scurve-save" onClick={savePlan} disabled={!activePlan || planIsLocked || Boolean(busyPlanAction)}>{busyPlanAction === "save" ? "Saving..." : "Save & Lock"}</button>
          <button type="button" className="scurve-delete" onClick={deletePlan} disabled={!activePlan || planIsLocked || Boolean(busyPlanAction)}>{busyPlanAction === "delete" ? "Deleting..." : "Delete Draft"}</button>
          {isAdmin ? <button type="button" className="scurve-delete-all" onClick={deleteAllPlans} disabled={!plans.length || Boolean(busyPlanAction)}>{busyPlanAction === "deleteAll" ? "Deleting All..." : "Delete All Plans"}</button> : null}
          <button type="button" className="scurve-home" onClick={onHome}><Home size={16} /> Home</button>
        </div>
      </div>

      {!data.hasCompletedPlanning ? <div className="warning scurve-warning">Planning is not completed for this project.</div> : null}
      {planLockedRaw ? <div className="scurve-message scurve-message-top">{isAdmin ? "Admin override active: this locked plan can be edited or deleted." : "This plan is locked. Create a new revision for further changes."}</div> : null}
      {message ? <div className="scurve-message scurve-message-top">{message}</div> : null}

      <section className="scurve-summary-panel">
        <div className="scurve-plan-card">
          <small>Saved Plans</small>
          <select value={activePlan} onChange={(event) => setActivePlan(event.target.value)}>
            {plans.length ? plans.map((plan) => <option key={plan} value={plan}>{planDisplayLabel(plan)}</option>) : <option value="">No plans saved</option>}
          </select>
          <div className="scurve-plan-list">
            {plans.length ? plans.map((plan) => (
              <button
                type="button"
                key={plan}
                className={activePlan === plan ? "active" : ""}
                onClick={() => setActivePlan(plan)}
                title={planDisplayLabel(plan)}
              >
                {planDisplayLabel(plan)}
              </button>
            )) : <span>No S-Curve plans available.</span>}
          </div>
        </div>
        <div className="scurve-plan-card">
          <small>Financial Year</small>
          <label className="scurve-fy-input">
            <CalendarDays size={16} />
            <select value={financialYear} onChange={(event) => setFinancialYear(event.target.value)}>
              <option value="">Select Financial Year</option>
              {financialYearOptions().map((year) => <option key={year.value} value={year.value}>{year.label}</option>)}
            </select>
          </label>
          <small>Plan Type</small>
          <label className="scurve-fy-input">
            <ListChecks size={16} />
            <select value={planVersion} onChange={(event) => setPlanVersion(event.target.value)}>
              <option value="">Select Plan Type</option>
              {scurvePlanVersions.map((version) => <option key={version} value={version}>{version}</option>)}
            </select>
          </label>
          <button type="button" className="scurve-create-plan" onClick={createPlanFromFinancialYear} disabled={!createReady}>{busyPlanAction === "create" ? "Creating..." : "Create Plan"}</button>
        </div>
        <div className="scurve-metric-card blue"><span><BarChart3 size={28} /></span><div><small>Total Activities</small><strong>{activePlanSummary.totalActivities || activities.length}</strong></div></div>
        <div className="scurve-metric-card orange"><span><BarChart3 size={28} /></span><div><small>Overall Progress</small><strong>{Number(activePlanSummary.overallProgress || 0).toFixed(2)} %</strong></div></div>
      </section>

      <section className="scurve-table-card">
        <div className="scurve-table-head">
          <h2><BarChart3 size={20} /> S-Curve Planning Table</h2>
          <div>
            <button type="button" className="scurve-reset" onClick={() => resetScurveDraft(true)} disabled={!activePlan || Boolean(busyPlanAction)}><RefreshCw size={16} /> Reset</button>
            <button type="button" className="scurve-import" onClick={() => importInputRef.current?.click()} disabled={planIsLocked}><Upload size={16} /> Import from Excel</button>
            <button type="button" className="scurve-export" onClick={exportPlan}><Download size={16} /> Export Excel</button>
            <input ref={importInputRef} className="hidden-input" type="file" accept=".csv,.xlsx,.xls" onChange={importPlan} />
          </div>
        </div>

        <div className="scurve-table-wrap">
          <table className="scurve-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Action</th>
                <th>Weightage</th>
                <th>Activity</th>
                <th>UOM</th>
                <th>Scope Qty</th>
                <th>Actuals Till Last FY</th>
                <th>Start</th>
                <th>Finish</th>
                <th>Expected Finish</th>
                <th>Planned Total</th>
                {months.map((month) => <th key={month}>{month}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleActivities.length ? visibleActivities.map((activity, index) => {
                const activityIndex = (currentPage - 1) * rowsPerPage + index;
                const splitActivity = splitScurveActivity(activity);
                const parentSchedule = getParentSchedule(splitActivity.parent) || {};
                const previousActivity = visibleActivities[index - 1];
                const previousParent = previousActivity ? splitScurveActivity(previousActivity).parent : "";
                const showParent = index === 0 || splitActivity.parent !== previousParent;
                return (
                  <React.Fragment key={activity.id || `${activity.activity_type}-${index}`}>
                    {showParent ? (
                      <tr className="scurve-parent-row">
                        <td colSpan="7">
                          <FolderKanban size={15} />
                          <strong>{splitActivity.parent}</strong>
                          <button type="button" onClick={() => openScurveAddActivity(splitActivity.parent)} disabled={planIsLocked}>
                            <Plus size={14} /> Add Activity
                          </button>
                        </td>
                        <td>{formatDate(parentSchedule.start) || "-"}</td>
                        <td>{formatDate(parentSchedule.finish) || "-"}</td>
                        <td>{formatDate(parentSchedule.finish) || "-"}</td>
                        <td colSpan={1 + months.length}></td>
                      </tr>
                    ) : null}
                    <tr className="scurve-child-row">
                      <td>{activityIndex + 1}</td>
                      <td>
                        <button type="button" className="scurve-row-delete" onClick={() => deleteScurveActivity(activityIndex)} disabled={planIsLocked} title="Delete activity">
                          <Trash2 size={14} />
                        </button>
                      </td>
                      <td><input className={planIsLocked || isLockedField(activity, "weight_percent") ? "locked-cell-input" : ""} value={formatScurveWeightage(activity.weight_percent)} readOnly={planIsLocked || isLockedField(activity, "weight_percent")} onChange={(event) => updateScurveActivity(activityIndex, "weight_percent", event.target.value)} /></td>
                      <td><textarea className={`scurve-activity-cell ${planIsLocked || isLockedField(activity, "activity_type") ? "locked-cell-input" : ""}`} value={splitActivity.child || ""} readOnly={planIsLocked || isLockedField(activity, "activity_type")} onClick={() => openScurvePlanModal(activityIndex)} onChange={(event) => updateScurveActivityChild(activityIndex, event.target.value)} title="Click to enter month-wise plan" /></td>
                      <td><input className={planIsLocked || isLockedField(activity, "uom") ? "locked-cell-input" : ""} value={activity.uom || ""} readOnly={planIsLocked || isLockedField(activity, "uom")} onChange={(event) => updateScurveActivity(activityIndex, "uom", event.target.value)} /></td>
                      <td><input className={planIsLocked || isLockedField(activity, "scope_qty") ? "locked-cell-input" : ""} value={activity.scope_qty ?? ""} readOnly={planIsLocked || isLockedField(activity, "scope_qty")} onChange={(event) => updateScurveActivity(activityIndex, "scope_qty", event.target.value)} /></td>
                      <td><input className={planIsLocked || isLockedField(activity, "actuals_till_last_fy") ? "locked-cell-input" : ""} value={activity.actuals_till_last_fy ?? ""} readOnly={planIsLocked || isLockedField(activity, "actuals_till_last_fy")} title="Auto picked from Daily Report total progress up to the previous financial year" onChange={(event) => updateScurveActivity(activityIndex, "actuals_till_last_fy", event.target.value)} /></td>
                      <td><input className={planIsLocked || isLockedField(activity, "start_date") ? "locked-cell-input" : ""} value={stageDateInput(activity.start_date)} readOnly={planIsLocked || isLockedField(activity, "start_date")} onChange={(event) => updateScurveActivity(activityIndex, "start_date", event.target.value)} placeholder="DD-MM-YY" /></td>
                      <td><input className={planIsLocked || isLockedField(activity, "finish_date") ? "locked-cell-input" : ""} value={stageDateInput(activity.finish_date)} readOnly={planIsLocked || isLockedField(activity, "finish_date")} onChange={(event) => updateScurveActivity(activityIndex, "finish_date", event.target.value)} placeholder="DD-MM-YY" /></td>
                      <td className={isExpectedFinishBeyondParent(activity) ? "scurve-expected-extension-month" : ""}><input className={`${planIsLocked || isLockedField(activity, "expected_finish") ? "locked-cell-input" : ""} ${isExpectedFinishBeyondParent(activity) ? "scurve-expected-extension-input" : ""}`} value={activity.expected_finish || activity.finish_date || ""} readOnly={planIsLocked || isLockedField(activity, "expected_finish")} onChange={(event) => updateScurveActivity(activityIndex, "expected_finish", event.target.value)} onBlur={() => normalizeScurveActivityDate(activityIndex, "expected_finish")} placeholder="DD-MM-YY" title={canEditExpectedFinish ? (isExpectedFinishBeyondParent(activity) ? "Beyond Finish; planning months are highlighted up to Expected Finish" : "Editable in draft/revision plan") : "Only admin or permitted users can edit Expected Finish"} /></td>
                      <td>{number(plannedTotal(activity))}</td>
                      {months.map((month) => {
                        const monthLocked = planIsLocked || !isMonthAllowedForPlanning(activity, month);
                        const extensionMonth = !monthLocked && isExpectedFinishExtensionMonth(activity, month);
                        return (
                        <td key={month} className={monthLocked ? "scurve-locked-month" : (extensionMonth ? "scurve-expected-extension-month" : "")}>
                          <input
                            value={monthlyValues[activity.activity_type]?.[month] ?? ""}
                            readOnly={monthLocked}
                            className={monthLocked ? "locked-cell-input" : (extensionMonth ? "scurve-expected-extension-input" : "")}
                            title={monthLocked ? "Outside activity start/expected finish date range" : (extensionMonth ? "Beyond Finish but allowed up to Expected Finish" : "")}
                            onChange={(event) => updateScurveMonth(activity.activity_type, month, event.target.value)}
                          />
                        </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              }) : <tr><td colSpan={11 + months.length} className="empty">Create a financial year plan to start entering S-Curve values.</td></tr>}
            </tbody>
          </table>
        </div>

        {scurvePlanModalActivity ? (
          <div className="scurve-modal-backdrop">
            <div className="scurve-add-modal scurve-plan-modal">
              <div className="scurve-add-modal-head">
                <div>
                  <h3>Month-wise Planning</h3>
                  <p>{scurvePlanModalSplit?.parent || ""} / {scurvePlanModalSplit?.child || scurvePlanModalActivity.activity_type}</p>
                </div>
                <button type="button" onClick={closeScurvePlanModal}>Close</button>
              </div>
              <div className="scurve-plan-modal-summary">
                <span>Scope Qty <strong>{number(scurvePlanModalActivity.scope_qty)}</strong></span>
                <span>Actuals Till Last FY <strong>{number(scurvePlanModalActivity.actuals_till_last_fy)}</strong></span>
                <span>Planned Total <strong>{number(plannedTotal(scurvePlanModalActivity))}</strong></span>
                <span>Balance <strong>{number(Math.max(0, scurveNumber(scurvePlanModalActivity.scope_qty) - scurveNumber(scurvePlanModalActivity.actuals_till_last_fy) - plannedTotal(scurvePlanModalActivity)))}</strong></span>
              </div>
              <div className="scurve-plan-date-grid">
                <label>
                  <span>Start</span>
                  <input value={stageDateInput(scurvePlanModalActivity.start_date)} readOnly />
                </label>
                <label>
                  <span>Finish</span>
                  <input value={stageDateInput(scurvePlanModalActivity.finish_date)} readOnly />
                </label>
                <label>
                  <span>Expected Finish</span>
                  <input
                    value={scurvePlanModalActivity.expected_finish || scurvePlanModalActivity.finish_date || ""}
                    readOnly={planIsLocked || isLockedField(scurvePlanModalActivity, "expected_finish")}
                    onChange={(event) => updateScurveActivity(scurvePlanModal.activityIndex, "expected_finish", event.target.value)}
                    onBlur={() => normalizeScurveActivityDate(scurvePlanModal.activityIndex, "expected_finish")}
                    placeholder="DD-MM-YY"
                  />
                </label>
              </div>
              <div className="scurve-plan-month-grid">
                {months.map((month) => {
                  const monthLocked = planIsLocked || !isMonthAllowedForPlanning(scurvePlanModalActivity, month);
                  const extensionMonth = !monthLocked && isExpectedFinishExtensionMonth(scurvePlanModalActivity, month);
                  return (
                    <label key={month} className={monthLocked ? "scurve-plan-month-locked" : (extensionMonth ? "scurve-plan-month-extension" : "")}>
                      <span>{month}</span>
                      <input
                        value={monthlyValues[scurvePlanModalActivity.activity_type]?.[month] ?? ""}
                        readOnly={monthLocked}
                        onChange={(event) => updateScurveMonth(scurvePlanModalActivity.activity_type, month, event.target.value)}
                        title={monthLocked ? "Outside activity start/expected finish date range" : ""}
                      />
                    </label>
                  );
                })}
              </div>
              <div className="scurve-add-modal-actions">
                <button type="button" onClick={closeScurvePlanModal}>Done</button>
              </div>
            </div>
          </div>
        ) : null}

        {scurveAddModal ? (
          <div className="scurve-modal-backdrop">
            <form className="scurve-add-modal" onSubmit={submitScurveAddActivity}>
              <div className="scurve-add-modal-head">
                <div>
                  <h3>Add Activity</h3>
                  <p>{scurveAddModal.parentName}</p>
                </div>
                <button type="button" onClick={closeScurveAddActivity}>Close</button>
              </div>
              <div className="scurve-add-modal-grid">
                <label className="wide">
                  <span>Activity</span>
                  <select value={scurveAddModal.mode} onChange={(event) => updateScurveAddModal("mode", event.target.value)}>
                    {appendixChildrenForParent(scurveAddModal.parentName).map((row) => (
                      <option key={row.id} value={row.id}>{row.item} ({formatDate(row.schedule_start)} to {formatDate(row.schedule_finish)})</option>
                    ))}
                    <option value="others">Others</option>
                  </select>
                </label>
                {scurveAddModal.mode === "others" ? (
                  <label className="wide">
                    <span>Activity Name</span>
                    <input value={scurveAddModal.otherName} onChange={(event) => updateScurveAddModal("otherName", event.target.value)} placeholder="Enter activity name" />
                  </label>
                ) : null}
                <label>
                  <span>Weightage</span>
                  <input type="number" min="0" value={scurveAddModal.weight} onChange={(event) => updateScurveAddModal("weight", event.target.value)} />
                </label>
                <label>
                  <span>Schedule Start</span>
                  <input value={stageDateInput(scurveAddModal.startDate)} readOnly={scurveAddModal.mode !== "others"} onChange={(event) => updateScurveAddModal("startDate", event.target.value)} placeholder="DD-MM-YY" />
                </label>
                <label>
                  <span>Schedule Finish</span>
                  <input value={stageDateInput(scurveAddModal.finishDate)} readOnly={scurveAddModal.mode !== "others"} onChange={(event) => updateScurveAddModal("finishDate", event.target.value)} placeholder="DD-MM-YY" />
                </label>
                <p className="wide">Allowed parent range: {formatDate((getParentSchedule(scurveAddModal.parentName) || {}).start) || "-"} to {formatDate((getParentSchedule(scurveAddModal.parentName) || {}).finish) || "-"}</p>
              </div>
              <div className="scurve-add-modal-actions">
                <button type="button" onClick={closeScurveAddActivity}>Cancel</button>
                <button type="submit">Add Activity</button>
              </div>
            </form>
          </div>
        ) : null}

        <div className="scurve-table-footer">
          <span>Showing {activities.length ? (currentPage - 1) * rowsPerPage + 1 : 0} to {Math.min(currentPage * rowsPerPage, activities.length)} of {activities.length} entries</span>
          <div className="scurve-pagination-wrap">
            <label>Rows per page:
              <select value={rowsPerPage} onChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(1); }}>
                {[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <div className="scurve-pagination">
              <button type="button" onClick={() => setPage(1)} disabled={currentPage === 1}><ChevronsLeft size={15} /></button>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}><ChevronLeft size={15} /></button>
              <strong>{currentPage}</strong>
              <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount}><ChevronRight size={15} /></button>
              <button type="button" onClick={() => setPage(pageCount)} disabled={currentPage === pageCount}><ChevronsRight size={15} /></button>
            </div>
          </div>
        </div>
      </section>
      <div className="scurve-note"><span>i</span> Note: Update monthly planned values and actual progress to generate accurate S-Curve.</div>
    </div>
  );
}

function CorporateAmrMasterView({ rows = [], onBack, onChanged }) {
  const corporateRows = (rows || []).filter((row) => row.project_type === "Corporate AMR");
  const fyStartYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const currentFy = `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
  const lastFy = `FY ${fyStartYear - 1}-${String(fyStartYear).slice(-2)}`;
  const [approvalTemplate, setApprovalTemplate] = useState([]);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(null);
  const [editState, setEditState] = useState(null);
  const [projectCategory, setProjectCategory] = useState("Ongoing");
  const [message, setMessage] = useState("");
  const [modalMessage, setModalMessage] = useState("");
  const [savingMaster, setSavingMaster] = useState(false);
  const [localMasterDrafts, setLocalMasterDrafts] = useState({});
  const isCompletedProject = (row) => Boolean(
    row?.completion_date ||
    row?.completion_marked === "Y" ||
    row?.commissioned_date ||
    row?.commissioned_marked === "Y"
  );
  const isArchivedProject = (row) => row?.project_archived === "Y";
  const parentProjectIds = new Set(
    corporateRows
      .map((row) => Number(row.parent_project_id || 0))
      .filter(Boolean),
  );
  const isParentProject = (row) => parentProjectIds.has(Number(row?.id || 0));
  const countableRows = (items) => (items || []).filter((row) => !isParentProject(row));
  const categoryRows = {
    Ongoing: corporateRows.filter((row) => !isArchivedProject(row) && !isCompletedProject(row)),
    Completed: corporateRows.filter((row) => !isArchivedProject(row) && isCompletedProject(row)),
    Archived: corporateRows.filter((row) => isArchivedProject(row)),
  };
  const activeCorporateRows = categoryRows[projectCategory] || [];
  const activeRowsWithSerial = activeCorporateRows.reduce((items, row) => {
    const parent = isParentProject(row);
    const lastSerial = items.length ? items[items.length - 1].serial : 0;
    items.push({ row, isParent: parent, serial: parent ? lastSerial : lastSerial + 1 });
    return items;
  }, []);

  useEffect(() => {
    let cancelled = false;
    api("/api/approval-fields/template")
      .then((data) => {
        if (!cancelled) setApprovalTemplate(data.columns || []);
      })
      .catch(() => {
        if (!cancelled) setApprovalTemplate([]);
      });
    return () => { cancelled = true; };
  }, []);

  const duplicateApprovalSteps = new Set(["14", "18"]);
  const visibleApprovalTemplate = approvalTemplate.filter((column) => !duplicateApprovalSteps.has(String(column.stepNo)));
  const approvalMasterColumns = visibleApprovalTemplate.flatMap((column) => {
    const approvalColumn = {
      key: `approval:${column.fieldKey}`,
      fieldKey: column.fieldKey,
      dataField: column.dataField,
      stepNo: column.stepNo,
      label: `${column.stepNo}. ${column.stepName}`,
      group: "2. APPROVAL & COST INFORMATION",
    };
    if (String(column.stepNo) !== "19") return [approvalColumn];
    return [
      approvalColumn,
      {
        key: "tender_opening_date",
        label: "Tender Opening Date",
        group: "2. APPROVAL & COST INFORMATION",
        dataField: "Date",
      },
    ];
  });

  const amountValue = (values, fieldKey) => Number(String(values[`${fieldKey}.amount`] || "").replace(",", "")) || 0;
  const netItcValue = (values, fieldKey) => Number(String(values[`${fieldKey}.net_itc`] || "").replace(",", "")) || 0;

  const allColumns = [
    { key: "project_name", label: "Project Name", group: "1. BASIC PROJECT INFORMATION" },
    { key: "project_manager", label: "Project Manager", group: "1. BASIC PROJECT INFORMATION" },
    { key: "executing_agency", label: "Executing Agency", group: "1. BASIC PROJECT INFORMATION" },
    ...approvalMasterColumns,
    { key: "gross_cost", label: "Gross Cost (In Cr.)", group: "2. APPROVAL & COST INFORMATION" },
    { key: "expenditure_last_fy", label: `Expenditure incurred up to ${lastFy}`, group: "3. CAPEX / FINANCIAL TRACKING" },
    { key: "be_current_fy", label: `BE Current Financial Year (${currentFy})`, group: "3. CAPEX / FINANCIAL TRACKING" },
    { key: "re_current_fy", label: `RE Current Financial Year (${currentFy})`, group: "3. CAPEX / FINANCIAL TRACKING" },
    { key: "actual_current_fy", label: "Actual Cost Incurred in Current FY", group: "3. CAPEX / FINANCIAL TRACKING" },
    { key: "cumulative_cost", label: "Cummulative Cost", group: "3. CAPEX / FINANCIAL TRACKING" },
    { key: "tender_award", label: "Tender Award Date", group: "3. CAPEX / FINANCIAL TRACKING" },
    { key: "loa_loi", label: "LOA/LOI", group: "4. TENDERING & CONTRACT MILESTONES" },
    { key: "contract_signing", label: "Contract Signing", group: "4. TENDERING & CONTRACT MILESTONES" },
    { key: "effective_date", label: "Effective date of Contract", group: "4. TENDERING & CONTRACT MILESTONES" },
    { key: "schedule_month", label: "Schedule Month", group: "4. TENDERING & CONTRACT MILESTONES" },
    { key: "contract_schedule_completion", label: "Schedule Completion", group: "4. TENDERING & CONTRACT MILESTONES" },
    { key: "expected_completion_date", label: "Expected Completion Date", group: "5. SCHEDULE & COMPLETION TRACKING" },
    { key: "completion_marked", label: "Completion Marked", group: "5. SCHEDULE & COMPLETION TRACKING" },
    { key: "completion_date", label: "Completion Date", group: "5. SCHEDULE & COMPLETION TRACKING" },
    { key: "commissioned_marked", label: "Commissioned Marked", group: "5. SCHEDULE & COMPLETION TRACKING" },
    { key: "commissioned_date", label: "Commissioned Date", group: "5. SCHEDULE & COMPLETION TRACKING" },
    { key: "status", label: "Status", group: "6. STATUS" },
  ];
  const visibleSet = new Set(visibleColumnKeys || allColumns.map((column) => column.key));
  const columns = allColumns.filter((column) => visibleSet.has(column.key));
  const groups = columns.reduce((items, column) => {
    const last = items[items.length - 1];
    if (last?.name === column.group) {
      last.count += 1;
    } else {
      items.push({ name: column.group, count: 1 });
    }
    return items;
  }, []);
  const groupClass = (name) => {
    if (name.startsWith("1.")) return "basic";
    if (name.startsWith("2.")) return "approval";
    if (name.startsWith("3.")) return "capex";
    if (name.startsWith("4.")) return "tender";
    if (name.startsWith("5.")) return "schedule";
    return "status";
  };
  const localDraftFor = (row) => localMasterDrafts[String(row?.id || "")] || {};
  const capexCalculatedKeys = new Set([
    "expenditure_last_fy",
    "be_current_fy",
    "re_current_fy",
    "actual_current_fy",
    "cumulative_cost",
  ]);
  const valueFor = (row, key) => {
    const draft = localDraftFor(row);
    if (key.startsWith("approval:")) {
      const fieldKey = key.replace("approval:", "");
      const currentValue = draft.approval_values?.[fieldKey] ?? row.approval_fields?.[fieldKey] ?? "";
      const previousValues = (row.approval_field_history?.[fieldKey] || [])
        .map((item) => item?.value || "")
        .filter((value, index, values) => value && value !== currentValue && values.indexOf(value) === index);
      if (!previousValues.length) return currentValue;
      return `${currentValue || "-"} | Prev: ${previousValues.join(", ")}`;
    }
    const dateValue = (value) => value || "";
    const values = {
      project_name: row.display_name || row.project_name || "",
      project_manager: row.project_manager || "",
      executing_agency: row.contractor_name || row.master_executing_agency || "",
      dic_recommendation_date: dateValue(row.dic_recommendation_date),
      cod_cleared: row.cod_cleared || "",
      cod_date: dateValue(row.cod_date),
      stage1_date: row.stage1_date || "",
      stage1_cost: row.stage1_cost || "",
      stage1_cleared: row.stage1_cleared || "",
      expected_tod_date: dateValue(row.expected_tod_date),
      final_tod_date: dateValue(row.final_tod_date),
      tender_cancelled: row.tender_cancelled || "",
      retender_expected_date: dateValue(row.retender_expected_date),
      retender_final_date: dateValue(row.retender_final_date),
      stage2_date: row.stage2_date || "",
      stage2_cost: row.stage2_cost || "",
      stage2_cleared: row.stage2_cleared || "",
      gross_cost: row.gross_cost ? number(row.gross_cost) : "",
      expenditure_last_fy: row.expenditure_last_fy !== null && row.expenditure_last_fy !== undefined ? number(row.expenditure_last_fy) : "",
      be_current_fy: row.be_current_fy !== null && row.be_current_fy !== undefined ? number(row.be_current_fy) : "",
      re_current_fy: row.re_current_fy !== null && row.re_current_fy !== undefined ? number(row.re_current_fy) : "",
      actual_current_fy: row.actual_current_fy !== null && row.actual_current_fy !== undefined ? number(row.actual_current_fy) : "",
      cumulative_cost: row.cumulative_cost !== null && row.cumulative_cost !== undefined ? number(row.cumulative_cost) : "",
      tender_opening_date: (draft.tender_openings || row.tender_openings || []).map((item) => `${item.opening_date || ""}${item.remarks ? ` (${item.remarks})` : ""}`).filter(Boolean).join(", "),
      tender_award: dateValue(row.final_tod_date),
      loa_loi: dateValue(row.loa_date),
      contract_signing: row.contract_signing || "",
      effective_date: row.effective_date || "",
      schedule_month: row.schedule_months || row.schedule || "",
      contract_schedule_completion: row.schedule_completion || "",
      expected_completion_date: row.expected_finish || row.expected_completion_date || "",
      completion_marked: row.completion_marked || (row.completion_date ? "Y" : "N"),
      completion_date: dateValue(row.completion_date),
      commissioned_marked: row.commissioned_marked || (row.commissioned_date ? "Y" : "N"),
      commissioned_date: dateValue(row.commissioned_date),
      status: row.status_override || row.status || "",
    };
    if (capexCalculatedKeys.has(key)) return values[key] ?? "";
    return draft.master_values?.[key] ?? values[key] ?? "";
  };
  const editValueFor = (row, column) => {
    const draft = localDraftFor(row);
    if (column.key.startsWith("approval:")) {
      return draft.approval_values?.[column.fieldKey] ?? row.approval_fields?.[column.fieldKey] ?? "";
    }
    return valueFor(row, column.key);
  };
  const editAmountPartFor = (row, column, part) => {
    const draft = localDraftFor(row);
    return draft.approval_values?.[`${column.fieldKey}.${part}`] ?? row.approval_fields?.[`${column.fieldKey}.${part}`] ?? "";
  };
  const dateStepNumbers = new Set(["1", "2", "4", "5", "6", "6A", "7", "8", "9", "10", "11", "12", "13", "14", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36"]);
  const isDateColumn = (column) => (
    (column.key.startsWith("approval:") && (column.dataField === "Date" || dateStepNumbers.has(String(column.stepNo)))) ||
    ["loa_loi", "contract_signing", "effective_date", "contract_schedule_completion", "expected_completion_date", "completion_date", "commissioned_date"].includes(column.key)
  );
  const isMarkedColumn = (column) => ["completion_marked", "commissioned_marked"].includes(column.key);
  const toDateInputValue = (value) => {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const match = text.match(/^(\d{2})-(\d{2})-(\d{2}|\d{4})$/);
    if (!match) return "";
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2]}-${match[1]}`;
  };
  const editableColumnKeys = new Set([
    "project_manager",
    "executing_agency",
    "tender_opening_date",
    "loa_loi",
    "contract_signing",
    "effective_date",
    "schedule_month",
    "contract_schedule_completion",
    "expected_completion_date",
    "completion_marked",
    "completion_date",
    "commissioned_marked",
    "commissioned_date",
    "status",
  ]);
  const readonlyColumnKeys = new Set([
    "project_name",
    "gross_cost",
    "tender_award",
  ]);
  const isColumnEditable = (column) => column.key.startsWith("approval:") || editableColumnKeys.has(column.key);
  const editorColumns = allColumns.filter((column) => !readonlyColumnKeys.has(column.key));
  const openEditForm = (row) => {
    const values = {};
    const draft = localDraftFor(row);
    editorColumns.forEach((column) => {
      values[column.key] = isDateColumn(column) ? toDateInputValue(editValueFor(row, column)) : editValueFor(row, column);
      if (column.key.startsWith("approval:") && column.dataField === "Amount") {
        values[`${column.key}.amount`] = editAmountPartFor(row, column, "amount");
        values[`${column.key}.net_itc`] = editAmountPartFor(row, column, "net_itc");
      }
    });
    setEditState({
      row,
      values,
      revertStep: "",
      revertRemark: "",
      tenderOpenings: (draft.tender_openings || row.tender_openings || []).map((item) => ({
        opening_date: toDateInputValue(item.opening_date),
        remarks: item.remarks || "",
      })),
    });
    setMessage("");
    setModalMessage("");
  };
  const updateEditValue = (key, value) => {
    setEditState((current) => (
      current ? { ...current, values: { ...current.values, [key]: value } } : current
    ));
  };
  const updateTenderOpening = (index, key, value) => {
    setEditState((current) => {
      if (!current) return current;
      const tenderOpenings = [...(current.tenderOpenings || [])];
      tenderOpenings[index] = { ...(tenderOpenings[index] || {}), [key]: value };
      return { ...current, tenderOpenings };
    });
  };
  const addTenderOpening = () => {
    setEditState((current) => current ? {
      ...current,
      tenderOpenings: [...(current.tenderOpenings || []), { opening_date: "", remarks: "" }],
    } : current);
  };
  const removeTenderOpening = (index) => {
    setEditState((current) => current ? {
      ...current,
      tenderOpenings: (current.tenderOpenings || []).filter((_, rowIndex) => rowIndex !== index),
    } : current);
  };
  const updateEditAmountGroup = (column, part, value) => {
    setEditState((current) => {
      if (!current) return current;
      const values = { ...current.values, [`${column.key}.${part}`]: value };
      const gross = amountValue(values, column.key) + netItcValue(values, column.key);
      values[column.key] = gross ? String(gross) : "";
      return { ...current, values };
    });
  };
  const clearLocalDraft = (rowId) => {
    setLocalMasterDrafts((current) => {
      const next = { ...current };
      delete next[String(rowId)];
      return next;
    });
  };
  const archiveProject = async (row, archived) => {
    if (!row?.id) return;
    if (archived && !window.confirm(`Archive ${row.project_name}? It will be hidden from Registration, CAPEX, Schedule, Repository, Dashboard and other normal lists.`)) {
      return;
    }
    try {
      await api(`/api/projects/${row.id}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      setMessage(archived ? "Project archived and hidden from normal app lists." : "Project restored from archive.");
      await onChanged?.();
    } catch (err) {
      setMessage(err.message || "Unable to update archive status.");
    }
  };
  const saveEditForm = async (event) => {
    event?.preventDefault?.();
    if (!editState?.row || savingMaster) return;
    setSavingMaster(true);
    setModalMessage("");
    const approvalValues = {};
    const masterValues = {};
    for (const column of editorColumns) {
      if (!isColumnEditable(column)) continue;
      const value = editState.values[column.key] ?? "";
      if (column.key.startsWith("approval:")) {
        approvalValues[column.fieldKey] = value;
        if (column.dataField === "Amount") {
          approvalValues[`${column.fieldKey}.amount`] = editState.values[`${column.key}.amount`] ?? "";
          approvalValues[`${column.fieldKey}.net_itc`] = editState.values[`${column.key}.net_itc`] ?? "";
        }
      } else {
        masterValues[column.key] = value;
      }
    }
    try {
      const tenderOpenings = editState.tenderOpenings || [];
      const missingTenderRemark = tenderOpenings.some((item) => item.opening_date && !String(item.remarks || "").trim());
      if (missingTenderRemark) {
        throw new Error("Enter remarks for each Tender Opening Date proposal.");
      }
      if (Object.keys(approvalValues).length) {
        await api(`/api/projects/${editState.row.id}/approval-fields?auto_stage=true`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: approvalValues }),
        });
      }

      if (Object.keys(masterValues).length || tenderOpenings.length) {
        const result = await api(`/api/projects/${editState.row.id}/corporate-amr-master`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ master_values: masterValues, approval_values: {}, tender_openings: tenderOpenings }),
        });
        if (result?.status !== "ok") {
          throw new Error("Save did not complete.");
        }
      }

      clearLocalDraft(editState.row.id);
      await onChanged?.();
      setEditState(null);
      setMessage("Corporate AMR master details saved.");
    } catch (err) {
      setModalMessage(err.message || "Unable to save Corporate AMR master details.");
    } finally {
      setSavingMaster(false);
    }
  };
  const revertStage = async () => {
    if (!editState?.row) return;
    if (!editState.revertStep) {
      setModalMessage("Select a revert point or keep No Action.");
      return;
    }
    if (!String(editState.revertRemark || "").trim()) {
      setModalMessage("Enter remark before reverting back.");
      return;
    }
    const stepNo = Number(editState.revertStep);
    const step = approvalTemplate.find((item) => Number(item.stepNo) === stepNo);
    const label = step ? `${step.stepNo}. ${step.stepName}` : `Step ${stepNo}`;
    if (!window.confirm(`Revert ${editState.row.unique_id} back to ${label}? Current approval dates/costs will be preserved in history.`)) return;
    try {
      await api(`/api/projects/${editState.row.id}/approval-stage-revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_no: stepNo, requested_by_role: "admin", remark: editState.revertRemark }),
      });
      setEditState(null);
      setMessage(`Project reverted back to ${label}. Previous approval dates/costs are preserved.`);
      await onChanged?.();
    } catch (err) {
      setModalMessage(err.message || "Unable to revert approval stage.");
    }
  };
  const toggleColumn = (key) => {
    const next = new Set(visibleColumnKeys || allColumns.map((column) => column.key));
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setVisibleColumnKeys([...next]);
  };

  return (
    <div className="corporate-master-window">
      <div className="corporate-master-head">
        <div>
          <h1>Corporate AMR Master</h1>
          <p>Master database layout for Corporate AMR schemes.</p>
        </div>
        <div className="corporate-master-actions">
          <details className="corporate-column-picker">
            <summary><ListChecks size={16} /> Column View</summary>
            <div>
              <div className="column-picker-tools">
                <button type="button" onClick={() => setVisibleColumnKeys(allColumns.map((column) => column.key))}>All</button>
                <button type="button" onClick={() => setVisibleColumnKeys(["project_name", "gross_cost", "status"])}>Basic</button>
              </div>
              {allColumns.map((column) => (
                <label key={column.key}>
                  <input
                    type="checkbox"
                    checked={visibleSet.has(column.key)}
                    onChange={() => toggleColumn(column.key)}
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          </details>
          <button type="button" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        </div>
      </div>
      {message ? <div className="corporate-master-message">{message}</div> : null}
      <div className="corporate-master-category-tabs">
        {["Ongoing", "Completed", "Archived"].map((category) => (
          <button
            key={category}
            type="button"
            className={projectCategory === category ? "active" : ""}
            onClick={() => setProjectCategory(category)}
          >
            {category}
            <span>{countableRows(categoryRows[category]).length}</span>
          </button>
        ))}
      </div>

      <section className="corporate-master-card">
        <div className="corporate-master-title">MASTER DATABASE LAYOUT (ONE MASTER TABLE)</div>
        <div className="corporate-master-table-wrap">
          <table className="corporate-master-table">
            <thead>
              <tr>
                <th className="serial-head" rowSpan="2">Sr.</th>
                {projectCategory === "Completed" || projectCategory === "Archived" ? <th className="serial-head" rowSpan="2">Archive</th> : null}
                {groups.map((group) => (
                  <th key={group.name} className={`group-head ${groupClass(group.name)}`} colSpan={group.count}>
                    {group.name}
                  </th>
                ))}
              </tr>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={`column-head ${groupClass(column.group)} col-${column.key.replace(/[^a-z0-9_-]/gi, "-")}`}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeRowsWithSerial.length ? activeRowsWithSerial.map(({ row, isParent, serial }, index) => (
                <tr key={row.id || index} className={isParent ? "corporate-parent-row" : ""} onDoubleClick={() => openEditForm(row)}>
                  <td className="serial-cell">{isParent ? "" : serial}</td>
                  {projectCategory === "Completed" || projectCategory === "Archived" ? (
                    <td className="serial-cell" onDoubleClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={row.project_archived === "Y"}
                        onChange={(event) => archiveProject(row, event.target.checked)}
                        title={row.project_archived === "Y" ? "Unarchive project" : "Archive project"}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column.key} className={`col-${column.key.replace(/[^a-z0-9_-]/gi, "-")}`}>{valueFor(row, column.key)}</td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td className="empty" colSpan={columns.length + 1 + ((projectCategory === "Completed" || projectCategory === "Archived") ? 1 : 0)}>
                    No Corporate AMR {projectCategory.toLowerCase()} projects available.
                  </td>
                </tr>
              )}
              {Array.from({ length: Math.max(0, 6 - activeRowsWithSerial.length) }).map((_, index) => (
                <tr key={`blank-${index}`} className="blank-row">
                  <td className="serial-cell">{countableRows(activeCorporateRows).length + index + 1}</td>
                  {projectCategory === "Completed" || projectCategory === "Archived" ? <td /> : null}
                  {columns.map((column) => <td key={column.key} className={`col-${column.key.replace(/[^a-z0-9_-]/gi, "-")}`} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editState ? (
        <div className="corporate-master-modal-backdrop">
          <form className="corporate-master-modal" onSubmit={saveEditForm}>
            <div className="corporate-master-modal-head">
              <div>
                <h3>Edit Corporate AMR Master</h3>
                <p>{editState.row.unique_id} | {editState.row.project_name}</p>
              </div>
              <button type="button" onClick={() => setEditState(null)}>Close</button>
            </div>
            <div className="corporate-master-form-grid">
              {editorColumns.map((column) => {
                const editable = isColumnEditable(column);
                const dateColumn = isDateColumn(column);
                const markedColumn = isMarkedColumn(column);
                return (
                  <label key={column.key} className={groupClass(column.group)}>
                    <span>{column.label}</span>
                    {column.key === "tender_opening_date" ? (
                      <div className="corporate-tender-openings inline">
                        <div className="corporate-tender-openings-head">
                          <h4>Tender Opening Date</h4>
                          <button type="button" onClick={addTenderOpening}>Add Date</button>
                        </div>
                        {(editState.tenderOpenings || []).length ? (editState.tenderOpenings || []).map((item, index) => (
                          <div className="corporate-tender-opening-row" key={`tender-opening-${index}`}>
                            <input
                              type="date"
                              value={item.opening_date || ""}
                              onChange={(event) => updateTenderOpening(index, "opening_date", event.target.value)}
                            />
                            <input
                              value={item.remarks || ""}
                              onChange={(event) => updateTenderOpening(index, "remarks", event.target.value)}
                              placeholder="Remarks"
                            />
                            <button type="button" onClick={() => removeTenderOpening(index)}>Remove</button>
                          </div>
                        )) : (
                          <div className="corporate-tender-empty">No dates added.</div>
                        )}
                      </div>
                    ) : column.key.startsWith("approval:") && column.dataField === "Amount" ? (
                      <div className="corporate-amount-group">
                        <input
                          value={editState.values[`${column.key}.amount`] ?? ""}
                          readOnly={!editable}
                          onChange={(event) => updateEditAmountGroup(column, "amount", event.target.value)}
                          placeholder="Amount"
                          inputMode="decimal"
                        />
                        <input
                          value={editState.values[`${column.key}.net_itc`] ?? ""}
                          readOnly={!editable}
                          onChange={(event) => updateEditAmountGroup(column, "net_itc", event.target.value)}
                          placeholder="Net of ITC"
                          inputMode="decimal"
                        />
                        <input value={editState.values[column.key] ?? ""} readOnly placeholder="Gross Cost" />
                      </div>
                    ) : markedColumn ? (
                      <select
                        value={editState.values[column.key] ?? "N"}
                        disabled={!editable}
                        onChange={(event) => updateEditValue(column.key, event.target.value)}
                      >
                        <option value="N">No</option>
                        <option value="Y">Yes</option>
                      </select>
                    ) : (
                      <div className={dateColumn ? "corporate-date-input" : ""}>
                        <input
                          type={dateColumn ? "date" : "text"}
                          value={editState.values[column.key] ?? ""}
                          readOnly={!editable}
                          onChange={(event) => updateEditValue(column.key, event.target.value)}
                          placeholder={dateColumn ? "DD-MM-YY" : ""}
                        />
                        {dateColumn ? <CalendarDays size={15} /> : null}
                      </div>
                    )}
                  </label>
                );
              })}
            </div>
            {modalMessage ? <div className="corporate-master-modal-message">{modalMessage}</div> : null}
            <div className="corporate-master-modal-actions">
              <label className="corporate-revert-control">
                <span>Revert Back To Point</span>
                <select
                  value={editState.revertStep}
                  onChange={(event) => setEditState((current) => current ? { ...current, revertStep: event.target.value } : current)}
                >
                  <option value="">No Action</option>
                  {visibleApprovalTemplate.map((item) => (
                    <option key={item.fieldKey} value={item.stepNo}>
                      {item.stepNo}. {item.stepName}
                    </option>
                  ))}
                </select>
                <input
                  value={editState.revertRemark || ""}
                  onChange={(event) => setEditState((current) => current ? { ...current, revertRemark: event.target.value } : current)}
                  placeholder="Revert remark"
                />
              </label>
              <button type="button" className="corporate-revert-button" onClick={revertStage}>Revert Back</button>
              <button type="button" disabled={savingMaster} onClick={() => setEditState(null)}>Cancel</button>
              <button type="button" disabled={savingMaster} onClick={saveEditForm}>
                {savingMaster ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function OngoingView({ rows, summaryByType, loading = false, onRefresh, onOpenContract, onOpenSCurve, onOpenDailyProgress, onOpenPlantLevel, onOpenCorporateMaster }) {
  const [projectType, setProjectType] = useState("Corporate AMR");
  const [selectedRow, setSelectedRow] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [projectListFilter, setProjectListFilter] = useState("active");
  const [plantDashboardRows, setPlantDashboardRows] = useState([]);
  const [plantDashboardLoading, setPlantDashboardLoading] = useState(false);
  const plantStatusBucket = (status) => {
    const text = String(status || "").trim();
    if (["On Time", "Delay < 1 Yr.", "Delay > 1 Yr."].includes(text)) return "active";
    if (text === "Completed") return "completed";
    if (text === "Yet to Start") return "underApproval";
    return "";
  };
  const rowStatus = (row) => {
    const explicitStatus = String(row?.status || "").trim();
    if (explicitStatus) return explicitStatus;
    if (row?.project_dropped === "Y") return "Project Dropped";
    if (row?.commissioned_marked === "Y") return "Commissioned";
    if (row?.completion_marked === "Y") return "Complete";
    if (row?.stage2_cleared === "Y") return "Ongoing";
    if (String(row?.final_tod_date || "").trim()) return "Stage-2";
    if (row?.stage1_cleared === "Y") return "Tendering";
    if (row?.cod_cleared === "Y") return "Stage-1";
    return "Under Formulation";
  };
  const rowBucket = (row) => {
    const backendBucket = String(row?.status_bucket || "").trim();
    if (backendBucket) return backendBucket;
    const plantBucket = plantStatusBucket(row?.status);
    if (plantBucket) return plantBucket;
    const status = rowStatus(row);
    if (status === "Ongoing") return "active";
    if (["Complete", "Completed", "Commissioned"].includes(status)) return "completed";
    return "underApproval";
  };
  const rowIsActive = (row) => rowBucket(row) === "active";
  const rowIsCompleted = (row) => rowBucket(row) === "completed";
  const ongoingRowsById = new Map((rows || []).map((row) => [String(row.id), row]));
  const plantDashboardTypeRows = (plantDashboardRows || []).map((row) => {
    const base = ongoingRowsById.get(String(row.id)) || {};
    return {
      ...base,
      ...row,
      project_type: "Plant Level AMR",
      unique_id: base.unique_id || row.unique_id || "",
      display_name: row.project_name || base.display_name || base.project_name || "",
      gross_cost: Number(row.gross_cost_cr || base.gross_cost || 0) || 0,
      status: row.status || base.status || "",
      status_bucket: plantStatusBucket(row.status),
      project_archived: base.project_archived || "N",
    };
  });
  const sourceRows = projectType === "Plant Level AMR" && plantDashboardTypeRows.length ? plantDashboardTypeRows : rows;
  const metricsLoading = loading || (projectType === "Plant Level AMR" && plantDashboardLoading);
  const allTypeRows = sourceRows.filter((row) => row.project_type === projectType && row.project_archived !== "Y");
  const countableTypeRows = allTypeRows.filter((row) => !projectHasChildren(row, sourceRows));
  const rowMatchesListFilter = (row) => {
    if (projectListFilter === "total") return true;
    if (projectListFilter === "active") return rowIsActive(row);
    if (projectListFilter === "completed") return rowIsCompleted(row);
    if (projectListFilter === "approval") return rowBucket(row) === "underApproval";
    return rowIsActive(row);
  };
  const typeRows = countableTypeRows.filter(rowMatchesListFilter);
  const isPlantLevel = projectType === "Plant Level AMR";
  const filteredRows = typeRows.filter((row) => {
    const query = searchText.trim().toLowerCase();
    if (!query) return true;
    return `${row.unique_id || ""} ${row.display_name || row.project_name || ""}`.toLowerCase().includes(query);
  });
  const fallbackGrossTotal = countableTypeRows.reduce((sum, row) => sum + (Number(row.gross_cost || 0) || 0), 0);
  const grossTotal = fallbackGrossTotal;
  const fallbackCompletedProjects = countableTypeRows.filter(rowIsCompleted).length;
  const fallbackActiveProjects = countableTypeRows.filter(rowIsActive).length;
  const fallbackActiveGrossTotal = countableTypeRows.reduce((sum, row) => (
    rowIsActive(row) ? sum + (Number(row.gross_cost || 0) || 0) : sum
  ), 0);
  const fallbackCompletedGrossTotal = countableTypeRows.reduce((sum, row) => (
    rowIsCompleted(row) ? sum + (Number(row.gross_cost || 0) || 0) : sum
  ), 0);
  const fallbackUnderApprovalProjects = countableTypeRows.filter((row) => rowBucket(row) === "underApproval").length;
  const fallbackUnderApprovalGrossTotal = countableTypeRows.reduce((sum, row) => (
    rowBucket(row) === "underApproval" ? sum + (Number(row.gross_cost || 0) || 0) : sum
  ), 0);
  const activeBreakup = {
    onTime: countableTypeRows.filter((row) => rowIsActive(row) && String(row.status || "") === "On Time").length,
    delayGtOneYear: countableTypeRows.filter((row) => rowIsActive(row) && String(row.status || "") === "Delay > 1 Yr.").length,
    delayLtOneYear: countableTypeRows.filter((row) => rowIsActive(row) && String(row.status || "") === "Delay < 1 Yr.").length,
  };
  const metricCards = [
    {
      key: "total",
      className: "total",
      iconClass: "blue",
      icon: <FolderKanban size={30} />,
      label: "Total Projects",
      count: countableTypeRows.length,
      cost: grossTotal,
    },
    {
      key: "active",
      className: "active",
      iconClass: "green",
      icon: <BarChart3 size={30} />,
      label: "Active Projects",
      count: fallbackActiveProjects,
      cost: fallbackActiveGrossTotal,
    },
    {
      key: "completed",
      className: "completed",
      iconClass: "purple",
      icon: <CheckCircle size={30} />,
      label: "Completed Projects",
      count: fallbackCompletedProjects,
      cost: fallbackCompletedGrossTotal,
    },
    {
      key: "approval",
      className: "approval",
      iconClass: "amber",
      icon: <ClipboardList size={30} />,
      label: "Under Approval",
      count: fallbackUnderApprovalProjects,
      cost: fallbackUnderApprovalGrossTotal,
    },
  ];
  const activeMetricLabel = metricCards.find((card) => card.key === projectListFilter)?.label || "Active Projects";

  useEffect(() => {
    setSelectedRow(null);
    setSearchText("");
    setProjectListFilter("active");
  }, [projectType]);

  useEffect(() => {
    if (projectType !== "Plant Level AMR") return;
    let cancelled = false;
    setPlantDashboardLoading(true);
    api("/api/plant-level-amr")
      .then((dashboard) => {
        if (!cancelled) setPlantDashboardRows(dashboard.projects || []);
      })
      .catch(() => {
        if (!cancelled) setPlantDashboardRows([]);
      })
      .finally(() => {
        if (!cancelled) setPlantDashboardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectType, rows.length]);

  function requireSelection(action) {
    if (!selectedRow) {
      window.alert("Please select a project first.");
      return;
    }
    action(selectedRow);
  }

  return (
    <div className="ongoing-window">
      <section className="ongoing-main">
        <div className="ongoing-page-head">
          <div>
            <h1>Ongoing Projects</h1>
            <p>{isPlantLevel ? "Plant Level AMR schemes open in a separate project window." : "Select a Corporate AMR project to manage planning and DPR."}</p>
          </div>
          <button type="button" className="ongoing-refresh" onClick={onRefresh} disabled={loading}><RefreshCw size={16} /> {loading ? "Loading..." : "Refresh"}</button>
        </div>

        <div className="ongoing-summary-panel">
          <div className="ongoing-type-label">Project Type</div>
          <div className="ongoing-type-tabs">
            {["Corporate AMR", "Plant Level AMR"].map((type) => (
              <button
                key={type}
                type="button"
                className={projectType === type ? "active" : ""}
                onClick={() => setProjectType(type)}
              >
                {type === "Corporate AMR" ? <Factory size={18} /> : <FolderKanban size={18} />}
                {type}
              </button>
            ))}
          </div>

          <div className="ongoing-metrics">
            <button
              type="button"
              className={`ongoing-metric-card total ${projectListFilter === "total" ? "selected" : ""}`.trim()}
              onClick={() => {
                setProjectListFilter("total");
                setSelectedRow(null);
              }}
            >
              <span className="metric-icon blue"><FolderKanban size={30} /></span>
              <div><small>Total Projects</small><strong>{metricsLoading ? "..." : countableTypeRows.length}</strong><p>Cost: ₹ {number(grossTotal)} Cr</p></div>
            </button>
            <button
              type="button"
              className={`ongoing-metric-card active ${projectListFilter === "active" ? "selected" : ""}`.trim()}
              onClick={() => {
                setProjectListFilter("active");
                setSelectedRow(null);
              }}
            >
              <span className="metric-icon green"><BarChart3 size={30} /></span>
              <div>
                <small>Active Projects</small>
                <strong>{metricsLoading ? "..." : fallbackActiveProjects}</strong>
                <p>Cost: ₹ {number(fallbackActiveGrossTotal)} Cr</p>
                {isPlantLevel ? (
                  <div className="ongoing-active-breakup">
                    <span>On Time: <b>{activeBreakup.onTime}</b></span>
                    <span>Delay &gt; 1 Yr.: <b>{activeBreakup.delayGtOneYear}</b></span>
                    <span>Delay &lt; 1 Yr.: <b>{activeBreakup.delayLtOneYear}</b></span>
                  </div>
                ) : null}
              </div>
            </button>
            <button
              type="button"
              className={`ongoing-metric-card completed ${projectListFilter === "completed" ? "selected" : ""}`.trim()}
              onClick={() => {
                setProjectListFilter("completed");
                setSelectedRow(null);
              }}
            >
              <span className="metric-icon purple"><CheckCircle size={30} /></span>
              <div><small>Completed Projects</small><strong>{metricsLoading ? "..." : fallbackCompletedProjects}</strong><p>Cost: ₹ {number(fallbackCompletedGrossTotal)} Cr</p></div>
            </button>
            <button
              type="button"
              className={`ongoing-metric-card approval ${projectListFilter === "approval" ? "selected" : ""}`.trim()}
              onClick={() => {
                setProjectListFilter("approval");
                setSelectedRow(null);
              }}
            >
              <span className="metric-icon amber"><ClipboardList size={30} /></span>
              <div><small>Under Approval</small><strong>{metricsLoading ? "..." : fallbackUnderApprovalProjects}</strong><p>Cost: ₹ {number(fallbackUnderApprovalGrossTotal)} Cr</p></div>
            </button>
            <div className="ongoing-metric-card hide-gross">
              <span className="metric-icon orange"><IndianRupee size={30} /></span>
              <div><small>Total Gross Cost</small><strong>{metricsLoading ? "..." : `₹ ${number(grossTotal)} Cr`}</strong><p>(All Projects)</p></div>
            </div>
          </div>
        </div>

        <div className="ongoing-table-card">
          <div className="ongoing-table-head">
            <h2>{activeMetricLabel} - {projectType}</h2>
            <label className="ongoing-search">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search project name or ID..."
              />
              <Search size={19} />
            </label>
          </div>
          <div className="ongoing-table-wrap">
            <table className="ongoing-table">
              <thead>
                <tr>
                  <th>Unique ID</th>
                  <th>Project Name</th>
                  <th>Gross Cost (₹ Cr)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {metricsLoading ? (
                  <tr><td colSpan="4" className="empty">Loading ongoing projects...</td></tr>
                ) : filteredRows.length ? filteredRows.map((row) => {
                  const dprEligible = Boolean(row.hasActiveScurvePlan && row.hasCompletedPlanning);
                  return (
                    <tr
                      key={row.id}
                      className={`${selectedRow?.id === row.id ? "selected-row" : ""} ${projectHasChildren(row, rows) ? "project-parent-row" : ""}`.trim()}
                      onClick={() => setSelectedRow(row)}
                      onDoubleClick={() => {
                        setSelectedRow(row);
                        if (row.project_type === "Plant Level AMR") {
                          return;
                        } else {
                          onOpenContract(row);
                        }
                      }}
                    >
                      <td>{row.unique_id}</td>
                      <td>{row.display_name || row.project_name}</td>
                      <td>{row.gross_cost ? number(row.gross_cost) : "-"}</td>
                      <td>
                        {row.project_type === "Plant Level AMR" ? (
                          <button
                            type="button"
                            className="ongoing-dpr-btn eligible"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedRow(row);
                            }}
                          >
                            <FolderKanban size={14} /> Select
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={dprEligible ? "ongoing-dpr-btn eligible" : "ongoing-dpr-btn not-eligible"}
                            disabled={!dprEligible}
                            title={dprEligible ? "Open DPR" : "Complete S-Curve planning to enable DPR"}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!dprEligible) return;
                              setSelectedRow(row);
                              onOpenDailyProgress(row);
                            }}
                          >
                            <CheckCircle size={14} /> DPR
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan="4" className="empty">No projects available for this selection.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {isPlantLevel ? (
            <div className="ongoing-actions">
              <button type="button" onClick={() => onOpenPlantLevel(filteredRows)}><FolderKanban size={18} /> Open Plant Level AMR Window</button>
            </div>
          ) : (
            <div className="ongoing-actions">
              <button type="button" className="corporate-master-open" onClick={onOpenCorporateMaster}><Table2 size={18} /> Corporate AMR Master</button>
              <button type="button" onClick={() => requireSelection(onOpenContract)}><FileText size={18} /> Contract Details & Appendix-2</button>
              <button type="button" onClick={() => requireSelection(onOpenSCurve)}><BarChart3 size={18} /> S-Curve Planning</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PlantLevelProjectView({ project, user, onBack, onHome, ongoingRows = [] }) {
  const defaultFinancialYearMonths = ["Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27"];
  const defaultReMonths = ["Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27"];
  const ongoingPlantRows = (ongoingRows || []).filter((row) => row?.project_type === "Plant Level AMR");
  const ongoingFallbackRows = ongoingPlantRows.map((row, index) => ({
    sl_no: index + 1,
    id: row.id,
    project_name: row.display_name || row.project_name || "",
    contractor_name: row.contractor_name || "",
    at_no: row.unique_id || "",
    at_date: "",
    scheduled_month: "-",
    start_date: "",
    finish_date: "",
    expected_finish_date: "",
    completion_date: "",
    physical_progress_percent: 0,
    status: "Yet to Start",
    start_bucket: "Yet to Start",
    gross_cost_cr: Number(row.gross_cost || 0) || 0,
    remarks: "",
    be_cr: Number(row.gross_cost || 0) || 0,
    re_cr: Number(row.gross_cost || 0) || 0,
    monthly: [],
  }));
  function fallbackDashboard(rows, base = {}) {
    const countableRows = rows.filter((row) => !projectHasChildren(row, rows));
    const totalBe = countableRows.reduce((sum, row) => sum + (Number(row.be_cr || row.gross_cost_cr || 0) || 0), 0);
    const progress = countableRows.length
      ? countableRows.reduce((sum, row) => sum + (Number(row.physical_progress_percent || 0) || 0), 0) / countableRows.length
      : 0;
    const statusCounts = countableRows.reduce((counts, row) => {
      const status = row.status === "Ongoing" ? "On Time" : (row.status || "Yet to Start");
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, { Completed: 0, "Yet to Start": 0, "On Time": 0, "Delay < 1 Yr.": 0, "Delay > 1 Yr.": 0 });
    return {
      ...base,
      financial_year_months: base.financial_year_months || defaultFinancialYearMonths,
      re_months: base.re_months || defaultReMonths,
      projects: rows,
      summary: {
        ...(base.summary || {}),
        total_projects: countableRows.length,
        status_counts: statusCounts,
        status_percent: Object.fromEntries(Object.entries(statusCounts).map(([status, count]) => [status, countableRows.length ? (count / countableRows.length) * 100 : 0])),
        overall_progress_percent: progress,
        cumulative_be_cr: totalBe,
        cumulative_re_cr: totalBe,
      },
      capex: base.capex || {
        rows: [],
        totals: { be_cr: totalBe, re_cr: totalBe, actual_cr: 0, variance_cr: 0 },
      },
    };
  }
  const [dashboardData, setDashboardData] = useState(null);
  const [details, setDetails] = useState(project || ongoingFallbackRows[0] || null);
  const [rows, setRows] = useState(project ? [project] : ongoingFallbackRows);
  const [selectedId, setSelectedId] = useState(project?.id || "");
  const [statusFilter, setStatusFilter] = useState("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("Apr-26");
  const [plantEditOpen, setPlantEditOpen] = useState(false);
  const [plantEditDraft, setPlantEditDraft] = useState({});
  const [plantEditSaving, setPlantEditSaving] = useState(false);
  const plantEditSavingRef = useRef(false);
  const [edcIdcEditOpen, setEdcIdcEditOpen] = useState(false);
  const [edcIdcDraft, setEdcIdcDraft] = useState({});
  const [plantColumnFilters, setPlantColumnFilters] = useState({});
  const [plantColumnSearch, setPlantColumnSearch] = useState({});
  const [plantSort, setPlantSort] = useState(null);
  const [plantColumnWidths, setPlantColumnWidths] = useState({});
  const [rowsPerPage, setRowsPerPage] = useState(7);
  const [page, setPage] = useState(1);
  const plantUploadRef = useRef(null);
  const fyReloadAttemptRef = useRef("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [edcIdcMonthly, setEdcIdcMonthly] = useState({});
  const plantColumnPrefsLoadedRef = useRef(false);
  const defaultPlantVisibleColumns = {
    project_name: true,
    department: true,
    contractor_name: true,
    at_no: true,
    at_date: true,
    schedule_months: true,
    start_date: true,
    finish_date: true,
    expected_finish_date: true,
    completion_date: true,
    fy_classification: true,
    physical_progress_percent: true,
    status: true,
    delay_days: true,
    delay_category: true,
    gross_cost_cr: true,
    remarks: true,
    be_cr: true,
    re_cr: true,
    monthly_be: true,
    monthly_re: true,
    monthly_actual: true,
  };
  const [visiblePlantColumns, setVisiblePlantColumns] = useState(() => {
    try {
      const saved = window.localStorage.getItem(PLANT_AMR_VISIBLE_COLUMNS_KEY);
      return saved ? { ...defaultPlantVisibleColumns, ...JSON.parse(saved) } : defaultPlantVisibleColumns;
    } catch {
      return defaultPlantVisibleColumns;
    }
  });

  useEffect(() => {
    const username = user?.username || "default";
    let active = true;
    plantColumnPrefsLoadedRef.current = false;
    api(`/api/user-preferences/${encodeURIComponent(username)}/plant_level_amr_columns`)
      .then((data) => {
        if (!active) return;
        const savedColumns = data?.value && typeof data.value === "object" ? data.value : {};
        if (Object.keys(savedColumns).length) {
          setVisiblePlantColumns({ ...defaultPlantVisibleColumns, ...savedColumns });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) plantColumnPrefsLoadedRef.current = true;
      });
    return () => {
      active = false;
    };
  }, [user?.username]);

  useEffect(() => {
    if (!plantColumnPrefsLoadedRef.current) return;
    try {
      window.localStorage.setItem(PLANT_AMR_VISIBLE_COLUMNS_KEY, JSON.stringify(visiblePlantColumns));
    } catch {
      // Ignore storage failures; column choices still work for the current session.
    }
    const username = user?.username || "default";
    api(`/api/user-preferences/${encodeURIComponent(username)}/plant_level_amr_columns`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: visiblePlantColumns }),
    }).catch(() => {});
  }, [visiblePlantColumns, user?.username]);

  useEffect(() => {
    loadPlantLevelProjects();
  }, [project?.id, ongoingRows, monthFilter]);

  async function loadPlantLevelProjects() {
    setError("");
    setMessage("");
    try {
      const dashboard = await api(`/api/plant-level-amr?month=${encodeURIComponent(monthFilter)}`);
      const apiRows = dashboard.projects || [];
      const nextRows = apiRows.length ? apiRows : ongoingFallbackRows;
      applyBackendDashboard(apiRows.length ? dashboard : fallbackDashboard(nextRows, dashboard));
    } catch (err) {
      const fallbackRows = project ? [project] : ongoingFallbackRows;
      const nextSelected = fallbackRows.find((row) => String(row.id) === String(selectedId)) || fallbackRows[0] || null;
      setRows(fallbackRows);
      setSelectedId(nextSelected?.id || "");
      setDetails(nextSelected);
      setDashboardData(fallbackDashboard(fallbackRows));
      setError("");
      setMessage(fallbackRows.length ? "Showing Plant Level AMR projects from Ongoing window." : (err.message || "Unable to load Plant Level AMR projects."));
    }
  }

  useEffect(() => {
    const needsBackendFy = rows.some((row) => (row?.start_date || row?.schedule_start || row?.amr_start_date) && !row?.fy_classification);
    const reloadKey = `${monthFilter}:${rows.length}`;
    if (!needsBackendFy || fyReloadAttemptRef.current === reloadKey) return;
    fyReloadAttemptRef.current = reloadKey;
    loadPlantLevelProjects();
  }, [rows, monthFilter]);

  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monthDateFromLabel = (label) => {
    const match = String(label || "").trim().match(/^([A-Za-z]{3})-(\d{2}|\d{4})$/);
    if (!match) return null;
    const monthIndex = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      .findIndex((month) => month.toLowerCase() === match[1].toLowerCase());
    if (monthIndex < 0) return null;
    const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
    return new Date(year, monthIndex, 1);
  };
  const selectedMonthDate = monthDateFromLabel(monthFilter) || todayOnly;
  const selectedMonthEndDate = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth() + 1, 0);
  const asOnDate = selectedMonthEndDate;
  const isAdmin = String(user?.role || "").trim().toLowerCase() === "admin";
  const plantRows = rows.length ? rows : ((details || project) ? [details || project] : []);
  const countablePlantRows = plantRows.filter((row) => !projectHasChildren(row, plantRows));
  const selectedProject = plantRows.find((row) => String(row.id) === String(selectedId)) || details || project;
  const departmentOptions = Array.from(new Set([
    ...BASE_DEPARTMENT_OPTIONS,
    ...plantRows.map((row) => row?.department).filter(Boolean),
  ])).sort((a, b) => String(a).localeCompare(String(b)));
  const grossValue = (row) => Number(row?.gross_cost_cr || 0) || 0;
  const startDateValue = (row) => row?.start_date || "";
  const finishDateValue = (row) => row?.finish_date || "";
  const expectedFinishValue = (row) => row?.expected_finish_date || row?.finish_date || "";
  const scheduleMonthsValue = (row) => row?.schedule_months || row?.scheduled_month || "";
  const progressValue = (row) => Number(row?.physical_progress_percent || 0) || 0;
  const projectStatus = (row) => row?.status === "Ongoing" ? "On Time" : (row?.status || "On Time");
  const summary = dashboardData?.summary || {};
  const financialYearMonths = dashboardData?.financial_year_months || defaultFinancialYearMonths;
  const reMonths = new Set(dashboardData?.re_months || defaultReMonths);
  const plantColumnOptions = [
    ["project_name", "Project Name"],
    ["department", "Department"],
    ["contractor_name", "Contractor Name"],
    ["at_no", "AT No."],
    ["at_date", "AT Date"],
    ["schedule_months", "Schedule in Months"],
    ["start_date", "Schedule Start"],
    ["finish_date", "Schedule Finish"],
    ["expected_finish_date", "Expected Finish Date"],
    ["completion_date", "Completion Date"],
    ["fy_classification", "FY Start Classification"],
    ["physical_progress_percent", "Physical Progress %"],
    ["status", "Status as on Date"],
    ["delay_days", "Delay Days"],
    ["delay_category", "Delay Category"],
    ["gross_cost_cr", "Gross Cost (Cr)"],
    ["remarks", "Remarks"],
    ["be_cr", "BE (Cr)"],
    ["re_cr", "RE (Cr)"],
    ["monthly_be", "Monthly BE"],
    ["monthly_re", "Monthly RE"],
    ["monthly_actual", "Monthly Actual"],
  ];
  const showPlantColumn = (key) => visiblePlantColumns[key] !== false;
  const visibleMonthlyMetrics = [
    ["be", "monthly_be", "BE"],
    ["re", "monthly_re", "RE"],
    ["actual", "monthly_actual", "Actual"],
  ].filter(([, key]) => showPlantColumn(key));
  const visibleMonthlyMetricsForMonth = (month) => visibleMonthlyMetrics.filter(([metric]) => metric !== "re" || reMonths.has(month));
  const visibleBaseColumnCount = plantColumnOptions.filter(([key]) => !key.startsWith("monthly_") && showPlantColumn(key)).length;
  const visibleMonthlyColumnCount = financialYearMonths.reduce((count, month) => count + visibleMonthlyMetricsForMonth(month).length, 0);
  const plantTableColSpan = 2 + visibleBaseColumnCount + visibleMonthlyColumnCount;
  const edcIdcRow = {
    id: "plant-edc-idc-fixed-row",
    is_fixed_row: true,
    project_name: "EDC & IDC",
    fy_classification: "-",
    fy_classification_color: "neutral",
    status: "-",
    delay_days: "",
    delay_category: "",
    monthly: financialYearMonths.map((month) => ({
      month,
      be: Number(edcIdcMonthly[month]?.be || 0),
      re: Number(edcIdcMonthly[month]?.re || 0),
      actual: Number(edcIdcMonthly[month]?.actual || 0),
    })),
  };
  const monthCapexValue = (row, month, kind) => {
    const record = (row?.monthly || []).find((item) => item.month === month);
    return Number(record?.[kind] || 0);
  };
  const rowFilterValue = (row, key) => {
    if (key === "project_name") return row.project_name || "";
    if (key === "department") return row.department || "";
    if (key === "contractor_name") return row.contractor_name || "";
    if (key === "at_no") return row.at_no || "";
    if (key === "at_date") return formatDate(row.at_date);
    if (key === "schedule_months") return scheduleMonthsValue(row);
    if (key === "start_date") return formatDate(startDateValue(row));
    if (key === "finish_date") return formatDate(finishDateValue(row));
    if (key === "expected_finish_date") return formatDate(expectedFinishValue(row));
    if (key === "completion_date") return formatDate(row.completion_date);
    if (key === "fy_classification") return row.fy_classification || "";
    if (key === "physical_progress_percent") return progressValue(row);
    if (key === "status") return projectStatus(row);
    if (key === "delay_days") return row.delay_days || "";
    if (key === "delay_category") return row.delay_category || "";
    if (key === "gross_cost_cr") return grossValue(row);
    if (key === "remarks") return row.remarks || "";
    if (key === "be_cr") return row.be_cr || 0;
    if (key === "re_cr") return row.re_cr || 0;
    const monthlyMatch = String(key).match(/^(.+)-(be|re|actual)$/) || String(key).match(/^(.+)_(be|re|actual)$/);
    if (monthlyMatch) return monthCapexValue(row, monthlyMatch[1], monthlyMatch[2]);
    return "";
  };
  const uniqueColumnOptions = (key) => Array.from(new Set(plantRows.map((row) => String(rowFilterValue(row, key) ?? "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const columnFilterMatches = (row) => Object.entries(plantColumnFilters).every(([key, value]) => {
    if (!Array.isArray(value) || !value.length) return true;
    return value.includes(String(rowFilterValue(row, key) ?? "").trim());
  });
  const setPlantColumnFilter = (key, values) => setPlantColumnFilters((current) => ({ ...current, [key]: values }));
  const togglePlantColumnFilterValue = (key, value) => setPlantColumnFilters((current) => {
    const selected = new Set(current[key] || []);
    selected.has(value) ? selected.delete(value) : selected.add(value);
    return { ...current, [key]: Array.from(selected) };
  });
  const visibleFilterOptions = (key) => {
    const search = String(plantColumnSearch[key] || "").trim().toLowerCase();
    return uniqueColumnOptions(key).filter((value) => !search || value.toLowerCase().includes(search));
  };
  function openEdcIdcEditor() {
    if (!isAdmin) return setMessage("Only admin can edit EDC & IDC values.");
    const nextDraft = {};
    financialYearMonths.forEach((month) => {
      nextDraft[month] = {
        be: Number(edcIdcMonthly[month]?.be || 0),
        re: Number(edcIdcMonthly[month]?.re || 0),
        actual: Number(edcIdcMonthly[month]?.actual || 0),
      };
    });
    setEdcIdcDraft(nextDraft);
    setEdcIdcEditOpen(true);
  }
  async function saveEdcIdcEditor(event) {
    event?.preventDefault?.();
    if (!isAdmin) return setMessage("Only admin can edit EDC & IDC values.");
    try {
      const latestDashboard = await api("/api/plant-level-amr/edc-idc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthly: financialYearMonths.map((month) => ({
            month,
            be: edcIdcDraft[month]?.be ?? 0,
            re: edcIdcDraft[month]?.re ?? 0,
            actual: edcIdcDraft[month]?.actual ?? 0,
          })),
        }),
      });
      applyBackendDashboard(latestDashboard);
      setEdcIdcEditOpen(false);
      setMessage("EDC & IDC values saved.");
    } catch (err) {
      setMessage(err.message || "Unable to save EDC & IDC values.");
    }
  }
  async function savePlantTableData() {
    try {
      const latestDashboard = await api("/api/plant-level-amr/edc-idc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthly: financialYearMonths.map((month) => ({
            month,
            be: edcIdcMonthly[month]?.be ?? 0,
            re: edcIdcMonthly[month]?.re ?? 0,
            actual: edcIdcMonthly[month]?.actual ?? 0,
          })),
        }),
      });
      applyBackendDashboard(latestDashboard);
      setMessage("Saved. EDC & IDC values are now available to CAPEX.");
    } catch (err) {
      setMessage(err.message || "Unable to save EDC & IDC values.");
    }
  }
  const selectedMonthIndex = Math.max(0, financialYearMonths.indexOf(monthFilter));
  const monthsUpToSelected = financialYearMonths.slice(0, selectedMonthIndex + 1);
  const actualTillLastFyValue = (row) => Number(row?.actual_till_last_fy_cr || row?.capex_till_last_fy_cr || 0) || 0;
  const projectHasRePlan = (row) => (row?.monthly || []).some((item) => reMonths.has(item.month) && Number(item.re || 0) > 0);
  const reEffectiveMonthForRow = (row) => (row?.monthly || []).find((item) => reMonths.has(item.month) && Number(item.re || 0) > 0)?.month || "";
  const sumMonths = (row, months, metric) => months.reduce((total, month) => total + monthCapexValue(row, month, metric), 0);
  const sumProjectMonths = (sourceRows, months, metric) => sourceRows.reduce((total, row) => total + sumMonths(row, months, metric), 0);
  const currentFinancialYearMonths = financialYearMonths;
  const kpiFinancials = plantRows.reduce((totals, row) => {
    const fyBeTotal = sumMonths(row, currentFinancialYearMonths, "be");
    const fyActualTotal = sumMonths(row, currentFinancialYearMonths, "actual");
    const selectedBe = sumMonths(row, monthsUpToSelected, "be");
    const selectedActual = sumMonths(row, monthsUpToSelected, "actual");
    const hasRe = projectHasRePlan(row);
    const reEffectiveMonth = reEffectiveMonthForRow(row);
    const reEffectiveIndex = reEffectiveMonth ? financialYearMonths.indexOf(reEffectiveMonth) : -1;
    const fyMonthsBeforeRe = reEffectiveIndex > 0 ? financialYearMonths.slice(0, reEffectiveIndex) : [];
    const fyMonthsReOnward = hasRe && reEffectiveIndex >= 0 ? financialYearMonths.slice(reEffectiveIndex) : [];
    const selectedMonthsBeforeRe = reEffectiveIndex > 0 ? financialYearMonths.slice(0, Math.min(reEffectiveIndex, selectedMonthIndex + 1)) : [];
    const selectedMonthsReOnward = hasRe && reEffectiveIndex >= 0 && selectedMonthIndex >= reEffectiveIndex
      ? financialYearMonths.slice(reEffectiveIndex, selectedMonthIndex + 1)
      : [];
    const fyReTotal = sumMonths(row, fyMonthsBeforeRe, "actual") + sumMonths(row, fyMonthsReOnward, "re");
    const selectedRe = sumMonths(row, selectedMonthsBeforeRe, "actual") + sumMonths(row, selectedMonthsReOnward, "re");
    totals.cumulativeBe += fyBeTotal;
    totals.cumulativeActual += fyActualTotal;
    totals.asOnBe += selectedBe;
    totals.asOnActual += selectedActual;
    if (hasRe && fyMonthsReOnward.length) {
      totals.hasRe = true;
      totals.cumulativeRe += fyReTotal;
    }
    if (hasRe && selectedMonthsReOnward.length) {
      totals.asOnRe += selectedRe;
    }
    return totals;
  }, { cumulativeBe: 0, cumulativeRe: 0, cumulativeActual: 0, asOnBe: 0, asOnRe: 0, asOnActual: 0, hasRe: false });
  const edcKpiFinancials = financialYearMonths.reduce((totals, month, index) => {
    const be = Number(edcIdcMonthly[month]?.be || 0);
    const re = Number(edcIdcMonthly[month]?.re || 0);
    const actual = Number(edcIdcMonthly[month]?.actual || 0);
    totals.cumulativeBe += be;
    totals.cumulativeRe += re;
    totals.cumulativeActual += actual;
    if (index <= selectedMonthIndex) {
      totals.asOnBe += be;
      totals.asOnRe += re;
      totals.asOnActual += actual;
    }
    return totals;
  }, { cumulativeBe: 0, cumulativeRe: 0, cumulativeActual: 0, asOnBe: 0, asOnRe: 0, asOnActual: 0 });
  kpiFinancials.cumulativeBe += edcKpiFinancials.cumulativeBe;
  kpiFinancials.cumulativeRe += edcKpiFinancials.cumulativeRe;
  kpiFinancials.cumulativeActual += edcKpiFinancials.cumulativeActual;
  kpiFinancials.asOnBe += edcKpiFinancials.asOnBe;
  kpiFinancials.asOnRe += edcKpiFinancials.asOnRe;
  kpiFinancials.asOnActual += edcKpiFinancials.asOnActual;
  const filteredRows = plantRows.filter((row) => (
    (statusFilter === "All" || projectStatus(row) === statusFilter)
    && (departmentFilter === "All" || String(row.department || "") === departmentFilter)
    && columnFilterMatches(row)
  ));
  const sortedRows = plantSort ? [...filteredRows].sort((left, right) => (
    String(rowFilterValue(left, plantSort.key) ?? "").localeCompare(String(rowFilterValue(right, plantSort.key) ?? ""), undefined, { numeric: true })
    * (plantSort.direction === "desc" ? -1 : 1)
  )) : filteredRows;
  const tableRows = statusFilter === "All" ? [...sortedRows, edcIdcRow] : sortedRows;
  const pageCount = Math.max(1, Math.ceil(tableRows.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = tableRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const statusCounts = plantRows.reduce((counts, row) => {
    const status = projectStatus(row);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, { Completed: 0, "Yet to Start": 0, "On Time": 0, "Delay < 1 Yr.": 0, "Delay > 1 Yr.": 0 });
  const statusGrossCost = plantRows.reduce((totals, row) => {
    const status = projectStatus(row);
    totals[status] = (totals[status] || 0) + grossValue(row);
    return totals;
  }, { Completed: 0, "Yet to Start": 0, "On Time": 0, "Delay < 1 Yr.": 0, "Delay > 1 Yr.": 0 });
  const statusPercent = (status) => plantRows.length ? ((statusCounts[status] || 0) / plantRows.length) * 100 : 0;
  const percentText = (value) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const fyClassificationRows = dashboardData?.fy_classification_rows || [];
  const startedDuringFyRow = fyClassificationRows.find((row) => String(row.label || "").toLowerCase().includes("started"));
  const ongoingSinceLastFyRow = fyClassificationRows.find((row) => row.label === "Ongoing Since Last FY");
  const startedDuringFyActiveCount = plantRows.filter((row) => (
    String(row?.fy_classification || "").toLowerCase().includes("started")
    && ["On Time", "Completed", "Delay < 1 Yr.", "Delay > 1 Yr."].includes(projectStatus(row))
  )).length;
  const startedDuringFyActiveGrossCost = plantRows.reduce((total, row) => (
    String(row?.fy_classification || "").toLowerCase().includes("started")
      && ["On Time", "Completed", "Delay < 1 Yr.", "Delay > 1 Yr."].includes(projectStatus(row))
      ? total + grossValue(row)
      : total
  ), 0);
  const totalGrossCost = plantRows.reduce((total, row) => total + grossValue(row), 0);
  const fyClassificationGrossCost = (label) => plantRows.reduce((total, row) => (
    row?.fy_classification === label ? total + grossValue(row) : total
  ), 0);
  const overallProgress = Number(summary.overall_progress_percent || 0);
  const projectCapexSourceRows = plantRows.filter((row) => !row?.is_fixed_row);
  const capexRows = financialYearMonths.map((month) => {
    const be = sumProjectMonths(projectCapexSourceRows, [month], "be");
    const re = sumProjectMonths(projectCapexSourceRows, [month], "re");
    const actual = sumProjectMonths(projectCapexSourceRows, [month], "actual");
    const edcBe = Number(edcIdcMonthly[month]?.be || 0);
    const edcRe = Number(edcIdcMonthly[month]?.re || 0);
    const edcActual = Number(edcIdcMonthly[month]?.actual || 0);
    const plan = re || be;
    const variance = plan - actual;
    return {
      financial_year: month,
      be_cr: be,
      re_cr: re,
      actual_cr: actual,
      edc_be_cr: edcBe,
      edc_re_cr: edcRe,
      edc_actual_cr: edcActual,
      variance_cr: variance,
      variance_percent: plan ? (variance / plan) * 100 : 0,
    };
  });
  const capexTotals = capexRows.reduce((totals, row) => {
    const be = Number(row.be_cr || 0);
    const re = Number(row.re_cr || 0);
    const actual = Number(row.actual_cr || 0);
    const edcBe = Number(row.edc_be_cr || 0);
    const edcRe = Number(row.edc_re_cr || 0);
    const edcActual = Number(row.edc_actual_cr || 0);
    const variance = Number(row.variance_cr || 0);
    totals.be += be;
    totals.re += re;
    totals.actual += actual;
    totals.edcBe += edcBe;
    totals.edcRe += edcRe;
    totals.edcActual += edcActual;
    totals.variance += variance;
    return totals;
  }, { be: 0, re: 0, actual: 0, edcBe: 0, edcRe: 0, edcActual: 0, variance: 0 });
  const totalCapexRow = [
    "Total / FY",
    capexTotals.be,
    capexTotals.re,
    capexTotals.actual,
    capexTotals.edcBe,
    capexTotals.edcRe,
    capexTotals.edcActual,
    capexTotals.variance,
    (capexTotals.re || capexTotals.be) ? `${number((capexTotals.variance / (capexTotals.re || capexTotals.be)) * 100)}%` : "0%",
  ];
  const monthLabelFromDate = (value) => {
    const parsed = parseAppDateValue(value);
    if (!parsed) return "-";
    return `${parsed.toLocaleString("en-US", { month: "short" })}-${String(parsed.getFullYear()).slice(-2)}`;
  };
  const statusSummaryLabels = ["Completed", "Yet to Start", "On Time", "Delay < 1 Yr.", "Delay > 1 Yr."];
  const statusClassName = (status) => String(status || "")
    .toLowerCase()
    .replaceAll("<", "lt")
    .replaceAll(">", "gt")
    .replaceAll(".", "")
    .replaceAll(" ", "-");
  const statusLegendTone = (status) => (
    status === "Completed" || status === "On Time" ? "green" : status === "Yet to Start" || status === "Delay < 1 Yr." ? "amber" : "red"
  );
  const fyClassName = (row) => `fy-classification ${row?.fy_classification_color === "green" ? "started" : row?.fy_classification_color === "neutral" ? "neutral" : "ongoing-last"}`;
  function plantColumnFilterControl(key) {
    if (!showPlantColumn(key)) return null;
    const options = uniqueColumnOptions(key);
    const visibleOptions = visibleFilterOptions(key);
    const selected = plantColumnFilters[key] || [];
    const active = selected.length > 0 || plantSort?.key === key;
    const allVisibleSelected = visibleOptions.length > 0 && visibleOptions.every((value) => selected.includes(value));
    return (
      <th className="plant-filter-cell">
        <details className="plant-excel-filter">
          <summary className={active ? "active" : ""}>Filter</summary>
          <div className="plant-excel-filter-menu">
            <button type="button" onClick={() => setPlantSort({ key, direction: "asc" })}>Sort A to Z</button>
            <button type="button" onClick={() => setPlantSort({ key, direction: "desc" })}>Sort Z to A</button>
            <button type="button" onClick={() => setPlantColumnFilter(key, [])}>Clear Filter</button>
            <input
              value={plantColumnSearch[key] || ""}
              onChange={(event) => setPlantColumnSearch((current) => ({ ...current, [key]: event.target.value }))}
              placeholder="Search"
            />
            <label>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(event) => setPlantColumnFilter(key, event.target.checked ? visibleOptions : [])}
              />
              (Select All)
            </label>
            <div className="plant-excel-filter-options">
              {visibleOptions.map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={selected.includes(value)}
                    onChange={() => togglePlantColumnFilterValue(key, value)}
                  />
                  {value}
                </label>
              ))}
              {!options.length ? <span>No values</span> : null}
            </div>
          </div>
        </details>
      </th>
    );
  }
  function plantColumnStyle(key, fallback = 110) {
    return { width: `${plantColumnWidths[key] || fallback}px`, minWidth: `${plantColumnWidths[key] || fallback}px` };
  }
  function startPlantColumnResize(key, event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = plantColumnWidths[key] || event.currentTarget.parentElement?.offsetWidth || 110;
    const onMove = (moveEvent) => {
      const nextWidth = Math.max(54, Math.min(620, startWidth + moveEvent.clientX - startX));
      setPlantColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  function plantResizableHeader(key, label, fallback = 110, props = {}) {
    return (
      <th {...props} style={plantColumnStyle(key, fallback)}>
        <span dangerouslySetInnerHTML={{ __html: label }} />
        <i className="plant-col-resizer" onMouseDown={(event) => startPlantColumnResize(key, event)} />
      </th>
    );
  }
  function updatePlantRow(rowId, patch) {
    setRows((current) => current.map((row) => String(row.id) === String(rowId) ? { ...row, ...patch } : row));
    if (String(selectedProject?.id) === String(rowId)) {
      setDetails((current) => ({ ...(current || selectedProject), ...patch }));
    }
  }

  function applyBackendDashboard(dashboard) {
    setDashboardData(dashboard);
    const nextRows = dashboard.projects || [];
    setRows(nextRows);
    if (dashboard.edc_idc?.monthly) {
      const nextEdc = {};
      dashboard.edc_idc.monthly.forEach((item) => {
        nextEdc[item.month] = {
          be: Number(item.be || 0),
          re: Number(item.re || 0),
          actual: Number(item.actual || 0),
        };
      });
      setEdcIdcMonthly(nextEdc);
    }
    const nextSelected = nextRows.find((row) => String(row.id) === String(selectedId))
      || nextRows[0]
      || null;
    setSelectedId(nextSelected?.id || "");
    setDetails(nextSelected);
  }

  async function saveMonthlyValue(row, month, metric) {
    if (!row?.id) return setMessage("Select a project first.");
    if (row?.is_fixed_row && !isAdmin) return setMessage("Only admin can edit EDC & IDC values.");
    const current = monthCapexValue(row, month, metric);
    const entered = window.prompt(`${metric.toUpperCase()} for ${month} (Cr)`, String(current || 0));
    if (entered === null) return;
    if (row?.is_fixed_row) {
      try {
        const dashboard = await api("/api/plant-level-amr/edc-idc/monthly", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, metric, value: entered }),
        });
        applyBackendDashboard(dashboard);
        setMessage(`EDC & IDC ${metric.toUpperCase()} saved for ${month}.`);
      } catch (err) {
        setMessage(err.message || "Unable to save EDC & IDC value.");
      }
      return;
    }
    try {
      const dashboard = await api("/api/plant-level-amr/monthly", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: row.id, month, metric, value: entered }),
      });
      applyBackendDashboard(dashboard);
      setMessage(`${metric.toUpperCase()} saved for ${month}.`);
    } catch (err) {
      setMessage(err.message || "Unable to save monthly value.");
    }
  }

  async function savePlantField(row, field, label, currentValue = "") {
    if (!row?.id) return setMessage("Select a project first.");
    const entered = window.prompt(label, String(currentValue ?? ""));
    if (entered === null) return;
    if (field === "remarks" && entered.length > PLANT_AMR_REMARKS_LIMIT) {
      return setMessage(`Remarks cannot exceed ${PLANT_AMR_REMARKS_LIMIT} characters.`);
    }
    try {
      const dashboard = await api("/api/plant-level-amr/project-field", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: row.id, field, value: entered, month: monthFilter }),
      });
      applyBackendDashboard(dashboard);
      setMessage(`${label} updated.`);
    } catch (err) {
      setMessage(err.message || `Unable to update ${label}.`);
    }
  }

  function editableCell(row, field, label, value, display = value) {
    if (row?.is_fixed_row) return <td>{display || "-"}</td>;
    return (
      <td
        className="plant-editable-cell"
        title="Double click row to edit"
        onClick={(event) => {
          event.stopPropagation();
          selectPlantRow(row);
        }}
      >
        {display || "-"}
      </td>
    );
  }

  function plantMonthlyDraftValues(row) {
    const draft = {};
    financialYearMonths.forEach((month) => {
      draft[month] = {
        be: monthCapexValue(row, month, "be"),
        re: monthCapexValue(row, month, "re"),
        actual: monthCapexValue(row, month, "actual"),
      };
    });
    return draft;
  }

  function plantEditValues(row) {
    return {
      id: row?.id || "",
      project_name: row?.project_name || "",
      department: row?.department || "",
      contractor_name: row?.contractor_name || "",
      at_no: row?.at_no || "",
      at_date: formatDate(row?.at_date) || "",
      schedule_months: scheduleMonthsValue(row),
      start_date: formatDate(startDateValue(row)) || "",
      finish_date: formatDate(finishDateValue(row)) || "",
      expected_finish_date: formatDate(expectedFinishValue(row)) || "",
      completion_date: formatDate(row?.completion_date) || "",
      physical_progress_percent: progressValue(row),
      gross_cost_cr: grossValue(row),
      actual_till_last_fy_cr: actualTillLastFyValue(row),
      remarks: row?.remarks || "",
      be_cr: row?.be_cr || 0,
      re_cr: row?.re_cr || 0,
      monthly: plantMonthlyDraftValues(row),
    };
  }

  function selectPlantRow(row, openForm = false) {
    setSelectedId(row.id);
    setDetails(row);
    setPlantEditDraft(plantEditValues(row));
    if (openForm) setPlantEditOpen(true);
  }

  const plantEditFields = [
    ["Project Name", "project_name", "text"],
    ["Department", "department", "select"],
    ["Contractor Name", "contractor_name", "text"],
    ["AT No.", "at_no", "text"],
    ["AT Date", "at_date", "text"],
    ["Schedule in Months", "schedule_months", "readonly"],
    ["Schedule Start", "start_date", "text"],
    ["Schedule Finish", "finish_date", "text"],
    ["Expected Finish Date", "expected_finish_date", "text"],
    ["Completion Date", "completion_date", "text"],
    ["Physical Progress %", "physical_progress_percent", "number"],
    ["Gross Cost (Cr)", "gross_cost_cr", "number"],
    ["Actual Till Last FY (Cr)", "actual_till_last_fy_cr", "number"],
    ["BE (Cr)", "be_cr", "number"],
    ["RE (Cr)", "re_cr", "number"],
    ["Remarks", "remarks", "textarea"],
  ];
  const canEditPlantField = (_field, type) => isAdmin || type !== "readonly";
  function updatePlantEditDraftField(field, value) {
    setPlantEditDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "start_date" || field === "finish_date") {
        next.schedule_months = scheduleMonthsBetween(
          field === "start_date" ? value : next.start_date,
          field === "finish_date" ? value : next.finish_date,
        );
      }
      return next;
    });
  }

  async function submitPlantEditForm(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (plantEditSavingRef.current) return;
    const editProjectId = plantEditDraft.id || selectedProject?.id;
    if (!editProjectId) return setMessage("Select a project first.");
    if (String(plantEditDraft.remarks || "").length > PLANT_AMR_REMARKS_LIMIT) {
      return setMessage(`Remarks cannot exceed ${PLANT_AMR_REMARKS_LIMIT} characters.`);
    }
    plantEditSavingRef.current = true;
    setPlantEditSaving(true);
    setMessage("Saving project fields...");
    try {
      const originalValues = plantEditValues(selectedProject || {});
      const fields = {};
      for (const [, field, type] of plantEditFields) {
        if (!canEditPlantField(field, type)) continue;
        const nextValue = plantEditDraft[field] ?? "";
        const currentValue = originalValues[field] ?? "";
        if (String(nextValue) !== String(currentValue)) fields[field] = nextValue;
      }
      let dashboard = null;
      if (Object.keys(fields).length) {
        dashboard = await api("/api/plant-level-amr/project-fields", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: editProjectId, fields, month: monthFilter }),
        });
      }
      const allowedMonthlyMetrics = ["be", "re", "actual"];
      for (const month of financialYearMonths) {
        for (const metric of allowedMonthlyMetrics) {
          const nextValue = Number(plantEditDraft.monthly?.[month]?.[metric] ?? 0);
          const currentValue = Number(originalValues.monthly?.[month]?.[metric] ?? 0);
          if (nextValue === currentValue) continue;
          dashboard = await api("/api/plant-level-amr/monthly", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project_id: editProjectId,
              month,
              metric,
              value: nextValue,
            }),
          });
        }
      }
      if (dashboard) {
        applyBackendDashboard(dashboard);
      } else {
        await loadPlantLevelProjects();
      }
      setPlantEditOpen(false);
      setMessage("Save Successfully");
    } catch (err) {
      setMessage(err.message || "Unable to update project fields.");
    } finally {
      plantEditSavingRef.current = false;
      setPlantEditSaving(false);
    }
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  const plantTemplateBaseFields = [
    ["Project Name", "project_name"],
    ["AT Date", "at_date"],
    ["AT No.", "at_no"],
    ["Department", "department"],
    ["Contractor Name", "contractor_name"],
    ["Schedule Start", "start_date"],
    ["Schedule Finish", "finish_date"],
    ["Expected Finish", "expected_finish_date"],
    ["Physical Progress", "physical_progress_percent"],
    ["Gross Cost", "gross_cost_cr"],
    ["Actual Till Last FY (Cr.)", "actual_till_last_fy_cr"],
    ["BE(Cr.)", "be_cr"],
    ["Completion Date", "completion_date"],
    ["RE(Cr.)", "re_cr"],
  ];

  function plantTemplateMonthlyFields() {
    return financialYearMonths.flatMap((month) => [
      [`${month} BE`, { month, metric: "be" }],
      [`${month} RE`, { month, metric: "re" }],
      [`${month} Actual`, { month, metric: "actual" }],
    ]);
  }

  function downloadPlantAmrTemplate() {
    const headers = plantTemplateBaseFields.map(([label]) => label);
    const body = plantRows.map((row) => [
      row.project_name,
      formatDate(row.at_date) || "",
      row.at_no || "",
      row.department || "",
      row.contractor_name || "",
      formatDate(startDateValue(row)) || "",
      formatDate(finishDateValue(row)) || "",
      formatDate(expectedFinishValue(row)) || "",
      progressValue(row),
      grossValue(row),
      actualTillLastFyValue(row),
      row.be_cr || 0,
      formatDate(row.completion_date) || "",
      row.re_cr || 0,
    ]);
    const csv = [headers, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plant-level-amr-edit-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Plant Level AMR template downloaded.");
  }

  async function uploadPlantAmrTemplate(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(`Uploading ${file.name}...`);
    try {
      const dashboard = await api("/api/plant-level-amr/upload-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content: await file.text() }),
      });
      applyBackendDashboard(dashboard);
      const result = dashboard.upload_result || {};
      const successMessage = `Upload completed successfully. Updated ${result.updated || 0} project rows${result.skipped ? `, skipped ${result.skipped}` : ""}${result.failed ? `, failed ${result.failed}` : ""}.`;
      setMessage(successMessage);
      window.alert(result.errors?.length ? `${successMessage}\n\nWarnings:\n${result.errors.join("\n")}` : successMessage);
    } catch (err) {
      const failureMessage = `Data upload failed. ${err.message || "Unable to upload Plant Level AMR template."}`;
      setMessage(failureMessage);
      window.alert(failureMessage);
    }
  }

  function plantCurrentViewExportColumns() {
    const baseColumns = plantColumnOptions
      .filter(([key]) => !key.startsWith("monthly_") && showPlantColumn(key))
      .map(([key, label]) => ({
        key,
        label: key === "status" ? `Status as on ${formatDate(asOnDate)}` : label,
        value: (row) => rowFilterValue(row, key),
      }));
    const monthlyColumns = financialYearMonths.flatMap((month) => visibleMonthlyMetricsForMonth(month).map(([metric,, label]) => ({
      key: `${month}_${metric}`,
      label: `${month} ${label}`,
      value: (row) => monthCapexValue(row, month, metric),
    })));
    return [
      { key: "sl_no", label: "Sl No", value: (_row, index) => index + 1 },
      ...baseColumns,
      ...monthlyColumns,
    ];
  }

  function exportPlantAmrCsv() {
    const columns = plantCurrentViewExportColumns();
    const body = tableRows.map((row, index) => columns.map((column) => column.value(row, index)));
    const headers = columns.map((column) => column.label);
    const csv = [headers, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plant-level-amr-${monthFilter}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Plant Level AMR current view export downloaded.");
  }

  async function exportPlantAmrPdf() {
    const columns = plantCurrentViewExportColumns();
    const filterSummary = [
      `Plant: All Plants`,
      `Department: ${departmentFilter}`,
      `Status: ${statusFilter}`,
      `Month: ${monthFilter}`,
      `Data as on: ${formatDate(asOnDate)}`,
      `Rows: ${tableRows.length}`,
    ].join(" | ");
    const payload = {
      title: "Plant Level AMR Projects - Current View",
      subtitle: filterSummary,
      columns: columns.map((column) => column.label),
      rows: tableRows.map((row, index) => columns.map((column) => String(column.value(row, index) ?? ""))),
    };
    const downloadPdfBlob = (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `plant-level-amr-${monthFilter}-current-view.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    };
    try {
      setMessage("Preparing Plant Level AMR PDF current view...");
      const blob = await apiBlob("/api/plant-level-amr/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      downloadPdfBlob(blob);
      setMessage("Plant Level AMR PDF current view downloaded.");
    } catch (err) {
      const fallbackBlob = buildSimplePdfBlob(payload.title, payload.subtitle, payload.columns, payload.rows);
      downloadPdfBlob(fallbackBlob);
      setMessage("Plant Level AMR PDF current view downloaded.");
    }
  }

  function addDraftProject() {
    if (!isAdmin) {
      setMessage("Only admin can add Plant Level AMR projects.");
      return;
    }
    const nextId = `draft-${Date.now()}`;
    const draft = {
      id: nextId,
      unique_id: `DRAFT/${plantRows.length + 1}`,
      project_type: "Plant Level AMR",
      project_name: "New Plant Level AMR Project",
      registration_date: today,
      amr_status: "On Time",
      progress_override: 0,
      stage2_cost: 0,
      fund_heading: "RSP - Capital",
    };
    setRows((current) => [draft, ...current]);
    setSelectedId(nextId);
    setDetails(draft);
    setMessage("Draft project added in this dashboard.");
  }

  function editSelectedProject(rowToEdit = selectedProject) {
    if (!rowToEdit?.id) return setMessage("Select a project first.");
    const name = window.prompt("Project name", rowToEdit.project_name || "");
    if (name === null) return;
    updatePlantRow(rowToEdit.id, { project_name: name.trim() || rowToEdit.project_name });
    setMessage("Project updated in this dashboard.");
  }

  async function deleteSelectedProject() {
    if (!selectedProject?.id) return setMessage("Select a project first.");
    if (selectedProject?.is_fixed_row) return setMessage("EDC & IDC is fixed on this page and cannot be deleted.");
    if (!window.confirm(`Delete "${selectedProject.project_name}" from every window?`)) return;
    try {
      await api(`/api/projects/${selectedProject.id}`, { method: "DELETE" });
      await loadPlantLevelProjects();
      setMessage("Project deleted successfully from every window.");
    } catch (err) {
      setMessage(err.message || "Unable to delete project.");
    }
  }

  function updateCapexPlan() {
    if (!selectedProject?.id) return setMessage("Select a project first.");
    const value = window.prompt("BE (Cr)", String(grossValue(selectedProject) || ""));
    if (value === null) return;
    updatePlantRow(selectedProject.id, { stage2_cost: Number(value) || 0 });
    setMessage("CAPEX plan value updated in this dashboard.");
  }

  useEffect(() => {
    setPage(1);
  }, [statusFilter, departmentFilter, plantColumnFilters, rowsPerPage]);

  return (
    <div className="plant-level-window">
      <div className="plant-amr-topbar">
        <button type="button" className="plant-amr-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <h1>Plant Level AMR Projects</h1>
        <button type="button" className="plant-amr-home" onClick={onHome}><Home size={17} /> Home</button>
      </div>

      <section className="plant-amr-filter-band">
        <label>Plant <b>*</b><select><option>All Plants</option><option>RSP</option></select></label>
        <label>Department<select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option>All</option>{departmentOptions.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All</option><option>Completed</option><option>Yet to Start</option><option>On Time</option><option>Delay &lt; 1 Yr.</option><option>Delay &gt; 1 Yr.</option></select></label>
        <label>Month<select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>{financialYearMonths.map((month) => <option key={month}>{month}</option>)}</select></label>
        <div className="plant-amr-date"><span>Data as on :</span><strong>{formatDate(asOnDate)}</strong></div>
        <div className="plant-amr-export-group">
          <button type="button" className="plant-amr-export" onClick={exportPlantAmrCsv}><Download size={17} /> Export</button>
          <button type="button" className="plant-amr-export" onClick={exportPlantAmrPdf}><FileText size={17} /> PDF</button>
        </div>
      </section>

      {error ? <div className="plant-level-error">{error}</div> : null}
      {message ? <div className="plant-level-note">{message}</div> : null}

      <section className="plant-amr-kpis">
        <div className="plant-amr-kpi plant-amr-kpi-group overview-group">
          <ListChecks size={34} />
          <span>Projects</span>
          <div className="plant-kpi-lines">
            <p><small>Total Projects</small><strong>{countablePlantRows.length} ({number(totalGrossCost)} Cr.)</strong></p>
            <p><small>{startedDuringFyRow?.label || "Started During FY"}</small><strong>{startedDuringFyActiveCount} ({number(startedDuringFyActiveGrossCost)} Cr.)</strong></p>
            <p><small>Ongoing Since Last FY</small><strong>{ongoingSinceLastFyRow?.value || 0} ({number(fyClassificationGrossCost("Ongoing Since Last FY"))} Cr.)</strong></p>
            <p><small>Yet to Start</small><strong>{statusCounts["Yet to Start"] || 0} ({number(statusGrossCost["Yet to Start"] || 0)} Cr.)</strong></p>
          </div>
        </div>
        <div className="plant-amr-kpi plant-amr-kpi-group status-group">
          <CheckCircle size={34} />
          <span>Project Status</span>
          <div className="plant-kpi-lines">
            {["On Time", "Delay < 1 Yr.", "Delay > 1 Yr.", "Completed"].map((status) => (
              <p key={status}><small>{status}</small><strong>{statusCounts[status] || 0} ({number(statusGrossCost[status] || 0)} Cr.)</strong></p>
            ))}
          </div>
        </div>
        <div className="plant-amr-kpi plant-amr-kpi-group cumulative-group">
          <IndianRupee size={34} />
          <span>Cumulative</span>
          <div className="plant-kpi-lines">
            <p><small>BE</small><strong>{number(kpiFinancials.cumulativeBe)}</strong></p>
            <p><small>RE</small><strong>{number(kpiFinancials.cumulativeRe)}</strong></p>
            <p><small>Actual</small><strong>{number(kpiFinancials.cumulativeActual)}</strong></p>
          </div>
        </div>
        <div className="plant-amr-kpi plant-amr-kpi-group current-fy-group">
          <Calculator size={34} />
          <span>As on Date Plan Vs Actual</span>
          <div className="plant-kpi-lines">
            <p><small>BE</small><strong>{number(kpiFinancials.asOnBe)}</strong></p>
            <p><small>RE</small><strong>{number(kpiFinancials.asOnRe)}</strong></p>
            <p><small>Actual</small><strong>{number(kpiFinancials.asOnActual)}</strong></p>
          </div>
        </div>
      </section>

      <div className="plant-amr-dashboard-grid">
        <section className="plant-amr-panel plant-amr-progress-panel">
          <div className="plant-amr-panel-head">
            <h2>Projects List</h2>
            <div>
              <details className="plant-column-picker">
                <summary>Columns</summary>
                <div>
                  {plantColumnOptions.map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={showPlantColumn(key)}
                        onChange={(event) => setVisiblePlantColumns((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </details>
              <button type="button" onClick={downloadPlantAmrTemplate}><Download size={15} /> Download Template</button>
              <button type="button" onClick={() => plantUploadRef.current?.click()}><Upload size={15} /> Upload</button>
              <input ref={plantUploadRef} type="file" accept=".csv,text/csv" className="hidden-input" onChange={uploadPlantAmrTemplate} />
              <button type="button" className="danger" onClick={deleteSelectedProject}><Trash2 size={15} /> Delete</button>
            </div>
          </div>
          <div className="plant-amr-table-wrap">
            <table className="plant-amr-table">
              <thead>
                <tr>
                  {plantResizableHeader("sl_no", "Sl No", 58)}
                  {showPlantColumn("project_name") ? plantResizableHeader("project_name", "Project Name", 330) : null}
                  {showPlantColumn("department") ? plantResizableHeader("department", "Department", 130) : null}
                  {showPlantColumn("contractor_name") ? plantResizableHeader("contractor_name", "Contractor Name", 150) : null}
                  {showPlantColumn("at_no") ? plantResizableHeader("at_no", "AT No.", 90) : null}
                  {showPlantColumn("at_date") ? plantResizableHeader("at_date", "AT Date", 84) : null}
                  {showPlantColumn("schedule_months") ? plantResizableHeader("schedule_months", "Schedule<br />in Months", 92) : null}
                  {showPlantColumn("start_date") ? plantResizableHeader("start_date", "Schedule Start", 96) : null}
                  {showPlantColumn("finish_date") ? plantResizableHeader("finish_date", "Schedule Finish", 96) : null}
                  {showPlantColumn("expected_finish_date") ? plantResizableHeader("expected_finish_date", "Expected Finish Date<br /><small>By Default Finish Date</small>", 116) : null}
                  {showPlantColumn("completion_date") ? plantResizableHeader("completion_date", "Completion Date", 106) : null}
                  {showPlantColumn("fy_classification") ? plantResizableHeader("fy_classification", "Ongoing Since Last FY / Started During FY", 150) : null}
                  {showPlantColumn("physical_progress_percent") ? plantResizableHeader("physical_progress_percent", "Physical Progress %", 96) : null}
                  {showPlantColumn("status") ? plantResizableHeader("status", `Status as on<br />${formatDate(asOnDate)}`, 104) : null}
                  {showPlantColumn("delay_days") ? plantResizableHeader("delay_days", "Delay Days", 74) : null}
                  {showPlantColumn("delay_category") ? plantResizableHeader("delay_category", "Delay Category", 110) : null}
                  {showPlantColumn("gross_cost_cr") ? plantResizableHeader("gross_cost_cr", "Gross Cost (Cr)", 98) : null}
                  {showPlantColumn("remarks") ? plantResizableHeader("remarks", "Remarks", 220) : null}
                  {showPlantColumn("be_cr") ? plantResizableHeader("be_cr", "BE (Cr)", 80) : null}
                  {showPlantColumn("re_cr") ? plantResizableHeader("re_cr", "RE (Cr)", 80) : null}
                  {visibleMonthlyMetrics.length ? financialYearMonths.map((month) => {
                    const monthMetrics = visibleMonthlyMetricsForMonth(month);
                    return monthMetrics.length ? plantResizableHeader(`month_${month}`, month, monthMetrics.length * 76, { key: month, colSpan: monthMetrics.length }) : null;
                  }) : null}
                  {plantResizableHeader("actions", "Actions", 78)}
                </tr>
                <tr>
                  <th className="plant-filter-cell"><button type="button" onClick={() => { setPlantColumnFilters({}); setPlantSort(null); }}>Clear</button></th>
                  {plantColumnFilterControl("project_name")}
                  {plantColumnFilterControl("department")}
                  {plantColumnFilterControl("contractor_name")}
                  {plantColumnFilterControl("at_no")}
                  {plantColumnFilterControl("at_date")}
                  {plantColumnFilterControl("schedule_months")}
                  {plantColumnFilterControl("start_date")}
                  {plantColumnFilterControl("finish_date")}
                  {plantColumnFilterControl("expected_finish_date")}
                  {plantColumnFilterControl("completion_date")}
                  {plantColumnFilterControl("fy_classification")}
                  {plantColumnFilterControl("physical_progress_percent")}
                  {plantColumnFilterControl("status")}
                  {plantColumnFilterControl("delay_days")}
                  {plantColumnFilterControl("delay_category")}
                  {plantColumnFilterControl("gross_cost_cr")}
                  {plantColumnFilterControl("remarks")}
                  {plantColumnFilterControl("be_cr")}
                  {plantColumnFilterControl("re_cr")}
                  {visibleMonthlyMetrics.length ? financialYearMonths.flatMap((month) => visibleMonthlyMetricsForMonth(month).map(([metric,, label]) => (
                    <React.Fragment key={`${month}-${metric}-filter`}>{plantColumnFilterControl(`${month}_${metric}`)}</React.Fragment>
                  ))) : null}
                  <th className="plant-filter-cell" />
                </tr>
                {visibleMonthlyMetrics.length ? (
                  <tr>
                    <th className="plant-month-subhead-spacer" colSpan={1 + visibleBaseColumnCount} />
                    {financialYearMonths.flatMap((month) => visibleMonthlyMetricsForMonth(month).map(([metric,, label]) => (
                      <th key={`${month}-${metric}`}>{label}</th>
                    )))}
                    <th className="plant-month-subhead-spacer" />
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {visibleRows.length ? visibleRows.map((row, index) => {
                  const progress = progressValue(row);
                  const status = projectStatus(row);
                  const gross = grossValue(row);
                  return (
                    <tr
                      key={row.id || index}
                      className={`${String(selectedProject?.id) === String(row.id) ? "selected-row" : ""} ${projectHasChildren(row, plantRows) ? "project-parent-row" : ""}`.trim()}
                      onClick={() => selectPlantRow(row)}
                      onDoubleClick={() => { row.is_fixed_row ? openEdcIdcEditor() : selectPlantRow(row, true); }}
                      title={row.is_fixed_row ? "Double click to edit EDC & IDC values" : "Double click to update project fields"}
                    >
                      <td>{(currentPage - 1) * rowsPerPage + index + 1}</td>
                      {showPlantColumn("project_name") ? editableCell(row, "project_name", "Project Name", row.project_name, <span className="plant-project-name">{row.project_name}</span>) : null}
                      {showPlantColumn("department") ? <td>{row.department || "-"}</td> : null}
                      {showPlantColumn("contractor_name") ? editableCell(row, "contractor_name", "Contractor Name", row.contractor_name) : null}
                      {showPlantColumn("at_no") ? editableCell(row, "at_no", "AT No.", row.at_no) : null}
                      {showPlantColumn("at_date") ? editableCell(row, "at_date", "AT Date", row.at_date, formatDate(row.at_date)) : null}
                      {showPlantColumn("schedule_months") ? editableCell(row, "schedule_months", "Schedule in Months", scheduleMonthsValue(row)) : null}
                      {showPlantColumn("start_date") ? editableCell(row, "start_date", "Schedule Start", startDateValue(row), formatDate(startDateValue(row))) : null}
                      {showPlantColumn("finish_date") ? <td>{formatDate(finishDateValue(row)) || "-"}</td> : null}
                      {showPlantColumn("expected_finish_date") ? editableCell(row, "expected_finish_date", "Expected Finish Date", expectedFinishValue(row), formatDate(expectedFinishValue(row))) : null}
                      {showPlantColumn("completion_date") ? editableCell(row, "completion_date", "Completion Date", row.completion_date, formatDate(row.completion_date)) : null}
                      {showPlantColumn("fy_classification") ? <td><span className={fyClassName(row)}>{row.fy_classification || "-"}</span></td> : null}
                      {showPlantColumn("physical_progress_percent") ? editableCell(row, "physical_progress_percent", "Physical Progress %", progress, <strong>{progress}%</strong>) : null}
                      {showPlantColumn("status") ? <td><span className={`plant-status ${statusClassName(status)}`}>{status}</span></td> : null}
                      {showPlantColumn("delay_days") ? <td>{row.delay_days || "-"}</td> : null}
                      {showPlantColumn("delay_category") ? <td>{row.delay_category || "-"}</td> : null}
                      {showPlantColumn("gross_cost_cr") ? editableCell(row, "gross_cost_cr", "Gross Cost (Cr)", gross, number(gross)) : null}
                      {showPlantColumn("remarks") ? editableCell(row, "remarks", "Remarks", row.remarks) : null}
                      {showPlantColumn("be_cr") ? editableCell(row, "be_cr", "BE (Cr)", row.be_cr || 0, number(row.be_cr || 0)) : null}
                      {showPlantColumn("re_cr") ? editableCell(row, "re_cr", "RE (Cr)", row.re_cr || 0, number(row.re_cr || 0)) : null}
                      {visibleMonthlyMetrics.length ? financialYearMonths.flatMap((month) => visibleMonthlyMetricsForMonth(month).map(([metric]) => (
                        <td
                          key={`${month}-${metric}`}
                          style={plantColumnStyle(`${month}_${metric}`, 76)}
                          className="editable-month-cell"
                          onClick={(event) => { event.stopPropagation(); saveMonthlyValue(row, month, metric); }}
                        >
                          {metric === "actual" && !monthCapexValue(row, month, metric) ? "-" : number(monthCapexValue(row, month, metric))}
                        </td>
                      ))) : null}
                      <td>
                        <button
                          type="button"
                          title={row.is_fixed_row ? "Edit EDC & IDC" : "Refresh"}
                          onClick={(event) => {
                            event.stopPropagation();
                            row.is_fixed_row ? openEdcIdcEditor() : loadPlantLevelProjects();
                          }}
                        >
                          {row.is_fixed_row ? <Pencil size={14} /> : <RefreshCw size={14} />}
                        </button>
                      </td>
                    </tr>
                  );
                }) : <tr><td colSpan={plantTableColSpan} className="empty">No Plant Level AMR projects match the selected filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="plant-amr-table-foot">
            <div><b>Legend (Status):</b><span className="legend green" /> Completed / On Time <span className="legend amber" /> Yet to Start / Delay &lt; 1 Yr. <span className="legend red" /> Delay &gt; 1 Yr.</div>
            <div className="plant-amr-footer-controls">
              <span>Showing {tableRows.length ? (currentPage - 1) * rowsPerPage + 1 : 0} to {Math.min(currentPage * rowsPerPage, tableRows.length)} of {tableRows.length}</span>
              <button type="button" onClick={() => setPage(1)} disabled={currentPage === 1}><ChevronsLeft size={15} /></button>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}><ChevronLeft size={15} /></button>
              <strong>{currentPage}</strong>
              <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount}><ChevronRight size={15} /></button>
              <button type="button" onClick={() => setPage(pageCount)} disabled={currentPage === pageCount}><ChevronsRight size={15} /></button>
              <label>Rows visible:
                <select value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))}>
                  {[7, 10, 20, 30, 40, 50, 60, 70, 80].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="plant-amr-panel plant-capex-panel-wide">
          <h2>CAPEX Planning (Cr)</h2>
          <table className="plant-mini-table"><thead><tr><th>Financial Year</th><th>BE (Cr)</th><th>RE (Cr)</th><th>Actual (Cr)</th><th>EDC/IDC BE</th><th>EDC/IDC RE</th><th>EDC/IDC Actual</th><th>Variance (Cr)</th><th>% Variance</th></tr></thead><tbody>{[...capexRows.map((row) => [row.financial_year, row.be_cr, row.re_cr || 0, row.actual_cr, row.edc_be_cr, row.edc_re_cr, row.edc_actual_cr, row.variance_cr, `${row.variance_percent}%`]), totalCapexRow].map((row) => <tr key={row[0]} className={row[0] === "Total / FY" ? "plant-total-row" : ""}>{row.map((cell, index) => <td key={index}>{index && typeof cell === "number" ? number(cell) : cell}</td>)}</tr>)}</tbody></table>
        </section>

      </div>
      {plantEditOpen ? (
        <div className="plant-edit-backdrop" onMouseDown={() => setPlantEditOpen(false)}>
          <form className="plant-edit-form" onSubmit={submitPlantEditForm} onMouseDown={(event) => event.stopPropagation()} noValidate>
            <div className="plant-edit-head">
              <div>
                <h2>Update Project Fields</h2>
                <p>{plantEditDraft.project_name || selectedProject?.project_name || "Selected project"}</p>
              </div>
              <div className="plant-edit-status-chip">
                <span>As on {formatDate(asOnDate)}</span>
                <b>{projectStatus({ ...selectedProject, ...plantEditDraft })}</b>
              </div>
              <button type="button" onClick={() => setPlantEditOpen(false)}><X size={18} /></button>
            </div>
            <div className="plant-edit-grid">
              {plantEditFields.map(([label, field, type]) => {
                const canEditField = canEditPlantField(field, type);
                const lockTitle = type === "readonly" ? "Auto-calculated by backend" : "Admin only";
                return (
                <label key={field} className={`${type === "textarea" ? "wide" : ""} ${canEditField ? "" : "plant-field-locked"}`.trim()}>
                  <span>{label}</span>
                  {type === "textarea" ? (
                    <textarea
                      className={canEditField ? "" : "plant-locked-input"}
                      maxLength={field === "remarks" ? PLANT_AMR_REMARKS_LIMIT : undefined}
                      value={plantEditDraft[field] ?? ""}
                      readOnly={!canEditField}
                      title={canEditField ? "" : lockTitle}
                      onChange={(event) => setPlantEditDraft((current) => ({
                        ...current,
                        [field]: field === "remarks" ? event.target.value.slice(0, PLANT_AMR_REMARKS_LIMIT) : event.target.value,
                      }))}
                    />
                  ) : type === "readonly" ? (
                    <input
                      className={canEditField ? "" : "plant-autocalculated-input"}
                      type="text"
                      value={plantEditDraft[field] ?? ""}
                      readOnly={!canEditField}
                      title={canEditField ? "" : "Auto-calculated by backend"}
                      onChange={(event) => updatePlantEditDraftField(field, event.target.value)}
                    />
                  ) : type === "select" ? (
                    <select
                      className={canEditField ? "" : "plant-locked-input"}
                      value={plantEditDraft[field] ?? ""}
                      disabled={!canEditField}
                      title={canEditField ? "" : lockTitle}
                      onChange={(event) => setPlantEditDraft((current) => ({ ...current, [field]: event.target.value }))}
                    >
                      <option value="">Select Department</option>
                      {departmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  ) : (
                    <input
                      className={canEditField ? "" : "plant-locked-input"}
                      type={type}
                      value={plantEditDraft[field] ?? ""}
                      placeholder={label.includes("Date") ? "DD-MM-YY" : ""}
                      readOnly={!canEditField}
                      title={canEditField ? "" : lockTitle}
                      onChange={(event) => updatePlantEditDraftField(field, event.target.value)}
                    />
                  )}
                </label>
              );})}
            </div>
            <div className="plant-edit-monthly-section">
              <h3>Monthly BE, RE and Actual values</h3>
              <div className="edc-idc-edit-grid">
                <div className="edc-idc-edit-head">Month</div>
                <div className="edc-idc-edit-head">BE</div>
                <div className="edc-idc-edit-head">RE</div>
                <div className="edc-idc-edit-head">Actual</div>
                {financialYearMonths.map((month) => (
                  <React.Fragment key={month}>
                    <strong>{month}</strong>
                    {["be", "re", "actual"].map((metric) => {
                      const canEditMonthly = true;
                      return (
                        <input
                          key={`${month}-${metric}`}
                          className={canEditMonthly ? "" : "plant-locked-input"}
                          type="number"
                          value={plantEditDraft.monthly?.[month]?.[metric] ?? 0}
                          readOnly={!canEditMonthly}
                          title={canEditMonthly ? "" : "Admin only"}
                          onChange={(event) => setPlantEditDraft((current) => ({
                            ...current,
                            monthly: {
                              ...(current.monthly || {}),
                              [month]: {
                                ...(current.monthly?.[month] || {}),
                                [metric]: event.target.value,
                              },
                            },
                          }))}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div className="plant-edit-actions">
              <span>Double-check date fields before saving; status is calculated automatically.</span>
              <button type="button" onClick={() => setPlantEditOpen(false)} disabled={plantEditSaving}>Cancel</button>
              <button
                type="submit"
                disabled={plantEditSaving}
              >
                <Save size={15} /> {plantEditSaving ? "Saving..." : "Save Fields"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {edcIdcEditOpen ? (
        <div className="plant-edit-backdrop" onMouseDown={() => setEdcIdcEditOpen(false)}>
          <form className="plant-edit-form" onSubmit={saveEdcIdcEditor} onMouseDown={(event) => event.stopPropagation()} noValidate>
            <div className="plant-edit-head">
              <div>
                <h2>Update EDC & IDC</h2>
                <p>Monthly BE, RE and Actual values</p>
              </div>
              <button type="button" onClick={() => setEdcIdcEditOpen(false)}><X size={18} /></button>
            </div>
            <div className="edc-idc-edit-grid">
              <div className="edc-idc-edit-head">Month</div>
              <div className="edc-idc-edit-head">BE</div>
              <div className="edc-idc-edit-head">RE</div>
              <div className="edc-idc-edit-head">Actual</div>
              {financialYearMonths.map((month) => (
                <React.Fragment key={month}>
                  <strong>{month}</strong>
                  {["be", "re", "actual"].map((metric) => (
                    <input
                      key={`${month}-${metric}`}
                      type="number"
                      value={edcIdcDraft[month]?.[metric] ?? 0}
                      onChange={(event) => setEdcIdcDraft((current) => ({
                        ...current,
                        [month]: {
                          ...(current[month] || {}),
                          [metric]: event.target.value,
                        },
                      }))}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
            <div className="plant-edit-actions">
              <span>EDC & IDC is a fixed Plant Level AMR page row.</span>
              <button type="button" onClick={() => setEdcIdcEditOpen(false)}>Cancel</button>
              <button type="submit"><Save size={15} /> Save EDC & IDC</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ProjectsLandingView({ onChanged }) {
  return (
    <div className="projects-window">
      <h1>Projects</h1>
      <div className="projects-instruction">Select a Projects option from the left menu.</div>
    </div>
  );
}

function DailyProgressTable({ columns, rows, records = [], project, entryDate, activityRows = [], manpowerRows = [] }) {
  const [reportMonth, setReportMonth] = useState(() => String(entryDate || localDateInput(0)).slice(0, 7));
  const monthDate = parseAppDateValue(`${reportMonth}-01`) || new Date();
  const monthName = monthDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const dayColumns = Array.from({ length: daysInMonth }, (_, index) => {
    const dateValue = new Date(monthDate.getFullYear(), monthDate.getMonth(), index + 1);
    const iso = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, "0")}-${String(dateValue.getDate()).padStart(2, "0")}`;
    return {
      day: index + 1,
      iso,
      week: dateValue.toLocaleDateString("en-GB", { weekday: "short" }),
      weekend: [0, 6].includes(dateValue.getDay()),
    };
  });
  const activityActualsByDate = Object.fromEntries((rows || []).map((row) => [String(row.date).slice(0, 10), row.values || {}]));
  const activityEntryById = Object.fromEntries((activityRows || []).filter((row) => row.activity_id).map((row) => [String(row.activity_id), row]));
  const manpowerRecordByDate = Object.fromEntries((records || []).map((row) => [String(row.report_date || row.date).slice(0, 10), row]));
  const selectedDateKey = String(entryDate || "").slice(0, 10);
  const manpowerValueFor = (key, dateKey) => {
    if (dateKey === selectedDateKey) {
      if (key === "rsp_executive") return manpowerRows.filter((row) => row.category === "RSP - Executive").reduce((sum, row) => sum + Number(row.today || 0), 0);
      if (key === "rsp_non_executive") return manpowerRows.filter((row) => row.category === "RSP - Non Executive").reduce((sum, row) => sum + Number(row.today || 0), 0);
      if (key === "executing_agency") return manpowerRows.filter((row) => row.category === "Executing Agency").reduce((sum, row) => sum + Number(row.today || 0), 0);
      if (key === "contractor_supervisor") return manpowerRows.filter((row) => row.category === "Contractor" && String(row.trade || "").toLowerCase().includes("supervisor")).reduce((sum, row) => sum + Number(row.today || 0), 0);
      if (key === "contractor_labour") return manpowerRows.filter((row) => row.category === "Contractor" && String(row.trade || "").toLowerCase().includes("labour")).reduce((sum, row) => sum + Number(row.today || 0), 0);
      if (key === "supervisor") return manpowerRows.filter((row) => row.category === "Executing Agency" && String(row.trade || "").toLowerCase().includes("supervisor")).reduce((sum, row) => sum + Number(row.today || 0), 0);
      if (key === "labour_deployed") return manpowerRows.filter((row) => row.category === "Executing Agency" && String(row.trade || "").toLowerCase().includes("labour")).reduce((sum, row) => sum + Number(row.today || 0), 0);
    }
    return Number(manpowerRecordByDate[dateKey]?.[key] || 0);
  };
  const valueForActivity = (column, dateKey) => {
    if (dateKey === selectedDateKey && activityEntryById[String(column.id)]) {
      return Number(activityEntryById[String(column.id)].todayProgress || 0);
    }
    return Number(activityActualsByDate[dateKey]?.[String(column.id)] || 0);
  };
  const manpowerReportRows = [
    { key: "rsp_executive", label: "RSP Exe.", tone: "blue" },
    { key: "rsp_non_executive", label: "RSP Non Executive", tone: "green" },
    { key: "executing_agency", label: "Agency Manpower", tone: "purple" },
    { key: "contractor_supervisor", label: "Contractor Supervisor", tone: "orange" },
    { key: "contractor_labour", label: "Contractor Labour", tone: "red" },
  ];
  return (
    <section className="dpr-report-card dpr-month-report">
      <div className="dpr-report-toolbar">
        <label>
          <span>Month</span>
          <CalendarDays size={16} />
          <input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
        </label>
        <div><span>Project :</span><strong>{project?.project_name || "-"}</strong></div>
        <div><span>Project Code :</span><strong>{project?.unique_id || "-"}</strong></div>
        <div><span>Location :</span><strong>{project?.location || project?.site || "-"}</strong></div>
      </div>
      <div className="dpr-report-scroll">
        <table className="dpr-report-table">
          <thead>
            <tr>
              <th rowSpan="2" className="dpr-report-index">#</th>
              <th rowSpan="2" className="dpr-report-activity">Activity / Work Description</th>
              <th rowSpan="2" className="dpr-report-category">Category</th>
              <th colSpan={dayColumns.length} className="dpr-month-title">{monthName}</th>
              <th rowSpan="2" className="dpr-report-total">Total<br />(Month)</th>
            </tr>
            <tr>
              {dayColumns.map((day) => (
                <th key={day.iso} className={day.weekend ? "weekend" : ""}>
                  <span>{String(day.day).padStart(2, "0")}</span>
                  <small>{day.week}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.length ? columns.map((column, index) => {
              const values = dayColumns.map((day) => valueForActivity(column, day.iso));
              return (
                <tr key={column.id}>
                  <td className="dpr-report-index">{index + 1}</td>
                  <td className="dpr-report-activity"><span>{column.label}</span><ChevronRight size={14} /></td>
                  <td className="dpr-report-category">{column.category || "-"}</td>
                  {dayColumns.map((day, dayIndex) => <td key={day.iso} className={day.weekend ? "weekend-cell" : ""}>{number(values[dayIndex] || 0)}</td>)}
                  <td className="dpr-report-total">{number(values.reduce((sum, value) => sum + Number(value || 0), 0))}</td>
                </tr>
              );
            }) : <tr><td colSpan={dayColumns.length + 4} className="empty">No S-Curve activity progress entries available.</td></tr>}
            <tr className="dpr-manpower-section"><td colSpan={dayColumns.length + 4}>Manpower Category (No. of Persons)</td></tr>
            {manpowerReportRows.map((row) => {
              const values = dayColumns.map((day) => manpowerValueFor(row.key, day.iso));
              return (
                <tr key={row.key} className="dpr-manpower-report-row">
                  <td></td>
                  <td><span className={`dpr-mp-dot ${row.tone}`}>{row.label.slice(0, 1)}</span>{row.label}</td>
                  <td></td>
                  {dayColumns.map((day, index) => <td key={day.iso} className={day.weekend ? "weekend-cell" : ""}>{number(values[index] || 0)}</td>)}
                  <td className="dpr-report-total">{number(values.reduce((sum, value) => sum + Number(value || 0), 0))}</td>
                </tr>
              );
            })}
            <tr className="dpr-grand-total">
              <td colSpan="3">TOTAL (Persons / Day)</td>
              {dayColumns.map((day) => <td key={day.iso}>{number(manpowerReportRows.reduce((sum, row) => sum + manpowerValueFor(row.key, day.iso), 0))}</td>)}
              <td>{number(dayColumns.reduce((sum, day) => sum + manpowerReportRows.reduce((inner, row) => inner + manpowerValueFor(row.key, day.iso), 0), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DprSummaryView({ progress, project, entryDate, onMonthChange, onExport, onExportPdf, onBack, onHome }) {
  const summary = progress.summary || {};
  const totalScope = summary.totals?.scope || 0;
  const summaryRows = summary.summaryRows || [];
  const activityRows = summaryRows.filter((row) => !row.overall);
  const progressSummaryRows = summaryRows.filter((row) => row.source !== "capex");
  const reportDateValue = new Date(`${entryDate}T00:00:00`);
  const summaryAsOfDate = summary.selectedMonthEnd || entryDate;
  const reportMonthLabel = Number.isNaN(reportDateValue.getTime())
    ? ""
    : reportDateValue.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(" ", "-");
  const financialYearShort = (summary.financialYearLabel || "").replace(/^FY\s+20(\d{2})-20(\d{2})$/, "FY-$1-$2");
  const pct = (value) => `${Number(value || 0).toFixed(2)}%`;
  const plainNumber = (value) => {
    const parsed = Number(String(value ?? "").replaceAll(",", "").replace("%", "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const actualValueFor = (row, key) => {
    if (key === "currentFyActual") {
      return plainNumber(row.currentFyActual || 0) || Math.max(0, plainNumber(row.cumulativeActual) - plainNumber(row.lastFyActual));
    }
    return plainNumber(row[key]);
  };
  const summaryBucket = (row) => {
    const parent = String(row.parent || "").toLowerCase();
    const activity = String(row.activity || row.category || "").toLowerCase();
    if (parent.includes("design") || activity.includes("design") || activity.includes("engineering")) return "design";
    if (parent.includes("civil") || activity.includes("civil")) return "civil";
    if (parent.includes("erection") && (activity.includes("steel") || activity.includes("structur"))) return "structural_erection";
    if ((parent.includes("supply") || parent.includes("delivery")) && (activity.includes("steel") || activity.includes("structur"))) return "structural_supply";
    if ((parent.includes("supply") || parent.includes("delivery")) && (activity.includes("electrical") || activity.includes("equipment"))) return "equipment_supply";
    if (parent.includes("erection") && (activity.includes("electrical") || activity.includes("equipment"))) return "equipment_erection";
    return "";
  };
  const weightedRows = (() => {
    const rows = activityRows.filter((row) => row.source !== "capex").map((row) => ({ ...row }));
    const byBucket = Object.fromEntries(rows.map((row) => [summaryBucket(row), row]).filter(([bucket]) => bucket));
    const equipmentSupply = byBucket.equipment_supply;
    const structuralErection = byBucket.structural_erection;
    if (equipmentSupply && structuralErection) {
      const equipmentWeight = plainNumber(equipmentSupply.weightPercent ?? equipmentSupply.weight_percent);
      const structuralErectionWeight = plainNumber(structuralErection.weightPercent ?? structuralErection.weight_percent);
      if (equipmentWeight < structuralErectionWeight) {
        equipmentSupply.weightPercent = structuralErectionWeight;
        structuralErection.weightPercent = equipmentWeight;
      }
    }
    return rows;
  })();
  const weightedOverallFromRows = (key) => weightedRows.reduce((total, row) => {
    const scope = plainNumber(row.scope);
    const rawWeight = plainNumber(row.weightPercent ?? row.weight_percent);
    const weight = rawWeight > 1 ? rawWeight / 100 : rawWeight;
    return scope && weight ? total + (weight * (actualValueFor(row, key) / scope) * 100) : total;
  }, 0);
  const weightedOverallRow = {
    lastFyActualPercent: weightedOverallFromRows("lastFyActual"),
    ftmPlanPercent: weightedOverallFromRows("ftmPlan"),
    ftmActualPercent: weightedOverallFromRows("ftmActual"),
    currentFyPlanPercent: weightedOverallFromRows("currentFyPlan"),
    currentFyActualPercent: weightedOverallFromRows("currentFyActual"),
    cumulativePlanPercent: weightedOverallFromRows("cumulativePlan"),
    cumulativeActualPercent: weightedOverallFromRows("cumulativeActual"),
  };
  const capexRow = activityRows.find((row) => row.source === "capex" || String(row.category || "").toLowerCase().includes("capex")) || {};
  const onTrackRows = activityRows.filter((row) => Number(row.cumulativeActualPercent || 0) >= 90).map((row) => row.category);
  const attentionRows = activityRows.filter((row) => Number(row.cumulativeActualPercent || 0) < Number(row.cumulativePlanPercent || 0)).map((row) => row.category);
  const takeaways = [
    onTrackRows.length ? `${onTrackRows.slice(0, 2).join(" and ")} are on track as per plan.` : "No activity has reached the on-track threshold yet.",
    attentionRows.length ? `${attentionRows.slice(0, 3).join(", ")} require focused attention.` : "Actual progress is aligned with plan across listed activities.",
    `Overall cumulative progress is ${pct(weightedOverallRow.cumulativeActualPercent)} against the plan of ${pct(weightedOverallRow.cumulativePlanPercent)}.`,
  ];
  const kpiCards = [
    { label: "Overall Cumulative Till", value: pct(weightedOverallRow.cumulativeActualPercent), plan: pct(weightedOverallRow.cumulativePlanPercent), icon: ClipboardList, tone: "blue" },
    { label: "Total Capex (In Cr.)", value: number(capexRow.cumulativeActual || 0), plan: `${number(capexRow.cumulativePlan || 0)} Cr.`, icon: IndianRupee, tone: "green" },
  ];
  const fyMatch = (summary.financialYearLabel || "").match(/FY\s+(\d{4})-(\d{4})/);
  const fyStartYear = fyMatch ? Number(fyMatch[1]) : reportDateValue.getFullYear();
  const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const monthIndex = (3 + index) % 12;
    const year = fyStartYear + (monthIndex < 3 ? 1 : 0);
    const date = new Date(year, monthIndex, 1);
    return {
      value: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(" ", "-"),
    };
  });
  const selectedMonth = String(entryDate || "").slice(0, 7);

  function changeSummaryMonth(monthValue) {
    if (!monthValue) return;
    const [year, month] = monthValue.split("-").map(Number);
    const endDate = new Date(year, month, 0);
    const nextDate = `${year}-${String(month).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
    onMonthChange?.(nextDate);
  }

  return (
    <div className="dpr-summary-page dpr-board-page">
      <div className="dpr-board-header">
        <div className="dpr-board-title">
          <h2>Project Till Summary</h2>
          <p>As on {reportMonthLabel || formatDate(entryDate)}</p>
        </div>
        <div className="dpr-summary-nav">
          <label className="dpr-summary-month-select">
            <span>Month</span>
            <select value={selectedMonth} onChange={(event) => changeSummaryMonth(event.target.value)}>
              {monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" className="dpr-back-button" onClick={onBack}><ArrowLeft size={16} /> Back</button>
          <button type="button" onClick={onHome}><Home size={16} /> Home</button>
        </div>
      </div>

      <section className="dpr-board-subbar">
        <strong>{project?.project_name || "Selected Project"}{project?.unique_id ? ` (${project.unique_id})` : ""}</strong>
        <span>{summary.financialYearLabel || ""} | As on <CalendarDays size={15} /> {formatDate(summaryAsOfDate)}</span>
        <div className="dpr-board-actions">
          <button type="button" onClick={onExport}><Download size={15} /> Export Summary</button>
          <button type="button" onClick={onExportPdf}><FileText size={15} /> Export PDF</button>
        </div>
      </section>

      <section className="dpr-board-kpis">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <article className={`dpr-board-kpi ${card.tone}`} key={card.label}>
              <Icon size={48} />
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>( Plan: {card.plan} )</small>
            </article>
          );
        })}
      </section>

      <section className="dpr-board-grid">
        <article className="dpr-board-panel dpr-board-table-panel">
          <h3>Project Progress Summary ( Quantity & % )</h3>
          <div className="dpr-progress-scroll">
          <table className="dpr-progress-table dpr-board-table">
            <thead>
              <tr>
                <th rowSpan="2" className="activity">Activity / Work Package</th>
                <th rowSpan="2">Scope</th>
                <th rowSpan="2">UOM</th>
                <th rowSpan="2" className="till">Actual Till Last Financial Year</th>
                <th colSpan="2" className="ftm">For the Month - {reportMonthLabel || ""}</th>
                <th colSpan="2" className="fy">{financialYearShort || "Current FY"}</th>
                <th colSpan="2" className="cum">Cumulative Till Date</th>
              </tr>
              <tr>
                <th className="ftm">Plan</th>
                <th className="ftm">Actual</th>
                <th className="fy">Plan</th>
                <th className="fy">Actual</th>
                <th className="cum">Plan</th>
                <th className="cum">Actual</th>
              </tr>
            </thead>
            <tbody>
              {progressSummaryRows.length ? progressSummaryRows.map((row) => (
                row.overall ? (
                  <tr key="overall" className="overall">
                    <td className="activity">Overall Progress</td>
                    <td className="scope-cell">{row.overall && !totalScope ? "100%" : "100%"}</td>
                    <td className="uom-cell">%</td>
                    <td className="till-cell">{pct(weightedOverallRow.lastFyActualPercent)}</td>
                    <td className="ftm-cell">{pct(weightedOverallRow.ftmPlanPercent)}</td>
                    <td className="ftm-actual-cell">{pct(weightedOverallRow.ftmActualPercent)}</td>
                    <td className="fy-cell">{pct(weightedOverallRow.currentFyPlanPercent)}</td>
                    <td className="fy-actual-cell">{pct(weightedOverallRow.currentFyActualPercent)}</td>
                    <td className="cum-cell">{pct(weightedOverallRow.cumulativePlanPercent)}</td>
                    <td className="cum-cell">{pct(weightedOverallRow.cumulativeActualPercent)}</td>
                  </tr>
                ) : (
                  <React.Fragment key={row.id || row.category}>
                    {(() => {
                      const activityName = row.activity || row.category;
                      const currentFyActual = Number(row.currentFyActual || 0) || Math.max(0, Number(row.cumulativeActual || 0) - Number(row.lastFyActual || 0));
                      const currentFyActualPercent = Number(row.currentFyActualPercent || 0) || (Number(row.scope || 0) ? (currentFyActual / Number(row.scope || 0)) * 100 : 0);
                      const ftmActual = Number(row.ftmActual || 0);
                      const ftmActualPercent = Number(row.ftmActualPercent || 0) || (Number(row.scope || 0) ? (ftmActual / Number(row.scope || 0)) * 100 : 0);
                      return (
                      <>
                    <tr className={row.source === "capex" ? "capex-summary-row" : ""}>
                      <td className="activity" rowSpan="2">{activityName}</td>
                      <td className="scope-cell" rowSpan="2">{number(row.scope)}</td>
                      <td className="uom-cell">{row.uom || "-"}</td>
                      <td className="till-cell">{number(row.lastFyActual)}</td>
                      <td className="ftm-cell">{number(row.ftmPlan)}</td>
                      <td className="ftm-actual-cell">{number(ftmActual)}</td>
                      <td className="fy-cell">{number(row.currentFyPlan)}</td>
                      <td className="fy-actual-cell">{number(currentFyActual)}</td>
                      <td className="cum-cell">{number(row.cumulativePlan)}</td>
                      <td className="cum-cell">{number(row.cumulativeActual)}</td>
                    </tr>
                    <tr className={`percent-row ${row.source === "capex" ? "capex-summary-row" : ""}`}>
                      <td className="uom-cell">%</td>
                      <td className="till-cell">{pct(row.lastFyActualPercent)}</td>
                      <td className="ftm-cell">{pct(row.ftmPlanPercent)}</td>
                      <td className="ftm-actual-cell">{pct(ftmActualPercent)}</td>
                      <td className="fy-cell">{pct(row.currentFyPlanPercent)}</td>
                      <td className="fy-actual-cell">{pct(currentFyActualPercent)}</td>
                      <td className="cum-cell">{pct(row.cumulativePlanPercent)}</td>
                      <td className="cum-cell">{pct(row.cumulativeActualPercent)}</td>
                    </tr>
                      </>
                      );
                    })()}
                  </React.Fragment>
                )
              )) : <tr><td colSpan="10" className="empty">No S-Curve summary available.</td></tr>}
            </tbody>
            </table>
          </div>
        </article>
        {capexRow?.source === "capex" ? (
          <article className="dpr-board-panel dpr-board-table-panel dpr-capex-table-panel">
            <h3>CAPEX SUMMARY ( Cr. & % )</h3>
            <div className="dpr-progress-scroll dpr-capex-scroll">
              <table className="dpr-progress-table dpr-board-table dpr-capex-only-table">
                <thead>
                  <tr>
                    <th rowSpan="2" className="activity">Activity / Work Package</th>
                    <th rowSpan="2">Scope</th>
                    <th rowSpan="2">UOM</th>
                    <th rowSpan="2" className="till">Actual Till Last Financial Year</th>
                    <th colSpan="2" className="ftm">For the Month - {reportMonthLabel || ""}</th>
                    <th colSpan="2" className="fy">{financialYearShort || "Current FY"}</th>
                    <th colSpan="2" className="cum">Cumulative Till Date</th>
                  </tr>
                  <tr>
                    <th className="ftm">Plan</th>
                    <th className="ftm">Actual</th>
                    <th className="fy">Plan</th>
                    <th className="fy">Actual</th>
                    <th className="cum">Plan</th>
                    <th className="cum">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    return (
                      <>
                        <tr className="dpr-capex-summary-row">
                          <td className="activity" rowSpan="2">Capex ( In Cr.)</td>
                          <td className="scope-cell" rowSpan="2">{number2(capexRow.scope)}</td>
                          <td className="uom-cell">{capexRow.uom || "Cr."}</td>
                          <td className="till-cell">{number2(capexRow.lastFyActual)}</td>
                          <td className="ftm-cell">{number2(capexRow.ftmPlan)}</td>
                          <td className="ftm-actual-cell">{number2(capexRow.ftmActual)}</td>
                          <td className="fy-cell">{number2(capexRow.currentFyPlan)}</td>
                          <td className="fy-actual-cell">{number2(capexRow.currentFyActual)}</td>
                          <td className="cum-cell">{number2(capexRow.cumulativePlan)}</td>
                          <td className="cum-cell">{number2(capexRow.cumulativeActual)}</td>
                        </tr>
                        <tr className="percent-row dpr-capex-summary-row">
                          <td className="uom-cell">%</td>
                          <td className="till-cell">{pct(capexRow.lastFyActualPercent)}</td>
                          <td className="ftm-cell">{pct(capexRow.ftmPlanPercent)}</td>
                          <td className="ftm-actual-cell">{pct(capexRow.ftmActualPercent)}</td>
                          <td className="fy-cell">{pct(capexRow.currentFyPlanPercent)}</td>
                          <td className="fy-actual-cell">{pct(capexRow.currentFyActualPercent)}</td>
                          <td className="cum-cell">{pct(capexRow.cumulativePlanPercent)}</td>
                          <td className="cum-cell">{pct(capexRow.cumulativeActualPercent)}</td>
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </article>
        ) : null}
      </section>

      <section className="dpr-board-takeaways">
        <h3>Key Takeaways</h3>
        <div>
          {takeaways.map((item) => <p key={item}>• {item}</p>)}
        </div>
      </section>
    </div>
  );
}

function ScopeOverview({ rows }) {
  return (
    <section className="panel">
      <h2>PROJECT SCOPE OVERVIEW</h2>
      <DataTable
        columns={[
          { key: "category", label: "Category" },
          { key: "scope", label: "Scope", render: (row) => number(row.scope) },
          { key: "uom", label: "UOM" },
          { key: "ftmPlan", label: "FTM Plan", render: (row) => number(row.ftmPlan) },
          { key: "ftmActual", label: "FTM Actual", render: (row) => number(row.ftmActual) },
          { key: "cumulativePlan", label: "Cum. Plan", render: (row) => number(row.cumulativePlan) },
          { key: "cumulativeActual", label: "Cum. Actual", render: (row) => number(row.cumulativeActual) },
        ]}
        rows={rows}
        empty="No S-Curve activity scope available."
      />
    </section>
  );
}

function PerformanceSnapshot({ plannedPercent, actualPercent }) {
  const actualWidth = `${Math.min(Math.max(actualPercent, 0), 100)}%`;
  return (
    <section className="panel">
      <h2>CUMULATIVE PERFORMANCE SNAPSHOT</h2>
      <div className="metrics">
        <div className="metric planned"><span>PLANNED PROGRESS</span><strong>{plannedPercent.toFixed(2)}%</strong></div>
        <div className="metric actual"><span>ACTUAL PROGRESS</span><strong>{actualPercent.toFixed(2)}%</strong></div>
      </div>
      <div className="rate">
        <b>EXECUTION PROGRESS RATE</b>
        <div className="bar"><div style={{ width: actualWidth }}>{actualPercent.toFixed(1)}% ACTUAL</div></div>
      </div>
    </section>
  );
}

function localDateInput(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DailyProgressEntryView({
  progress,
  project,
  user,
  entryDate,
  setEntryDate,
  selectedPlanName,
  setSelectedPlanName,
  onSaved,
  ongoingProjects = [],
  onProjectChange,
  onBack,
  onHome,
  onWindowMenuEnter,
  onWindowMenuLeave,
}) {
  const [activeDprTab, setActiveDprTab] = useState("entry");
  const isAdmin = String(user?.role || "").trim().toLowerCase() === "admin"
    || String(user?.username || "").trim().toLowerCase() === "admin";
  const backdateDays = Number(progress.dateWindow?.backdateDays ?? 3);
  const maxEntryDate = isAdmin ? "" : (progress.dateWindow?.maxDate || localDateInput(0));
  const minEntryDate = isAdmin ? "" : (progress.dateWindow?.minDate || localDateInput(-backdateDays));
  const [department, setDepartment] = useState("All");
  const [activityRows, setActivityRows] = useState([]);
  const [manpowerRows, setManpowerRows] = useState([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [savingActuals, setSavingActuals] = useState(false);
  const [activityActualCard, setActivityActualCard] = useState(null);
  const [monthlyActualRows, setMonthlyActualRows] = useState([]);
  const [monthlyActualMessage, setMonthlyActualMessage] = useState("");
  const [monthlyActualLoading, setMonthlyActualLoading] = useState(false);
  const [monthlyActualSaving, setMonthlyActualSaving] = useState(false);
  const projectContext = progress.projectContext || {};
  const contextProjectOptions = projectContext.projectOptions?.length ? projectContext.projectOptions : ongoingProjects;
  const projectTypeOptions = projectContext.projectTypes?.length
    ? projectContext.projectTypes.map((type) => type.value)
    : ["Corporate AMR", "Plant Level AMR"];
  const [selectedProjectType, setSelectedProjectType] = useState(projectContext.selectedProjectType || project?.project_type || "Corporate AMR");
  const selectedProjectOption = (contextProjectOptions || []).find((row) => Number(row.id) === Number(project?.id));
  const availablePlanNames = Array.isArray(selectedProjectOption?.planNames)
    ? selectedProjectOption.planNames
    : String(selectedProjectOption?.planNames || "").split(",").map((name) => name.trim()).filter(Boolean);
  const entryAllowed = Boolean(progress.entryAllowed ?? progress.hasCompletedPlanning);
  const entryStatusMessage = progress.entryStatus?.message || `Confirm S-Curve planning for ${progress.financialYear || "the selected financial year"} before Daily Progress entry.`;

  const filteredDprProjects = useMemo(
    () => (contextProjectOptions || []).filter((row) => (
      String(row.project_type || "").trim() === selectedProjectType
    )),
    [contextProjectOptions, selectedProjectType],
  );

  useEffect(() => {
    setActivityRows(progress.entryRows || []);
    setManpowerRows(progress.manpowerRows || []);
  }, [progress]);

  useEffect(() => {
    setSelectedProjectType(projectContext.selectedProjectType || project?.project_type || "Corporate AMR");
  }, [project?.id, project?.project_type, projectContext.selectedProjectType]);

  useEffect(() => {
    if (!isAdmin && minEntryDate && entryDate < minEntryDate) setEntryDate(minEntryDate);
    if (!isAdmin && maxEntryDate && entryDate > maxEntryDate) setEntryDate(maxEntryDate);
  }, [entryDate, minEntryDate, maxEntryDate, setEntryDate]);

  useEffect(() => {
    if (!selectedPlanName && progress.planName) setSelectedPlanName?.(progress.planName);
  }, [progress.planName, selectedPlanName, setSelectedPlanName]);

  function handleProjectTypeChange(nextType) {
    setSelectedProjectType(nextType);
    const firstProject = (contextProjectOptions || []).find((row) => (
      String(row.project_type || "").trim() === nextType
    ));
    if (firstProject?.id) onProjectChange?.(firstProject.id);
  }

  function dprProjectOptionLabel(row) {
    const planNames = Array.isArray(row.planNames)
      ? row.planNames
      : String(row.planNames || "").split(",").map((name) => name.trim()).filter(Boolean);
    const planText = row.activePlanName
      ? ` | Active Plan: ${row.activePlanName}`
      : (planNames.length ? ` | Plans: ${planNames.join(", ")}` : " | No S-Curve plan");
    return `${row.unique_id ? `${row.unique_id} - ` : ""}${row.project_name}${planText}`;
  }

  function handleProjectChange(projectId) {
    if (projectId) onProjectChange?.(Number(projectId));
  }

  function updateActivity(index, key, value) {
    if (!entryAllowed) return;
    if (["scope", "unit", "monthTarget"].includes(key)) return;
    setActivityRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  }

  function activityActual(row) {
    if (Object.prototype.hasOwnProperty.call(row, "actualsTillLastFy") || Object.prototype.hasOwnProperty.call(row, "currentFyBaseActual")) {
      return number(Number(row.actualsTillLastFy || 0) + Number(row.currentFyBaseActual || 0) + Number(row.todayProgress || 0));
    }
    return number(Number(row.baseActual || 0) + Number(row.todayProgress || 0));
  }

  async function openActivityActualCard(row) {
    if (!isAdmin || !row?.activity_id || !project?.id) return;
    setActivityActualCard({ ...row, loading: true });
    setMonthlyActualRows([]);
    setMonthlyActualMessage("");
    setMonthlyActualLoading(true);
    try {
      const params = new URLSearchParams({
        activity_id: row.activity_id,
        as_of: entryDate,
        plan_name: selectedPlanName || progress.planName || "",
        requested_by_role: user?.role || "",
      });
      const payload = await api(`/api/projects/${project.id}/daily-progress/activity-actuals?${params.toString()}`);
      setActivityActualCard({ ...row, ...payload, loading: false });
      setMonthlyActualRows(payload.rows || []);
    } catch (error) {
      setActivityActualCard({ ...row, loading: false });
      setMonthlyActualMessage(error.message || "Unable to load monthly actuals.");
    } finally {
      setMonthlyActualLoading(false);
    }
  }

  function updateMonthlyActual(index, key, value) {
    setMonthlyActualRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  }

  async function saveMonthlyActuals() {
    if (!activityActualCard?.activityId && !activityActualCard?.activity_id) return;
    setMonthlyActualSaving(true);
    setMonthlyActualMessage("");
    try {
      await api(`/api/projects/${project.id}/daily-progress/activity-actuals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_id: activityActualCard.activityId || activityActualCard.activity_id,
          plan_name: selectedPlanName || progress.planName || "",
          as_of: entryDate,
          requested_by_role: user?.role || "",
          rows: monthlyActualRows.map((row) => ({
            month: row.month,
            actual_qty: row.actualQty || 0,
            remark: row.remark || "",
          })),
        }),
      });
      setMonthlyActualMessage("Monthly actuals saved.");
      await onSaved?.();
    } catch (error) {
      setMonthlyActualMessage(error.message || "Unable to save monthly actuals.");
    } finally {
      setMonthlyActualSaving(false);
    }
  }

  function updateManpower(id, key, value) {
    if (!entryAllowed) return;
    if (key === "category" && value === "Contractor") {
      const contractorName = window.prompt("Enter contractor name");
      if (!contractorName?.trim()) return;
      const groupId = Date.now();
      setManpowerRows((rows) => {
        const nextRows = [];
        rows.forEach((row) => {
          if (row.id !== id) {
            nextRows.push(row);
            return;
          }
          nextRows.push(
            { ...row, id: `${groupId}-supervisor`, contractorGroupId: groupId, category: "Contractor", contractorName: contractorName.trim(), trade: "Supervisor", lastMonth: row.lastMonth || "0", today: row.today || "0", remarks: row.remarks || "" },
            { id: `${groupId}-labour`, contractorGroupId: groupId, category: "Contractor", contractorName: contractorName.trim(), trade: "Labour", designation: "", scope: "", unit: "", lastMonth: "0", today: "0", remarks: "" },
          );
        });
        return nextRows;
      });
      return;
    }
    if (key === "contractorName") {
      setManpowerRows((rows) => {
        const target = rows.find((row) => row.id === id);
        if (target?.category !== "Contractor") return rows;
        const groupKey = contractorPairKey(target);
        return rows.map((row) => (
          row.category === "Contractor" && contractorPairKey(row) === groupKey
            ? { ...row, contractorName: value }
            : row
        ));
      });
      return;
    }
    setManpowerRows((rows) => rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function resetDailyProgressEntry() {
    if (!entryAllowed) return;
    setActivityRows((rows) => rows.map((row) => ({ ...row, todayProgress: "0", area: "" })));
    setManpowerRows((rows) => rows.map((row) => ({ ...row, today: "0", remarks: "" })));
    setSaveMessage("Editable fields cleared. Imported S-Curve data remains locked.");
  }

  function addManpowerRow() {
    if (!entryAllowed) return;
    const contractorName = window.prompt("Enter contractor name");
    if (!contractorName?.trim()) return;
    const groupId = Date.now();
    setManpowerRows((rows) => [
      ...rows,
      { id: `${groupId}-supervisor`, contractorGroupId: groupId, category: "Contractor", contractorName: contractorName.trim(), trade: "Supervisor", designation: "", scope: "", unit: "", lastMonth: "0", today: "0", remarks: "" },
      { id: `${groupId}-labour`, contractorGroupId: groupId, category: "Contractor", contractorName: contractorName.trim(), trade: "Labour", designation: "", scope: "", unit: "", lastMonth: "0", today: "0", remarks: "" },
    ]);
  }

  function deleteManpowerRow(id) {
    if (!entryAllowed) return;
    setManpowerRows((rows) => {
      const target = rows.find((row) => row.id === id);
      if (target?.category === "Contractor") {
        const key = target.contractorGroupId || `${target.contractorName || ""}`;
        return rows.filter((row) => row.category !== "Contractor" || (row.contractorGroupId || `${row.contractorName || ""}`) !== key);
      }
      return rows.filter((row) => row.id !== id);
    });
  }

  function exportDailyProgress() {
    const activityHeader = ["Parent", "Activity", "Scope", "Unit", "Month Target", "Actual Achieved", "Today Progress", "Area of Work"];
    const manpowerHeader = ["Category", "Contractor", "Type", "Last Month Average", entryDateLabel, "Remarks"];
    const csvRows = [
      ["Daily Progress Report", entryDate],
      [],
      activityHeader,
      ...activityRows.map((row) => [row.parent, row.activity, row.scope, row.unit, row.monthTarget, activityActual(row), row.todayProgress, row.area]),
      [],
      ["Manpower Entry"],
      manpowerHeader,
      ...manpowerRows.map((row) => [row.category, row.contractorName || "", row.trade || "", row.lastMonth, row.today, row.remarks]),
    ];
    const csv = csvRows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-progress-${entryDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportDprSummary() {
    const header = [
      "Activity / Work Package",
      "Scope",
      "UOM",
      "Actual Till Last FY",
      "Month Plan",
      "Month Actual",
      "Financial Year Plan",
      "Financial Year Actual",
      "Cumulative Plan",
      "Cumulative Actual",
    ];
    const summaryExportRows = progress.summary?.summaryRows || [];
    const exportSummaryBucket = (row) => {
      const parent = String(row.parent || "").toLowerCase();
      const activity = String(row.activity || row.category || "").toLowerCase();
      if (parent.includes("design") || activity.includes("design") || activity.includes("engineering")) return "design";
      if (parent.includes("civil") || activity.includes("civil")) return "civil";
      if (parent.includes("erection") && (activity.includes("steel") || activity.includes("structur"))) return "structural_erection";
      if ((parent.includes("supply") || parent.includes("delivery")) && (activity.includes("steel") || activity.includes("structur"))) return "structural_supply";
      if ((parent.includes("supply") || parent.includes("delivery")) && (activity.includes("electrical") || activity.includes("equipment"))) return "equipment_supply";
      if (parent.includes("erection") && (activity.includes("electrical") || activity.includes("equipment"))) return "equipment_erection";
      return "";
    };
    const activitySummaryRows = summaryExportRows.filter((row) => !row.overall && row.source !== "capex").map((row) => ({ ...row }));
    const exportByBucket = Object.fromEntries(activitySummaryRows.map((row) => [exportSummaryBucket(row), row]).filter(([bucket]) => bucket));
    if (exportByBucket.equipment_supply && exportByBucket.structural_erection) {
      const equipmentWeight = Number(exportByBucket.equipment_supply.weightPercent || 0);
      const structuralErectionWeight = Number(exportByBucket.structural_erection.weightPercent || 0);
      if (equipmentWeight < structuralErectionWeight) {
        exportByBucket.equipment_supply.weightPercent = structuralErectionWeight;
        exportByBucket.structural_erection.weightPercent = equipmentWeight;
      }
    }
    const parseSummaryNumber = (value) => {
      const parsed = Number(String(value ?? "").replaceAll(",", "").replace("%", "").trim());
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const activitySummaryValue = (row, key) => {
      if (key === "currentFyActual") {
        return parseSummaryNumber(row.currentFyActual || 0) || Math.max(0, parseSummaryNumber(row.cumulativeActual) - parseSummaryNumber(row.lastFyActual));
      }
      return parseSummaryNumber(row[key]);
    };
    const weightedExportPercent = (key) => activitySummaryRows.reduce((total, row) => {
      const scope = parseSummaryNumber(row.scope);
      const rawWeight = parseSummaryNumber(row.weightPercent ?? row.weight_percent);
      const weight = rawWeight > 1 ? rawWeight / 100 : rawWeight;
      return scope && weight ? total + (weight * (activitySummaryValue(row, key) / scope) * 100) : total;
    }, 0);
    const rows = summaryExportRows.flatMap((row) => {
      if (row.overall) {
        return [[
          "Overall Progress",
          "100%",
          "%",
          weightedExportPercent("lastFyActual").toFixed(2),
          weightedExportPercent("ftmPlan").toFixed(2),
          weightedExportPercent("ftmActual").toFixed(2),
          weightedExportPercent("currentFyPlan").toFixed(2),
          weightedExportPercent("currentFyActual").toFixed(2),
          weightedExportPercent("cumulativePlan").toFixed(2),
          weightedExportPercent("cumulativeActual").toFixed(2),
        ]];
      }
      return [
        [
          row.category,
          row.scope,
          row.uom,
          row.lastFyActual,
          row.ftmPlan,
          row.ftmActual,
          row.currentFyPlan,
          row.currentFyActual,
          row.cumulativePlan,
          row.cumulativeActual,
        ],
        [
          row.category,
          row.scope,
          "%",
          Number(row.lastFyActualPercent || 0).toFixed(2),
          Number(row.ftmPlanPercent || 0).toFixed(2),
          Number(row.ftmActualPercent || 0).toFixed(2),
          Number(row.currentFyPlanPercent || 0).toFixed(2),
          Number(row.currentFyActualPercent || 0).toFixed(2),
          Number(row.cumulativePlanPercent || 0).toFixed(2),
          Number(row.cumulativeActualPercent || 0).toFixed(2),
        ],
      ];
    });
    const csvRows = [
      ["DPR Summary", project?.project_name || "", entryDate],
      [],
      header,
      ...rows,
    ];
    const csv = csvRows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dpr-summary-${entryDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportDprSummaryPdf() {
    const source = document.querySelector(".dpr-summary-page");
    if (!source) return;
    const printWindow = window.open("", "_blank", "width=1400,height=900");
    if (!printWindow) {
      window.print();
      return;
    }
    const styles = Array.from(document.querySelectorAll("link[rel='stylesheet'], style"))
      .map((node) => node.outerHTML)
      .join("\n");
    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>DPR Summary ${entryDate}</title>
          ${styles}
          <style>
            @page { size: A4 landscape; margin: 6mm; }
            html, body { margin: 0; background: #eef5fd; width: 285mm; min-height: 198mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .dpr-summary-page {
              width: 100% !important;
              min-height: 198mm !important;
              padding: 0 !important;
              border: 0 !important;
              box-shadow: none !important;
              box-sizing: border-box !important;
              overflow: visible !important;
            }
            .dpr-board-header { min-height: 38px !important; padding: 0 8px !important; }
            .dpr-board-header h2 { font-size: 20px !important; margin: 0 !important; letter-spacing: 0 !important; }
            .dpr-board-header p { font-size: 10px !important; margin: 0 !important; }
            .dpr-board-subbar { min-height: 24px !important; padding: 3px 8px !important; font-size: 9px !important; }
            .dpr-summary-nav button, .dpr-board-subbar button { display: none !important; }
            .dpr-board-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 5px !important; margin: 5px 0 !important; }
            .dpr-board-kpi { min-height: 48px !important; padding: 5px 8px !important; gap: 6px !important; }
            .dpr-board-kpi svg { width: 24px !important; height: 24px !important; }
            .dpr-board-kpi span, .dpr-board-kpi small { font-size: 8px !important; }
            .dpr-board-kpi strong { font-size: 13px !important; }
            .dpr-board-grid { gap: 4px !important; }
            .dpr-board-panel h3 { min-height: 21px !important; padding: 4px 8px !important; font-size: 9px !important; }
            .dpr-progress-scroll { overflow: visible !important; max-height: none !important; }
            .dpr-board-panel, .dpr-board-takeaways { break-inside: avoid; }
            .dpr-progress-table { min-width: 0 !important; width: 100% !important; font-size: 9.4px !important; }
            .dpr-progress-table th, .dpr-progress-table td { padding: 3px 5px !important; font-size: 9.2px !important; line-height: 1.1 !important; }
            .dpr-progress-table .activity { width: 155px !important; }
            .dpr-capex-table-panel { margin-top: 4px !important; }
            .dpr-board-takeaways { margin-top: 4px !important; padding: 5px 10px !important; }
            .dpr-board-takeaways h3 { font-size: 10px !important; margin-bottom: 3px !important; }
            .dpr-board-takeaways p { font-size: 8.5px !important; line-height: 1.2 !important; }
          </style>
        </head>
        <body>${source.outerHTML}</body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 650);
  }

  async function savePhysicalProgressActuals() {
    if (!project?.id) return;
    if (!entryAllowed) {
      setSaveMessage(entryStatusMessage);
      return;
    }
    const missingAreaRows = activityRows.filter((row) => Number(row.todayProgress || 0) > 0 && !String(row.area || "").trim());
    if (missingAreaRows.length) {
      setSaveMessage("Area of Work is mandatory where Physical Progress is greater than 0.");
      return;
    }
    setSavingActuals(true);
    setSaveMessage("");
    try {
      await api(`/api/projects/${project.id}/daily-progress/actuals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_date: entryDate,
          plan_name: selectedPlanName || progress.planName || "",
          requested_by_role: user?.role || "",
          actuals: activityRows
            .filter((row) => row.activity_id)
            .map((row) => ({
              activity_id: row.activity_id,
              actual_qty: row.todayProgress || 0,
              area_of_work: row.area || "",
            })),
          manpowerRows: manpowerRows.map((row) => ({
            category: row.category || "",
            contractorName: row.contractorName || "",
            trade: row.trade || "",
            lastMonth: row.lastMonth || 0,
            today: row.today || 0,
            remarks: row.remarks || "",
          })),
        }),
      });
      setSaveMessage(`Daily progress data saved for ${formatDate(entryDate)}.`);
      await onSaved?.();
    } catch (error) {
      setSaveMessage(error.message || "Unable to save physical progress actuals.");
    } finally {
      setSavingActuals(false);
    }
  }

  const totalLastMonth = manpowerRows.reduce((total, row) => total + Number(row.lastMonth || 0), 0);
  const totalToday = manpowerRows.reduce((total, row) => total + Number(row.today || 0), 0);
  const hasPhysicalEntryData = activityRows.some((row) => Number(row.todayProgress || 0) > 0 || String(row.area || "").trim());
  const hasManpowerEntryData = manpowerRows.some((row) => (
    Number(row.today || 0) > 0
    || Number(row.lastMonth || 0) > 0
    || String(row.contractorName || "").trim()
    || String(row.remarks || "").trim()
  ));
  const canSaveDailyEntry = entryAllowed && (hasPhysicalEntryData || hasManpowerEntryData);
  const entryDateLabel = formatDate(entryDate);
  const contractorPairKey = (row) => row?.contractorGroupId || `${row?.contractorName || ""}`;
  const dprTabs = [
    { key: "entry", label: "Data Entry", icon: Pencil },
    { key: "report", label: "Daily Report", icon: FileText },
    { key: "summary", label: "Summary", icon: BarChart3 },
  ];

  function renderDprTab() {
    if (activeDprTab === "report") {
      return (
        <DailyProgressTable
          columns={progress.activityReportColumns || []}
          rows={progress.activityReportRows || []}
          records={progress.records || []}
          project={project}
          entryDate={entryDate}
          activityRows={activityRows}
          manpowerRows={manpowerRows}
        />
      );
    }

    if (activeDprTab === "summary") {
      return <DprSummaryView progress={progress} project={project} entryDate={entryDate} onMonthChange={setEntryDate} onExport={exportDprSummary} onExportPdf={exportDprSummaryPdf} onBack={onBack} onHome={onHome} />;
    }

    return (
      <>
        {!entryAllowed ? (
          <section className="dpr-card dpr-entry-locked-card">
            <div className="dpr-card-title-row">
              <div>
                <h2>Physical Progress</h2>
                <p>{progress.financialYear ? `Selected Financial Year: FY ${progress.financialYear}` : "Selected Financial Year"}</p>
              </div>
              <span className="dpr-lock-badge"><Lock size={16} /> Entry Locked</span>
            </div>
            <div className="dpr-entry-locked-body">
              <strong>{entryStatusMessage}</strong>
              <span>Save & Lock the S-Curve plan for the selected date's financial year, then return here to enter Physical Progress and Manpower data.</span>
            </div>
          </section>
        ) : null}

        {entryAllowed ? (
        <section className="dpr-card">
          <div className="dpr-card-title-row">
            <div>
              <h2>Physical Progress</h2>
              <p>{progress.planName ? `Source: ${progress.planName} / ${progress.planMonth}` : "Source: active S-Curve plan"}</p>
            </div>
          </div>
          {saveMessage ? <div className="dpr-save-message">{saveMessage}</div> : null}
          <div className="dpr-activity-table">
            <div className="dpr-row dpr-table-head">
              <span>Parent</span>
              <span>Activity</span>
              <span>Scope</span>
              <span>Unit of Measurement</span>
              <span>Month Target</span>
              <span>Actual Achieved</span>
              <span>{entryDateLabel} Physical Progress</span>
              <span>Area of Work</span>
            </div>
            {activityRows.map((row, index) => (
              <div className="dpr-row" key={row.id}>
                <strong>{row.parent || "-"}</strong>
                <strong>
                  {isAdmin && row.activity_id ? (
                    <button
                      type="button"
                      className="dpr-activity-open"
                      onClick={() => openActivityActualCard(row)}
                      title="Open full financial year actuals"
                    >
                      {row.activity || "-"}
                    </button>
                  ) : row.activity || "-"}
                </strong>
                <input className="dpr-source-field dpr-source-scope" value={row.scope} readOnly title="Locked from active S-Curve plan" placeholder="From S-Curve" />
                <input className="dpr-source-field dpr-source-unit" value={row.unit} readOnly title="Locked from active S-Curve plan" placeholder="From S-Curve" />
                <label><input className="dpr-source-field dpr-source-target" value={row.monthTarget} readOnly title="Locked from active S-Curve monthly plan" placeholder="From S-Curve" /></label>
                <label><input value={activityActual(row)} readOnly title="Actuals till last FY plus current FY actual up to selected date" /></label>
                <label><input value={row.todayProgress} onChange={(event) => updateActivity(index, "todayProgress", event.target.value)} placeholder="Enter physical progress" /></label>
                <input
                  className={Number(row.todayProgress || 0) > 0 && !String(row.area || "").trim() ? "dpr-required-field" : ""}
                  value={row.area}
                  onChange={(event) => updateActivity(index, "area", event.target.value)}
                  placeholder={Number(row.todayProgress || 0) > 0 ? "Required" : "Enter area of work"}
                  aria-invalid={Number(row.todayProgress || 0) > 0 && !String(row.area || "").trim()}
                />
              </div>
            ))}
          </div>
        </section>
        ) : null}

        {entryAllowed ? (
        <section className="dpr-card">
          <div className="dpr-manpower-head">
            <div>
              <h2>Manpower Entry</h2>
              <p className="dpr-manpower-date-link"><CalendarDays size={16} /> Manpower and Today Progress will be recorded for {entryDateLabel}</p>
              <div className="dpr-manpower-filters">
                <label>
                  Department / Activity
                  <select value={department} onChange={(event) => setDepartment(event.target.value)}>
                    <option>All</option>
                    {Array.from(new Set(activityRows.map((row) => row.parent).filter(Boolean))).map((name) => <option key={name}>{name}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <div className="dpr-manpower-actions">
              <button type="button" onClick={addManpowerRow}><Plus size={18} /> Add Contractor</button>
              <button type="button" onClick={exportDailyProgress}><Download size={18} /> Export</button>
            </div>
          </div>

          <div className="dpr-manpower-table-wrap">
            <table className="dpr-manpower-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Category</th>
                  <th>Contractor</th>
                  <th>Type</th>
                  <th>Last Month Average (A)</th>
                  <th>{entryDateLabel}</th>
                  <th>Remarks</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {manpowerRows.map((row, index) => {
                  const isContractor = row.category === "Contractor";
                  const previousRow = manpowerRows[index - 1];
                  const nextRow = manpowerRows[index + 1];
                  const startsContractorPair = isContractor && (!previousRow || previousRow.category !== "Contractor" || contractorPairKey(previousRow) !== contractorPairKey(row));
                  const contractorRowSpan = startsContractorPair && nextRow?.category === "Contractor" && contractorPairKey(nextRow) === contractorPairKey(row) ? 2 : 1;
                  return (
                    <tr key={row.id} className={isContractor ? "dpr-contractor-row" : ""}>
                      <td>{index + 1}</td>
                      {isContractor ? (
                        startsContractorPair ? (
                          <>
                            <td rowSpan={contractorRowSpan} className="dpr-merged-cell"><strong>Contractor</strong></td>
                            <td rowSpan={contractorRowSpan} className="dpr-merged-cell">
                              <input value={row.contractorName || ""} onChange={(event) => updateManpower(row.id, "contractorName", event.target.value)} placeholder="Contractor name" />
                            </td>
                          </>
                        ) : null
                      ) : (
                        <>
                          <td><select value={row.category} onChange={(event) => updateManpower(row.id, "category", event.target.value)}><option>RSP - Executive</option><option>RSP - Non Executive</option><option>Executing Agency</option><option>Contractor</option></select></td>
                          <td className="dpr-empty-cell"></td>
                        </>
                      )}
                      <td><input value={row.trade || ""} onChange={(event) => updateManpower(row.id, "trade", event.target.value)} placeholder={isContractor ? "Supervisor / Labour" : "Type"} readOnly={isContractor} /></td>
                      <td><input value={row.lastMonth} onChange={(event) => updateManpower(row.id, "lastMonth", event.target.value)} /></td>
                      <td><input value={row.today} onChange={(event) => updateManpower(row.id, "today", event.target.value)} /></td>
                      <td><input value={row.remarks} onChange={(event) => updateManpower(row.id, "remarks", event.target.value)} placeholder="Enter remarks" /></td>
                      <td>
                        <div className="dpr-table-actions">
                          <button type="button" title="Edit row"><Pencil size={15} /></button>
                          <button type="button" title={isContractor ? "Delete contractor rows" : "Delete row"} onClick={() => deleteManpowerRow(row.id)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="dpr-total-row">
                  <td colSpan="4">Total Manpower</td>
                  <td>{number(totalLastMonth)}</td>
                  <td>{number(totalToday)}</td>
                  <td colSpan="2"></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="dpr-note"><strong>Note:</strong> Contractor manpower (Supervisor / Labour) may increase or decrease based on site requirement.</p>
          <div className="dpr-bottom-actions">
            <button type="button" className="dpr-reset-button" onClick={resetDailyProgressEntry}>
              <RefreshCw size={16} /> Reset
            </button>
            <button type="button" className="dpr-save-button" onClick={savePhysicalProgressActuals} disabled={savingActuals || !canSaveDailyEntry}>
              <Save size={16} /> {savingActuals ? "Saving..." : "Save Daily Progress"}
            </button>
          </div>
        </section>
        ) : null}
        {activityActualCard ? (
          <div className="dpr-actual-card-backdrop">
            <section className="dpr-actual-card" aria-label="Monthly activity actuals">
              <div className="dpr-actual-card-head">
                <div>
                  <h2>{activityActualCard.activity || "Activity Actuals"}</h2>
                  <p>FY {activityActualCard.financialYear || progress.financialYear || ""} / {activityActualCard.planName || progress.planName || ""}</p>
                </div>
                <div className="dpr-actual-card-head-actions">
                  <button type="button" className="dpr-actual-head-save" onClick={saveMonthlyActuals} disabled={monthlyActualSaving || monthlyActualLoading}>
                    <Save size={16} /> {monthlyActualSaving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" className="dpr-actual-head-close" onClick={() => setActivityActualCard(null)} title="Close">
                    <X size={18} />
                  </button>
                </div>
              </div>
              {monthlyActualMessage ? <div className="dpr-save-message">{monthlyActualMessage}</div> : null}
              <div className="dpr-actual-card-meta">
                <span>Scope <strong>{number(activityActualCard.scope || 0)}</strong></span>
                <span>Unit <strong>{activityActualCard.unit || activityActualCard.unitOfMeasurement || "-"}</strong></span>
                <span>Total Actual <strong>{number(monthlyActualRows.reduce((total, row) => total + Number(row.actualQty || 0), 0))}</strong></span>
              </div>
              <div className="dpr-monthly-actual-table-wrap">
                <table className="dpr-monthly-actual-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Last Working Date</th>
                      <th>Actual Data</th>
                      <th>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyActualLoading ? (
                      <tr><td colSpan="4">Loading monthly actuals...</td></tr>
                    ) : monthlyActualRows.map((row, index) => (
                      <tr key={row.month}>
                        <td><strong>{row.month}</strong></td>
                        <td>{formatDate(row.saveDate) || "-"}</td>
                        <td>
                          <input
                            value={row.actualQty ?? ""}
                            onChange={(event) => updateMonthlyActual(index, "actualQty", event.target.value)}
                            inputMode="decimal"
                          />
                        </td>
                        <td>
                          <input
                            value={row.remark || ""}
                            onChange={(event) => updateMonthlyActual(index, "remark", event.target.value)}
                            placeholder="Enter remark"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dpr-bottom-actions">
                <button type="button" className="dpr-reset-button" onClick={() => setActivityActualCard(null)}>
                  Close
                </button>
                <button type="button" className="dpr-save-button" onClick={saveMonthlyActuals} disabled={monthlyActualSaving || monthlyActualLoading}>
                  <Save size={16} /> {monthlyActualSaving ? "Saving..." : "Save Monthly Actuals"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="dpr-window">
      <section className="dpr-main">
        <header className="dpr-header">
          <div className="dpr-heading">
            <button type="button" className="dpr-header-back" onClick={onBack} title="Back to ongoing projects">
              <ArrowLeft size={20} />
              <span>Back</span>
            </button>
            <ClipboardList size={48} />
            <div>
              <h1>Daily Progress Report</h1>
              <p>Data Entry Management</p>
              {progress.hasCompletedPlanning && project?.project_name ? <strong>{project.project_name}</strong> : null}
            </div>
          </div>
          <div className="dpr-userbar">
            {activeDprTab === "entry" ? (
              <span><CalendarDays size={20} /> {new Date(`${entryDate}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
            ) : null}
            <span><User size={34} /> {user?.username || "User"} <ChevronDown size={16} /></span>
          </div>
        </header>

        <section className={`dpr-project-context ${activeDprTab === "entry" ? "" : "dpr-project-context-compact"}`} aria-label="Daily progress project selection">
          <label>
            <span>Project Type</span>
            <select value={selectedProjectType} onChange={(event) => handleProjectTypeChange(event.target.value)}>
              {projectTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="dpr-project-list">
            <span>Project / Available Plans</span>
            <select value={filteredDprProjects.some((row) => Number(row.id) === Number(project?.id)) ? String(project.id) : ""} onChange={(event) => handleProjectChange(event.target.value)}>
              <option value="">{filteredDprProjects.length ? "Select project" : "No projects available"}</option>
              {filteredDprProjects.map((row) => (
                <option key={row.id} value={row.id}>
                  {dprProjectOptionLabel(row)}
                </option>
              ))}
            </select>
          </label>
          <div className="dpr-project-current">
            <FolderKanban size={20} />
            <span>Current Applicable</span>
            <strong>{selectedProjectOption?.activePlanName || projectContext.currentApplicable || selectedProjectType}</strong>
          </div>
          <div className="dpr-project-current">
            <FolderKanban size={20} />
            <span>S-Curve Plan</span>
            <strong>{progress.planName || (availablePlanNames.length ? "Auto selected" : "No plan found")}</strong>
          </div>
          {activeDprTab === "entry" ? (
            <label className="dpr-entry-date-field">
              <span>Date Data Entered</span>
              <input type="date" value={entryDate} min={minEntryDate || undefined} max={maxEntryDate || undefined} onChange={(event) => setEntryDate(event.target.value)} />
              <small>{isAdmin ? "Allowed: Admin back date entry unlimited" : `Allowed: T-${backdateDays} to today`}</small>
            </label>
          ) : null}
        </section>

        <nav className="dpr-tabs" aria-label="Daily progress sections">
          {dprTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                type="button"
                key={tab.key}
                className={activeDprTab === tab.key ? "active" : ""}
                aria-pressed={activeDprTab === tab.key}
                onClick={() => setActiveDprTab(tab.key)}
              >
                <Icon size={18} /> {tab.label}
              </button>
            );
          })}
        </nav>

        {!entryAllowed ? <div className="warning dpr-warning">{entryStatusMessage}</div> : null}

        {renderDprTab()}
      </section>
    </div>
  );
}

function DailyProgressView({ project, user, refreshKey, ongoingProjects = [], onProjectChange, onBack, onHome, onWindowMenuEnter, onWindowMenuLeave }) {
  const [progress, setProgress] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [entryDate, setEntryDate] = useState(localDateInput(0));
  const [selectedPlanName, setSelectedPlanName] = useState("");
  const dailyProjectRef = useRef(project?.id);
  async function loadDailyProgress() {
    if (!project?.id) return;
    const params = new URLSearchParams({ as_of: entryDate, requested_by_role: user?.role || "" });
    setLoadError("");
    try {
      const payload = await api(`/api/projects/${project.id}/daily-progress?${params.toString()}`);
      setProgress(payload);
      setSelectedPlanName(payload.planName || "");
    } catch (error) {
      setProgress(null);
      setLoadError(error.message || "Unable to load daily progress.");
    }
  }

  useEffect(() => {
    if (!project?.id) return;
    if (dailyProjectRef.current !== project.id) {
      dailyProjectRef.current = project.id;
      if (selectedPlanName) setSelectedPlanName("");
    }
    setProgress(null);
    loadDailyProgress();
  }, [project?.id, refreshKey, entryDate]);
  function handleDailyProjectChange(projectId) {
    setSelectedPlanName("");
    setProgress(null);
    setLoadError("");
    onProjectChange?.(projectId);
  }
  if (!project) return <EmptySelect />;
  if (loadError) {
    return (
      <div className="loading daily-progress-load-error">
        <strong>Daily progress could not load.</strong>
        <span>{loadError}</span>
        <button type="button" onClick={loadDailyProgress}>Retry</button>
      </div>
    );
  }
  if (!progress) return <div className="loading">Loading daily progress...</div>;
  return (
    <DailyProgressEntryView
      progress={progress}
      project={project}
      user={user}
      entryDate={entryDate}
      setEntryDate={setEntryDate}
      selectedPlanName={selectedPlanName}
      setSelectedPlanName={setSelectedPlanName}
      onSaved={loadDailyProgress}
      ongoingProjects={ongoingProjects}
      onProjectChange={handleDailyProjectChange}
      onBack={onBack}
      onHome={onHome}
      onWindowMenuEnter={onWindowMenuEnter}
      onWindowMenuLeave={onWindowMenuLeave}
    />
  );
}

const CAPEX_PLAN_VERSIONS = ["Original Plan", "Revision 1", "Revision 2", "Revision 3", "Revision 4", "Revision 5"];
const CAPEX_PLAN_TYPES = ["BE", "RE"];

function capexVersionNumber(version) {
  const text = String(version || "").trim();
  if (text.toLowerCase() === "original plan") return 0;
  const match = text.match(/(?:revision|revised plan-)\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function capexVersionLabel(numberValue) {
  return numberValue === 0 ? "Original Plan" : `Revision ${numberValue}`;
}

function CapexView({ onClose, onBack, onHome, user }) {
  const [data, setData] = useState(null);
  const [planName, setPlanName] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [newRow, setNewRow] = useState({ name: "", indent: 2 });
  const [selectedMonth, setSelectedMonth] = useState("Apr-26");
  const [planningOpen, setPlanningOpen] = useState(false);
  const [capexDetailOpen, setCapexDetailOpen] = useState(false);
  const [capexViewBy, setCapexViewBy] = useState("Monthly");
  const [collapsedCapexRows, setCollapsedCapexRows] = useState(() => new Set());
  const reEffectiveDateRef = useRef(null);
  const [reEffectiveDate, setReEffectiveDate] = useState("");
  const [message, setMessage] = useState("");
  const [planDraft, setPlanDraft] = useState({
    financialYear: "FY 2026-2027",
    planVersion: "Original Plan",
    planType: "BE",
  });
  const isAdmin = String(user?.role || "").trim().toLowerCase() === "admin";

  async function load(nextPlan = planName) {
    const suffix = nextPlan ? `?plan_name=${encodeURIComponent(nextPlan)}` : "";
    const capex = await api(`/api/capex${suffix}`);
    setData(capex);
    setPlanName(nextPlan || capex.activePlan || capex.plans?.[0]?.name || "");
  }

  useEffect(() => {
    load();
  }, []);

  async function saveCell(rowId, column, value) {
    setMessage("");
    try {
      await api("/api/capex/cell", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planName, row_id: rowId, column, value }),
      });
      await load();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function addRow(event) {
    event.preventDefault();
    try {
      await api("/api/capex/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_name: planName,
          name: newRow.name,
          indent: Number(newRow.indent || 2),
          after_row_id: selectedRow?.row_id || null,
        }),
      });
      setNewRow({ name: "", indent: 2 });
      setMessage("CAPEX row added.");
      await load();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function deleteRow() {
    if (!selectedRow) return setMessage("Select a CAPEX row first.");
    if (!window.confirm(`Delete ${selectedRow.values?.["CAPEX Plan (FY)"] || "selected row"} and its child rows?`)) return;
    try {
      await fetch(`${API_BASE}/api/capex/rows`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planName, row_id: selectedRow.row_id, requested_by_role: user?.role || "" }),
      }).then(async (response) => {
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.detail || "Delete failed");
        }
      });
      setSelectedRow(null);
      setMessage("CAPEX row deleted.");
      await load();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function saveRows(nextRows = rows) {
    setMessage("");
    try {
      await api("/api/capex/rows", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planName, rows: nextRows }),
      });
      setMessage("CAPEX plan saved to backend table.");
      await load(planName);
      return true;
    } catch (err) {
      setMessage(err.message);
      throw err;
    }
  }

  async function createPlan() {
    setMessage("");
    const versionExists = (version) => plans.some((plan) => (
      plan.financial_year === planDraft.financialYear
      && plan.plan_type === planDraft.planType
      && capexVersionNumber(plan.plan_version) === capexVersionNumber(version)
    ));
    let planVersionToCreate = planDraft.planVersion;
    if (versionExists(planVersionToCreate)) {
      for (let revision = 1; revision <= 20; revision += 1) {
        const candidate = capexVersionLabel(revision);
        if (!versionExists(candidate)) {
          planVersionToCreate = candidate;
          setPlanDraft((current) => ({ ...current, planVersion: candidate }));
          break;
        }
      }
    }
    let effectiveFromMonth = "";
    if (planDraft.planType === "RE") {
      effectiveFromMonth = requestCapexEffectiveMonth(capexEffectiveMonthFromDate(reEffectiveDate) || activePlan?.effective_from_month || months[0]);
      if (!effectiveFromMonth) {
        return;
      }
    }
    try {
      const result = await api("/api/capex/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financial_year: planDraft.financialYear,
          plan_version: planVersionToCreate,
          plan_type: planDraft.planType,
          source_plan_name: planName,
          effective_from_month: effectiveFromMonth,
        }),
      });
      setPlanName(result.plan);
      setMessage(`CAPEX planning dataset created: ${planVersionToCreate}.`);
      await load(result.plan);
    } catch (err) {
      setMessage(err.message);
    }
  }

  function importCapexRows() {
    setMessage("CAPEX import is available from the Planning window. Use Open Planning, then Import from Excel.");
  }

  function capexEffectiveMonthFromDate(dateValue) {
    if (!dateValue) return "";
    const parsed = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return "";
    const label = `${parsed.toLocaleString("en-US", { month: "short" })}-${String(parsed.getFullYear()).slice(-2)}`;
    return months.includes(label) ? label : "";
  }

  function normalizeCapexEffectiveMonth(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const exact = months.find((month) => month.toLowerCase() === text.toLowerCase());
    if (exact) return exact;
    return capexEffectiveMonthFromDate(text);
  }

  function requestCapexEffectiveMonth(defaultMonth = "") {
    const entered = window.prompt(`Select RE Effective Month (${months.join(", ")})`, defaultMonth || months[0] || "");
    const effectiveMonth = normalizeCapexEffectiveMonth(entered);
    if (!effectiveMonth) {
      setMessage(`Select a valid RE effective month: ${months.join(", ")}.`);
      return "";
    }
    return effectiveMonth;
  }

  function handleCapexPlanTypeChange(planType) {
    setPlanDraft((current) => ({ ...current, planType }));
    if (planType === "RE") {
      setTimeout(() => {
        if (reEffectiveDateRef.current?.showPicker) {
          reEffectiveDateRef.current.showPicker();
        } else {
          reEffectiveDateRef.current?.focus();
        }
      }, 0);
    }
  }

  async function approvePlan() {
    if (!planName) return setMessage("Select a CAPEX plan first.");
    const effectiveMonth = activePlan?.plan_type === "RE"
      ? (activePlan?.effective_from_month || requestCapexEffectiveMonth(months[0] || "Apr-26"))
      : "";
    if (activePlan?.plan_type === "RE" && !effectiveMonth) return;
    try {
      await saveRows(rows);
      const result = await api("/api/capex/plans/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planName, effective_from_month: effectiveMonth }),
      });
      setPlanName(result.plan);
      setMessage("CAPEX plan approved and activated. Actual columns are now editable.");
      await load(result.plan);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function setEffectivePlan() {
    if (!planName) return setMessage("Select a CAPEX plan first.");
    try {
      await api("/api/capex/plans/effective", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planName }),
      });
      setMessage("Effective CAPEX plan updated.");
      await load(planName);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function deletePlan() {
    if (!planName) return setMessage("Select a CAPEX plan first.");
    if (!isAdmin && (activePlan?.locked || activePlan?.approved)) {
      setMessage("Approved or locked CAPEX plans cannot be deleted.");
      return;
    }
    if (!window.confirm(`Delete CAPEX plan ${planName}?`)) return;
    try {
      const result = await api("/api/capex/plans/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planName, requested_by_role: user?.role || "" }),
      });
      setMessage("CAPEX plan deleted.");
      setPlanName(result.activePlan || "");
      await load(result.activePlan || "");
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function moveRow(direction) {
    if (!selectedRow) return setMessage("Select a CAPEX row first.");
    try {
      await api("/api/capex/rows/move", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planName, row_id: selectedRow.row_id, direction }),
      });
      await load(planName);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function changeIndent(delta) {
    if (!selectedRow) return setMessage("Select a CAPEX row first.");
    try {
      await api("/api/capex/rows/indent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_name: planName, row_id: selectedRow.row_id, delta }),
      });
      await load(planName);
    } catch (err) {
      setMessage(err.message);
    }
  }

  const activePlan = (data?.plans || []).find((plan) => plan.name === planName) || data?.plans?.[0];
  useEffect(() => {
    if (!activePlan && !data) return;
    setPlanDraft({
      financialYear: activePlan?.financial_year || data?.financialYear || "FY 2026-2027",
      planVersion: activePlan?.plan_version || "Original Plan",
      planType: activePlan?.plan_type || "BE",
    });
  }, [activePlan?.name, data?.financialYear]);

  const rows = data?.rows || [];
  const editableCells = data?.editableCells || {};
  function isCapexCellEditable(row, key) {
    return Boolean(editableCells[String(row.row_id)]?.[key]);
  }

  function openCapexDetail(row) {
    setSelectedRow(row);
    setCapexDetailOpen(true);
  }

  function toggleCapexRow(rowId) {
    setCollapsedCapexRows((current) => {
      const next = new Set(current);
      const key = String(rowId);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }
  const allColumns = (data?.columns || []).map((column) => column.key);
  const baseColumns = allColumns.slice(0, 5);
  const months = data?.months || ["Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27"];
  const reMonths = new Set(["Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27"]);
  const monthColumns = months.flatMap((month) => (
    reMonths.has(month) ? [`${month} BE`, `${month} RE`, `${month} Actual`] : [`${month} BE`, `${month} Actual`]
  ));
  const quarterDefinitions = [
    ["Q1", months.slice(0, 3)],
    ["Q2", months.slice(3, 6)],
    ["Q3", months.slice(6, 9)],
    ["Q4", months.slice(9, 12)],
  ].filter(([, quarterMonths]) => quarterMonths.length);
  const quarterColumns = quarterDefinitions.flatMap(([quarter]) => [`${quarter} BE`, `${quarter} RE`, `${quarter} Actual`]);
  const monthGroups = [];
  for (const column of monthColumns) {
    const [month, ...rest] = column.split(" ");
    let group = monthGroups[monthGroups.length - 1];
    if (!group || group.month !== month) {
      group = { month, subs: [] };
      monthGroups.push(group);
    }
    group.subs.push({ key: column, label: rest.join(" ") });
  }
  const planningColumnsFromApi = (data?.planningColumns || []).map((column) => column.key);
  const planningMonthColumns = planningColumnsFromApi.length ? planningColumnsFromApi.slice(5) : months.flatMap((month) => [`${month} BE`, `${month} RE`]);
  const planningMonthGroups = [];
  for (const column of planningMonthColumns) {
    const [month, ...rest] = column.split(" ");
    let group = planningMonthGroups[planningMonthGroups.length - 1];
    if (!group || group.month !== month) {
      group = { month, subs: [] };
      planningMonthGroups.push(group);
    }
    group.subs.push({ key: column, label: rest.join(" ") });
  }
  const quarterGroups = quarterDefinitions.map(([quarter]) => ({
    month: quarter,
    subs: [
      { key: `${quarter} BE`, label: "BE" },
      { key: `${quarter} RE`, label: "RE" },
      { key: `${quarter} Actual`, label: "Actual" },
    ],
  }));
  const planningBaseColumns = ["CAPEX Plan (FY)", "Gross Cost", "Cummulative Expenditure till Last FY", "BE (FY)", "RE (FY)"];
  const planningKeys = [...planningBaseColumns, ...planningMonthColumns];
  const planningMonthColumnWidth = 92;
  const keys = [...baseColumns, ...monthColumns];
  const fySummaryColumns = [...baseColumns, "Actual (FY)"];
  const viewColumns = capexViewBy === "FY Summary"
    ? fySummaryColumns
    : capexViewBy === "Quarterly"
      ? [...baseColumns, ...quarterColumns]
      : keys;
  const headerBaseColumns = capexViewBy === "FY Summary" ? fySummaryColumns : baseColumns;
  const viewGroups = capexViewBy === "Quarterly" ? quarterGroups : monthGroups;
  const rowsWithDisplayFallback = rows.map((row) => ({ ...row, display: row.display || row.values || {} }));
  const displayRows = data?.displayRows?.length ? data.displayRows : rowsWithDisplayFallback;
  const planningDisplayRows = data?.planningDisplayRows?.length ? data.planningDisplayRows : rowsWithDisplayFallback;
  const rowHasChildren = (row, list) => {
    if ((row.children || []).length) return true;
    const index = list.findIndex((item) => item.row_id === row.row_id);
    return index >= 0 && Number(list[index + 1]?.indent || 0) > Number(row.indent || 0);
  };
  const visibleCapexRows = (list) => {
    const hiddenIndentStack = [];
    return list.filter((row) => {
      const indent = Number(row.indent || 0);
      while (hiddenIndentStack.length && indent <= hiddenIndentStack[hiddenIndentStack.length - 1]) {
        hiddenIndentStack.pop();
      }
      const hidden = hiddenIndentStack.length > 0;
      if (collapsedCapexRows.has(String(row.row_id))) {
        hiddenIndentStack.push(indent);
      }
      return !hidden;
    });
  };
  const visibleDisplayRows = visibleCapexRows(displayRows);
  const visiblePlanningDisplayRows = visibleCapexRows(planningDisplayRows);
  const capexTotalDisplay = (list, columns) => {
    const totals = { "CAPEX Plan (FY)": "Total" };
    columns.forEach((column) => {
      if (column === "CAPEX Plan (FY)") return;
      const total = list.reduce((sum, row) => (
        Number(row.indent || 0) === 0
          ? sum + capexNumericValue(capexCellValue(row, column))
          : sum
      ), 0);
      totals[column] = total ? number(total) : "";
    });
    return totals;
  };
  const renderCapexNameCell = (row, key, list, indentSize = 30) => {
    const isParent = rowHasChildren(row, list);
    const isCollapsed = collapsedCapexRows.has(String(row.row_id));
    return (
      <div className="capex-tree-cell" style={{ paddingLeft: `${(row.indent || 0) * indentSize + 8}px` }}>
        {isParent ? (
          <button
            type="button"
            className="capex-tree-toggle"
            onClick={(event) => {
              event.stopPropagation();
              toggleCapexRow(row.row_id);
            }}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? "+" : "-"}
          </button>
        ) : <span className="capex-tree-spacer" />}
        <input
          className="cell-input"
          value={capexCellValue(row, key)}
          readOnly={!isCapexCellEditable(row, key)}
          style={{ fontWeight: row.indent <= 1 ? 800 : 500 }}
          onChange={(event) => {
            const value = event.target.value;
            setData((current) => ({
              ...current,
              rows: current.rows.map((item) => item.row_id === row.row_id ? { ...item, values: { ...item.values, [key]: value } } : item),
            }));
          }}
          onBlur={(event) => isCapexCellEditable(row, key) && saveCell(row.row_id, key, event.target.value)}
        />
      </div>
    );
  };
  const capexCellValue = (row, key) => {
    if (key === "Actual (FY)") {
      const total = months.reduce((sum, month) => sum + capexNumericValue(capexCellValue(row, `${month} Actual`)), 0);
      return total ? number(total) : "";
    }
    const quarterMatch = String(key || "").match(/^(Q[1-4]) (BE|RE|Actual)$/);
    if (quarterMatch) {
      const quarter = quarterDefinitions.find(([label]) => label === quarterMatch[1]);
      if (!quarter) return "";
      const total = quarter[1].reduce((sum, month) => sum + capexNumericValue(capexCellValue(row, `${month} ${quarterMatch[2]}`)), 0);
      return total ? number(total) : "";
    }
    const display = row.display || {};
    const blankZero = (value) => {
      if (key === "CAPEX Plan (FY)") return value ?? "";
      const text = String(value ?? "").replaceAll(",", "").trim();
      if (text !== "" && !Number.isNaN(Number(text)) && Math.abs(Number(text)) < 0.000001) return "";
      return value ?? "";
    };
    if (Object.prototype.hasOwnProperty.call(display, key)) {
      return blankZero(display[key]);
    }
    return blankZero(row.values?.[key]);
  };
  const grossCost = data?.grossTotal || 0;
  const validationMessage = data?.validationMessage || "";
  const planLabel = activePlan?.plan_version || (planName.split("|")[1] || "Original Plan").trim();
  const financialYear = activePlan?.financial_year || data?.financialYear || planDraft.financialYear;
  const plans = data?.plans || [];
  const financialYearOptions = [financialYear, data?.financialYear, "FY 2026-2027", "FY 2027-2028", "FY 2028-2029", "FY 2029-2030"]
    .filter((value, index, list) => value && list.indexOf(value) === index);
  const planVersionOptions = [...CAPEX_PLAN_VERSIONS, ...plans.map((plan) => plan.plan_version)]
    .filter((value, index, list) => value && list.indexOf(value) === index);
  const progressValue = data?.progressPercent ?? 0;
  const capexNumericValue = (value) => Number(String(value ?? "").replaceAll(",", "")) || 0;
  const capexBlankZero = (value) => (capexNumericValue(value) ? number(value) : "");
  const capexTotalText = (value) => (Math.abs(Number(value || 0)) > 0.000001 ? Number(value).toFixed(2) : "");
  const selectedSnapshotRow = selectedRow || displayRows.find((row) => Number(row.indent || 0) === 2) || displayRows[0] || null;
  const selectedDetailRow = selectedRow ? (displayRows.find((row) => row.row_id === selectedRow.row_id) || selectedRow) : null;
  const detailBaseFields = ["CAPEX Plan (FY)", "Gross Cost", "Cummulative Expenditure till Last FY", "BE (FY)", "RE (FY)"];
  const detailMonthlyRows = months.map((month) => ({
    month,
    be: `${month} BE`,
    re: `${month} RE`,
    actual: `${month} Actual`,
  }));
  const detailMonthlyTotals = selectedDetailRow ? detailMonthlyRows.reduce((totals, row) => {
    totals.be += capexNumericValue(selectedDetailRow.values?.[row.be] ?? capexCellValue(selectedDetailRow, row.be));
    totals.re += capexNumericValue(selectedDetailRow.values?.[row.re] ?? capexCellValue(selectedDetailRow, row.re));
    totals.actual += capexNumericValue(selectedDetailRow.values?.[row.actual] ?? capexCellValue(selectedDetailRow, row.actual));
    return totals;
  }, { be: 0, re: 0, actual: 0 }) : { be: 0, re: 0, actual: 0 };
  const capexDetailBaseValue = (key) => {
    if (!selectedDetailRow) return "";
    if (key === "BE (FY)") return capexTotalText(detailMonthlyTotals.be);
    if (key === "RE (FY)") return capexTotalText(detailMonthlyTotals.re);
    return capexCellValue(selectedDetailRow, key);
  };
  async function saveCapexDetailRow() {
    if (!selectedDetailRow) return;
    try {
      const rowsToSave = (data?.rows || rows).map((row) => {
        if (row.row_id !== selectedDetailRow.row_id) return row;
        const values = { ...(row.values || {}) };
        values["BE (FY)"] = capexTotalText(detailMonthlyTotals.be);
        values["RE (FY)"] = capexTotalText(detailMonthlyTotals.re);
        return { ...row, values };
      });
      await saveRows(rowsToSave);
      setMessage("Data saved.");
      setCapexDetailOpen(false);
    } catch (err) {
      setMessage(err.message || "Save failed.");
    }
  }
  const saveCapexDetailOnEnter = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveCapexDetailRow();
  };
  const updateCapexLocalCell = (rowId, key, value) => {
    setData((current) => ({
      ...current,
      rows: current.rows.map((item) => {
        if (item.row_id !== rowId) return item;
        const values = { ...item.values, [key]: value };
        values["BE (FY)"] = capexTotalText(months.reduce((total, month) => total + capexNumericValue(values[`${month} BE`]), 0));
        values["RE (FY)"] = capexTotalText(months.reduce((total, month) => total + capexNumericValue(values[`${month} RE`]), 0));
        return { ...item, values };
      }),
      displayRows: (current.displayRows || []).map((item) => {
        if (item.row_id !== rowId) return item;
        const values = { ...item.values, [key]: value };
        values["BE (FY)"] = capexTotalText(months.reduce((total, month) => total + capexNumericValue(values[`${month} BE`] ?? item.display?.[`${month} BE`]), 0));
        values["RE (FY)"] = capexTotalText(months.reduce((total, month) => total + capexNumericValue(values[`${month} RE`] ?? item.display?.[`${month} RE`]), 0));
        return { ...item, values, display: { ...item.display, ...values } };
      }),
      planningDisplayRows: (current.planningDisplayRows || []).map((item) => {
        if (item.row_id !== rowId) return item;
        const values = { ...item.values, [key]: value };
        values["BE (FY)"] = capexTotalText(months.reduce((total, month) => total + capexNumericValue(values[`${month} BE`] ?? item.display?.[`${month} BE`]), 0));
        values["RE (FY)"] = capexTotalText(months.reduce((total, month) => total + capexNumericValue(values[`${month} RE`] ?? item.display?.[`${month} RE`]), 0));
        return { ...item, values, display: { ...item.display, ...values } };
      }),
    }));
  };
  const snapshotName = selectedSnapshotRow ? capexCellValue(selectedSnapshotRow, "CAPEX Plan (FY)") : "-";
  const snapshotGross = selectedSnapshotRow ? capexCellValue(selectedSnapshotRow, "Gross Cost") : "";
  const snapshotPlan = selectedSnapshotRow ? capexCellValue(selectedSnapshotRow, `${activePlan?.plan_type || "BE"} (FY)`) : "";
  const snapshotActual = selectedSnapshotRow ? months.reduce((total, month) => total + capexNumericValue(capexCellValue(selectedSnapshotRow, `${month} Actual`)), 0) : 0;
  const snapshotPlanNumber = capexNumericValue(snapshotPlan);
  const snapshotProgress = snapshotPlanNumber ? (snapshotActual / snapshotPlanNumber) * 100 : progressValue;
  const activeMetricLabel = activePlan?.plan_type === "RE" ? "FY Plan (RE)" : "FY Plan (BE)";
  const activeMetricValue = data?.activePlanTotal ?? data?.fyPlanTotal ?? "";
  const actualTillDateValue = data?.actualTillDateTotal ?? "";
  const varianceValue = data?.varianceTotal ?? "";
  const capexTableKeys = viewColumns;
  const mainTotalDisplay = capexTotalDisplay(displayRows, capexTableKeys);
  const planningTotalDisplay = capexTotalDisplay(planningDisplayRows, planningKeys);
  const capexExportSafeName = (value) => String(value || "capex-plan")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  const capexCsvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const capexHtmlValue = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const capexExportCellValue = (row, key) => {
    if (row?.row_id === "total") {
      const totalValues = row.display || row.values || {};
      if (Object.prototype.hasOwnProperty.call(totalValues, key)) return totalValues[key];
    }
    return capexCellValue(row, key);
  };
  const capexExportRowClass = (row, sourceRows) => {
    if (row?.row_id === "total") return "capex-export-total";
    return Number(row?.indent || 0) <= 1 || rowHasChildren(row, sourceRows) ? "capex-export-parent" : "";
  };
  const capexExportData = (scope) => {
    const isPlanning = scope === "planning";
    const exportKeys = isPlanning ? planningKeys : capexTableKeys;
    const totalDisplay = isPlanning ? planningTotalDisplay : mainTotalDisplay;
    const sourceRows = isPlanning ? visiblePlanningDisplayRows : visibleDisplayRows;
    const exportRows = [
      ...sourceRows,
      { row_id: "total", values: totalDisplay, display: totalDisplay },
    ];
    const title = isPlanning ? "CAPEX Planning Table" : "CAPEX Report";
    const fileBase = capexExportSafeName(`${financialYear}_${planLabel}_${activePlan?.plan_type || "BE"}_${isPlanning ? "planning" : "capex_report"}`);
    return { exportKeys, exportRows, sourceRows, title, fileBase };
  };
  function exportCapexExcel(scope = "main") {
    const { exportKeys, exportRows, sourceRows, title, fileBase } = capexExportData(scope);
    if (!exportRows.length) {
      setMessage("No CAPEX rows available to export.");
      return;
    }
    const headerCells = exportKeys.map((key) => `<th>${capexHtmlValue(key)}</th>`).join("");
    const bodyRows = exportRows.map((row) => {
      const rowClass = capexExportRowClass(row, sourceRows);
      return `<tr class="${rowClass}">${exportKeys.map((key) => `<td>${capexHtmlValue(capexExportCellValue(row, key))}</td>`).join("")}</tr>`;
    }).join("");
    const workbook = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { font-family: Arial, sans-serif; color: #001b4f; }
            h1 { margin: 0 0 6px; font-size: 20px; }
            .meta { margin: 0 0 14px; font-size: 12px; color: #33445f; }
            table { border-collapse: collapse; font-size: 10px; }
            th { background: #073b8f; color: #fff; padding: 6px; border: 1px solid #9fb5d1; font-weight: 700; }
            td { padding: 5px; border: 1px solid #c9d7e8; vertical-align: top; }
            .capex-export-parent td,
            .capex-export-total td { font-weight: 700; }
            .capex-export-total td { background: #eaf3ff; border-top: 2px solid #073b8f; }
          </style>
        </head>
        <body>
          <h1>${capexHtmlValue(title)}</h1>
          <p class="meta">${capexHtmlValue(financialYear)} | ${capexHtmlValue(planLabel)} | ${capexHtmlValue(activePlan?.plan_type || "BE")}</p>
          <table>
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </body>
      </html>`;
    const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileBase}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("CAPEX Excel export downloaded.");
  }
  function exportCapexPdf(scope = "main") {
    const { exportKeys, exportRows, sourceRows, title, fileBase } = capexExportData(scope);
    if (!exportRows.length) {
      setMessage("No CAPEX rows available to export.");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setMessage("Allow browser pop-ups to export CAPEX PDF.");
      return;
    }
    const headerCells = exportKeys.map((key) => `<th>${capexHtmlValue(key)}</th>`).join("");
    const bodyRows = exportRows.map((row) => {
      const rowClass = capexExportRowClass(row, sourceRows);
      return `<tr class="${rowClass}">${exportKeys.map((key) => `<td>${capexHtmlValue(capexExportCellValue(row, key))}</td>`).join("")}</tr>`;
    }).join("");
    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>${capexHtmlValue(fileBase)}</title>
          <style>
            @page { size: landscape; margin: 12mm; }
            body { font-family: Arial, sans-serif; color: #001b4f; }
            h1 { margin: 0 0 6px; font-size: 20px; }
            .meta { margin: 0 0 14px; font-size: 12px; color: #33445f; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th { background: #073b8f; color: #fff; padding: 6px; border: 1px solid #9fb5d1; }
            td { padding: 5px; border: 1px solid #c9d7e8; vertical-align: top; }
            tr:nth-child(even) td { background: #f3f7fb; }
            .capex-export-parent td,
            .capex-export-total td { font-weight: 700; }
            .capex-export-total td { background: #eaf3ff !important; border-top: 2px solid #073b8f; }
          </style>
        </head>
        <body>
          <h1>${capexHtmlValue(title)}</h1>
          <p class="meta">${capexHtmlValue(financialYear)} | ${capexHtmlValue(planLabel)} | ${capexHtmlValue(activePlan?.plan_type || "BE")}</p>
          <table>
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
    setMessage("CAPEX PDF export opened. Use Save as PDF in the print dialog.");
  }
  const updatePlanChoice = (patch) => {
    const nextDraft = { ...planDraft, ...patch };
    setPlanDraft(nextDraft);
    const matchingPlan = plans.find((plan) => (
      plan.financial_year === nextDraft.financialYear
      && plan.plan_version === nextDraft.planVersion
      && plan.plan_type === nextDraft.planType
    ));
    if (matchingPlan && matchingPlan.name !== planName) {
      setPlanName(matchingPlan.name);
      load(matchingPlan.name);
    }
  };

  return (
    <div className="capex-window">
      <div className="capex-management-head">
        <div className="capex-management-title">
          <BarChart3 size={28} />
          <h1>CAPEX Planning Management</h1>
        </div>
        <div className="capex-management-actions">
          <button className="capex-back" type="button" onClick={onBack}><ArrowLeft size={17} /> Back</button>
          <button className="capex-help" type="button"><HelpCircle size={18} /> Help</button>
          <button className="capex-home" type="button" onClick={onHome}><Home size={17} /> Home</button>
        </div>
      </div>

      <div className="capex-control-band">
        <label>Financial Year (FY)
          <select value={planDraft.financialYear} onChange={(event) => updatePlanChoice({ financialYear: event.target.value })}>
            {financialYearOptions.map((year) => <option key={year} value={year}>{year}{year === data?.financialYear ? " (Current FY)" : ""}</option>)}
          </select>
        </label>
        <label>Plan Version
          <select value={planDraft.planVersion} onChange={(event) => updatePlanChoice({ planVersion: event.target.value })}>
            {planVersionOptions.map((version) => <option key={version} value={version}>{version}</option>)}
          </select>
        </label>
        <label>Plan Type
          <select value={planDraft.planType} onChange={(event) => updatePlanChoice({ planType: event.target.value })}>
            {CAPEX_PLAN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <div className="capex-active-toggle">
          <span>Active Plan</span>
          <button className={activePlan?.effective ? "on" : ""} type="button" onClick={setEffectivePlan}>
            {activePlan?.effective ? "Yes" : "No"}
          </button>
          <Info size={17} />
        </div>
        <div className="capex-control-actions">
          <button className="capex-primary" type="button" onClick={createPlan}><Plus size={18} /> Create Plan</button>
          <button className="capex-success" type="button" onClick={() => saveRows(rows)}><Save size={18} /> Save Plan</button>
          <button className="capex-outline" type="button" onClick={approvePlan}><CheckCircle size={18} /> Approve Plan</button>
        </div>
      </div>
      <div className="capex-management-plan-row">
        <label>Available CAPEX Plans
          <select value={planName} onChange={(event) => { setPlanName(event.target.value); load(event.target.value); }}>
            {plans.length ? plans.map((plan) => (
              <option key={plan.name} value={plan.name}>
                {plan.financial_year} | {plan.plan_version} | {plan.plan_type}{plan.effective ? " | Active" : ""}{plan.locked ? " | Locked" : ""}
              </option>
            )) : <option value="">No plans available</option>}
          </select>
        </label>
        <button type="button" className="capex-plan-delete" onClick={deletePlan} disabled={!planName || (!isAdmin && (activePlan?.locked || activePlan?.approved))}>Delete Plan</button>
      </div>

      <div className="capex-metric-strip">
        <div className="capex-metric-card blue"><IndianRupee size={30} /><span>Gross Cost</span><strong>₹ {number(grossCost)} Cr</strong></div>
        <div className="capex-metric-card green"><ClipboardList size={30} /><span>{activeMetricLabel}</span><strong>₹ {number(activeMetricValue)} Cr</strong></div>
        <div className="capex-metric-card purple"><BarChart3 size={30} /><span>Actual Till Date</span><strong>₹ {number(actualTillDateValue)} Cr</strong></div>
        <div className="capex-metric-card orange"><Calculator size={30} /><span>Variance ({activePlan?.plan_type || "BE"} Vs Actual)</span><strong>₹ {number(varianceValue)} Cr</strong></div>
        <div className="capex-metric-card teal"><CheckCircle size={30} /><span>Progress ({activePlan?.plan_type || "BE"})</span><strong>{number(progressValue)}%</strong></div>
      </div>

      <div className="capex-workspace">
        <section className="capex-table-panel">
          <div className="capex-table-tools">
            <div className="capex-view-tabs">
              <span>View By</span>
              {["Monthly", "Quarterly", "FY Summary"].map((tab) => (
                <button key={tab} type="button" className={capexViewBy === tab ? "active" : ""} onClick={() => setCapexViewBy(tab)}>{tab}</button>
              ))}
            </div>
            <div className="capex-export-tools">
              <span>Export</span>
              <button type="button" onClick={() => exportCapexExcel("main")}><Download size={15} /> Excel</button>
              <button type="button" onClick={() => exportCapexPdf("main")}><FileText size={15} /> PDF</button>
            </div>
          </div>
          <div className="capex-grid-wrap">
            <table className="capex-grid">
              <colgroup>
                {capexTableKeys.map((key, index) => (
                  <col
                    key={key}
                    style={{
                      width: index === 0 ? "380px" : index === 1 ? "180px" : index === 2 ? "230px" : index < 5 ? "155px" : "86px",
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {headerBaseColumns.map((key, index) => (
                    <th key={key} rowSpan={capexViewBy === "FY Summary" ? "1" : "2"} className={index < 3 ? "capex-main-head" : "capex-fy-head"}>{key === "CAPEX Plan (FY)" ? "Project Head / Item" : key}</th>
                  ))}
                {capexViewBy !== "FY Summary" ? viewGroups.map((group) => <th key={group.month} colSpan={group.subs.length} className="capex-month-head">{group.month}</th>) : null}
                </tr>
                {capexViewBy !== "FY Summary" ? (
                  <tr>
                    {viewGroups.flatMap((group) => group.subs.map((sub) => <th key={sub.key} className="capex-sub-head">{sub.label}</th>))}
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {visibleDisplayRows.length ? (
                  <>
                    {visibleDisplayRows.map((row) => (
                      <tr
                        key={row.row_id}
                        className={`${selectedRow?.row_id === row.row_id ? "selected-row" : ""} capex-level-${Math.min(Number(row.indent || 0), 2)}`}
                        onClick={() => setSelectedRow(row)}
                        onDoubleClick={() => openCapexDetail(row)}
                        title="Double click to open CAPEX detail card"
                      >
                        {capexTableKeys.map((key) => (
                          <td key={key} className={!isCapexCellEditable(row, key) && key !== "CAPEX Plan (FY)" ? "locked-cell" : ""}>
                            {key === "CAPEX Plan (FY)" ? renderCapexNameCell(row, key, displayRows) : (
                              <input
                                className={`cell-input ${!isCapexCellEditable(row, key) ? "locked" : ""}`}
                                value={capexCellValue(row, key)}
                                readOnly={!isCapexCellEditable(row, key)}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  updateCapexLocalCell(row.row_id, key, value);
                                }}
                                onBlur={(event) => isCapexCellEditable(row, key) && saveCell(row.row_id, key, event.target.value)}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="capex-total-row">
                      {capexTableKeys.map((key) => (
                        <td key={key}><strong>{mainTotalDisplay[key]}</strong></td>
                      ))}
                    </tr>
                  </>
                ) : <tr><td colSpan={capexTableKeys.length} className="empty">No CAPEX rows available.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {false ? <div className="capex-side-panel">
          <section className="capex-side-card">
            <h2>Project Snapshot <Pin size={16} /></h2>
            <dl>
              <dt>Project Name</dt><dd>{snapshotName}</dd>
              <dt>Project Head</dt><dd>{selectedSnapshotRow ? (Number(selectedSnapshotRow.indent || 0) <= 1 ? snapshotName : "AMR - Ongoing") : "-"}</dd>
              <dt>Gross Cost (₹ Cr)</dt><dd>{selectedSnapshotRow ? number(capexCellValue(selectedSnapshotRow, "Gross Cost")) : "-"}</dd>
              <dt>Plan ({activePlan?.plan_type || "BE"}) (₹ Cr)</dt><dd>{selectedSnapshotRow ? number(capexCellValue(selectedSnapshotRow, `${activePlan?.plan_type || "BE"} (FY)`)) : "-"}</dd>
              <dt>Actual Till Date (₹ Cr)</dt><dd>{number(actualTillDateValue)}</dd>
              <dt>% Progress ({activePlan?.plan_type || "BE"})</dt><dd>{number(progressValue)}%</dd>
            </dl>
          </section>
          <section className="capex-side-card">
            <h2>Plan vs Actual (S-Curve)</h2>
            <svg className="capex-scurve" viewBox="0 0 360 180" role="img" aria-label="Plan versus actual trend">
              <path d="M28 142H338M28 102H338M28 62H338M28 22H338" />
              <polyline className="plan" points="30,150 78,129 126,108 174,78 222,48 270,26 330,22" />
              <polyline className="actual" points="30,150 78,146 126,139 174,132 222,120 270,112 330,96" />
              <text x="28" y="170">Apr-26</text>
              <text x="160" y="170">Sep-26</text>
              <text x="294" y="170">Mar-27</text>
            </svg>
          </section>
          <section className="capex-side-card">
            <h2>Alerts</h2>
            <div className={validationMessage.startsWith("Validation OK") ? "capex-alert ok" : "capex-alert danger"}>{validationMessage || "No validation message available."}</div>
            <div className="capex-alert note">{activePlan?.locked ? "Plan is approved and locked." : "Draft plan can be saved before approval."}</div>
            {message ? <div className="capex-alert info">{message}</div> : null}
          </section>
        </div> : null}
      </div>

      <div className="capex-footer">
        <form className="capex-add-form" onSubmit={addRow}>
          <input placeholder="Item Name" value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })} />
          <select value={newRow.indent} onChange={(e) => setNewRow({ ...newRow, indent: e.target.value })}>
            <option value="0">Header</option>
            <option value="1">SubHeader</option>
            <option value="2">Item</option>
          </select>
          <button type="submit" className="capex-add">Add</button>
        </form>
        <button type="button" className="capex-import" onClick={importCapexRows}>Import</button>
        <button className="capex-save" type="button" onClick={() => saveRows(rows)}><Save size={17} /> Save</button>
        <button type="button" className="capex-delete" onClick={deleteRow} disabled={!selectedRow}>Delete</button>
        <button type="button" className="capex-indent" onClick={() => changeIndent(1)}>Indent</button>
        <button type="button" className="capex-outdent" onClick={() => changeIndent(-1)}>Outdent</button>
        <button type="button" className="capex-up" onClick={() => moveRow(-1)}>Up</button>
        <button type="button" className="capex-down" onClick={() => moveRow(1)}>Down</button>
        <button className="capex-refresh-small" type="button" onClick={() => load(planName)}><RefreshCw size={17} /> Refresh</button>
        <button type="button" className="capex-close" onClick={onClose}>Close</button>
        <span>Saved active plans allow editing only Actual fields.</span>
      </div>
      {selectedRow ? <div className="capex-status">Selected: {selectedRow.values?.["CAPEX Plan (FY)"]}</div> : null}
      {message ? <div className="capex-status">{message}</div> : null}
      {capexDetailOpen && selectedDetailRow ? (
        <div className="capex-detail-backdrop" onMouseDown={() => setCapexDetailOpen(false)}>
          <section className="capex-detail-card" onMouseDown={(event) => event.stopPropagation()}>
            <div className="capex-detail-head">
              <div>
                <h2>{capexCellValue(selectedDetailRow, "CAPEX Plan (FY)") || "CAPEX Detail"}</h2>
                <p>{activePlan?.effective || activePlan?.locked ? "Active saved plan: only Actual fields are editable." : "Fill editable plan details for this row."}</p>
              </div>
              <button type="button" onClick={() => setCapexDetailOpen(false)}><X size={18} /></button>
            </div>
            <div className="capex-detail-grid">
              {detailBaseFields.map((key) => {
                const canEdit = isCapexCellEditable(selectedDetailRow, key);
                return (
                  <label key={key} className={canEdit ? "" : "locked"}>
                    <span>{key === "CAPEX Plan (FY)" ? "Project Head / Item" : key}</span>
                    <input
                      value={canEdit ? (selectedDetailRow.values?.[key] ?? "") : capexDetailBaseValue(key)}
                      readOnly={!canEdit}
                      onChange={(event) => updateCapexLocalCell(selectedDetailRow.row_id, key, event.target.value)}
                      onKeyDown={canEdit ? saveCapexDetailOnEnter : undefined}
                    />
                  </label>
                );
              })}
            </div>
            <section className="capex-detail-monthly-entry">
              <h3>Monthly BE, RE and Actual values</h3>
              <div className="capex-month-entry-grid">
                <strong>Month</strong>
                <strong>BE</strong>
                <strong>RE</strong>
                <strong>Actual</strong>
                {detailMonthlyRows.map(({ month, be, re, actual }) => (
                  <React.Fragment key={month}>
                    <span className="capex-month-label">{month}</span>
                    {[be, re, actual].map((key) => {
                      const canEdit = isCapexCellEditable(selectedDetailRow, key);
                      return (
                        <input
                          key={key}
                          className={canEdit ? "" : "locked"}
                          value={canEdit ? (selectedDetailRow.values?.[key] ?? "") : capexCellValue(selectedDetailRow, key)}
                          readOnly={!canEdit}
                          onChange={(event) => updateCapexLocalCell(selectedDetailRow.row_id, key, event.target.value)}
                          onKeyDown={canEdit ? saveCapexDetailOnEnter : undefined}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}
                <strong className="capex-month-total-label">Total</strong>
                <strong className="capex-month-total-value">{capexBlankZero(detailMonthlyTotals.be)}</strong>
                <strong className="capex-month-total-value">{capexBlankZero(detailMonthlyTotals.re)}</strong>
                <strong className="capex-month-total-value">{capexBlankZero(detailMonthlyTotals.actual)}</strong>
              </div>
            </section>
            <div className="capex-detail-foot">
              <span>{validationMessage}</span>
              <div>
                <button type="button" className="capex-detail-save" onClick={saveCapexDetailRow}><Save size={16} /> Save</button>
                <button type="button" onClick={() => setCapexDetailOpen(false)}>Close</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="capex-window">
      <div className="capex-titlebar">
        <h1>CAPEX</h1>
        <p>Editable CAPEX hierarchy with roll-up totals</p>
      </div>
      <div className="capex-toolbar">
        <b>Financial Year: {data?.financialYear || activePlan?.financial_year || "FY 2026-2027"}</b>
        <label>Effective Plan:
          <select value={planName} onChange={(event) => { setPlanName(event.target.value); load(event.target.value); }}>
            {(data?.plans || []).map((plan) => <option key={plan.name} value={plan.name}>{plan.name}</option>)}
          </select>
        </label>
        <button className="capex-planning" onClick={() => setPlanningOpen(true)}>▣ Open Planning</button>
        <button className="capex-effective" onClick={setEffectivePlan}>✔ Set Effective</button>
        <span className="capex-current-effective" title={`Current Effective: ${planName || "-"}`}>
          Current Effective: {planName || "-"}
        </span>
      </div>
      <div className="capex-summary-row">
        <label className="capex-month">Select Month:
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
            {["Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27"].map((month) => <option key={month}>{month}</option>)}
          </select>
        </label>
        <div className="capex-summary-box gross"><b>Gross Cost</b><strong>{number(grossCost)}</strong></div>
        <div className="capex-summary-box current"><b>Plan vs Actual - Current FY</b><strong>Plan: 0.00 | Actual: 0.00</strong></div>
        <div className="capex-summary-box cumulative"><b>Plan vs Actual - Cumulative</b><strong>Plan: 0.00 | Actual: 0.00</strong></div>
        <button className="capex-refresh" onClick={() => load(planName)}>▣ Refresh Summary</button>
      </div>
      <div className="capex-grid-wrap">
        <table className="capex-grid">
          <colgroup>
            {keys.map((key, index) => (
              <col
                key={key}
                style={{
                  width: index === 0 ? "380px" : index === 1 ? "180px" : index === 2 ? "230px" : index < 5 ? "155px" : "86px",
                }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {baseColumns.map((key, index) => (
                <th key={key} rowSpan="2" className={index < 3 ? "capex-head-yellow" : "capex-head-green"}>{key}</th>
              ))}
              {monthGroups.map((group) => <th key={group.month} colSpan={group.subs.length} className="capex-month-head">{group.month}</th>)}
            </tr>
            <tr>
              {monthGroups.flatMap((group) => group.subs.map((sub) => <th key={sub.key} className="capex-sub-head">{sub.label}</th>))}
            </tr>
          </thead>
          <tbody>
            {visibleDisplayRows.length ? visibleDisplayRows.map((row, rowIndex) => (
              <tr key={row.row_id} className={`${selectedRow?.row_id === row.row_id ? "selected-row" : ""} capex-level-${Math.min(Number(row.indent || 0), 2)}`} onClick={() => setSelectedRow(row)}>
                {keys.map((key) => (
                  <td key={key}>
                    {key === "CAPEX Plan (FY)" ? renderCapexNameCell(row, key, displayRows) : (
                      <input
                        className="cell-input"
                        value={capexCellValue(row, key)}
                        readOnly={!isCapexCellEditable(row, key)}
                        onChange={(event) => {
                          const value = event.target.value;
                          setData((current) => ({
                            ...current,
                            rows: current.rows.map((item) => item.row_id === row.row_id ? { ...item, values: { ...item.values, [key]: value } } : item),
                          }));
                        }}
                        onBlur={(event) => !(activePlan?.locked) && saveCell(row.row_id, key, event.target.value)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            )) : <tr><td colSpan={keys.length} className="empty">No CAPEX rows available.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="capex-footer">
        <form className="capex-add-form" onSubmit={addRow}>
          <input placeholder="Item Name" value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })} />
          <select value={newRow.indent} onChange={(e) => setNewRow({ ...newRow, indent: e.target.value })}>
            <option value="0">Header</option>
            <option value="1">SubHeader</option>
            <option value="2">Item</option>
          </select>
          <button type="submit" className="capex-add">✚<span>Add</span></button>
        </form>
        <button type="button" className="capex-import" onClick={importCapexRows}>▣<span>Import</span></button>
        <button type="button" className="capex-save" onClick={() => saveRows(rows)}>▣<span>Save</span></button>
        <button type="button" className="capex-delete" onClick={deleteRow} disabled={!selectedRow}>▣<span>Delete</span></button>
        <button type="button" className="capex-indent" onClick={() => changeIndent(1)}>▣<span>Indent</span></button>
        <button type="button" className="capex-outdent" onClick={() => changeIndent(-1)}>▣<span>Outdent</span></button>
        <button type="button" className="capex-up" onClick={() => moveRow(-1)}>▣<span>Up</span></button>
        <button type="button" className="capex-down" onClick={() => moveRow(1)}>▣<span>Down</span></button>
        <button type="button" className="capex-refresh-small" onClick={() => load(planName)}>▣<span>Refresh</span></button>
        <button type="button" className="capex-close" onClick={onClose}>✕<span>Close</span></button>
      </div>
      {selectedRow ? <div className="capex-status">Selected: {selectedRow.values?.["CAPEX Plan (FY)"]}</div> : null}
      {message ? <div className="capex-status">{message}</div> : null}
      {planningOpen ? (
        <div className="capex-modal-backdrop">
          <div className="capex-planning-modal">
            <div className="capex-planning-head">
              <h2>CAPEX Planning Management</h2>
              <button type="button" className="capex-planning-help"><HelpCircle size={17} /> Help</button>
            </div>
            <div className="capex-planning-controls">
              <div className="capex-planning-control-row">
                <label>Financial Year (FY)
                  <select value={planDraft.financialYear} onChange={(event) => updatePlanChoice({ financialYear: event.target.value })}>
                    {[financialYear, "FY 2026-2027", "FY 2027-2028", "FY 2028-2029", "FY 2029-2030"].filter((value, index, list) => value && list.indexOf(value) === index).map((year) => <option key={year} value={year}>{year}{year === data?.financialYear ? " (Current FY)" : ""}</option>)}
                  </select>
                </label>
                <label>Plan Version
                  <select value={planDraft.planVersion} onChange={(event) => updatePlanChoice({ planVersion: event.target.value })}>
                    {CAPEX_PLAN_VERSIONS.map((version) => <option key={version} value={version}>{version}</option>)}
                  </select>
                </label>
                <label>Plan Type
                  <select value={planDraft.planType} onChange={(event) => { handleCapexPlanTypeChange(event.target.value); updatePlanChoice({ planType: event.target.value }); }}>
                    {CAPEX_PLAN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                {planDraft.planType === "RE" ? (
                  <label>RE Effective Date:
                    <input
                      ref={reEffectiveDateRef}
                      type="date"
                      value={reEffectiveDate}
                      onChange={(event) => setReEffectiveDate(event.target.value)}
                    />
                  </label>
                ) : null}
                <div className="capex-planning-active">
                  <span>Active Plan</span>
                  <button type="button" className={activePlan?.effective ? "on" : ""} onClick={setEffectivePlan}>
                    {activePlan?.effective ? "Yes" : "No"}
                  </button>
                  <Info size={17} />
                </div>
                <div className="capex-planning-top-actions">
                  <button type="button" className="capex-planning-create" onClick={createPlan}><Plus size={17} /> Create Plan</button>
                  <button type="button" className="capex-planning-save-top" onClick={() => saveRows(rows)}><Save size={17} /> Save Plan</button>
                  <button type="button" className="capex-planning-approve-top" onClick={approvePlan}><CheckCircle size={17} /> Approve Plan</button>
                </div>
              </div>
              <div className="capex-plan-manager">
                <label>Available Plans:
                  <select value={planName} onChange={(event) => { setPlanName(event.target.value); load(event.target.value); }}>
                    {plans.length ? plans.map((plan) => (
                      <option key={plan.name} value={plan.name}>
                        {plan.financial_year} | {plan.plan_version} | {plan.plan_type}{plan.effective ? " | Active" : ""}{plan.locked ? " | Locked" : ""}
                      </option>
                    )) : <option value="">No plans available</option>}
                  </select>
                </label>
                <button type="button" className="capex-plan-delete" onClick={deletePlan} disabled={!planName || (!isAdmin && (activePlan?.locked || activePlan?.approved))}>Delete Plan</button>
              </div>
            </div>
            <div className="capex-planning-workspace">
            <div className="capex-planning-metrics">
              <div className="capex-planning-metric blue"><IndianRupee size={28} /><span>Gross Cost</span><strong>₹ {number(grossCost)} Cr</strong></div>
              <div className="capex-planning-metric green"><ClipboardList size={28} /><span>{activeMetricLabel}</span><strong>₹ {number(activeMetricValue)} Cr</strong></div>
              <div className="capex-planning-metric purple"><BarChart3 size={28} /><span>Actual Till Date</span><strong>₹ {number(actualTillDateValue)} Cr</strong></div>
              <div className="capex-planning-metric orange"><Calculator size={28} /><span>Variance</span><strong>₹ {number(varianceValue)} Cr</strong></div>
              <div className="capex-planning-metric teal"><CheckCircle size={28} /><span>Progress</span><strong>{number(progressValue)}%</strong></div>
            </div>
            <div className="capex-planning-table-tools">
              <div className="capex-view-tabs">
                <span>View By</span>
                {["Monthly", "Quarterly", "FY Summary"].map((tab) => (
                  <button key={tab} type="button" className={capexViewBy === tab ? "active" : ""} onClick={() => setCapexViewBy(tab)}>{tab}</button>
                ))}
              </div>
              <div className="capex-export-tools">
                <span>Export</span>
                <button type="button" onClick={() => exportCapexExcel("planning")}><Download size={15} /> Excel</button>
                <button type="button" onClick={() => exportCapexPdf("planning")}><FileText size={15} /> PDF</button>
              </div>
            </div>
            <div className="capex-planning-table-wrap">
              <table className="capex-planning-table">
                <colgroup>
                  {planningBaseColumns.map((key, index) => (
                    <col key={key} style={{ width: index === 0 ? "380px" : index === 2 ? "210px" : "120px" }} />
                  ))}
                  {planningMonthColumns.map((key) => <col key={key} style={{ width: `${planningMonthColumnWidth}px` }} />)}
                </colgroup>
                <thead>
                  <tr>
                    {planningBaseColumns.map((key, index) => (
                      <th key={key} rowSpan="2" className={index < 3 ? "capex-head-yellow" : "capex-head-green"}>{key}</th>
                    ))}
                    {planningMonthGroups.map((group) => (
                      <th
                        key={group.month}
                        colSpan={group.subs.length}
                        className="capex-month-head"
                        style={{ width: `${group.subs.length * planningMonthColumnWidth}px` }}
                      >
                        {group.month}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {planningMonthGroups.flatMap((group) => group.subs.map((sub) => (
                      <th
                        key={sub.key}
                        className={sub.label === activePlan?.plan_type ? "capex-sub-head active" : "capex-sub-head locked"}
                        style={{ width: `${planningMonthColumnWidth}px` }}
                      >
                        {sub.label}
                      </th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {visiblePlanningDisplayRows.length ? (
                    <>
                      {visiblePlanningDisplayRows.map((row, rowIndex) => (
                        <tr key={row.row_id} className={`capex-level-${Math.min(Number(row.indent || 0), 2)}`}>
                          {planningKeys.map((key) => (
                            <td key={key} className={!isCapexCellEditable(row, key) && key !== "CAPEX Plan (FY)" ? "locked-cell" : ""}>
                              {key === "CAPEX Plan (FY)" ? renderCapexNameCell(row, key, planningDisplayRows) : (
                                <input
                                  className="cell-input"
                                  value={capexCellValue(row, key)}
                                  readOnly={!isCapexCellEditable(row, key)}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateCapexLocalCell(row.row_id, key, value);
                                  }}
                                  onBlur={(event) => isCapexCellEditable(row, key) && saveCell(row.row_id, key, event.target.value)}
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="capex-total-row">
                        {planningKeys.map((key) => (
                          <td key={key}><strong>{planningTotalDisplay[key]}</strong></td>
                        ))}
                      </tr>
                    </>
                  ) : (
                    <tr><td colSpan={planningKeys.length} className="empty">Create or select a CAPEX planning dataset to start entering BE / RE values.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <aside className="capex-planning-side">
              <section>
                <h3>Project Snapshot <Pin size={15} /></h3>
                <dl>
                  <dt>Project Name</dt><dd>{snapshotName}</dd>
                  <dt>Project Head</dt><dd>{selectedSnapshotRow ? (Number(selectedSnapshotRow.indent || 0) <= 1 ? snapshotName : "AMR - Ongoing") : "-"}</dd>
                  <dt>Gross Cost (₹ Cr)</dt><dd>{snapshotGross ? number(snapshotGross) : "-"}</dd>
                  <dt>Plan ({activePlan?.plan_type || "BE"}) (₹ Cr)</dt><dd>{snapshotPlan ? number(snapshotPlan) : "-"}</dd>
                  <dt>Actual Till Date (₹ Cr)</dt><dd>{number(snapshotActual)}</dd>
                  <dt>% Progress ({activePlan?.plan_type || "BE"})</dt><dd>{number(snapshotProgress)}%</dd>
                  <dt>Delay (Days)</dt><dd className={snapshotProgress < 50 ? "capex-delay" : ""}>{snapshotProgress < 50 ? "45 Days" : "-"}</dd>
                </dl>
              </section>
              <section>
                <h3>Plan vs Actual (S-Curve) <X size={14} /></h3>
                <div className="capex-plan-legend"><span className="plan"></span>Plan ({activePlan?.plan_type || "BE"})<span className="actual"></span>Actual</div>
                <svg className="capex-planning-scurve" viewBox="0 0 360 190" role="img" aria-label="Plan versus actual S-Curve">
                  <path d="M35 150H340M35 115H340M35 80H340M35 45H340" />
                  <path d="M35 150V28" />
                  <polyline className="plan" points="38,150 82,132 126,110 170,84 214,58 258,35 330,30" />
                  <polyline className="actual" points="38,150 82,148 126,144 170,136 214,126 258,118 330,102" />
                  <text x="32" y="174">Apr-26</text>
                  <text x="122" y="174">Jun-26</text>
                  <text x="212" y="174">Sep-26</text>
                  <text x="292" y="174">Mar-27</text>
                  <text x="4" y="46">5K</text>
                  <text x="11" y="151">0</text>
                </svg>
              </section>
              <section>
                <h3>Alerts <X size={14} /></h3>
                <div className="capex-alert danger">Project is behind schedule by 45 days</div>
                <div className="capex-alert warn">Actual is {number(snapshotProgress)}% vs Planned {number(Number(snapshotProgress || 0) + 19.83)}%</div>
                <div className="capex-alert note">Monitor cash flow requirement in next quarter</div>
                <div className={validationMessage.startsWith("Validation OK") ? "capex-alert ok" : "capex-alert danger"}>{validationMessage || "No validation message available."}</div>
                {message ? <div className="capex-alert info">{message}</div> : null}
              </section>
              <div className="capex-lock-note">
                <span>Saved active plans allow editing only Actual fields.</span>
                <div><Lock size={22} /></div>
              </div>
            </aside>
            </div>
            <div className="capex-planning-foot">
              <button className="capex-save" onClick={() => saveRows(rows)}>Save Draft</button>
              <button className="capex-approve" onClick={approvePlan}>Submit for Approval</button>
              <button className="capex-refresh-small" onClick={() => load(planName)}>Refresh</button>
              <div className="capex-planning-lock-note">
                <span>Saved active plans allow editing only Actual fields.</span>
                <div><Lock size={22} /></div>
              </div>
              <button className="capex-close" onClick={() => setPlanningOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleView() {
  const [schedules, setSchedules] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activities, setActivities] = useState([]);
  useEffect(() => {
    api("/api/schedules").then((data) => setSchedules(data.schedules || []));
  }, []);
  useEffect(() => {
    if (!selected) return;
    api(`/api/schedules/${selected}/activities`).then((data) => setActivities(data.activities || []));
  }, [selected]);
  return (
    <>
      <section className="panel">
        <h2>SCHEDULE IMPORTS</h2>
        <DataTable
          columns={[
            { key: "file_name", label: "File" },
            { key: "imported_at", label: "Imported At", render: (row) => formatDate(row.imported_at) },
            { key: "activity_count", label: "Activities", render: (row) => number(row.activity_count) },
            { key: "open", label: "Open", render: (row) => <button className="mini-btn" onClick={() => setSelected(row.id)}>Open</button> },
          ]}
          rows={schedules}
        />
      </section>
      <section className="panel">
        <h2>SCHEDULE ACTIVITIES</h2>
        <DataTable
          columns={[
            { key: "activity_code", label: "ID" },
            { key: "activity_name", label: "Task Name" },
            { key: "duration_days", label: "Duration" },
            { key: "start_date", label: "Start", render: (row) => formatDate(row.start_date) },
            { key: "finish_date", label: "Finish", render: (row) => formatDate(row.finish_date) },
            { key: "percent_complete", label: "% Complete", render: (row) => number(row.percent_complete) },
            { key: "is_critical", label: "Critical" },
          ]}
          rows={activities}
        />
      </section>
    </>
  );
}

function BillingScheduleView({ onBack, onHome, ongoingProjects = [], selectedProject }) {
  const emptyForm = {
    milestone_no: "",
    description: "",
    milestone_type: "Physical",
    weightage_percent: "",
    schedule_start: "",
    schedule_finish: "",
    scheduled_amount: "",
    scheduled_date: "",
    billed_amount: "",
    billed_date: "",
    received_amount: "",
    received_date: "",
    remarks: "",
    manufacturing_clearance: "",
    inspection_clearance: "",
    dispatch_clearance: "",
    site_receipt_clearance: "",
    approval_clearance: "",
  };
  const [data, setData] = useState({ projects: [], rows: [], summary: {} });
  const [projectId, setProjectId] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const uploadRef = useRef(null);
  const billingProjectOptions = useMemo(
    () => (ongoingProjects || []).filter((project) => String(project.project_type || "").trim() === "Corporate AMR"),
    [ongoingProjects],
  );
  const defaultBillingProjectId = useMemo(() => {
    if (selectedProject && String(selectedProject.project_type || "").trim() === "Corporate AMR") return String(selectedProject.id);
    if (billingProjectOptions.length) return String(billingProjectOptions[0].id);
    return "";
  }, [billingProjectOptions, selectedProject]);

  async function loadBilling(nextProjectId = projectId) {
    const requestedId = nextProjectId || defaultBillingProjectId;
    const suffix = requestedId ? `?project_id=${requestedId}` : "";
    try {
      const result = await api(`/api/billing-schedule${suffix}`);
      setData(result);
      const resolvedProjectId = result.projectId ? String(result.projectId) : String(requestedId || "");
      setProjectId(resolvedProjectId);
      setSelectedRow(null);
      setForm(emptyForm);
      return;
    } catch (err) {
      setData({ projects: billingProjectOptions, rows: [], summary: {} });
      setProjectId(String(requestedId || ""));
      setSelectedRow(null);
      setForm(emptyForm);
      setMessage(err.message || "Unable to load billing schedule.");
    }
  }

  useEffect(() => {
    loadBilling(defaultBillingProjectId);
  }, [defaultBillingProjectId]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function editRow(row) {
    setSelectedRow(row);
    setForm({
      milestone_no: row.milestone_no ?? "",
      description: row.description || "",
      milestone_type: row.milestone_type || "Physical",
      weightage_percent: row.weightage_percent ?? "",
      schedule_start: row.schedule_start || "",
      schedule_finish: row.schedule_finish || "",
      scheduled_amount: row.scheduled_amount ?? "",
      scheduled_date: row.scheduled_date || "",
      billed_amount: row.billed_amount ?? "",
      billed_date: row.billed_date || "",
      received_amount: row.received_amount ?? "",
      received_date: row.received_date || "",
      remarks: row.remarks || "",
      manufacturing_clearance: row.manufacturing_clearance || "",
      inspection_clearance: row.inspection_clearance || "",
      dispatch_clearance: row.dispatch_clearance || "",
      site_receipt_clearance: row.site_receipt_clearance || "",
      approval_clearance: row.approval_clearance || "",
    });
  }

  async function saveMilestone(event) {
    event.preventDefault();
    if (!projectId) {
      setMessage("Select a project before saving.");
      return;
    }
    try {
      const payload = { ...form, project_id: Number(projectId) };
      if (selectedRow?.id) {
        await api(`/api/billing-schedule/${selectedRow.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setMessage("Billing milestone updated.");
      } else {
        await api("/api/billing-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setMessage("Billing milestone added.");
      }
      await loadBilling(projectId);
    } catch (err) {
      setMessage(err.message || "Unable to save billing milestone.");
    }
  }

  async function deleteMilestone() {
    if (!selectedRow?.id) {
      setMessage("Select a milestone to delete.");
      return;
    }
    try {
      await api(`/api/billing-schedule/${selectedRow.id}`, { method: "DELETE" });
      setMessage("Billing milestone deleted.");
      await loadBilling(projectId);
    } catch (err) {
      setMessage(err.message || "Unable to delete billing milestone.");
    }
  }

  function downloadTemplate() {
    const headers = [
      "Milestone No",
      "Description",
      "Schedule Start",
      "Schedule Finish",
      "Milestone Type",
      "Weightage %",
      "Scheduled Amount",
      "Scheduled Date",
      "Billed Amount",
      "Billed Date",
      "Received Amount",
      "Received Date",
      "Remarks",
    ];
    const sample = ["1", "Civil Foundation Work", "01-04-26", "30-06-26", "Physical", "12", "25000000", "30-06-26", "25000000", "10-07-26", "25000000", "20-07-26", "First Milestone"];
    const csv = [headers, sample].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Billing_Schedule_Template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function uploadTemplate(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !projectId) return;
    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      const headers = (rows.shift() || []).map((cell) => String(cell || "").trim().toLowerCase());
      const indexOf = (name) => headers.indexOf(name.toLowerCase());
      let imported = 0;
      for (const row of rows) {
        if (!String(row[indexOf("Milestone No")] || "").trim()) continue;
        await api("/api/billing-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: Number(projectId),
            milestone_no: row[indexOf("Milestone No")] || "",
            description: row[indexOf("Description")] || "",
            schedule_start: row[indexOf("Schedule Start")] || "",
            schedule_finish: row[indexOf("Schedule Finish")] || "",
            milestone_type: row[indexOf("Milestone Type")] || "Physical",
            weightage_percent: row[indexOf("Weightage %")] || 0,
            scheduled_amount: row[indexOf("Scheduled Amount")] || 0,
            scheduled_date: row[indexOf("Scheduled Date")] || "",
            billed_amount: row[indexOf("Billed Amount")] || 0,
            billed_date: row[indexOf("Billed Date")] || "",
            received_amount: row[indexOf("Received Amount")] || 0,
            received_date: row[indexOf("Received Date")] || "",
            remarks: row[indexOf("Remarks")] || "",
          }),
        });
        imported += 1;
      }
      setMessage(`Imported ${imported} billing milestone${imported === 1 ? "" : "s"}.`);
      await loadBilling(projectId);
    } catch (err) {
      setMessage(err.message || "Unable to upload billing template.");
    }
  }

  const projectOptions = (data.projects || []).length ? data.projects : billingProjectOptions;
  const selectedBillingProject = projectOptions.find((project) => String(project.id) === String(projectId));
  const rows = data.rows || [];
  const summary = data.summary || {};
  const meta = data.meta || {};
  const appendixActivities = data.appendixActivities || [];
  const clearanceRows = data.clearanceRows || [];
  const workflow = data.workflow || [];
  const auditLog = data.auditLog || [];
  const cr = (value) => number(Number(value || 0) / 10000000);
  const money = (value) => `Rs ${cr(value)} Cr`;
  const pct = (value) => `${number(value || 0)}%`;
  const selectedLinkedActivity = selectedRow?.appendix2_id
    ? appendixActivities.find((activity) => String(activity.id) === String(selectedRow.appendix2_id))
    : null;
  const activeMilestone = selectedRow || rows[0] || null;
  const contractValue = Number(summary.totalScheduled || 0);
  const balanceBilling = Math.max(0, Number(summary.totalScheduled || 0) - Number(summary.totalBilled || 0));
  const pvClaimed = rows.reduce((sum, row) => sum + (Number(row.billed_amount || 0) * 0.06), 0);
  const pvPaid = rows.reduce((sum, row) => sum + (Number(row.received_amount || 0) * 0.04), 0);
  const billStatusClass = (status) => String(status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "pending";
  const overdueDays = (row) => {
    const dueDate = parseAppDateValue(row?.scheduled_date || row?.schedule_finish);
    if (!dueDate || Number(row?.received_amount || 0) >= Number(row?.scheduled_amount || 0)) return "-";
    const today = new Date();
    const days = Math.floor((today - dueDate) / 86400000);
    return days > 0 ? days : "-";
  };

  return (
    <section className="billing-window billing-monitor">
      <div className="billing-control-strip">
        <label>Project
          <select value={projectId} onChange={(event) => loadBilling(event.target.value)}>
            {projectOptions.length ? null : <option value="">No Corporate AMR ongoing projects</option>}
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>{project.display_name || project.project_name}</option>
            ))}
          </select>
        </label>
        <label>Package / LOA<select value="PKG-01" readOnly><option>PKG-01</option></select></label>
        <label>Contractor<select value={selectedBillingProject?.contractor_name || "Contractor"} readOnly><option>{selectedBillingProject?.contractor_name || "Contractor"}</option></select></label>
        <label>LOA No.<input readOnly value={selectedBillingProject?.unique_id || "-"} /></label>
        <label>LOA Date<input readOnly value={formatDate(selectedBillingProject?.loa_date || selectedBillingProject?.stage2_date) || "-"} /></label>
        <button type="button" className="billing-refresh" onClick={() => loadBilling(projectId)}><RefreshCw size={16} /> Refresh</button>
        <button type="button" className="billing-icon-btn" onClick={downloadTemplate} title="Download template"><Download size={17} /></button>
      </div>

      <div className="billing-kpis billing-monitor-kpis">
        <div><BadgeIndianRupee size={32} /><span>Contract Value (Basic)</span><strong>{money(contractValue)}</strong></div>
        <div><FileText size={32} /><span>Billing Schedule Value</span><strong>{money(summary.totalScheduled)}</strong></div>
        <div><ClipboardList size={32} /><span>Billed Till Date (Basic)</span><strong>{money(summary.totalBilled)}</strong><small>{pct(summary.progressPercent)}</small></div>
        <div><IndianRupee size={32} /><span>Paid Till Date (Basic)</span><strong>{money(summary.totalReceived)}</strong><small>{pct(summary.receiptProgressPercent)}</small></div>
        <div><BadgeIndianRupee size={32} /><span>PV Claimed Till Date</span><strong>{money(pvClaimed)}</strong></div>
        <div><BadgeIndianRupee size={32} /><span>PV Paid Till Date</span><strong>{money(pvPaid)}</strong></div>
        <div><BarChart3 size={32} /><span>Balance Billing (Basic)</span><strong>{money(balanceBilling)}</strong><small>{pct(100 - Number(summary.progressPercent || 0))}</small></div>
        <div><BarChart3 size={32} /><span>Consumption Status</span><strong>{pct(summary.progressPercent)}</strong><small>Actual vs Contract Qty</small></div>
      </div>

      <nav className="billing-monitor-tabs">
        {["1. Billing Schedule", "2. RA Bill Entry", "3. Consumption Monitoring", "4. Price Variation Calculation", "5. Dispatch Clearance / Supply Linkage", "6. Payment & Deduction Tracker", "7. Reports"].map((tab, index) => (
          <button key={tab} type="button" className={index === 0 ? "active" : ""}><FileText size={15} /> {tab}</button>
        ))}
      </nav>

      <section className="billing-monitor-table-panel">
        <h2>Billing Schedule / Milestone</h2>
        <div className="billing-table-wrap">
          <table className="billing-table billing-milestone-grid">
            <thead>
              <tr>
                <th rowSpan="2">Sl. No.</th><th rowSpan="2">Billing Milestone</th><th rowSpan="2">Linked Appendix-2 Activity</th><th rowSpan="2">Billing Type</th><th rowSpan="2">Weightage (%)</th><th rowSpan="2">Amount (Rs)</th>
                <th>Planned</th><th>Actual</th><th rowSpan="2">RA Bill No.</th><th rowSpan="2">Status</th><th rowSpan="2">Bill Due Date</th><th rowSpan="2">Overdue (Days)</th><th rowSpan="2">Remarks</th>
              </tr>
              <tr><th>Date</th><th>Date</th></tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row, index) => (
                <tr key={row.id} className={activeMilestone?.id === row.id ? "selected" : ""} onClick={() => editRow(row)}>
                  <td>{index + 1}</td><td>{row.description || "-"}</td><td>{row.appendix2_id ? `A2-${row.milestone_no}` : "Manual"}</td><td>{row.milestone_type || "Physical"}</td><td>{number(row.weightage_percent || 0)}</td><td>{number(row.scheduled_amount || 0)}</td>
                  <td>{formatDate(row.scheduled_date || row.schedule_finish) || "-"}</td><td>{formatDate(row.billed_date) || "-"}</td><td>{row.billed_amount ? `RA-${String(row.milestone_no || index + 1).padStart(3, "0")}` : "-"}</td>
                  <td><span className={`billing-status-pill ${billStatusClass(row.status)}`}>{row.status}</span></td><td>{formatDate(row.received_date || row.scheduled_date) || "-"}</td><td className={overdueDays(row) !== "-" ? "billing-overdue" : ""}>{overdueDays(row)}</td><td>{row.remarks || "-"}</td>
                </tr>
              )) : <tr><td colSpan="13" className="empty">No billing milestones available.</td></tr>}
              <tr className="billing-total-row"><td colSpan="4">Total</td><td>{number(rows.reduce((sum, row) => sum + Number(row.weightage_percent || 0), 0))}</td><td>{number(summary.totalScheduled || 0)}</td><td colSpan="7"></td></tr>
            </tbody>
          </table>
        </div>
        <p className="billing-note">Note: Click on any milestone row to view / add related bills, consumption, PV, dispatch and payments.</p>
      </section>

      <div className="billing-detail-grid">
        <section className="billing-monitor-card selected-detail"><h3>Selected Milestone Details</h3><dl><dt>Milestone</dt><dd>{activeMilestone?.description || "-"}</dd><dt>Linked Activity</dt><dd>{activeMilestone?.appendix2_id ? `A2-${activeMilestone.milestone_no}` : "Manual"}</dd><dt>Billing Type</dt><dd>{activeMilestone?.milestone_type || "-"}</dd><dt>Weightage</dt><dd>{number(activeMilestone?.weightage_percent || 0)}%</dd><dt>Milestone Amount</dt><dd>{number(activeMilestone?.scheduled_amount || 0)}</dd><dt>Planned Date</dt><dd>{formatDate(activeMilestone?.scheduled_date || activeMilestone?.schedule_finish) || "-"}</dd><dt>Actual Date</dt><dd>{formatDate(activeMilestone?.billed_date) || "-"}</dd><dt>Status</dt><dd><span className={`billing-status-pill ${billStatusClass(activeMilestone?.status)}`}>{activeMilestone?.status || "-"}</span></dd></dl></section>
        <section className="billing-monitor-card"><h3>RA Bills Linked to this Milestone</h3><table className="billing-mini-table"><thead><tr><th>RA Bill No.</th><th>Bill Date</th><th>Basic Amount</th><th>GST</th><th>PV</th><th>Retention</th><th>Net Payable</th><th>Status</th></tr></thead><tbody>{activeMilestone ? <tr><td>RA-{String(activeMilestone.milestone_no || 1).padStart(3, "0")}</td><td>{formatDate(activeMilestone.billed_date) || "-"}</td><td>{number(activeMilestone.billed_amount || 0)}</td><td>{number(Number(activeMilestone.billed_amount || 0) * 0.18)}</td><td>{number(Number(activeMilestone.billed_amount || 0) * 0.06)}</td><td>{number(Number(activeMilestone.billed_amount || 0) * 0.05)}</td><td>{number(activeMilestone.received_amount || 0)}</td><td><span className={`billing-status-pill ${billStatusClass(activeMilestone.payment_status)}`}>{activeMilestone.payment_status || "-"}</span></td></tr> : <tr><td colSpan="8">No bill selected.</td></tr>}</tbody></table></section>
        <section className="billing-monitor-card"><h3>Price Variation Summary</h3><table className="billing-mini-table"><thead><tr><th>PV Item / Component</th><th>Base Index</th><th>Current Index</th><th>PV %</th><th>PV Amount</th></tr></thead><tbody>{["Steel", "Copper", "Aluminium"].map((name, index) => <tr key={name}><td>{name}</td><td>{number(120 + index * 55)}</td><td>{number(138 + index * 61)}</td><td>100.00%</td><td>{number((activeMilestone?.billed_amount || 0) * (0.03 - index * 0.005))}</td></tr>)}</tbody></table></section>
        <section className="billing-monitor-card"><h3>Consumption Summary</h3><table className="billing-mini-table"><thead><tr><th>Item Code</th><th>Material Description</th><th>UOM</th><th>Contract Qty</th><th>Actual Consumed Qty</th><th>Balance Qty</th><th>Consumption %</th></tr></thead><tbody>{appendixActivities.slice(0, 4).map((activity, index) => <tr key={activity.id || index}><td>IT-{String(index + 1).padStart(3, "0")}</td><td>{activity.activityName}</td><td>Nos</td><td>{number(1000 - index * 150)}</td><td>{number((1000 - index * 150) * 0.72)}</td><td>{number((1000 - index * 150) * 0.28)}</td><td><span className="billing-consumption-good">72.00%</span></td></tr>)}</tbody></table></section>
        <section className="billing-monitor-card"><h3>Dispatch / Supply Status</h3><table className="billing-mini-table"><thead><tr><th>Material / Equipment</th><th>PO / Item</th><th>Dispatch Clearance Date</th><th>Site Receipt Date</th><th>Status</th></tr></thead><tbody>{clearanceRows.slice(0, 4).map((row, index) => <tr key={`${row.linkedMilestone}-${index}`}><td>{row.item}</td><td>PO-{index + 1}</td><td>{row.dispatch}</td><td>{row.siteReceipt}</td><td><span className="billing-status-pill paid">{row.eligibility}</span></td></tr>)}</tbody></table></section>
        <section className="billing-monitor-card"><h3>Payment Tracker</h3><table className="billing-mini-table"><thead><tr><th>Bill No.</th><th>Certified Amount</th><th>GST</th><th>PV</th><th>Retention</th><th>Net Paid</th><th>Payment Date</th></tr></thead><tbody>{rows.filter((row) => Number(row.received_amount || 0) > 0).slice(0, 3).map((row, index) => <tr key={row.id}><td>RA-{String(row.milestone_no || index + 1).padStart(3, "0")}</td><td>{number(row.billed_amount || 0)}</td><td>{number(Number(row.billed_amount || 0) * 0.18)}</td><td>{number(Number(row.billed_amount || 0) * 0.06)}</td><td>{number(Number(row.billed_amount || 0) * 0.05)}</td><td>{number(row.received_amount || 0)}</td><td>{formatDate(row.received_date) || "-"}</td></tr>)}</tbody></table></section>
      </div>

      <div className="billing-bottom-actions"><button type="button" onClick={() => { setSelectedRow(null); setForm(emptyForm); }}><Plus size={16} /> Add RA Bill</button><button type="button"><PlusCircle size={16} /> Add Consumption</button><button type="button"><Calculator size={16} /> Calculate PV</button><button type="button"><FolderKanban size={16} /> Link Dispatch</button><button type="button" onClick={saveMilestone}><IndianRupee size={16} /> Add Payment</button><button type="button" onClick={downloadTemplate}><FileText size={16} /> View Documents</button><button type="button"><CalendarDays size={16} /> Milestone History</button><button type="button" className="close" onClick={onBack}><X size={16} /> Close</button></div>
      {message ? <p className="billing-message floating">{message}</p> : null}
      <input ref={uploadRef} type="file" accept=".csv,text/csv" hidden onChange={uploadTemplate} />
    </section>
  );

  return (
    <section className="billing-window">
      <div className="billing-topbar">
        <div className="billing-title-block">
          <h1>Billing Schedule</h1>
          <p>{selectedBillingProject ? `${selectedBillingProject.unique_id} - ${selectedBillingProject.project_name}` : "Select a project to manage billing milestones"}</p>
        </div>
        <div className="billing-head-actions">
          <label>
            Project
            <select value={projectId} onChange={(event) => loadBilling(event.target.value)}>
              {projectOptions.length ? null : <option value="">No Corporate AMR ongoing projects</option>}
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>{project.unique_id} - {project.display_name || project.project_name}</option>
              ))}
            </select>
          </label>
          <label>
            Financial Year
            <select value={meta.financialYear || "2026-27"} readOnly>
              <option>{meta.financialYear || "2026-27"}</option>
            </select>
          </label>
          <label>
            Plan Version
            <select value={meta.planVersion || "Rev-0"} readOnly>
              <option>{meta.planVersion || "Rev-0"} {meta.isActive ? "(Active)" : ""}</option>
            </select>
          </label>
          <button type="button" className="billing-back" onClick={onBack}>
            <ArrowLeft size={17} /> Back
          </button>
          <button type="button" className="billing-home" onClick={onHome}>
            <Home size={17} /> Home
          </button>
        </div>
        <div className="billing-role">
          <span>Status</span>
          <strong>{meta.approvalStatus || summary.approvalStatus || "Draft"}</strong>
        </div>
      </div>

      <div className="billing-kpis">
        <div><CalendarDays size={28} /><span>Total Scheduled</span><strong>{money(summary.totalScheduled)}</strong><small>From approved plan</small></div>
        <div><FileText size={28} /><span>Total Billed</span><strong>{money(summary.totalBilled)}</strong><small>{pct(summary.progressPercent)} of scheduled</small></div>
        <div><Download size={28} /><span>Total Received</span><strong>{money(summary.totalReceived)}</strong><small>{pct(summary.receiptProgressPercent)} of billed</small></div>
        <div><IndianRupee size={28} /><span>Pending Amount</span><strong>{money(summary.pendingAmount)}</strong><small>Billed minus received</small></div>
        <div><BarChart3 size={28} /><span>Billing Progress</span><strong>{pct(summary.progressPercent)}</strong><i><em style={{ width: `${Math.min(100, Number(summary.progressPercent || 0))}%` }} /></i></div>
        <div><CheckCircle size={28} /><span>Approval Status</span><strong>{meta.approvalStatus || summary.approvalStatus || "Draft"}</strong><small>Role: {meta.userRole || "Admin"}</small></div>
      </div>

      <div className="billing-dashboard-grid">
        <div className="billing-left-stack">
          <section className="billing-workflow-card">
            <div className="billing-section-head"><h2>Billing Schedule Workflow</h2><span>Current Status: {meta.approvalStatus || "Draft"}</span></div>
            <div className="billing-workflow-steps">
              {workflow.map((step, index) => (
                <React.Fragment key={`${step.label}-${index}`}>
                  <div className={`billing-workflow-step ${step.status}`}>
                    <span><ClipboardList size={18} /></span>
                    <strong>{step.label}</strong>
                    <small>{step.date || (step.status === "pending" ? "Pending" : "")}</small>
                  </div>
                  {index < workflow.length - 1 ? <b className="billing-workflow-arrow">→</b> : null}
                </React.Fragment>
              ))}
            </div>
          </section>

          <section className="billing-panel">
            <div className="billing-section-head">
              <h2>A. Appendix-2 Activities (Auto Picked)</h2>
              <button type="button" onClick={() => loadBilling(projectId)}>View Appendix-2</button>
            </div>
            <div className="billing-table-wrap compact">
              <table className="billing-table">
                <thead><tr><th>No.</th><th>Activity Code</th><th>Activity / Sub Activity</th><th>Weight (%)</th><th>Scheduled Amount</th><th>Billing Linked (%)</th><th>Billed Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {appendixActivities.length ? appendixActivities.map((activity, index) => (
                    <tr key={activity.id || index}>
                      <td>{index + 1}</td>
                      <td>{activity.activityCode}</td>
                      <td>{activity.activityName}{activity.subActivity ? ` + ${activity.subActivity}` : ""}</td>
                      <td>{number(activity.weightagePercent || 0)}</td>
                      <td>{number(activity.scheduledAmount || 0)}</td>
                      <td>{number(activity.billingLinkedPercent || 0)}</td>
                      <td>{number(activity.billedAmount || 0)}</td>
                      <td><span>{activity.status}</span></td>
                    </tr>
                  )) : <tr><td colSpan="8" className="empty">No Appendix-2 activities available for the selected project.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="billing-panel">
            <div className="billing-section-head">
              <h2>B. Milestone / Line Item Billing</h2>
              <div>
                <button type="button" className="billing-add" onClick={() => { setSelectedRow(null); setForm(emptyForm); }}>Add Milestone</button>
                <button type="button" className="billing-template" onClick={downloadTemplate}>Download Template</button>
                <button type="button" className="billing-upload" onClick={() => uploadRef.current?.click()}>Upload Template</button>
                <input ref={uploadRef} type="file" accept=".csv,text/csv" hidden onChange={uploadTemplate} />
              </div>
            </div>
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead><tr><th>Milestone No.</th><th>Linked Activity</th><th>Description</th><th>Start Date</th><th>Finish Date</th><th>Scheduled Amount</th><th>Billed Amount</th><th>Received Amount</th><th>Balance</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {rows.length ? rows.map((row) => (
                    <tr key={row.id} className={selectedRow?.id === row.id ? "selected" : ""} onClick={() => editRow(row)}>
                      <td>{row.milestone_no}</td>
                      <td>{row.appendix2_id ? `A2-${row.milestone_no}` : "Manual"}</td>
                      <td>{row.description}</td>
                      <td>{row.schedule_start || "-"}</td>
                      <td>{row.schedule_finish || "-"}</td>
                      <td>{number(row.scheduled_amount || 0)}</td>
                      <td>{number(row.billed_amount || 0)}</td>
                      <td>{number(row.received_amount || 0)}</td>
                      <td>{number(row.balance_amount || 0)}</td>
                      <td><span>{row.status}</span></td>
                      <td><Eye size={15} /></td>
                    </tr>
                  )) : <tr><td colSpan="11" className="empty">No billing milestones available.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="billing-panel">
            <div className="billing-section-head"><h2>C. Dispatch &amp; Clearance Tracker</h2></div>
            <div className="billing-table-wrap compact">
              <table className="billing-table">
                <thead><tr><th>Item / Equipment</th><th>Linked Milestone</th><th>Mfg. Clearance</th><th>Inspection</th><th>Dispatch</th><th>Site Receipt</th><th>Billing Eligibility</th><th>Remarks</th></tr></thead>
                <tbody>
                  {clearanceRows.length ? clearanceRows.map((row, index) => (
                    <tr key={`${row.linkedMilestone}-${index}`}>
                      <td>{row.item}</td><td>{row.linkedMilestone}</td><td>{row.manufacturing}</td><td>{row.inspection}</td><td>{row.dispatch}</td><td>{row.siteReceipt}</td><td><span>{row.eligibility}</span></td><td>{row.remarks || "-"}</td>
                    </tr>
                  )) : <tr><td colSpan="8" className="empty">No clearance records available.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="billing-analytics">
            <div><h3>Billing vs Schedule (S-Curve)</h3><div className="billing-mini-chart">{rows.slice(0, 8).map((row, index) => <span key={row.id || index} style={{ height: `${Math.max(6, Math.min(80, Number(row.scheduled_amount || 0) / Math.max(1, Number(summary.totalScheduled || 1)) * 120))}%` }} />)}</div></div>
            <div><h3>Pending vs Cleared Amount</h3><div className="billing-mini-chart orange">{rows.slice(0, 8).map((row, index) => <span key={row.id || index} style={{ height: `${Math.max(6, Math.min(80, Number(row.pending_payment || 0) / Math.max(1, Number(summary.totalBilled || 1)) * 120))}%` }} />)}</div></div>
            <div><h3>Milestone Status Summary</h3><div className="billing-donut"><strong>{rows.length}</strong><span>Total</span></div></div>
          </section>
        </div>

        <div className="billing-right-stack">
          <section className="billing-panel billing-workflow-actions">
            <h2>Workflow Actions</h2>
            <div>
              <button type="button" className="billing-template">Submit for Approval</button>
              <button type="button" className="billing-add">Approve</button>
              <button type="button" className="billing-delete">Reject</button>
              <button type="button" className="billing-refresh">Version History</button>
            </div>
            <p><b>Last Action:</b> {meta.lastAction || "-"}</p>
            <p><b>Pending With:</b> {meta.pendingWith || "-"}</p>
          </section>

          <form className="billing-form redesigned" onSubmit={saveMilestone}>
            <div className="billing-tabs"><span className="active">Milestone Details</span><span>Billing Details</span><span>Clearances</span><span>Remarks & Docs</span></div>
            <h2>{selectedRow ? "Update Milestone" : "Add Milestone"}</h2>
            <label>Milestone No.<input value={form.milestone_no} onChange={(event) => updateForm("milestone_no", event.target.value)} /></label>
            <label>Linked Activity<input value={selectedLinkedActivity ? `${selectedLinkedActivity.activityCode} - ${selectedLinkedActivity.activityName}` : "Auto / Manual"} readOnly /></label>
            <label className="wide">Description<input value={form.description} onChange={(event) => updateForm("description", event.target.value)} /></label>
            <label>Start Date<input placeholder="DD-MM-YY" value={form.schedule_start} onChange={(event) => updateForm("schedule_start", event.target.value)} /></label>
            <label>Finish Date<input placeholder="DD-MM-YY" value={form.schedule_finish} onChange={(event) => updateForm("schedule_finish", event.target.value)} /></label>
            <label>Milestone Type<select value={form.milestone_type} onChange={(event) => updateForm("milestone_type", event.target.value)}><option>Physical</option><option>Supply</option><option>Civil</option><option>Structural Erection</option><option>Equipment Erection</option><option>Service</option></select></label>
            <label>Weightage (%)<input value={form.weightage_percent} onChange={(event) => updateForm("weightage_percent", event.target.value)} /></label>
            <label>Scheduled Amount<input value={form.scheduled_amount} onChange={(event) => updateForm("scheduled_amount", event.target.value)} /></label>
            <label>Scheduled Date<input placeholder="DD-MM-YY" value={form.scheduled_date} onChange={(event) => updateForm("scheduled_date", event.target.value)} /></label>
            <label>Billed Amount<input value={form.billed_amount} onChange={(event) => updateForm("billed_amount", event.target.value)} /></label>
            <label>Billed Date<input placeholder="DD-MM-YY" value={form.billed_date} onChange={(event) => updateForm("billed_date", event.target.value)} /></label>
            <label>Received Amount<input value={form.received_amount} onChange={(event) => updateForm("received_amount", event.target.value)} /></label>
            <label>Received Date<input placeholder="DD-MM-YY" value={form.received_date} onChange={(event) => updateForm("received_date", event.target.value)} /></label>
            <label>Manufacturing<input value={form.manufacturing_clearance} onChange={(event) => updateForm("manufacturing_clearance", event.target.value)} /></label>
            <label>Inspection<input value={form.inspection_clearance} onChange={(event) => updateForm("inspection_clearance", event.target.value)} /></label>
            <label>Dispatch<input value={form.dispatch_clearance} onChange={(event) => updateForm("dispatch_clearance", event.target.value)} /></label>
            <label>Site Receipt<input value={form.site_receipt_clearance} onChange={(event) => updateForm("site_receipt_clearance", event.target.value)} /></label>
            <label className="wide">Remarks<input value={form.remarks} onChange={(event) => updateForm("remarks", event.target.value)} /></label>
            <div className="billing-doc-list">
              <h3>Documents</h3>
              {["Invoice", "Inspection Report", "Dispatch Document", "Measurement Sheet"].map((name) => <p key={name}><span>{name}</span><button type="button">Upload</button></p>)}
            </div>
            <div className="billing-audit">
              <h3>Approval Log</h3>
              {auditLog.length ? auditLog.map((log, index) => <p key={index}><span>{log.action}</span><small>{log.by} {log.remarks ? `- ${log.remarks}` : ""}</small></p>) : <p><span>Pending</span><small>No approval action yet</small></p>}
            </div>
            <div className="billing-form-actions">
              <button type="submit">{selectedRow ? "Update Milestone" : "Save Milestone"}</button>
              <button type="button" onClick={() => { setSelectedRow(null); setForm(emptyForm); }}>Reset</button>
              <button type="button" onClick={deleteMilestone} disabled={!selectedRow}>Delete</button>
            </div>
            {message ? <p className="billing-message">{message}</p> : null}
          </form>
        </div>
      </div>
    </section>
  );
}

function ReportsView() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api("/api/reports/summary").then(setData);
  }, []);
  return (
    <>
      <section className="panel">
        <h2>REPORTS</h2>
        <div className="metric-grid">
          <Metric title="STAGE-1 COST" value={data?.costs?.stage1_cost || 0} />
          <Metric title="STAGE-2 COST" value={data?.costs?.stage2_cost || 0} />
        </div>
      </section>
      <section className="panel">
        <h2>PROJECT TYPE SUMMARY</h2>
        <DataTable columns={[{ key: "project_type", label: "Project Type" }, { key: "count", label: "Count" }]} rows={data?.byType || []} />
      </section>
    </>
  );
}

function RepositoryView({ project }) {
  return (
    <section className="panel">
      <h2>REPOSITORY</h2>
      <div className="placeholder">
        <Search size={28} />
        <b>{project ? project.project_name : "Select a project"}</b>
        <span>Repository window is available in the desktop app. This web section is ready for document list/upload APIs.</span>
      </div>
    </section>
  );
}

function AdminView({ user, onOpenRegistration }) {
  const [data, setData] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [dailySettings, setDailySettings] = useState({ backdateDays: 3 });
  const [dailySettingsMessage, setDailySettingsMessage] = useState("");
  const [rightsDraft, setRightsDraft] = useState({});
  const [projectDraft, setProjectDraft] = useState([]);
  const [rightsMessage, setRightsMessage] = useState("");
  useEffect(() => {
    api("/api/admin/users").then(setData);
    api("/api/admin/daily-progress-settings").then(setDailySettings);
  }, []);

  useEffect(() => {
    if (!selectedUserId && data?.users?.length) {
      setSelectedUserId(data.users[0].id);
    }
  }, [data, selectedUserId]);

  const users = data?.users || [];
  const modulesForRights = data?.modules || modules.filter((item) => item.key !== "admin");
  const projectsForRights = data?.projects || [];
  const selectedUser = users.find((item) => item.id === selectedUserId) || users[0] || null;
  const selectedProjectIds = new Set((projectDraft || []).map((id) => Number(id)));
  const selectedPermissions = rightsDraft || {};

  useEffect(() => {
    if (!selectedUser) return;
    setRightsDraft(selectedUser.permissions || {});
    setProjectDraft(selectedUser.projectIds || []);
    setRightsMessage("");
  }, [selectedUser?.id]);

  function updatePermission(moduleKey, field, checked) {
    setRightsDraft((current) => ({
      ...current,
      [moduleKey]: {
        ...(current[moduleKey] || {}),
        [field]: checked,
      },
    }));
  }

  function updateProjectAccess(projectId, checked) {
    setProjectDraft((current) => checked
      ? Array.from(new Set([...(current || []), Number(projectId)]))
      : (current || []).filter((id) => Number(id) !== Number(projectId)));
  }

  async function saveUserRights() {
    if (!selectedUser) return;
    setRightsMessage("");
    try {
      const result = await api("/api/admin/users/rights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUser.id,
          permissions: rightsDraft,
          project_ids: projectDraft,
          requested_by_role: user?.role || "",
        }),
      });
      setRightsDraft(result.permissions || rightsDraft);
      setProjectDraft(result.projectIds || projectDraft);
      const fresh = await api("/api/admin/users");
      setData(fresh);
      setRightsMessage("User rights saved.");
    } catch (error) {
      setRightsMessage(error.message || "Unable to save user rights.");
    }
  }

  async function saveDailyProgressSettings() {
    setDailySettingsMessage("");
    try {
      const result = await api("/api/admin/daily-progress-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backdate_days: Number(dailySettings.backdateDays || 0),
          requested_by_role: user?.role || "",
        }),
      });
      setDailySettings({ backdateDays: result.backdateDays });
      setDailySettingsMessage("Daily Progress date window updated.");
    } catch (error) {
      setDailySettingsMessage(error.message || "Unable to update Daily Progress date window.");
    }
  }

  return (
    <section className="admin-window">
      <h1>Admin Panel - User Management &amp; Rights</h1>
      <div className="admin-action-row">
        <button className="admin-open" onClick={onOpenRegistration}>Open Project Registration</button>
        <button className="admin-close" type="button">Close</button>
      </div>
      <div className="admin-body">
        <div className="admin-users-panel">
          <h2>Users</h2>
          <div className="admin-users-list">
            {users.map((user) => (
              <button
                key={user.id}
                className={selectedUser?.id === user.id ? "selected" : ""}
                onClick={() => setSelectedUserId(user.id)}
              >
                {user.username} ({user.role}, {user.active ? "Active" : "Inactive"})
              </button>
            ))}
          </div>
        </div>

        <div className="admin-workspace">
          <fieldset className="admin-fieldset admin-details">
            <legend>User Details</legend>
            <label>
              <span>Username:</span>
              <input value={selectedUser?.username || ""} readOnly />
            </label>
            <label>
              <span>Password:</span>
              <input value="" type="password" readOnly />
            </label>
            <label>
              <span>Role:</span>
              <select value={selectedUser?.role || "user"} disabled>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="admin-check-label">
              <input type="checkbox" checked={Boolean(selectedUser?.active)} readOnly />
              <span>Active</span>
            </label>
          </fieldset>

          <fieldset className="admin-fieldset admin-daily-settings">
            <legend>Daily Progress Date Control</legend>
            <label>
              <span>Allowed Back Date Days:</span>
              <input
                type="number"
                min="0"
                max="365"
                value={dailySettings.backdateDays ?? 3}
                onChange={(event) => setDailySettings({ backdateDays: event.target.value })}
              />
            </label>
            <small>Default T-3 means data can be entered from three days ago up to today.</small>
            <button type="button" className="admin-save admin-setting-save" onClick={saveDailyProgressSettings}>
              <Save size={15} /> Save Date Rule
            </button>
            {dailySettingsMessage ? <p>{dailySettingsMessage}</p> : null}
          </fieldset>

          <div className="admin-rights-row">
            <fieldset className="admin-fieldset admin-page-rights">
              <legend>Page Rights</legend>
              <div className="admin-rights-head">
                <b>Page</b>
                <b>Access</b>
                <b>Edit</b>
              </div>
              {modulesForRights.map((moduleItem) => {
                const rights = selectedPermissions[moduleItem.key] || {};
                return (
                  <div className="admin-rights-grid" key={moduleItem.key}>
                    <span>{moduleItem.label}</span>
                    <input type="checkbox" checked={Boolean(rights.access)} onChange={(event) => updatePermission(moduleItem.key, "access", event.target.checked)} />
                    <input type="checkbox" checked={Boolean(rights.edit)} onChange={(event) => updatePermission(moduleItem.key, "edit", event.target.checked)} />
                  </div>
                );
              })}
            </fieldset>

            <fieldset className="admin-fieldset admin-project-access">
              <legend>Project Access</legend>
              <div className="admin-project-scroll">
                {projectsForRights.map((project) => (
                  <label key={project.id}>
                    <input type="checkbox" checked={selectedProjectIds.has(Number(project.id))} onChange={(event) => updateProjectAccess(project.id, event.target.checked)} />
                    <span>{project.unique_id} - {project.project_name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="admin-bottom-actions">
            <button className="admin-new">New User</button>
            <button className="admin-save" onClick={saveUserRights}>Save User &amp; Rights</button>
            <button className="admin-refresh" onClick={() => api("/api/admin/users").then(setData)}>Refresh</button>
          </div>
          {rightsMessage ? <p>{rightsMessage}</p> : null}
        </div>
      </div>
    </section>
  );
}

function EmptySelect() {
  return <div className="loading">Select a project from the left list.</div>;
}

function App() {
  const [user, setUser] = useState(() => {
    try {
      const savedUser = window.localStorage.getItem(AUTH_USER_KEY);
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      window.localStorage.removeItem(AUTH_USER_KEY);
      return null;
    }
  });
  const [activeModule, setActiveModule] = useState("registration");
  const [menuExpanded, setMenuExpanded] = useState(false);
  const menuCloseTimer = useRef(null);
  const [projects, setProjects] = useState([]);
  const [ongoingProjects, setOngoingProjects] = useState([]);
  const [ongoingSummaryByType, setOngoingSummaryByType] = useState({});
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [projectDetailsStage, setProjectDetailsStage] = useState("formulation");
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) || ongoingProjects.find((project) => project.id === selectedId),
    [projects, ongoingProjects, selectedId],
  );

  async function loadProjects() {
    setProjectsLoading(true);
    try {
      const [all, ongoing] = await Promise.all([api("/api/projects"), api("/api/projects/ongoing?include_archived=true")]);
      const allRows = all.projects || [];
      const ongoingRows = ongoing.projects || [];
      setProjects(allRows);
      setOngoingProjects(ongoingRows);
      setOngoingSummaryByType(ongoing.summaryByType || {});
      if (!selectedId && allRows.length) setSelectedId(allRows[0].id);
    } finally {
      setProjectsLoading(false);
    }
  }

  function openRegistrationProject(row) {
    if (!row?.id) return;
    setSelectedId(row.id);
    const status = String(row.status || "").trim().toLowerCase();
    const projectType = row.project_type || (row.tableKey === "plant" ? "Plant Level AMR" : "Corporate AMR");
    const stageByStatus = {
      "under formulation": "formulation",
      "stage-1": "stage1",
      "stage 1": "stage1",
      tendering: "tendering",
      "stage-2": "stage2",
      "stage 2": "stage2",
    };
    if (status === "ongoing") {
      setActiveModule(projectType === "Plant Level AMR" ? "plant_level_project" : "contract_details");
      return;
    }
    setProjectDetailsStage(stageByStatus[status] || "formulation");
    setActiveModule("project_details");
  }

  function openOngoingContract(row) {
    if (!row?.id) return;
    setSelectedId(row.id);
    setActiveModule("contract_details");
  }

  function openOngoingSCurve(row) {
    if (!row?.id) return;
    setSelectedId(row.id);
    setActiveModule("scurve_planning");
  }

  function openOngoingDailyProgress(row) {
    if (!row?.id) return;
    setSelectedId(row.id);
    setActiveModule("daily_progress");
  }

  function openPlantLevelProject(row) {
    setSelectedId("");
    setActiveModule("plant_level_project");
  }

  function openCorporateMaster() {
    setSelectedId("");
    setActiveModule("corporate_amr_master");
  }

  function openMenu() {
    if (menuCloseTimer.current) {
      window.clearTimeout(menuCloseTimer.current);
      menuCloseTimer.current = null;
    }
    setMenuExpanded(true);
  }

  function closeMenuSmoothly(delay = 650) {
    if (menuCloseTimer.current) window.clearTimeout(menuCloseTimer.current);
    menuCloseTimer.current = window.setTimeout(() => {
      setMenuExpanded(false);
      menuCloseTimer.current = null;
    }, delay);
  }

  useEffect(() => {
    if (user) loadProjects();
  }, [user]);

  function logout() {
    window.localStorage.removeItem(AUTH_USER_KEY);
    setUser(null);
  }

  if (!user) return <Login onLogin={setUser} />;

  const isRegistration = activeModule === "registration";
  const projectSections = [
    ["project_details", "Project Details"],
    ["ongoing", "Ongoing Projects"],
    ["daily_progress", "Daily Progress Report"],
    ["schedule", "Schedule"],
    ["repository", "Repository"],
  ];
  const hiddenProjectSections = [
    ["contract_details", "Contract Details & Appendix-2"],
    ["scurve_planning", "S-Curve Planning"],
    ["plant_level_project", "Plant Level AMR Scheme"],
    ["corporate_amr_master", "Corporate AMR Master"],
  ];
  const allProjectSections = [...projectSections, ...hiddenProjectSections];
  const pageTitle = modules.find((item) => item.key === activeModule)?.label
    || allProjectSections.find(([key]) => key === activeModule)?.[1]
    || "Project Brain";
  const layoutClassName = `layout auto-hide-layout ${menuExpanded ? "menu-expanded" : ""}`;

  return (
    <div className={`app-shell module-active-${activeModule} ${isRegistration ? "registration-active" : ""}`}>
      <header>
        <div className="brand-mark">
          <Factory size={38} />
        </div>
        <div className="module-title">
          <h1>Rourkela Steel Plant - Project Department</h1>
        </div>
        {activeModule === "ongoing" ? (
          <button className="header-home-button" type="button" onClick={() => setActiveModule("registration")}>
            <Home size={18} />
            <span>Home</span>
          </button>
        ) : (
          <div className="user-badge">
            <User size={20} />
            <span>{user.username}</span>
            <ChevronDown size={18} />
          </div>
        )}
      </header>
      <div className={layoutClassName}>
        <div className="menu-hover-strip" onMouseEnter={openMenu} />
        <aside
          className="desktop-menu"
          onMouseEnter={openMenu}
          onMouseLeave={closeMenuSmoothly}
        >
          <h2>☰ Menu</h2>
          <button className={activeModule === "registration" ? "menu-btn green active" : "menu-btn green"} onClick={() => setActiveModule("registration")}>Project Registration</button>
          <button className={activeModule === "dashboard" ? "menu-btn green active" : "menu-btn green"} onClick={() => setActiveModule("dashboard")}>Dashboard</button>
          <button className={activeModule === "capex" ? "menu-btn green active" : "menu-btn green"} onClick={() => setActiveModule("capex")}>Capex</button>
          <button className={activeModule === "billing_schedule" ? "menu-btn green active" : "menu-btn green"} onClick={() => setActiveModule("billing_schedule")}>Billing Schedule</button>
          <button className={activeModule === "projects" || allProjectSections.some(([key]) => key === activeModule) ? "menu-btn green active" : "menu-btn green"} onClick={() => setActiveModule("projects")}>Projects</button>
          {activeModule === "projects" || allProjectSections.some(([key]) => key === activeModule) ? (
            <div className="project-submenu">
              {projectSections.map(([key, label]) => (
                <button key={key} className={activeModule === key ? "active" : ""} onClick={() => setActiveModule(key)}>{label}</button>
              ))}
            </div>
          ) : null}
          <button className={activeModule === "reports" ? "menu-btn green active" : "menu-btn green"} onClick={() => setActiveModule("reports")}>Reports</button>
          <button className={activeModule === "admin" ? "menu-btn orange active" : "menu-btn orange"} onClick={() => setActiveModule("admin")}>Admin Panel</button>
          <button className="logout-button" onClick={logout}>↩</button>
        </aside>
        <main className={`module-${activeModule}`} onMouseEnter={() => closeMenuSmoothly(120)}>
          {activeModule !== "billing_schedule" && activeModule !== "capex" ? (
            <button className="page-home-button" type="button" onClick={() => setActiveModule("registration")} title="Go to home page">
              <Home size={18} />
              <span>Home</span>
            </button>
          ) : null}
          <div className={activeModule === "dashboard" || activeModule === "registration" || activeModule === "ongoing" || activeModule === "project_details" || activeModule === "contract_details" || activeModule === "scurve_planning" || activeModule === "plant_level_project" || activeModule === "corporate_amr_master" || activeModule === "capex" || activeModule === "billing_schedule" || activeModule === "admin" ? "page-head hidden" : "page-head"}>
            <div>
              <h1>{pageTitle}</h1>
              <p>Project: {selectedProject?.project_name || "Select Project"}</p>
            </div>
            <button className="refresh" onClick={() => { loadProjects(); setRefreshKey((value) => value + 1); }}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
          {activeModule === "dashboard" ? <DashboardView refreshKey={refreshKey} /> : null}
          {activeModule === "registration" ? <RegistrationView onChanged={loadProjects} onOpenProject={openRegistrationProject} onHome={() => setActiveModule("registration")} /> : null}
          {activeModule === "projects" ? <ProjectsLandingView onChanged={loadProjects} /> : null}
          {activeModule === "project_details" ? <ProjectDetailsView onChanged={loadProjects} project={selectedProject} user={user} initialStage={projectDetailsStage} onBack={() => setActiveModule("projects")} onHome={() => setActiveModule("registration")} /> : null}
          {activeModule === "contract_details" ? <ContractDetailsView project={selectedProject} user={user} onBack={() => setActiveModule("ongoing")} onHome={() => setActiveModule("registration")} /> : null}
          {activeModule === "scurve_planning" ? <ScurvePlanningView project={selectedProject} user={user} onBack={() => { loadProjects(); setActiveModule("ongoing"); }} onHome={() => setActiveModule("registration")} /> : null}
          {activeModule === "plant_level_project" ? <PlantLevelProjectView project={selectedProject} user={user} ongoingRows={ongoingProjects} onBack={() => setActiveModule("ongoing")} onHome={() => setActiveModule("registration")} /> : null}
          {activeModule === "corporate_amr_master" ? <CorporateAmrMasterView rows={ongoingProjects} onBack={() => setActiveModule("ongoing")} onChanged={loadProjects} /> : null}
          {activeModule === "ongoing" ? (
            <OngoingView
              rows={ongoingProjects}
              summaryByType={ongoingSummaryByType}
              loading={projectsLoading}
              onRefresh={loadProjects}
              onOpenContract={openOngoingContract}
              onOpenSCurve={openOngoingSCurve}
              onOpenDailyProgress={openOngoingDailyProgress}
              onOpenPlantLevel={openPlantLevelProject}
              onOpenCorporateMaster={openCorporateMaster}
            />
          ) : null}
          {activeModule === "daily_progress" ? (
            <DailyProgressView
              project={selectedProject}
              user={user}
              refreshKey={refreshKey}
              ongoingProjects={ongoingProjects}
              onProjectChange={setSelectedId}
              onBack={() => setActiveModule("ongoing")}
              onHome={() => setActiveModule("registration")}
              onWindowMenuEnter={openMenu}
              onWindowMenuLeave={() => closeMenuSmoothly(650)}
            />
          ) : null}
          {activeModule === "capex" ? (
            <CapexView
              onClose={() => setActiveModule("registration")}
              onBack={() => setActiveModule("dashboard")}
              onHome={() => setActiveModule("registration")}
              user={user}
            />
          ) : null}
          {activeModule === "billing_schedule" ? (
            <BillingScheduleView
              onBack={() => setActiveModule("ongoing")}
              onHome={() => setActiveModule("registration")}
              ongoingProjects={ongoingProjects}
              selectedProject={selectedProject}
            />
          ) : null}
          {activeModule === "schedule" ? <ScheduleView /> : null}
          {activeModule === "reports" ? <ReportsView /> : null}
          {activeModule === "repository" ? <RepositoryView project={selectedProject} /> : null}
          {activeModule === "admin" ? <AdminView user={user} onOpenRegistration={() => setActiveModule("registration")} /> : null}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
