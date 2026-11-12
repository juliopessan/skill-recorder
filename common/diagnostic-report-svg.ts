// Pure SVG builders for the diagnostic report. No Electron / Node-only imports: bundled for the renderer too.
import type { ProcessMap, ProcessMapStep, QuestionnaireAxis } from "./diagnostic";

/** Avanade identity: orange for marks, dark orange / greys for small text (contrast on white). */
export const COLORS = {
  ink: "#333333",
  muted: "#666666",
  line: "#cccccc",
  grid: "#e5e5e5",
  accent: "#FF5800",
  accentDark: "#DC4600",
  aurora: "#890078",
  structured: "#00A650",
  semi: "#FFB414",
  unstructured: "#C80000",
  structuredText: "#00733A",
  semiText: "#8A5A00",
  unstructuredText: "#C80000",
  structuredTint: "#E5F6EC",
  semiTint: "#FFF4DC",
  unstructuredTint: "#F9E5E5",
} as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const n1 = (n: number): string => String(Number(n.toFixed(1)));

/** Greedy word wrap with a hard cap on lines; the last line ends with an ellipsis when truncated. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  let truncated = false;
  for (const raw of text.trim().split(/\s+/).filter(Boolean)) {
    const w = raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw;
    if (cur && `${cur} ${w}`.length > maxChars) {
      if (lines.length + 1 === maxLines) {
        truncated = true;
        break;
      }
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  if (truncated) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = `${last.length >= maxChars ? last.slice(0, maxChars - 1) : last}…`;
  }
  return lines;
}

const STRUCTURE = {
  structured: { stroke: COLORS.structured, fill: COLORS.structuredTint, text: COLORS.structuredText, label: "Dados estruturados" },
  semi: { stroke: COLORS.semi, fill: COLORS.semiTint, text: COLORS.semiText, label: "Dados semiestruturados" },
  unstructured: { stroke: COLORS.unstructured, fill: COLORS.unstructuredTint, text: COLORS.unstructuredText, label: "Dados não estruturados" },
} as const;

export function formatDuration(ms: number | null): string {
  if (ms == null) return "sem medição";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

const BOX_W = 156;
const BOX_H = 104;
const GAP_X = 32;
const GAP_Y = 44;
const PER_ROW = 4;

function arrowHead(x: number, y: number, dir: "right" | "down"): string {
  const pts = dir === "right" ? `${x},${y} ${x - 7},${y - 4} ${x - 7},${y + 4}` : `${x},${y} ${x - 4},${y - 7} ${x + 4},${y - 7}`;
  return `<polygon points="${pts}" fill="${COLORS.muted}"/>`;
}

function stepBox(step: ProcessMapStep, index: number, x: number, y: number): string {
  const st = STRUCTURE[step.dataStructure] ?? STRUCTURE.unstructured;
  const title = wrapText(step.title, 19, 2);
  const apps = wrapText(step.apps.join(", ") || "sem aplicativo", 27, 1)[0]!;
  const badges: string[] = [];
  const addBadge = (letter: string, fill: string, label: string): void => {
    const bx = x + BOX_W - 22 - badges.length * 20;
    badges.push(
      `<g><title>${escapeHtml(label)}</title><rect x="${bx}" y="${y - 8}" width="16" height="16" rx="3" fill="${fill}"/>` +
        `<text x="${bx + 8}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${letter}</text></g>`,
    );
  };
  if (step.manualTransfer) addBadge("T", COLORS.accentDark, "Transferência manual de dados");
  if (step.rework) addBadge("R", COLORS.ink, "Retrabalho");
  const titleSvg = title
    .map((l, i) => `<text x="${x + 10}" y="${y + 34 + i * 14}" font-size="11" font-weight="700" fill="${COLORS.ink}">${escapeHtml(l)}</text>`)
    .join("");
  return (
    `<g><rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="2" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"/>` +
    `<text x="${x + 10}" y="${y + 17}" font-size="9" font-weight="700" fill="${COLORS.muted}">PASSO ${index + 1}</text>` +
    titleSvg +
    `<text x="${x + 10}" y="${y + 68}" font-size="11" fill="${COLORS.ink}">${escapeHtml(formatDuration(step.medianDurationMs))}</text>` +
    `<text x="${x + 10}" y="${y + 83}" font-size="9" fill="${COLORS.muted}">${escapeHtml(apps)}</text>` +
    `<text x="${x + 10}" y="${y + 97}" font-size="9" font-weight="700" fill="${st.text}">${st.label}</text>` +
    badges.join("") +
    `</g>`
  );
}

/** Left-to-right (wrapping) flow of the mapped steps, boxes colored by data structure. */
export function processFlowSvg(map: ProcessMap, label: string): string {
  const steps = map.steps;
  if (steps.length === 0) return `<p class="muted">Nenhum passo mapeado.</p>`;
  const rows = Math.max(1, Math.ceil(steps.length / PER_ROW));
  const width = PER_ROW * BOX_W + (PER_ROW - 1) * GAP_X;
  const flowH = rows * BOX_H + (rows - 1) * GAP_Y + 12;
  const legendY = flowH + 18;
  const height = legendY + 18;
  const pos = (i: number): { x: number; y: number } => ({
    x: (i % PER_ROW) * (BOX_W + GAP_X),
    y: 12 + Math.floor(i / PER_ROW) * (BOX_H + GAP_Y),
  });
  const parts: string[] = [];
  steps.forEach((_, i) => {
    if (i === 0) return;
    const a = pos(i - 1);
    const b = pos(i);
    if (a.y === b.y) {
      const ay = a.y + BOX_H / 2;
      parts.push(`<line x1="${a.x + BOX_W}" y1="${ay}" x2="${b.x - 7}" y2="${ay}" stroke="${COLORS.muted}" stroke-width="1.5"/>${arrowHead(b.x, ay, "right")}`);
    } else {
      const ax = a.x + BOX_W / 2;
      const midY = a.y + BOX_H + GAP_Y / 2;
      const bx = b.x + BOX_W / 2;
      parts.push(`<polyline points="${ax},${a.y + BOX_H} ${ax},${midY} ${bx},${midY} ${bx},${b.y - 7}" fill="none" stroke="${COLORS.muted}" stroke-width="1.5"/>${arrowHead(bx, b.y, "down")}`);
    }
  });
  steps.forEach((s, i) => {
    const p = pos(i);
    parts.push(stepBox(s, i, p.x, p.y));
  });
  const legend: string[] = [];
  let lx = 0;
  (["structured", "semi", "unstructured"] as const).forEach((k) => {
    legend.push(`<rect x="${lx}" y="${legendY - 9}" width="11" height="11" rx="2" fill="${STRUCTURE[k].fill}" stroke="${STRUCTURE[k].stroke}"/><text x="${lx + 16}" y="${legendY}" font-size="10" fill="${COLORS.muted}">${STRUCTURE[k].label.replace("Dados ", "")}</text>`);
    lx += 118;
  });
  legend.push(`<rect x="${lx}" y="${legendY - 10}" width="13" height="13" rx="3" fill="${COLORS.accentDark}"/><text x="${lx + 6.5}" y="${legendY}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">T</text><text x="${lx + 19}" y="${legendY}" font-size="10" fill="${COLORS.muted}">transferência manual</text>`);
  lx += 150;
  legend.push(`<rect x="${lx}" y="${legendY - 10}" width="13" height="13" rx="3" fill="${COLORS.ink}"/><text x="${lx + 6.5}" y="${legendY}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">R</text><text x="${lx + 19}" y="${legendY}" font-size="10" fill="${COLORS.muted}">retrabalho</text>`);
  return (
    `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}" font-family="inherit">` +
    parts.join("") +
    legend.join("") +
    `</svg>`
  );
}

export const AXIS_LABELS: Record<QuestionnaireAxis, string> = {
  inventory: "Inventário",
  structure: "Estrutura",
  quality: "Qualidade",
  access: "Acesso",
  governance: "Governança",
};
export const AXIS_ORDER: QuestionnaireAxis[] = ["inventory", "structure", "quality", "access", "governance"];

/** Radar of the five data axes; `answers` are 1..4 (undefined = unanswered, plotted at the center). */
export function radarSvg(answers: Partial<Record<QuestionnaireAxis, number>>): string {
  const cx = 230;
  const cy = 190;
  const R = 120;
  const point = (i: number, frac: number, extra = 0): [number, number] => {
    const ang = (-90 + (360 / AXIS_ORDER.length) * i) * (Math.PI / 180);
    return [cx + (R * frac + extra) * Math.cos(ang), cy + (R * frac + extra) * Math.sin(ang)];
  };
  const poly = (frac: number): string => AXIS_ORDER.map((_, i) => point(i, frac).map(n1).join(",")).join(" ");
  const rings = [1, 2, 3, 4]
    .map((lvl) => `<polygon points="${poly(lvl / 4)}" fill="none" stroke="${COLORS.grid}" stroke-width="1"/>`)
    .join("");
  const ringLabels = [1, 2, 3, 4]
    .map((lvl) => `<text x="${cx + 4}" y="${n1(cy - R * (lvl / 4) + 3)}" font-size="8" fill="${COLORS.muted}">${lvl}</text>`)
    .join("");
  const spokes = AXIS_ORDER.map((_, i) => {
    const [x, y] = point(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${n1(x)}" y2="${n1(y)}" stroke="${COLORS.grid}"/>`;
  }).join("");
  const data = AXIS_ORDER.map((a, i) => point(i, (answers[a] ?? 0) / 4).map(n1).join(",")).join(" ");
  const dots = AXIS_ORDER.map((a, i) => {
    const [x, y] = point(i, (answers[a] ?? 0) / 4);
    return `<circle cx="${n1(x)}" cy="${n1(y)}" r="3.5" fill="${COLORS.accent}"/>`;
  }).join("");
  const labels = AXIS_ORDER.map((a, i) => {
    const [x, y] = point(i, 1, 16);
    const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
    const value = answers[a] == null ? "sem resposta" : `${answers[a]} de 4`;
    return (
      `<text x="${n1(x)}" y="${n1(y)}" text-anchor="${anchor}" font-size="12" font-weight="700" fill="${COLORS.ink}">${AXIS_LABELS[a]}</text>` +
      `<text x="${n1(x)}" y="${n1(y + 13)}" text-anchor="${anchor}" font-size="10" fill="${COLORS.muted}">${value}</text>`
    );
  }).join("");
  return (
    `<svg class="chart" viewBox="30 40 400 290" role="img" aria-label="Radar dos cinco eixos de dados" font-family="inherit">` +
    rings + spokes + ringLabels +
    `<polygon points="${data}" fill="${COLORS.accent}" fill-opacity="0.18" stroke="${COLORS.accent}" stroke-width="2"/>` +
    dots + labels + `</svg>`
  );
}

export interface MatrixPoint {
  n: number;
  effort: "S" | "M" | "L";
  savings: number;
  wave: 1 | 2 | 3;
  quickWin: boolean;
}

const WAVE_FILL = { 1: "#FFD5BF", 2: COLORS.accentDark, 3: COLORS.aurora } as const;
const WAVE_TEXT = { 1: COLORS.ink, 2: "#ffffff", 3: "#ffffff" } as const;

/** Value (monthly savings) x effort matrix; points are numbered like the opportunity cards. */
export function valueEffortMatrixSvg(points: MatrixPoint[], formatMoney: (n: number) => string): string {
  const x0 = 70;
  const x1 = 500;
  const y0 = 20;
  const y1 = 260;
  const max = Math.max(0, ...points.map((p) => p.savings));
  const colW = (x1 - x0) / 3;
  const yOf = (f: number): number => y1 - 14 - (y1 - y0 - 28) * f;
  const efforts = ["S", "M", "L"] as const;
  const effortName = { S: "Pequeno", M: "Médio", L: "Grande" } as const;
  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = yOf(f);
      return `<line x1="${x0}" y1="${n1(y)}" x2="${x1}" y2="${n1(y)}" stroke="${COLORS.grid}"/><text x="${x0 - 8}" y="${n1(y + 3)}" text-anchor="end" font-size="9" fill="${COLORS.muted}">${escapeHtml(formatMoney(max * f))}</text>`;
    })
    .join("");
  const cols = efforts
    .map((e, i) => `<text x="${n1(x0 + colW * (i + 0.5))}" y="${y1 + 18}" text-anchor="middle" font-size="11" fill="${COLORS.ink}">${effortName[e]} (${e})</text>` + (i > 0 ? `<line x1="${n1(x0 + colW * i)}" y1="${y0}" x2="${n1(x0 + colW * i)}" y2="${y1}" stroke="${COLORS.grid}" stroke-dasharray="3 3"/>` : ""))
    .join("");
  const dots = efforts
    .flatMap((e, ci) => {
      const inCol = points.filter((p) => p.effort === e);
      return inCol.map((p, k) => {
        const cx = x0 + colW * (ci + 0.5) + (k - (inCol.length - 1) / 2) * 30;
        const cy = yOf(max === 0 ? 0 : p.savings / max);
        const ring = p.quickWin ? `stroke="${COLORS.structured}" stroke-width="3"` : `stroke="#ffffff" stroke-width="1"`;
        return `<g><circle cx="${n1(cx)}" cy="${n1(cy)}" r="12" fill="${WAVE_FILL[p.wave]}" ${ring}/><text x="${n1(cx)}" y="${n1(cy + 4)}" text-anchor="middle" font-size="11" font-weight="700" fill="${WAVE_TEXT[p.wave]}">${p.n}</text></g>`;
      });
    })
    .join("");
  const legend = ([1, 2, 3] as const)
    .map((w, i) => `<circle cx="${x0 + i * 90 + 6}" cy="${y1 + 56}" r="6" fill="${WAVE_FILL[w]}" stroke="${COLORS.line}"/><text x="${x0 + i * 90 + 17}" y="${y1 + 60}" font-size="10" fill="${COLORS.muted}">Onda ${w}</text>`)
    .join("");
  const qw = `<circle cx="${x0 + 290}" cy="${y1 + 56}" r="6" fill="#fff" stroke="${COLORS.structured}" stroke-width="3"/><text x="${x0 + 301}" y="${y1 + 60}" font-size="10" fill="${COLORS.muted}">Quick win</text>`;
  return (
    `<svg class="chart" viewBox="0 0 520 334" role="img" aria-label="Matriz valor por esforço" font-family="inherit">` +
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${COLORS.line}"/>` +
    grid + cols + dots +
    `<text x="14" y="${(y0 + y1) / 2}" font-size="10" fill="${COLORS.muted}" transform="rotate(-90 14 ${(y0 + y1) / 2})" text-anchor="middle">Economia mensal estimada</text>` +
    `<text x="${(x0 + x1) / 2}" y="${y1 + 32}" text-anchor="middle" font-size="10" fill="${COLORS.muted}">Esforço</text>` +
    legend + qw + `</svg>`
  );
}
