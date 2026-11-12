// Report model + self-contained HTML renderer for the AI Readiness Diagnostic.
// Pure: no Electron / Node-only imports (also bundled for the renderer).
import type { Enablement, Engagement, Expansion, Initiatives, Opportunity, Process, ProcessMap, ProcessMapStep, QuestionnaireAxis, Role, Source } from "./diagnostic";
import { DEFAULT_THESIS_TEXT, DIAGNOSTIC_CONFIG, DIAGNOSTIC_CONFIG_VERSION, MATURITY_LEVELS, MAX_SQUAD_SIZE } from "./diagnostic-config";
import {
  aggregateSavings,
  aiMaturity,
  aiReadinessScore,
  dataScore,
  observedStructuredRatio,
  opportunityReadiness,
  opportunitySavings,
  overallProcessScore,
  processMonthlyCost,
  processScore,
  weakestDimension,
  type AiMaturity,
} from "./diagnostic-math";
import { draftReasons, isQuickWin, prerequisitePath, squadByWave } from "./diagnostic-rules";
import { REPORT_CSS } from "./diagnostic-report-style";
import {
  AXIS_LABELS,
  AXIS_ORDER,
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
  /** Transitive prerequisites, dependencies first. Hidden opportunities are omitted. */
  prerequisitePath: Opportunity[];
}

export interface ReportProcess {
  id: string;
  name: string;
  owner?: string;
  volume?: { value: number; source: Source };
  people?: { value: number; source: Source };
  role?: Role;
  map?: ProcessMap;
  monthlyCost: number;
  score?: number;
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

export interface ReportMaturity extends AiMaturity {
  /** The dimension holding AI readiness back (ties → "dados"). */
  weakest: "processos" | "dados";
}

export interface ReportWaveSquad {
  wave: 1 | 2 | 3;
  roles: string[];
  count: number;
  max: number;
}

export interface DiagnosticReport {
  generatedAt: number;
  configVersion: number;
  draft: boolean;
  draftReasons: string[];
  thesis: string;
  scores: { process: number; data: number; ai: number };
  maturity: ReportMaturity;
  observedStructuredRatio: number;
  totals: { monthlyCost: number; monthlySavings: number };
  /** True when any visible opportunity's savings percentage is not confirmed. */
  savingsAreEstimates: boolean;
  processes: ReportProcess[];
  opportunities: ReportOpportunity[];
  topRecommendations: ReportOpportunity[];
  roadmap: { wave: 1 | 2 | 3; items: ReportOpportunity[] }[];
  squad: { roles: ReportSquadRole[]; weeksByWave: { wave: 1 | 2 | 3; weeks: number }[]; totalWeeks: number };
  /** Distinct roles per wave among visible opportunities, against the squad cap. */
  squadByWave: ReportWaveSquad[];
  /** Visible enablement items, by order. Never part of money totals. */
  enablement: Enablement[];
  /** Visible new fronts, by order. Never part of money totals. */
  expansion: Expansion[];
  kpis: ReportKpi[];
  assumptions: { label: string; value: string; source: Source | "consultant" }[];
}

const money2 = (n: number): number => Math.round(n * 100) / 100;
const pct = (r: number): string => `${Math.round((Number.isFinite(r) ? r : 0) * 100)}%`;
const SOURCE_LABEL: Record<Source | "consultant", string> = {
  measured: "medido",
  "ai-suggested": "sugerido pela IA",
  confirmed: "confirmado",
  consultant: "informado pelo consultor",
};
const PROVENANCE = "estimativa sugerida pela IA, limitada por teto da onda";
const isWave = (w: unknown): w is 1 | 2 | 3 => w === 1 || w === 2 || w === 3;

export function formatCurrency(amount: number, currency: string, fractionDigits = 2): string {
  const digits = { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits };
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency, ...digits }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("pt-BR", digits).format(amount)} ${currency}`;
  }
}

function buildKpis(e: Engagement, m: { cost: number; steps: ProcessMapStep[]; ratio: number; scores: DiagnosticReport["scores"] }): ReportKpi[] {
  const share = (f: (s: ProcessMapStep) => boolean): string =>
    m.steps.length === 0 ? "—" : pct(m.steps.filter(f).length / m.steps.length);
  const ms = m.steps.reduce((a, s) => a + (s.medianDurationMs ?? 0), 0);
  return [
    { label: "Custo mensal mapeado", baseline: formatCurrency(m.cost, e.currency), direction: "Reduzir" },
    { label: "Tempo mediano somado dos passos mapeados", baseline: formatDuration(ms), direction: "Reduzir" },
    { label: "Passos com dados estruturados", baseline: pct(m.ratio), direction: "Aumentar" },
    { label: "Passos com transferência manual de dados", baseline: share((s) => s.manualTransfer), direction: "Reduzir" },
    { label: "Passos com retrabalho", baseline: share((s) => s.rework), direction: "Reduzir" },
    { label: "Score de processos", baseline: `${m.scores.process}/100`, direction: "Aumentar" },
    { label: "Score de dados", baseline: `${m.scores.data}/100`, direction: "Aumentar" },
    { label: "Prontidão para IA", baseline: `${m.scores.ai}/100`, direction: "Aumentar" },
  ];
}

function buildAssumptions(e: Engagement, processes: ReportProcess[], items: ReportOpportunity[]): DiagnosticReport["assumptions"] {
  const out: DiagnosticReport["assumptions"] = [];
  for (const p of processes) {
    if (p.volume) out.push({ label: `Volume mensal — ${p.name}`, value: `${p.volume.value} execuções`, source: p.volume.source });
    if (p.people) out.push({ label: `Pessoas envolvidas — ${p.name}`, value: String(p.people.value), source: p.people.source });
    if (p.role) {
      out.push({ label: `Custo/hora do papel "${p.role.name}" — ${p.name}`, value: formatCurrency(p.role.hourlyCost, e.currency), source: "consultant" });
    }
    if (p.map) {
      const total = p.map.steps.reduce((a, s) => a + (s.medianDurationMs ?? 0), 0);
      out.push({ label: `Duração mediana por execução — ${p.name}`, value: formatDuration(total), source: "measured" });
    }
  }
  for (const axis of AXIS_ORDER) {
    const a = e.dataQuestionnaire[axis];
    if (a) out.push({ label: `Questionário de dados — ${AXIS_LABELS[axis]}`, value: `${a.answer} de 4`, source: a.source });
  }
  for (const o of items) {
    const cap = DIAGNOSTIC_CONFIG.waveCaps[o.wave];
    out.push({
      label: `Economia estimada — ${o.title}`,
      value: `${pct(o.estimatedSavingsPct.value)} pedido, ${pct(o.appliedPct)} aplicado (teto da onda ${o.wave}: ${pct(cap)})`,
      source: o.estimatedSavingsPct.source,
    });
  }
  return out;
}

export function buildReportModel(
  e: Engagement,
  maps: Record<string, ProcessMap>,
  opps: Opportunity[],
  now: number,
  initiatives: Initiatives = { enablement: [], expansion: [] },
): DiagnosticReport {
  const roles = new Map<string, Role>(e.roles.map((r) => [r.id, r]));
  const procs = new Map<string, Process>(e.processes.map((p) => [p.id, p]));
  const processes: ReportProcess[] = e.processes.map((p) => {
    const map = maps[p.id];
    const role = p.roleId ? roles.get(p.roleId) : undefined;
    return {
      id: p.id,
      name: p.name,
      owner: p.owner,
      volume: p.volumePerMonth,
      people: p.peopleCount,
      role,
      map,
      monthlyCost: map ? processMonthlyCost(map, p, role) : 0,
      score: map ? processScore(map) : undefined,
    };
  });
  const allMaps = processes.flatMap((p) => (p.map ? [p.map] : []));
  const scoreP = overallProcessScore(allMaps);
  const scoreD = dataScore(e.dataQuestionnaire, allMaps);
  const scores = { process: scoreP, data: scoreD, ai: aiReadinessScore(scoreP, scoreD) };
  const maturity: ReportMaturity = { ...aiMaturity(scores.ai), weakest: weakestDimension(scoreP, scoreD) };
  const byOrder = <T extends { hidden: boolean; order: number; id: string }>(xs: T[]): T[] =>
    xs.filter((x) => !x.hidden).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ratio = observedStructuredRatio(allMaps);

  const visible = opps
    .filter((o) => !o.hidden && isWave(o.wave))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const items: ReportOpportunity[] = visible.map((o) => {
    const p = procs.get(o.processId);
    const map = maps[o.processId];
    const role = p?.roleId ? roles.get(p.roleId) : undefined;
    const sav = p && map ? opportunitySavings(o, map, p, role) : { monthlyCostToday: 0, monthlySavings: 0, appliedPct: 0, capped: false };
    return {
      ...o,
      processName: p?.name ?? o.processId,
      ...sav,
      readiness: opportunityReadiness(o, scoreP, scoreD),
      // Hidden prerequisites still block the quick win, but are never listed.
      quickWin: isQuickWin(o, opps) && !(o.wave === 3 && o.prerequisites.length > 0),
      prerequisitePath: prerequisitePath(o, opps).filter((x) => !x.hidden),
    };
  });

  const monthlyCost = money2(processes.reduce((a, p) => a + p.monthlyCost, 0));
  const reasons = draftReasons(e, maps, opps);
  const roadmap = ([1, 2, 3] as const).map((wave) => ({ wave, items: items.filter((o) => o.wave === wave) }));

  const roleMap = new Map<string, ReportSquadRole>();
  for (const o of items) {
    for (const raw of o.suggestedSquad.roles) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const r = roleMap.get(key) ?? { name, opportunities: 0, waves: [] };
      r.opportunities += 1;
      if (!r.waves.includes(o.wave)) r.waves.push(o.wave);
      roleMap.set(key, r);
    }
  }
  const squadRoles = [...roleMap.values()].map((r) => ({ ...r, waves: [...r.waves].sort((a, b) => a - b) }));
  const weeksByWave = roadmap.map((w) => ({ wave: w.wave, weeks: w.items.reduce((a, o) => a + o.suggestedSquad.weeks, 0) }));

  return {
    generatedAt: now,
    configVersion: DIAGNOSTIC_CONFIG_VERSION,
    draft: reasons.length > 0,
    draftReasons: reasons,
    thesis: e.thesisText.trim() ? e.thesisText : DEFAULT_THESIS_TEXT,
    scores,
    maturity,
    observedStructuredRatio: ratio,
    totals: { monthlyCost, monthlySavings: aggregateSavings(visible, maps, e) },
    savingsAreEstimates: items.some((o) => o.estimatedSavingsPct.source !== "confirmed"),
    processes,
    opportunities: items,
    topRecommendations: [...items].sort((a, b) => b.monthlySavings - a.monthlySavings || a.order - b.order).slice(0, 3),
    roadmap,
    squad: { roles: squadRoles, weeksByWave, totalWeeks: weeksByWave.reduce((a, w) => a + w.weeks, 0) },
    squadByWave: squadByWave(visible).map((w) => ({ ...w, count: w.roles.length, max: MAX_SQUAD_SIZE })),
    enablement: byOrder(initiatives.enablement),
    expansion: byOrder(initiatives.expansion),
    kpis: buildKpis(e, { cost: monthlyCost, steps: allMaps.flatMap((m) => m.steps), ratio, scores }),
    assumptions: buildAssumptions(e, processes, items),
  };
}

const WAVES = {
  1: { title: "Onda 1", span: "0–3 meses", goal: "Estruturar dados e padronizar processos" },
  2: { title: "Onda 2", span: "3–6 meses", goal: "Automação determinística" },
  3: { title: "Onda 3", span: "6–12 meses", goal: "IA" },
} as const;
const RISK: Record<string, string> = { low: "baixo", medium: "médio", high: "alto" };
const EFFORT = new Set(["S", "M", "L"]);

interface Ctx {
  m: DiagnosticReport;
  e: Engagement;
  cur: (n: number) => string;
  cur0: (n: number) => string;
  date: string;
  num: Map<string, number>;
}

const esc = escapeHtml;
const li = (items: string[]): string => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
const waveInfo = (w: number): { title: string; span: string; goal: string } => WAVES[isWave(w) ? w : 3];
const pathText = (path: Opportunity[]): string => path.map((p) => esc(p.title)).join(" → ");
const prov = `<span class="prov">${PROVENANCE}</span>`;

const DIMENSION_LABEL = { processos: "processos", dados: "dados", ia: "IA" } as const;
const FORMAT_LABEL: Record<string, string> = { treinamento: "Treinamento", workshop: "Workshop", letramento: "Letramento", mentoria: "Mentoria" };
const days = (n: number): string => `${Number.isFinite(n) ? n : 0} ${n === 1 ? "dia" : "dias"}`;

function maturityHeadline(m: DiagnosticReport): string {
  return `Nível ${m.maturity.level} de ${MATURITY_LEVELS.length} — ${m.maturity.name}`;
}

function maturityNext(m: DiagnosticReport): string {
  const n = m.maturity.nextLevel;
  const weak = DIMENSION_LABEL[m.maturity.weakest];
  if (!n) return `Nível máximo de maturidade atingido. Mantenha a evolução de ${weak}, a dimensão mais fraca hoje.`;
  return `O que falta para o próximo nível (${n.level} — ${n.name}): +${n.pointsNeeded} ${n.pointsNeeded === 1 ? "ponto" : "pontos"} de prontidão para IA, começando por ${weak}, a dimensão mais fraca.`;
}

function maturityScale(m: DiagnosticReport): string {
  return `<ol class="levels" aria-label="Escala de maturidade em IA">${MATURITY_LEVELS.map(
    (l) => `<li class="${l.level === m.maturity.level ? "on" : l.level < m.maturity.level ? "done" : ""}"><b>${l.level}</b><span>${esc(l.name)}</span></li>`,
  ).join("")}</ol>`;
}

function renderCover({ m, e, date }: Ctx): string {
  return `
<section id="capa" class="cover">
  <div class="cover-top">
    <div class="eyebrow">Diagnóstico de prontidão para IA</div>
    <h1>${esc(e.clientName)}</h1>
    <p class="cover-date">${date}</p>
  </div>
  <div class="cover-maturity">
    <div class="eyebrow">Maturidade em IA</div>
    <div class="cover-level">${esc(maturityHeadline(m))}</div>
    ${maturityScale(m)}
    <p class="cover-next">${esc(maturityNext(m))}</p>
  </div>
  <p class="tagline">Do what matters</p>
  <div class="cover-footer" aria-hidden="true">avanade.com</div>
</section>`;
}

function renderSummary({ m, cur }: Ctx): string {
  const score = (label: string, v: number): string =>
    `<div class="card score"><div class="tag">${label}</div><div class="num">${v}<span>/100</span></div><div class="bar"><i style="width:${v}%"></i></div></div>`;
  const banner = m.draft
    ? `<div class="banner" role="note"><strong>Rascunho — premissas não confirmadas</strong>${li(m.draftReasons)}</div>`
    : "";
  const recs = m.topRecommendations.length
    ? `<ol class="recs">${m.topRecommendations
        .map(
          (o) =>
            `<li><strong>${esc(o.title)}</strong> — ${waveInfo(o.wave).title}, economia potencial de ${esc(cur(o.monthlySavings))}/mês. ` +
            `<span class="muted">${esc(o.rationale)}</span></li>`,
        )
        .join("")}</ol>`
    : `<p class="muted">Nenhuma oportunidade visível neste diagnóstico.</p>`;
  return `
<section id="resumo" class="pb">
  <h2>Resumo executivo</h2>
  ${banner}
  <div class="scores">${score("Processos", m.scores.process)}${score("Dados", m.scores.data)}${score("Prontidão para IA", m.scores.ai)}</div>
  <div class="card maturity"><div class="tag">Maturidade em IA</div><div class="level">${esc(maturityHeadline(m))}</div><p class="small">${esc(maturityNext(m))}</p></div>
  <div class="kpi">
    <div class="card"><div class="tag">Custo mensal mapeado</div><div class="num">${esc(cur(m.totals.monthlyCost))}</div></div>
    <div class="card"><div class="tag">Economia mensal potencial</div><div class="num">${esc(cur(m.totals.monthlySavings))}</div>${m.savingsAreEstimates ? prov : ""}</div>
  </div>
  <h3>Principais recomendações</h3>
  ${recs}
</section>`;
}

function renderEnablement({ m }: Ctx): string {
  const cards = m.enablement
    .map(
      (x) => `<div class="card item"><div><span class="tag">${esc(FORMAT_LABEL[x.format] ?? "Capacitação")}</span><span class="tag tag-muted">Lacuna: ${esc(DIMENSION_LABEL[x.gap] ?? "—")}</span></div>
<h3>${esc(x.title)}</h3>
<div class="meta"><span>Público: ${esc(x.audience)}</span><span>Duração: ${esc(days(x.durationDays))}</span></div>
<p>${esc(x.rationale)}</p></div>`,
    )
    .join("");
  const body = cards ? `<div class="items">${cards}</div>` : `<p class="muted">Nenhuma ação de capacitação proposta.</p>`;
  return `<section id="capacitacao"><h2>Capacitação: treinamentos e workshops de IA</h2>
<p class="lead">Para sair do nível ${m.maturity.level} (${esc(m.maturity.name)}), as pessoas precisam evoluir junto com processos e dados. As ações abaixo atacam as lacunas mais fracas e acontecem na Onda 1, antes das iniciativas de IA.</p>
${body}<p class="small muted">Capacitação não entra no cálculo de economia deste relatório.</p></section>`;
}

function renderExpansion({ m }: Ctx): string {
  const cards = m.expansion
    .map(
      (x) => `<div class="card item"><span class="tag">Próximo ciclo</span><h3>${esc(x.area)}</h3>
<p>${esc(x.rationale)}</p>
<div class="small"><strong>Evidências nas gravações</strong>${li(x.evidence)}</div>
${x.relatedApps.length ? `<div class="apps">${x.relatedApps.map((a) => `<span class="chip">${esc(a)}</span>`).join("")}</div>` : ""}</div>`,
    )
    .join("");
  const body = cards ? `<div class="items">${cards}</div>` : `<p class="muted">Nenhuma nova frente identificada nas gravações.</p>`;
  return `<section id="novas-frentes"><h2>Novas frentes no cliente</h2>
<p class="lead">Áreas que apareceram nas gravações — aplicativos e passagens de bastão — mas ainda não foram mapeadas. São candidatas ao próximo ciclo do diagnóstico.</p>
${body}<p class="small muted">Sem estimativa financeira: as frentes precisam ser gravadas e mapeadas antes de qualquer número.</p></section>`;
}

function renderThesis({ m }: Ctx): string {
  return `
<section id="antes-da-ia">
  <h2>Antes da IA</h2>
  <p class="thesis">${esc(m.thesis)}</p>
  <p>Os indicadores deste relatório respondem às duas perguntas da tese: os processos estão mapeados e padronizados (${m.scores.process}/100) e os dados estão estruturados (${m.scores.data}/100)? A prontidão para IA (${m.scores.ai}/100) é limitada pelo mais fraco dos dois.</p>
</section>`;
}

function renderProcess({ cur }: Ctx, p: ReportProcess): string {
  if (!p.map) return `<div class="process"><h3>${esc(p.name)}</h3><p class="muted">Mapa ainda não disponível.</p></div>`;
  const map = p.map;
  const meta = [
    p.owner ? `Responsável: ${esc(p.owner)}` : "",
    p.volume ? `Volume: ${p.volume.value}/mês (${SOURCE_LABEL[p.volume.source]})` : "",
    p.people ? `Pessoas: ${p.people.value} (${SOURCE_LABEL[p.people.source]})` : "",
    p.role ? `Papel: ${esc(p.role.name)} (${esc(cur(p.role.hourlyCost))}/h)` : "",
    `Custo mensal: ${esc(cur(p.monthlyCost))}`,
    `Score do processo: ${p.score ?? 0}/100`,
  ].filter(Boolean);
  const stepTitle = (id: string): string => esc(map.steps.find((s) => s.id === id)?.title ?? id);
  const variants = map.variants.length
    ? `<h3>Variantes observadas</h3><ul>${map.variants.map((v) => `<li><strong>${stepTitle(v.stepId)}:</strong> ${esc(v.description)}</li>`).join("")}</ul>`
    : `<p class="muted small">Nenhuma variante observada.</p>`;
  return `<div class="process"><h3>${esc(p.name)}</h3><div class="meta">${meta.map((x) => `<span>${x}</span>`).join("")}</div>${processFlowSvg(map, `Fluxo do processo ${p.name}`)}${variants}</div>`;
}

function renderProcessMaps(ctx: Ctx): string {
  const body = ctx.m.processes.map((p) => renderProcess(ctx, p)).join("") || `<p class="muted">Nenhum processo cadastrado.</p>`;
  return `<section id="mapa" class="pb"><h2>Mapa por processo</h2><p class="lead">Passos observados nas gravações, com tempo mediano medido, aplicativos e estrutura dos dados.</p>${body}</section>`;
}

function renderData({ m, e }: Ctx): string {
  const answers: Partial<Record<QuestionnaireAxis, number>> = {};
  for (const a of AXIS_ORDER) if (e.dataQuestionnaire[a]) answers[a] = e.dataQuestionnaire[a]!.answer;
  const rows = AXIS_ORDER.map((a) => {
    const q = e.dataQuestionnaire[a];
    if (!q) return `<tr><td><strong>${AXIS_LABELS[a]}</strong></td><td colspan="3" class="muted">Sem resposta.</td></tr>`;
    const evidence = q.evidence.length ? li(q.evidence) : `<span class="muted">Sem evidências registradas.</span>`;
    return `<tr><td><strong>${AXIS_LABELS[a]}</strong></td><td>${q.answer} de 4</td><td>${SOURCE_LABEL[q.source]}</td><td>${evidence}</td></tr>`;
  }).join("");
  const w = DIAGNOSTIC_CONFIG.dataWeights;
  return `<section id="dados" class="pb"><h2>Diagnóstico de dados</h2>
<p class="lead">Score de dados: <strong>${m.scores.data}/100</strong>, combinando o questionário (${pct(w.questionnaire)}) e a proporção observada de passos com dados estruturados (${pct(m.observedStructuredRatio)}, ${pct(w.observed)}).</p>
<div class="card">${radarSvg(answers).replace('class="chart"', 'class="chart narrow"')}</div>
<table><thead><tr><th>Eixo</th><th>Resposta</th><th>Fonte</th><th>Evidências</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function renderCard({ cur, num }: Ctx, o: ReportOpportunity): string {
  const path = o.prerequisitePath.length
    ? `<div class="path"><strong>Pré-requisitos:</strong> ${pathText(o.prerequisitePath)} → <strong>${esc(o.title)}</strong></div>`
    : `<div class="path muted">Sem pré-requisitos listados.</div>`;
  const badges =
    `<span class="badge badge-wave">${waveInfo(o.wave).title}</span>` +
    (o.quickWin ? `<span class="badge badge-quick">Quick win</span>` : "") +
    `<span class="badge">Esforço ${EFFORT.has(o.effort) ? o.effort : "—"}</span>` +
    `<span class="badge">Risco ${esc(RISK[o.risk] ?? "—")}</span>`;
  const provenance = o.estimatedSavingsPct.source !== "confirmed" ? prov : "";
  return `<div class="card opp"><h3>${num.get(o.id)}. ${esc(o.title)}</h3><div>${badges}</div>
<p class="small muted">Processo: ${esc(o.processName)}</p>
<div class="grid"><div>Custo atual<b>${esc(cur(o.monthlyCostToday))}/mês</b></div><div>Economia<b>${esc(cur(o.monthlySavings))}/mês</b>${provenance}</div><div>Prontidão<b>${o.readiness}/100</b></div><div>Economia aplicada<b>${pct(o.appliedPct)}${o.capped ? " (teto)" : ""}</b></div></div>
<p>${esc(o.rationale)}</p>${path}</div>`;
}

function renderOpportunities(ctx: Ctx): string {
  const { m, num, cur0 } = ctx;
  const points = m.opportunities.map((o) => ({ n: num.get(o.id)!, effort: o.effort, savings: o.monthlySavings, wave: o.wave, quickWin: o.quickWin }));
  const cards = m.opportunities.map((o) => renderCard(ctx, o)).join("") || `<p class="muted">Nenhuma oportunidade visível.</p>`;
  return `<section id="oportunidades"><h2>Oportunidades</h2><p class="lead">Valor (economia mensal estimada) por esforço de implementação.</p><div class="card">${valueEffortMatrixSvg(points, cur0)}</div>${cards}</section>`;
}

function renderRoadmap({ m, cur, num }: Ctx): string {
  const waves = m.roadmap
    .map((w) => {
      const info = WAVES[w.wave];
      const rows = w.items
        .map((o) => {
          const dep = o.prerequisitePath.length ? `<div class="small muted">Depende de: ${o.prerequisitePath.map((p) => esc(p.title)).join(", ")}</div>` : "";
          return `<tr><td>${num.get(o.id)}. ${esc(o.title)}${dep}</td><td class="r">${esc(cur(o.monthlySavings))}/mês</td></tr>`;
        })
        .join("");
      const body = w.items.length ? `<table><tbody>${rows}</tbody></table>` : `<p class="muted">Nenhuma oportunidade nesta onda.</p>`;
      const training =
        w.wave === 1 && m.enablement.length
          ? `<h4>Capacitação</h4><table><tbody>${m.enablement
              .map((x) => `<tr><td>${esc(x.title)}<div class="small muted">${esc(FORMAT_LABEL[x.format] ?? "Capacitação")} · ${esc(x.audience)}</div></td><td class="r">${esc(days(x.durationDays))}</td></tr>`)
              .join("")}</tbody></table>`
          : "";
      return `<div class="card wave"><div class="eyebrow">${info.title} · ${info.span}</div><h3>${info.goal}</h3>${body}${training}</div>`;
    })
    .join("");
  return `<section id="roadmap"><h2>Roadmap de 12 meses</h2><p class="lead">Três ondas: primeiro o terreno (dados, processos e capacitação das pessoas), depois a automação determinística e, só então, a IA.</p>${waves}</section>`;
}

function renderSquad({ m }: Ctx): string {
  const roles = m.squad.roles.length
    ? `<table><thead><tr><th>Perfil</th><th class="r">Oportunidades</th><th>Ondas</th></tr></thead><tbody>${m.squad.roles
        .map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${r.opportunities}</td><td>${r.waves.join(", ")}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="muted">Nenhum perfil sugerido.</p>`;
  const weeks = m.squad.weeksByWave
    .map((w) => {
      const sq = m.squadByWave.find((x) => x.wave === w.wave);
      const people = sq ? `${sq.count} de ${sq.max} pessoas` : "—";
      const names = sq?.roles.length ? sq.roles.map(esc).join(", ") : `<span class="muted">sem perfis</span>`;
      return `<tr><td>${WAVES[w.wave].title} (${WAVES[w.wave].span})</td><td>${names}</td><td class="r nowrap">${people}</td><td class="r nowrap">${w.weeks} semanas</td></tr>`;
    })
    .join("");
  const kpis = m.kpis
    .map((k) => `<tr><td>${esc(k.label)}</td><td class="r">${esc(k.baseline)}</td><td>${k.direction}</td></tr>`)
    .join("");
  return `<section id="squad" class="pb"><h2>Proposta de squad</h2><p class="lead">Squads enxutos, de até ${MAX_SQUAD_SIZE} pessoas por onda. Perfis sugeridos pelas oportunidades e indicadores para medir o resultado contra a linha de base deste diagnóstico.</p>
<h3>Perfis</h3>${roles}
<h3>Squad e duração por onda</h3><table><thead><tr><th>Onda</th><th>Perfis</th><th class="r">Squad</th><th class="r">Duração</th></tr></thead><tbody>${weeks}<tr><td colspan="3"><strong>Total</strong></td><td class="r nowrap"><strong>${m.squad.totalWeeks} semanas</strong></td></tr></tbody></table>
<p class="small muted">Premissa: squads de no máximo ${MAX_SQUAD_SIZE} pessoas; as oportunidades de uma mesma onda são entregues em sequência pelo mesmo squad.</p>
<h3>KPIs e linha de base</h3><table><thead><tr><th>Indicador</th><th class="r">Linha de base</th><th>Meta</th></tr></thead><tbody>${kpis}</tbody></table></section>`;
}

function renderAppendix({ m, date }: Ctx): string {
  const w = DIAGNOSTIC_CONFIG;
  const rows = m.assumptions
    .map((a) => `<tr><td>${esc(a.label)}</td><td>${esc(a.value)}</td><td>${SOURCE_LABEL[a.source]}</td></tr>`)
    .join("");
  const p = w.processPenalties;
  const params = [
    `Teto de economia por onda: ${pct(w.waveCaps[1])} (onda 1), ${pct(w.waveCaps[2])} (onda 2), ${pct(w.waveCaps[3])} (onda 3).`,
    `Oportunidades sobre o mesmo passo são etapas de um caminho, não somam: vale a maior economia por passo.`,
    `Score de dados: questionário ${pct(w.dataWeights.questionnaire)} + dados estruturados observados ${pct(w.dataWeights.observed)}.`,
    `Prontidão para IA: ${pct(w.aiWeights.min)} do menor score + ${pct(w.aiWeights.mean)} da média.`,
    `Maturidade em IA pela prontidão: ${MATURITY_LEVELS.map((l) => `nível ${l.level} ${l.name} (a partir de ${l.min})`).join(", ")}.`,
    `Squad: no máximo ${MAX_SQUAD_SIZE} pessoas por oportunidade e por onda (perfis distintos).`,
    `Capacitação e novas frentes não entram no custo nem na economia.`,
    `Score de processo: penalidades por variante (${p.perVariant} pontos), transferência manual (até ${p.manualTransferRatio}), retrabalho (até ${p.reworkRatio}) e passos sem responsável (até ${p.unownedRatio}).`,
  ];
  return `<section id="premissas" class="pb"><h2>Apêndice de premissas</h2><p class="lead">Todo número deste relatório e a origem dele. Parâmetros do modelo na versão ${m.configVersion}.</p>
<table><thead><tr><th>Premissa</th><th>Valor</th><th>Fonte</th></tr></thead><tbody>${rows}</tbody></table>
<h3>Parâmetros do modelo (versão ${m.configVersion})</h3><ul class="small">${params.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<footer>Gerado em ${date}. Relatório derivado dos dados do diagnóstico; não contém imagens das gravações.</footer></section>`;
}

export function renderReportHtml(model: DiagnosticReport, e: Engagement, _maps?: Record<string, ProcessMap>): string {
  const ctx: Ctx = {
    m: model,
    e,
    cur: (n) => formatCurrency(n, e.currency),
    cur0: (n) => formatCurrency(n, e.currency, 0),
    date: new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(new Date(model.generatedAt)),
    num: new Map(model.opportunities.map((o, i) => [o.id, i + 1])),
  };
  const body = [renderCover, renderSummary, renderThesis, renderProcessMaps, renderData, renderOpportunities, renderEnablement, renderRoadmap, renderExpansion, renderSquad, renderAppendix]
    .map((f) => f(ctx))
    .join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Diagnóstico de prontidão para IA — ${e.clientName}`)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="page-footer" aria-hidden="true">avanade.com</div>
<main>${body}</main>
</body>
</html>
`;
}
