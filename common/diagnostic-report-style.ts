// Print-friendly stylesheet for the diagnostic report, in the Avanade visual identity.
// Inline only: no external fonts, images or URLs. Orange #FF5800 is used for marks and large type;
// small orange text uses #DC4600 for contrast on white.
import { COLORS } from "./diagnostic-report-svg";

export const REPORT_CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; }
:root {
  --orange:#FF5800; --orange-dark:#DC4600; --aurora:#890078;
  --grey-1:#333333; --grey-2:#4c4c4c; --grey-3:#666666; --grey-4:#7f7f7f; --grey-5:#999999; --grey-6:#b3b3b3; --grey-7:#cccccc; --grey-8:#e5e5e5;
  --master:linear-gradient(135deg, #FF5800 0%, #890078 100%);
  --structured:${COLORS.structured}; --semi:${COLORS.semi}; --unstructured:${COLORS.unstructured};
  --ink:var(--grey-1); --muted:var(--grey-3); --line:var(--grey-7); --grid:var(--grey-8); --paper:#ffffff; --wash:#f5f5f5;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; background:var(--paper); color:var(--ink); font-family:'Segoe UI', 'Segoe UI Variable', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size:10.5pt; line-height:1.5; }
main { max-width:182mm; margin:0 auto; }
h1, h2 { font-weight:300; color:var(--ink); }
h1 { font-size:34pt; line-height:1.1; margin:0 0 6px; letter-spacing:-0.01em; }
/* 4px orange accent bar drawn as a background so it can never be orphaned from its heading. */
h2 { font-size:20pt; line-height:1.2; margin:0 0 6px; padding-top:14px; background:linear-gradient(#FF5800, #FF5800) no-repeat 0 0 / 40px 4px; }
h3 { font-size:12pt; font-weight:600; margin:16px 0 6px; }
h4, h5 { font-size:10pt; font-weight:600; margin:12px 0 4px; }
p { margin:6px 0; }
.eyebrow { font-size:8.5pt; letter-spacing:.1em; text-transform:uppercase; color:var(--orange-dark); font-weight:600; }
.tag { display:inline-block; font-size:7.5pt; letter-spacing:.1em; text-transform:uppercase; font-weight:600; color:var(--orange-dark); margin-right:10px; }
.tag-muted { color:var(--muted); }
.muted { color:var(--muted); }
.small { font-size:9pt; }
.nowrap { white-space:nowrap; }
section { padding-top:22px; }
section.pb { page-break-before:always; break-before:page; padding-top:0; }
h2, h3, h4 { page-break-after:avoid; break-after:avoid; }
.lead { page-break-inside:avoid; break-inside:avoid; page-break-after:avoid; break-after:avoid; font-size:11pt; color:var(--muted); margin-bottom:14px; }

/* Cover */
.cover { background:var(--master); color:#fff; min-height:250mm; padding:22mm 16mm 18mm; display:flex; flex-direction:column; justify-content:space-between; page-break-after:always; break-after:page; }
.cover h1 { color:#fff; font-size:38pt; margin-top:10px; }
.cover .eyebrow { color:#fff; opacity:.9; }
.cover-date { font-size:12pt; margin:0; }
.cover-level { font-size:24pt; font-weight:300; margin:6px 0 12px; }
.cover-next { font-size:11pt; max-width:140mm; }
.levels { list-style:none; display:grid; grid-template-columns:repeat(5,1fr); gap:6px; padding:0; margin:0 0 12px; }
.levels li { border-top:4px solid rgba(255,255,255,.35); padding-top:6px; font-size:8.5pt; }
.levels li b { display:block; font-size:14pt; font-weight:300; }
.levels li.done { border-top-color:rgba(255,255,255,.75); }
.levels li.on { border-top-color:#fff; font-weight:600; }
.tagline { font-weight:700; font-size:16pt; margin:0; }

/* Footer on every printed page */
.page-footer { position:fixed; bottom:0; right:0; font-family:'Segoe UI', 'Segoe UI Variable', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif; font-weight:600; font-size:9pt; color:var(--grey-3); }

.banner { border:1px solid var(--semi); background:${COLORS.semiTint}; border-left:5px solid var(--semi); padding:10px 14px; margin:14px 0; page-break-inside:avoid; break-inside:avoid; }
.banner strong { display:block; font-size:11.5pt; }
.banner ul { margin:6px 0 0 18px; padding:0; }
.scores { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:16px 0 0; }
.card { border:1px solid var(--line); border-top:4px solid var(--orange); border-radius:2px; padding:12px 14px; background:var(--paper); page-break-inside:avoid; break-inside:avoid; margin-bottom:12px; }
.score .num { font-size:30pt; font-weight:300; line-height:1.1; color:var(--ink); }
.score .num span { font-size:12pt; color:var(--muted); }
.bar { height:4px; background:var(--grid); margin-top:8px; }
.bar i { display:block; height:4px; background:var(--master); }
.maturity .level { font-size:16pt; font-weight:300; margin:2px 0; }
.kpi { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
.kpi .num { font-size:18pt; font-weight:300; }
table { width:100%; border-collapse:collapse; margin:8px 0; font-size:9.5pt; }
th { text-align:left; font-size:7.5pt; font-weight:600; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); border-bottom:2px solid var(--grey-1); }
th,td { padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
tr { page-break-inside:avoid; break-inside:avoid; }
thead { display:table-header-group; }
td.r, th.r { text-align:right; }
.thesis { font-size:15pt; font-weight:300; line-height:1.5; border-left:4px solid var(--orange); padding:4px 0 4px 18px; margin:22px 0; }
.chart { width:100%; height:auto; display:block; margin:8px 0; }
.chart.narrow { max-width:128mm; margin-left:auto; margin-right:auto; }
.process { page-break-inside:auto; margin-bottom:22px; }
.process h3 { break-after:avoid; page-break-after:avoid; }
.meta { display:flex; flex-wrap:wrap; gap:4px 18px; font-size:9pt; color:var(--muted); margin-bottom:4px; }
.badge { display:inline-block; font-size:7.5pt; font-weight:600; letter-spacing:.1em; text-transform:uppercase; padding:1px 7px; border-radius:2px; border:1px solid var(--orange-dark); color:var(--orange-dark); margin-right:4px; vertical-align:middle; }
.badge-quick { background:${COLORS.structuredText}; border-color:${COLORS.structuredText}; color:#fff; }
.badge-wave { background:var(--orange-dark); color:#fff; }
.opp h3 { margin-top:0; }
.opp .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:8px 0; }
.opp .grid div { font-size:8.5pt; color:var(--muted); }
.opp .grid b { display:block; font-size:11pt; font-weight:600; color:var(--ink); }
.path { font-size:9pt; background:var(--wash); padding:6px 10px; border-radius:2px; }
.items { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
.items .card { margin-bottom:0; }
.item h3 { margin:6px 0 4px; }
.item ul { margin:4px 0 0 16px; padding:0; }
.apps { margin-top:8px; }
.chip { display:inline-block; font-size:8pt; border:1px solid var(--line); border-radius:2px; padding:0 6px; margin:0 4px 4px 0; color:var(--grey-2); }
.wave h3 { margin-top:6px; }
ol.recs { margin:6px 0 0 18px; padding:0; }
.prov { display:block; font-size:8pt; color:var(--muted); font-style:italic; }
#premissas td, #premissas th { padding:3px 8px; font-size:9pt; }
footer { margin-top:24px; font-size:8pt; color:var(--muted); border-top:1px solid var(--line); padding-top:8px; }
`;
