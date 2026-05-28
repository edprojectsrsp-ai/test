const fs = require("fs");
const os = require("os");
const path = require("path");
const pptxgen = require(
  path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "node",
    "node_modules",
    "pptxgenjs"
  )
);

function readPayload(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function asLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function addBullets(slide, title, lines, x, y, w, h, opts = {}) {
  slide.addText(title, {
    x,
    y,
    w,
    h: 0.3,
    fontFace: "Arial",
    bold: true,
    fontSize: 20,
    color: "0B3D91",
  });
  const runs = (lines || []).map((line) => ({ text: line, options: { bullet: { indent: 14 } } }));
  slide.addText(runs.length ? runs : [{ text: "No data available." }], {
    x,
    y: y + 0.35,
    w,
    h: h - 0.35,
    fontFace: "Arial",
    fontSize: opts.fontSize || 12,
    color: "1F2937",
    breakLine: true,
    valign: "top",
    margin: 0.08,
    fit: "shrink",
  });
}

async function main() {
  const payloadPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!payloadPath || !outputPath) {
    throw new Error("Usage: dashboard_export_ppt.js <payload.json> <output-path>");
  }

  const payload = readPayload(payloadPath);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Sutradhar PM";
  pptx.company = "Rourkela Steel Plant";
  pptx.subject = "Executive Dashboard Summary";
  pptx.title = payload.title || "Executive Summary Dashboard";

  let slide = pptx.addSlide();
  slide.background = { color: "EEF3F8" };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.8, fill: { color: "0B3D91" }, line: { color: "0B3D91" } });
  slide.addText(payload.title || "Executive Summary Dashboard", {
    x: 0.4,
    y: 0.2,
    w: 8.8,
    h: 0.4,
    fontFace: "Arial",
    fontSize: 24,
    bold: true,
    color: "FFFFFF",
  });
  slide.addText(
    [
      { text: `Project: ${payload.project_label || "-"}` },
      { text: `Financial Year: ${payload.fy_label || "-"}`, options: { breakLine: true } },
      { text: `Month: ${payload.month_label || "-"}`, options: { breakLine: true } },
      { text: `Status: ${payload.status_text || "-"}`, options: { breakLine: true } },
    ],
    {
      x: 0.5,
      y: 1.1,
      w: 6.2,
      h: 1.3,
      fontFace: "Arial",
      fontSize: 14,
      color: "1F2937",
      margin: 0.05,
    }
  );
  addBullets(slide, "Project Identity", payload.header_lines || [], 0.5, 2.5, 5.7, 3.4, { fontSize: 12 });
  addBullets(slide, "Stage Status", asLines(payload.stage_text), 6.7, 2.5, 2.9, 3.4, { fontSize: 12 });
  addBullets(slide, "CAPEX Snapshot", asLines(payload.capex_text), 9.8, 2.5, 3.0, 3.4, { fontSize: 11 });

  slide = pptx.addSlide();
  slide.background = { color: "EEF3F8" };
  addBullets(slide, "Physical Progress Summary", asLines(payload.physical_text), 0.5, 0.4, 6.1, 6.5, { fontSize: 10 });
  addBullets(slide, "DPR Insights", (payload.dpr_summary || []).map((line) => String(line)), 6.9, 0.4, 5.9, 3.0, { fontSize: 12 });

  const criticalLines = (payload.critical_rows || []).slice(0, 12).map((row) => `${row[0]} | ${row[3]} | Delay: ${row[4]}`);
  const missedLines = (payload.missed_rows || []).slice(0, 12).map((row) => `${row[0]} | ${row[1]} | ${row[3]}`);
  addBullets(slide, "Critical Path Activities", criticalLines, 6.9, 3.7, 5.9, 2.7, { fontSize: 10 });
  addBullets(slide, "Missed Baseline Activities", missedLines, 0.5, 6.95, 12.3, 0.4 + Math.max(1.3, missedLines.length * 0.18), { fontSize: 10 });

  await pptx.writeFile({ fileName: outputPath });
  console.log(`Exported pptx: ${outputPath}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
