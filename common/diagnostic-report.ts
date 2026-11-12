// Report model + self-contained HTML renderer for the AI Readiness Diagnostic.
// Pure: no Electron / Node-only imports (also bundled for the renderer).
import type { Engagement, Opportunity, Process, ProcessMap, QuestionnaireAxis, Role, Source } from "./diagnostic";
import { DEFAULT_THESIS_TEXT, DIAGNOSTIC_CONFIG, DIAGNOSTIC_CONFIG_VERSION } from "./diagnostic-config";
import {
  aiReadinessScore,
  dataScore,
  observedStructuredRatio,
  opportunityReadiness,
  opportunitySavings,
  processMonthlyCost,
  processScore,
} from "./diagnostic-math";
import { draftReasons, isQuickWin, prerequisitePath } from "./diagnostic-rules";
import {
  AXIS_LABELS,
  AXIS_ORDER,
  COLORS,
  escapeHtml,
  formatDuration,
  processFlowSvg,
  radarSvg,
  valueEffortMatrixSvg,
} from "./diagnostic-report-svg";

export { escapeHtml };

export interface ReportOpportunity extends Opportunity {
  processName: string;
  monthlyCostToday: number;
  monthlySavings: number;
  appliedPct: number;
  capped: boolean;
  readiness: number;
  quickWin: boolean;
  prerequisitePath: Opportunity[];
}

export interface ReportSquadRole {
  name: string;
  opportunities: number;
  waves: number[];
}

export interface ReportKpi {
  label: string;
  baseline: string;
  direction: string;
}

export interface DiagnosticReport {
  generatedAt: number;
  configVersion: number;
  draft: boolean;
  draftReasons: string[];
  scores: { process: number; data: number; ai: number };
  processScores: Record<string, number>;
  totals: { monthlyCost: number; monthlySavings: number };
  processCosts: Record<string, number>;
  opportunities: ReportOpportunity[];
  topRecommendations: ReportOpportunity[];
  roadmap: { wave: 1 | 2 | 3; items: ReportOpportunity[] }[];
  squad: { roles: ReportSquadRole[]; weeksByWave: { wave: number; weeks: number }[]; totalWeeks: number };
  kpis: ReportKpi[];
  assumptions: { label: string; value: string; source: Source }[];
}

const money2 = (n: number): number => Math.round(n * 100) / 100;
const pct = (r: number): string => `${Math.round(r * 100)}%`;
const SOURCE_LABEL: Record<Source, string> = { measured: "medido", "ai-suggested": "sugerido pela IA", confirmed: "confirmado" };

export function formatCurrency(amount: number, currency: string, fractionDigits = 2): string {
  const opts = { style: "currency" as const, currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits };
  try {
    return new Intl.NumberFormat("pt-BR", opts).format(amount);
  } catch {
    return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(amount)} ${currency}`;
  }
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

export function buildReportModel(
  e: Engagement,
  maps: Record<string, ProcessMap>,
  opps: Opportunity[],
  now: number,
): DiagnosticReport {
  const roles = new Map<string, Role>(e.roles.map((r) => [r.id, r]));
  const procs = new Map<string, Process>(e.processes.map((p) => [p.id, p]));
  const roleOf = (p: Process): Role | undefined => (p.roleId ? roles.get(p.roleId) : undefined);
  const mapped = e.processes.filter((p) => maps[p.id]);
  const allMaps = mapped.map((p) => maps[p.id]!);

  const processScores: Record<string, number> = {};
  const processCosts: Record<string, number> = {};
  for (const p of mapped) {
    processScores[p.id] = processScore(maps[p.id]!);
    processCosts[p.id] = processMonthlyCost(maps[p.id]!, p, roleOf(p));
  }
  const scoreP = mean(Object.values(processScores));
  const scoreD = dataScore(e.dataQuestionnaire, allMaps);
  const scoreAi = aiReadinessScore(scoreP, scoreD);

  const visible = opps.filter((o) => !o.hidden).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const items: ReportOpportunity[] = visible.map((o) => {
    const p = procs.get(o.processId);
    const map = maps[o.processId];
    const sav = p && map ? opportunitySavings(o, map, p, roleOf(p)) : { monthlyCostToday: 0, monthlySavings: 0, appliedPct: 0, capped: false };
    const path = prerequisitePath(o, opps);
    return {
      ...o,
      processName: p?.name ?? o.processId,
      ...sav,
      readiness: opportunityReadiness(o, scoreP, scoreD),
      quickWin: isQuickWin(o, opps) && !(o.wave === 3 && o.prerequisites.length > 0),
      prerequisitePath: path,
    };
  });

  const totalCost = money2(Object.values(processCosts).reduce((a, b) => a + b, 0));
  const totalSavings = money2(items.reduce((a, o) => a + o.monthlySavings, 0));
  const reasons = draftReasons(e, maps);

  const roadmap = ([1, 2, 3] as const).map((wave) => ({ wave, items: items.filter((o) => o.wave === wave) }));

  const roleMap = new Map<string, ReportSquadRole>();
  for (const o of items) {
    for (const name of o.suggestedSquad.roles) {
      const r = roleMap.get(name) ?? { name, opportunities: 0, waves: [] };
      r.opportunities += 1;
      if (!r.waves.includes(o.wave)) r.waves.push(o.wave);
      roleMap.set(name, r);
    }
  }
  const weeksByWave = roadmap.map((w) => ({ wave: w.wave, weeks: w.items.reduce((a, o) => a + o.suggestedSquad.weeks, 0) }));

  const steps = allMaps.flatMap((m) => m.steps);
  const ratioOf = (f: (s: (typeof steps)[number]) => boolean): string => (steps.length === 0 ? "—" : pct(steps.filter(f).length / steps.length));
  const kpis: ReportKpi[] = [
    { label: "Custo mensal mapeado", baseline: formatCurrency(totalCost, e.currency), direction: "Reduzir" },
    { label: "Tempo mediano somado dos passos mapeados", baseline: formatDuration(steps.reduce((a, s) => a + (s.medianDurationMs ?? 0), 0)), direction: "Reduzir" },
    { label: "Passos com dados estruturados", baseline: pct(observedStructuredRatio(allMaps)), direction: "Aumentar" },
    { label: "Passos com transferência manual de dados", baseline: ratioOf((s) => s.manualTransfer), direction: "Reduzir" },
    { label: "Passos com retrabalho", baseline: ratioOf((s) => s.rework), direction: "Reduzir" },
    { label: "Score de processos", baseline: `${scoreP}/100`, direction: "Aumentar" },
    { label: "Score de dados", baseline: `${scoreD}/100`, direction: "Aumentar" },
    { label: "Prontidão para IA", baseline: `${scoreAi}/100`, direction: "Aumentar" },
  ];

  const assumptions: DiagnosticReport["assumptions"] = [];
  for (const p of e.processes) {
    if (p.volumePerMonth) assumptions.push({ label: `Volume mensal — ${p.name}`, value: `${p.volumePerMonth.value} execuções`, source: p.volumePerMonth.source });
    if (p.peopleCount) assumptions.push({ label: `Pessoas envolvidas — ${p.name}`, value: String(p.peopleCount.value), source: p.peopleCount.source });
    const role = roleOf(p);
    if (role) assumptions.push({ label: `Custo/hora do papel "${role.name}" — ${p.name}`, value: formatCurrency(role.hourlyCost, e.currency), source: "confirmed" });
    const map = maps[p.id];
    if (map) {
      const total = map.steps.reduce((a, s) => a + (s.medianDurationMs ?? 0), 0);
      assumptions.push({ label: `Duração mediana por execução — ${p.name}`, value: formatDuration(total), source: "measured" });
    }
  }
  for (const axis of AXIS_ORDER) {
    const a = e.dataQuestionnaire[axis];
    if (a) assumptions.push({ label: `Questionário de dados — ${AXIS_LABELS[axis]}`, value: `${a.answer} de 4`, source: a.source });
  }
  for (const o of items) {
    const cap = DIAGNOSTIC_CONFIG.waveCaps[o.wave];
    assumptions.push({
      label: `Economia estimada — ${o.title}`,
      value: `${pct(o.estimatedSavingsPct.value)} pedido, ${pct(o.appliedPct)} aplicado (teto da onda ${o.wave}: ${pct(cap)})`,
      source: o.estimatedSavingsPct.source,
    });
  }

  return {
    generatedAt: now,
    configVersion: DIAGNOSTIC_CONFIG_VERSION,
    draft: reasons.length > 0,
    draftReasons: reasons,
    scores: { process: scoreP, data: scoreD, ai: scoreAi },
    processScores,
    totals: { monthlyCost: totalCost, monthlySavings: totalSavings },
    processCosts,
    opportunities: items,
    topRecommendations: [...items].sort((a, b) => b.monthlySavings - a.monthlySavings || a.order - b.order).slice(0, 3),
    roadmap,
    squad: { roles: [...roleMap.values()], weeksByWave, totalWeeks: weeksByWave.reduce((a, w) => a + w.weeks, 0) },
    kpis,
    assumptions,
  };
}

const WAVES = {
  1: { title: "Onda 1", span: "0–3 meses", goal: "Estruturar dados e padronizar processos" },
  2: { title: "Onda 2", span: "3–6 meses", goal: "Automação determinística" },
  3: { title: "Onda 3", span: "6–12 meses", goal: "IA" },
} as const;

const CSS = `
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
section { padding-top:18px; page-break-before:always; break-before:page; }
section.first { page-break-before:avoid; break-before:avoid; padding-top:0; }
.lead { font-size:11pt; color:var(--muted); margin-bottom:14px; }
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
footer { margin-top:24px; font-size:8pt; color:var(--muted); border-top:1px solid var(--line); padding-top:8px; }
`;

const li = (items: string[]): string => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;

export function renderReportHtml(model: DiagnosticReport, e: Engagement, maps: Record<string, ProcessMap>): string {
  const cur = (n: number): string => formatCurrency(n, e.currency);
  const cur0 = (n: number): string => formatCurrency(n, e.currency, 0);
  const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(model.generatedAt));
  const thesis = e.thesisText.trim() ? e.thesisText : DEFAULT_THESIS_TEXT;
  const num = new Map(model.opportunities.map((o, i) => [o.id, i + 1]));

  const scoreCard = (label: string, v: number): string =>
    `<div class="card score"><div class="small muted">${label}</div><div class="num">${v}<span>/100</span></div><div class="bar"><i style="width:${v}%"></i></div></div>`;

  const banner = model.draft
    ? `<div class="banner" role="note"><strong>Rascunho — premissas não confirmadas</strong>${li(model.draftReasons)}</div>`
    : "";

  const summary = `
<section id="resumo" class="first">
  <div class="eyebrow">Diagnóstico de prontidão para IA</div>
  <h1>${escapeHtml(e.clientName)}</h1>
  <p class="lead">Relatório gerado em ${date}</p>
  ${banner}
  <div class="scores">${scoreCard("Processos", model.scores.process)}${scoreCard("Dados", model.scores.data)}${scoreCard("Prontidão para IA", model.scores.ai)}</div>
  <div class="kpi">
    <div class="card"><div class="small muted">Custo mensal mapeado</div><div class="num">${escapeHtml(cur(model.totals.monthlyCost))}</div></div>
    <div class="card"><div class="small muted">Economia mensal potencial</div><div class="num">${escapeHtml(cur(model.totals.monthlySavings))}</div></div>
  </div>
  <h3>Principais recomendações</h3>
  ${
    model.topRecommendations.length === 0
      ? `<p class="muted">Nenhuma oportunidade visível neste diagnóstico.</p>`
      : `<ol class="recs">${model.topRecommendations
          .map((o) => `<li><strong>${escapeHtml(o.title)}</strong> — ${WAVES[o.wave].title}, economia potencial de ${escapeHtml(cur(o.monthlySavings))}/mês. <span class="muted">${escapeHtml(o.rationale)}</span></li>`)
          .join("")}</ol>`
  }
</section>`;

  const before = `
<section id="antes-da-ia">
  <h2>Antes da IA</h2>
  <p class="thesis">${escapeHtml(thesis)}</p>
  <p>Os três indicadores deste relatório respondem às duas perguntas da tese: os processos estão mapeados e padronizados (${model.scores.process}/100) e os dados estão estruturados (${model.scores.data}/100)? A prontidão para IA (${model.scores.ai}/100) é limitada pelo mais fraco dos dois.</p>
</section>`;

  const processBlocks = e.processes
    .map((p) => {
      const map = maps[p.id];
      const role = p.roleId ? e.roles.find((r) => r.id === p.roleId) : undefined;
      const meta = [
        p.owner ? `Responsável: ${escapeHtml(p.owner)}` : "",
        p.volumePerMonth ? `Volume: ${p.volumePerMonth.value}/mês (${SOURCE_LABEL[p.volumePerMonth.source]})` : "",
        p.peopleCount ? `Pessoas: ${p.peopleCount.value} (${SOURCE_LABEL[p.peopleCount.source]})` : "",
        role ? `Papel: ${escapeHtml(role.name)} (${escapeHtml(cur(role.hourlyCost))}/h)` : "",
      ].filter(Boolean);
      if (!map) return `<div class="process"><h3>${escapeHtml(p.name)}</h3><p class="muted">Mapa ainda não disponível.</p></div>`;
      const title = (id: string): string => escapeHtml(map.steps.find((s) => s.id === id)?.title ?? id);
      const variants = map.variants.length
        ? `<h3>Variantes observadas</h3><ul>${map.variants.map((v) => `<li><strong>${title(v.stepId)}:</strong> ${escapeHtml(v.description)}</li>`).join("")}</ul>`
        : `<p class="muted small">Nenhuma variante observada.</p>`;
      return `<div class="process"><h3>${escapeHtml(p.name)}</h3><div class="meta">${meta.map((m) => `<span>${m}</span>`).join("")}<span>Custo mensal: ${escapeHtml(cur(model.processCosts[p.id] ?? 0))}</span><span>Score do processo: ${model.processScores[p.id]}/100</span></div>${processFlowSvg(map, `Fluxo do processo ${p.name}`)}${variants}</div>`;
    })
    .join("");
  const mapSection = `<section id="mapa"><h2>Mapa por processo</h2><p class="lead">Passos observados nas gravações, com tempo mediano medido, aplicativos e estrutura dos dados.</p>${processBlocks || `<p class="muted">Nenhum processo cadastrado.</p>`}</section>`;

  const answers: Partial<Record<QuestionnaireAxis, number>> = {};
  for (const a of AXIS_ORDER) if (e.dataQuestionnaire[a]) answers[a] = e.dataQuestionnaire[a]!.answer;
  const axisRows = AXIS_ORDER.map((a) => {
    const q = e.dataQuestionnaire[a];
    return q
      ? `<tr><td><strong>${AXIS_LABELS[a]}</strong></td><td>${q.answer} de 4</td><td>${SOURCE_LABEL[q.source]}</td><td>${q.evidence.length ? li(q.evidence) : `<span class="muted">Sem evidências registradas.</span>`}</td></tr>`
      : `<tr><td><strong>${AXIS_LABELS[a]}</strong></td><td colspan="3" class="muted">Sem resposta.</td></tr>`;
  }).join("");
  const allMaps = e.processes.flatMap((p) => (maps[p.id] ? [maps[p.id]!] : []));
  const dataSection = `<section id="dados"><h2>Diagnóstico de dados</h2><p class="lead">Score de dados: <strong>${model.scores.data}/100</strong>, combinando o questionário (60%) e a proporção observada de passos com dados estruturados (${pct(observedStructuredRatio(allMaps))}, 40%).</p><div class="card">${radarSvg(answers).replace('class="chart"', 'class="chart narrow"')}</div><table><thead><tr><th>Eixo</th><th>Resposta</th><th>Fonte</th><th>Evidências</th></tr></thead><tbody>${axisRows}</tbody></table></section>`;

  const cards = model.opportunities
    .map((o) => {
      const path = o.prerequisitePath.length
        ? `<div class="path"><strong>Pré-requisitos:</strong> ${o.prerequisitePath.map((p) => escapeHtml(p.title)).join(" → ")} → <strong>${escapeHtml(o.title)}</strong></div>`
        : `<div class="path muted">Sem pré-requisitos.</div>`;
      return `<div class="card opp"><h3>${num.get(o.id)}. ${escapeHtml(o.title)}</h3><div><span class="badge badge-wave">${WAVES[o.wave].title}</span>${o.quickWin ? `<span class="badge badge-quick">Quick win</span>` : ""}<span class="badge">Esforço ${o.effort}</span><span class="badge">Risco ${{ low: "baixo", medium: "médio", high: "alto" }[o.risk]}</span></div><p class="small muted">Processo: ${escapeHtml(o.processName)}</p><div class="grid"><div>Custo atual<b>${escapeHtml(cur(o.monthlyCostToday))}/mês</b></div><div>Economia<b>${escapeHtml(cur(o.monthlySavings))}/mês</b></div><div>Prontidão<b>${o.readiness}/100</b></div><div>Economia aplicada<b>${pct(o.appliedPct)}${o.capped ? " (teto)" : ""}</b></div></div><p>${escapeHtml(o.rationale)}</p>${path}</div>`;
    })
    .join("");
  const matrix = valueEffortMatrixSvg(
    model.opportunities.map((o) => ({ n: num.get(o.id)!, effort: o.effort, savings: o.monthlySavings, wave: o.wave, quickWin: o.quickWin })),
    cur0,
  );
  const oppSection = `<section id="oportunidades"><h2>Oportunidades</h2><p class="lead">Valor (economia mensal estimada) por esforço de implementação.</p><div class="card">${matrix}</div>${cards || `<p class="muted">Nenhuma oportunidade visível.</p>`}</section>`;

  const roadmap = `<section id="roadmap"><h2>Roadmap de 12 meses</h2><p class="lead">Três ondas: primeiro o terreno (dados e processos), depois a automação determinística e, só então, a IA.</p>${model.roadmap
    .map((w) => `<div class="card wave"><div class="eyebrow">${WAVES[w.wave].title} · ${WAVES[w.wave].span}</div><h3>${WAVES[w.wave].goal}</h3>${w.items.length ? `<table><tbody>${w.items.map((o) => `<tr><td>${num.get(o.id)}. ${escapeHtml(o.title)}${o.prerequisitePath.length ? `<div class="small muted">Depende de: ${o.prerequisitePath.map((p) => escapeHtml(p.title)).join(", ")}</div>` : ""}</td><td class="r">${escapeHtml(cur(o.monthlySavings))}/mês</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Nenhuma oportunidade nesta onda.</p>`}</div>`)
    .join("")}</section>`;

  const squad = `<section id="squad"><h2>Proposta de squad</h2><p class="lead">Perfis sugeridos pelas oportunidades e indicadores para medir o resultado contra a linha de base deste diagnóstico.</p><h3>Perfis</h3>${model.squad.roles.length ? `<table><thead><tr><th>Perfil</th><th class="r">Oportunidades</th><th>Ondas</th></tr></thead><tbody>${model.squad.roles.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="r">${r.opportunities}</td><td>${r.waves.sort().join(", ")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Nenhum perfil sugerido.</p>`}<h3>Duração</h3><table><tbody>${model.squad.weeksByWave.map((w) => `<tr><td>${WAVES[w.wave as 1 | 2 | 3].title} (${WAVES[w.wave as 1 | 2 | 3].span})</td><td class="r">${w.weeks} semanas</td></tr>`).join("")}<tr><td><strong>Total</strong></td><td class="r"><strong>${model.squad.totalWeeks} semanas</strong></td></tr></tbody></table><p class="small muted">Premissa: as oportunidades de uma mesma onda são entregues em sequência pelo mesmo squad.</p><h3>KPIs e linha de base</h3><table><thead><tr><th>Indicador</th><th class="r">Linha de base</th><th>Meta</th></tr></thead><tbody>${model.kpis.map((k) => `<tr><td>${escapeHtml(k.label)}</td><td class="r">${escapeHtml(k.baseline)}</td><td>${k.direction}</td></tr>`).join("")}</tbody></table></section>`;

  const w = DIAGNOSTIC_CONFIG;
  const appendix = `<section id="premissas"><h2>Apêndice de premissas</h2><p class="lead">Todo número deste relatório e a origem dele. Parâmetros do modelo na versão ${model.configVersion}.</p><table><thead><tr><th>Premissa</th><th>Valor</th><th>Fonte</th></tr></thead><tbody>${model.assumptions.map((a) => `<tr><td>${escapeHtml(a.label)}</td><td>${escapeHtml(a.value)}</td><td>${SOURCE_LABEL[a.source]}</td></tr>`).join("")}</tbody></table><h3>Parâmetros do modelo (versão ${model.configVersion})</h3><ul class="small"><li>Teto de economia por onda: ${pct(w.waveCaps[1])} (onda 1), ${pct(w.waveCaps[2])} (onda 2), ${pct(w.waveCaps[3])} (onda 3).</li><li>Score de dados: questionário ${pct(w.dataWeights.questionnaire)} + dados estruturados observados ${pct(w.dataWeights.observed)}.</li><li>Prontidão para IA: ${pct(w.aiWeights.min)} do menor score + ${pct(w.aiWeights.mean)} da média.</li><li>Score de processo: penalidades por variante (${w.processPenalties.perVariant} pontos), transferência manual (até ${w.processPenalties.manualTransferRatio}), retrabalho (até ${w.processPenalties.reworkRatio}) e passos sem responsável (até ${w.processPenalties.unownedRatio}).</li></ul><footer>Gerado em ${date}. Relatório derivado dos dados do diagnóstico; não contém imagens das gravações.</footer></section>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`Diagnóstico de prontidão para IA — ${e.clientName}`)}</title>
<style>${CSS}</style>
</head>
<body>
<main>${summary}${before}${mapSection}${dataSection}${oppSection}${roadmap}${squad}${appendix}</main>
</body>
</html>
`;
}
