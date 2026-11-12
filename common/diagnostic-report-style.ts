// Print-friendly stylesheet for the diagnostic report (inline only, no external resources).
import { COLORS } from "./diagnostic-report-svg";

export const REPORT_CSS = `
@page { size: A4; margin: 16mm 14mm; }
:root { --ink:${COLORS.ink}; --muted:${COLORS.muted}; --line:${COLORS.line}; --grid:${COLORS.grid}; --accent:${COLORS.accent}; --paper:#ffffff; --wash:#f4f6f8; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; background:var(--paper); color:var(--ink); font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; font-size:10.5pt; line-height:1.5; }
main { max-width:186mm; margin:0 auto; padding:0 4mm; }
h1 { font-size:26pt; line-height:1.15; margin:0 0 4px; letter-spacing:-0.01em; }
h2 { font-size:16pt; margin:0 0 4px; padding-bottom:6px; border-bottom:2px solid var(--accent); }
h3 { font-size:11.5pt; margin:18px 0 6px; }
p { margin:6px 0; }
.eyebrow { font-size:8.5pt; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); font-weight:700; }
.muted { color:var(--muted); }
.small { font-size:9pt; }
section { padding-top:18px; }
section.first { padding-top:0; }
section.pb { page-break-before:always; break-before:page; }
h2, h3 { page-break-after:avoid; break-after:avoid; }
.lead { page-break-inside:avoid; break-inside:avoid; page-break-after:avoid; break-after:avoid; font-size:11pt; color:var(--muted); margin-bottom:14px; }
.banner { border:1px solid ${COLORS.semi}; background:${COLORS.semiTint}; border-left:5px solid ${COLORS.semi}; padding:10px 14px; margin:14px 0; page-break-inside:avoid; }
.banner strong { display:block; font-size:11.5pt; }
.banner ul { margin:6px 0 0 18px; padding:0; }
.scores { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:16px 0; }
.card { border:1px solid var(--line); border-radius:6px; padding:12px 14px; background:var(--paper); page-break-inside:avoid; break-inside:avoid; margin-bottom:12px; }
.score .num { font-size:30pt; font-weight:700; line-height:1.1; color:var(--accent); }
.score .num span { font-size:12pt; color:var(--muted); font-weight:400; }
.bar { height:6px; background:var(--grid); border-radius:3px; margin-top:8px; }
.bar i { display:block; height:6px; background:var(--accent); border-radius:3px; }
.kpi { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
.kpi .num { font-size:18pt; font-weight:700; }
table { width:100%; border-collapse:collapse; margin:8px 0; font-size:9.5pt; }
th { text-align:left; background:var(--wash); font-size:8.5pt; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
th,td { padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
tr { page-break-inside:avoid; break-inside:avoid; }
thead { display:table-header-group; }
td.r, th.r { text-align:right; }
.thesis { font-size:14pt; line-height:1.55; border-left:4px solid var(--accent); padding:4px 0 4px 18px; margin:22px 0; }
.chart { width:100%; height:auto; display:block; margin:8px 0; }
.chart.narrow { max-width:128mm; margin-left:auto; margin-right:auto; }
.process { page-break-inside:auto; margin-bottom:22px; }
.meta { display:flex; flex-wrap:wrap; gap:4px 18px; font-size:9pt; color:var(--muted); margin-bottom:4px; }
.badge { display:inline-block; font-size:8pt; font-weight:700; padding:1px 7px; border-radius:10px; border:1px solid var(--accent); color:var(--accent); margin-right:4px; vertical-align:middle; }
.badge-quick { background:${COLORS.structured}; border-color:${COLORS.structured}; color:#fff; }
.badge-wave { background:var(--accent); color:#fff; }
.opp h3 { margin-top:0; }
.opp .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:8px 0; }
.opp .grid div { font-size:8.5pt; color:var(--muted); }
.opp .grid b { display:block; font-size:11pt; color:var(--ink); }
.path { font-size:9pt; background:var(--wash); padding:6px 10px; border-radius:4px; }
.wave { border-top:3px solid var(--accent); }
.wave h3 { margin-top:6px; }
ol.recs { margin:6px 0 0 18px; padding:0; }
.prov { font-size:8pt; color:var(--muted); font-style:italic; }
#premissas td, #premissas th { padding:3px 8px; font-size:9pt; }
footer { margin-top:24px; font-size:8pt; color:var(--muted); border-top:1px solid var(--line); padding-top:8px; }
`;
