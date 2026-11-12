# Diagnóstico de Prontidão para IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local "Diagnósticos" module to Skill Recorder that groups analyzed recordings into client processes, captures a cost baseline and data-readiness questionnaire, and exports an auditable AI-readiness report (HTML/PDF).

**Architecture:** Pure, deterministic domain logic in `common/` (schemas, math, rules, report HTML) with no Electron/AI dependency; persistence and two Copilot agent turns (`submit_process_map`, `submit_opportunities`) in `electron/diagnostic/`, mirroring `electron/describer/`; IPC + preload bridge; a React view in `src/Diagnostics.tsx` reachable from the Library.

**Tech Stack:** TypeScript, Zod, Electron, React, `@github/copilot-sdk`, Node `node:test` (the repo's runner — NOT Vitest; the spec's "Vitest" is superseded by this).

**Spec:** `docs/superpowers/specs/2026-11-12-ai-readiness-diagnostic-design.md`

## Global Constraints

- Everything stays local: storage under `userData/engagements/<engagementId>/`; override via env `SKILL_RECORDER_ENGAGEMENTS_DIR` (same pattern as `SKILL_RECORDER_SESSIONS_DIR`).
- Ids used as path segments must pass the same guard as `isValidSessionId` (`electron/recorder/session-store.ts`).
- All writes atomic: write `<file>.tmp` then `rename`.
- Default currency `BRL`. UI and report copy in Portuguese (pt-BR).
- Wave savings caps: wave 1 = 0.30, wave 2 = 0.60, wave 3 = 0.80.
- Data score = 0.6 × questionnaire (normalized) + 0.4 × observed structured-step ratio.
- AI readiness = 0.7 × min(process, data) + 0.3 × mean(process, data).
- Config (weights, penalties, caps) lives in `common/diagnostic-config.ts` with `DIAGNOSTIC_CONFIG_VERSION = 1`, written into every report.
- AI never produces final money numbers; all costs/savings/scores computed in `common/diagnostic-math.ts`.
- Report contains only derived data — no frames/screenshots.
- New test files must be appended to the `test` script in `package.json` (explicit file list).
- Agent sessions must pass `availableTools` restricted to the module's own tools (same sandboxing rule as `describer.ts:289`).

## Review Focus

1. Process with steps lacking `startMs`/`endMs` → duration counts as 0 and step flagged `durationUnknown`; cost must not become `NaN`. (Task 2)
2. `volumePerMonth`/`hourlyCost` missing or zero → cost 0 and the report is forced to draft, never a crash. (Tasks 2, 3)
3. Opportunity `prerequisites` referencing unknown ids or forming a cycle → rejected by validation with a readable error fed back to the agent. (Task 3)
4. Linked session deleted from disk → process marked `stale`, map generation refuses with a clear message instead of throwing. (Task 4)
5. Client name/process names containing HTML (`<script>`) → escaped in the report. (Task 6)

---

### Task 1: Domain schemas and config

**Files:**
- Create: `common/diagnostic.ts`, `common/diagnostic-config.ts`
- Test: `common/diagnostic.test.ts`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Produces (Zod schema + inferred type each): `Source = "measured"|"ai-suggested"|"confirmed"`; `SourcedNumber {value:number, source:Source}`; `Role {id,name,hourlyCost:number}`; `QuestionnaireAxis = "inventory"|"structure"|"quality"|"access"|"governance"`; `QuestionnaireAnswer {answer:1|2|3|4, source:Source, evidence:string[]}`; `DataQuestionnaire = Partial<Record<QuestionnaireAxis, QuestionnaireAnswer>>`; `ProcessMapStep {id,title,medianDurationMs:number|null,apps:string[],dataArtifacts:string[],dataStructure:"structured"|"semi"|"unstructured",manualTransfer:boolean,rework:boolean,owner?:string,sourceStepRefs:{sessionId,stepId}[]}`; `ProcessMap {version:1,processId,revision,createdAt,steps,variants:{stepId,description}[],confidence:"high"|"medium"|"low"}`; `ProcessMapSubmissionSchema` (= ProcessMap minus version/processId/revision/createdAt); `Process {id,name,owner?,sessionIds:string[],roleId?,volumePerMonth?:SourcedNumber,peopleCount?:SourcedNumber,stale:boolean}`; `Opportunity {id,title,processId,stepIds,wave:1|2|3,prerequisites:string[],estimatedSavingsPct:SourcedNumber,effort:"S"|"M"|"L",risk:"low"|"medium"|"high",rationale,suggestedSquad:{roles:string[],weeks:number},hidden:boolean,order:number}`; `OpportunitiesSubmissionSchema {opportunities: Opportunity minus hidden/order}`; `Engagement {version:1,id,clientName,createdAt,currency:string (default "BRL"),roles,dataQuestionnaire,processes,thesisText:string}`.
- `common/diagnostic-config.ts`: `DIAGNOSTIC_CONFIG_VERSION = 1`; `DIAGNOSTIC_CONFIG = { waveCaps:{1:0.3,2:0.6,3:0.8}, dataWeights:{questionnaire:0.6,observed:0.4}, aiWeights:{min:0.7,mean:0.3}, processPenalties:{perVariant:5,manualTransferRatio:30,reworkRatio:20,unownedRatio:15} }`; `DEFAULT_THESIS_TEXT` (pt-BR paragraph: antes da IA, processos mapeados e dados estruturados).

- [ ] **Step 1: Write failing tests** — `EngagementSchema.parse({version:1,id:"e1",clientName:"ACME",createdAt:1,roles:[],dataQuestionnaire:{},processes:[],thesisText:""}).currency === "BRL"`; `QuestionnaireAnswerSchema` rejects `answer: 5`; `OpportunitySchema` rejects `wave: 4`; `estimatedSavingsPct.value` outside `[0,1]` rejected.
- [ ] **Step 2: Run** `node --experimental-transform-types --no-warnings --import ./evals/register.mjs --test common/diagnostic.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement schemas and config** as listed above; add test file to `package.json` `test`.
- [ ] **Step 4: Run** same command → PASS; `npm run typecheck` → no errors.
- [ ] **Step 5: Commit** `feat(diagnostic): add domain schemas and config`

### Task 2: Deterministic math

**Files:**
- Create: `common/diagnostic-math.ts`
- Test: `common/diagnostic-math.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `DIAGNOSTIC_CONFIG`.
- Produces:
  - `stepMonthlyCost(step: ProcessMapStep, process: Process, role: Role|undefined): number` — `(medianDurationMs ?? 0)/3_600_000 × volume × hourlyCost`, 0 when any input missing.
  - `processMonthlyCost(map: ProcessMap, process: Process, role?: Role): number`
  - `opportunitySavings(opp: Opportunity, map: ProcessMap, process: Process, role?: Role): {monthlyCostToday:number, monthlySavings:number, appliedPct:number, capped:boolean}`
  - `processScore(map: ProcessMap): number` (0–100, clamped; 100 − perVariant×variants − manualTransferRatio×ratio − reworkRatio×ratio − unownedRatio×ratio)
  - `observedStructuredRatio(maps: ProcessMap[]): number` (structured steps / all steps; 0 when no steps)
  - `dataScore(q: DataQuestionnaire, maps: ProcessMap[]): number` — questionnaire normalized as mean((answer−1)/3)×100 over answered axes (0 if none)
  - `aiReadinessScore(process: number, data: number): number`
  - `opportunityReadiness(opp, processScoreValue, dataScoreValue): number` — wave 1 → 100, wave 2 → processScore, wave 3 → aiReadinessScore.
  - All money rounded to 2 decimals, scores to integers.

- [ ] **Step 1: Write failing tests** with fixed fixture (2 steps: 30 min and 90 min, volume 100, R$ 60/h): `processMonthlyCost` = 12000; opportunity on 90-min step, wave 1, pct 0.5 → `appliedPct 0.3, capped true, monthlySavings 2700`; step with `medianDurationMs:null` contributes 0 (Review Focus 1); missing volume → 0 (Review Focus 2); `aiReadinessScore(40, 80) === 46` (0.7×40 + 0.3×60); `dataScore` with all answers 4 and all steps structured → 100; `processScore` never below 0.
- [ ] **Step 2: Run** the test file → FAIL.
- [ ] **Step 3: Implement** the functions above; add file to `package.json` `test`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): deterministic cost and readiness math`

### Task 3: Rules — validation, draft gate, questionnaire suggestions

**Files:**
- Create: `common/diagnostic-rules.ts`
- Test: `common/diagnostic-rules.test.ts`

**Interfaces:**
- Produces:
  - `validateOpportunities(opps: Opportunity[]): {ok:true} | {ok:false, error:string}` — unknown prerequisite id, self-reference, or cycle → error naming the ids (Review Focus 3).
  - `draftReasons(e: Engagement, maps: Record<string, ProcessMap>): string[]` — non-empty (pt-BR messages) if any included process lacks a map, has `volumePerMonth`/`peopleCount` not `confirmed`, lacks a role, role `hourlyCost <= 0`, or is `stale` (Review Focus 2).
  - `isQuickWin(opp: Opportunity, all: Opportunity[]): boolean` — true iff `effort==="S"` and `prerequisites.length === 0` (a prerequisite counts as unresolved until delivered, and delivery tracking is out of scope — so any wave-3 opp with prerequisites is never a quick win, spec §5).
  - `prerequisitePath(opp, all): Opportunity[]` — topological order of transitive prerequisites.
  - `suggestQuestionnaire(maps: ProcessMap[]): DataQuestionnaire` — `structure` from `observedStructuredRatio` (≥0.75→4, ≥0.5→3, ≥0.25→2, else 1); `access` from ratio of steps with `manualTransfer` (inverse buckets); `quality` from `rework` ratio (inverse); `inventory`/`governance` left unanswered. Every suggested answer has `source:"ai-suggested"` and evidence strings with the ratio.

- [ ] **Step 1: Write failing tests**: cycle A→B→A rejected with message containing both ids; unknown id rejected; engagement with `volumePerMonth.source:"ai-suggested"` yields a draft reason; fully confirmed engagement yields `[]`; wave-3 S-effort opp with a wave-1 prerequisite → `isQuickWin === false`; `suggestQuestionnaire` on 3/4 structured steps → `structure.answer === 4`, `source === "ai-suggested"`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; add to `package.json` `test`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): validation, draft gate and questionnaire suggestions`

### Task 4: Engagement store

**Files:**
- Create: `electron/diagnostic/store.ts`
- Test: `electron/diagnostic/store.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas; `isValidSessionId`, `sessionDir` from `electron/recorder/session-store.ts`; `loadPersistedAnalysis(sessionId)` from `electron/describer/describer.ts`.
- Produces:
  - `engagementsRoot(): string` (env override `SKILL_RECORDER_ENGAGEMENTS_DIR`)
  - `listEngagements(): Engagement[]`, `loadEngagement(id): Engagement|null` (corrupt JSON → throws `Error("Diagnóstico corrompido: <id>")`), `saveEngagement(e): void` (atomic), `deleteEngagement(id): void`
  - `loadProcessMap(engagementId, processId): ProcessMap|null`, `saveProcessMap(engagementId, map): void` → file `maps/<processId>.json`
  - `loadOpportunities(engagementId): Opportunity[]`, `saveOpportunities(engagementId, opps): void` → `opportunities.json`
  - `refreshStale(e: Engagement): Engagement` — sets `process.stale = true` when any linked session dir or its analysis is missing (Review Focus 4).
  - `linkedAnalyses(e, processId): {sessionId:string, analysis: Analysis}[]` — throws `Error` with pt-BR message when process is stale.

- [ ] **Step 1: Write failing tests** using a temp dir via env overrides for both sessions and engagements roots: save/load round-trip; `.tmp` not left behind; invalid id `"../x"` throws; corrupt file throws the pt-BR message; deleting a linked session dir makes `refreshStale` mark the process stale and `linkedAnalyses` throw.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; add to `package.json` `test`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(diagnostic): local engagement store`

### Task 5: Agent turns — process map and opportunities

**Files:**
- Create: `electron/diagnostic/tools.ts`, `electron/diagnostic/instructions.ts`, `electron/diagnostic/agent.ts`
- Test: `electron/diagnostic/tools.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `CopilotClient`/`Tool` from `@github/copilot-sdk` used exactly as in `electron/describer/describer.ts` and `tools.ts`.
- Produces:
  - `buildMapTools(ctx: {analyses: {sessionId, analysis}[], onSubmit:(s: ProcessMapSubmission)=>void}): Tool[]` — tools `get_analyses` (returns titles, intents, steps with apps/durations) and `submit_process_map` (Zod-validated; on failure returns the Zod error text so the agent retries; also rejects `sourceStepRefs` pointing to unknown session/step).
  - `buildOpportunityTools(ctx: {engagement, maps: Record<string,ProcessMap>, onSubmit:(s)=>void}): Tool[]` — tools `get_diagnostic_context` (maps, questionnaire, roles — no money) and `submit_opportunities` (Zod + `validateOpportunities`; error text returned on failure).
  - `MAP_INSTRUCTIONS`, `OPPORTUNITY_INSTRUCTIONS` (pt-BR output): opportunities must follow dados → automação → IA; wave 3 must list data prerequisites; never output currency values.
  - `class DiagnosticAgent { generateMap(engagementId, processId, feedback?: string, onProgress?): Promise<ProcessMap>; generateOpportunities(engagementId, feedback?: string, onProgress?): Promise<Opportunity[]>; cancel(): void }` — persists via store, bumps `revision`, `medianDurationMs` comes from the agent's merged steps but is **recomputed** by code as the median of the referenced source steps' `endMs−startMs` (null if none have both).
  - Timeout/failure leaves previously saved map/opportunities untouched (spec §8).

- [ ] **Step 1: Write failing tests** on the tools only (no live Copilot): `submit_process_map` with invalid payload returns text containing the Zod path and does not call `onSubmit`; with an unknown `sourceStepRefs` session returns an error; valid payload calls `onSubmit` once; `submit_opportunities` with a cycle returns the `validateOpportunities` error; `get_diagnostic_context` JSON contains no `hourlyCost`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** tools, instructions, and `DiagnosticAgent` (session created with `availableTools` = its tool names); export a pure `medianDurationFromRefs(refs, analyses): number|null` and unit-test it in the same file (odd/even counts, missing timestamps → null).
- [ ] **Step 4: Run** tests → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat(diagnostic): copilot turns for process map and opportunities`

### Task 6: Report renderer and PDF export

**Files:**
- Create: `common/diagnostic-report.ts`, `electron/diagnostic/export.ts`
- Test: `common/diagnostic-report.test.ts`, fixture `common/__fixtures__/diagnostic-engagement.json`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `buildReportModel(e, maps, opps, now: number): DiagnosticReport` — `{generatedAt, configVersion, draft:boolean, draftReasons, scores:{process,data,ai}, totals:{monthlyCost,monthlySavings}, opportunities (visible, sorted by order, with computed money + readiness + quickWin), roadmap:{wave, items}[], assumptions:{label, value, source}[]}`.
  - `renderReportHtml(model, e, maps): string` — self-contained HTML (inline CSS, inline SVG), sections in spec §6 order; process flow SVG with step boxes colored by `dataStructure` (structured green, semi amber, unstructured red); radar SVG of 5 axes; value×effort matrix; 3-wave roadmap; draft banner text exactly `Rascunho — premissas não confirmadas`; all user strings escaped via an `escapeHtml` helper (Review Focus 5); currency formatted with `Intl.NumberFormat("pt-BR", {style:"currency", currency})`.
  - `exportReport(html: string, targetPath: string, format: "html"|"pdf"): Promise<void>` in `electron/diagnostic/export.ts` — PDF via hidden `BrowserWindow` + `webContents.printToPDF({printBackground:true, pageSize:"A4"})`.

- [ ] **Step 1: Write failing tests** with the fixture: model `draft === false` and totals match hand-computed values; flipping one source to `ai-suggested` sets draft and the HTML contains the banner text; `clientName: "<script>x</script>"` appears escaped and no `<script>` tag exists in output; HTML contains `DIAGNOSTIC_CONFIG_VERSION` and the thesis text; hidden opportunity absent.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; add test to `package.json`.
- [ ] **Step 4: Run** → PASS. Manually: `node` script in scratch rendering the fixture to HTML, then open with Playwright and save a PDF; confirm visually that all 8 sections render.
- [ ] **Step 5: Commit** `feat(diagnostic): report model, HTML renderer and PDF export`

### Task 7: IPC and preload bridge

**Files:**
- Modify: `common/ipc.ts` (`IPC` table), `electron/ipc.ts`, `electron/preload.cjs` (channel map at top **and** `exposeInMainWorld` object), `src/global.d.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces channels / `window.skillRecorder` methods:
  `diagnosticList` `"diagnostic:list"` → `listDiagnostics(): Promise<Engagement[]>`;
  `diagnosticGet` `"diagnostic:get"` → `getDiagnostic(id): Promise<{engagement, maps, opportunities, report}>` (calls `refreshStale`);
  `diagnosticSave` `"diagnostic:save"` → `saveDiagnostic(engagement: unknown)` (Zod-parsed in main);
  `diagnosticDelete` `"diagnostic:delete"`;
  `diagnosticSuggestQuestionnaire` `"diagnostic:suggest-questionnaire"`;
  `diagnosticGenerateMap` `"diagnostic:generate-map"` `(engagementId, processId, feedback?)`;
  `diagnosticGenerateOpportunities` `"diagnostic:generate-opportunities"` `(engagementId, feedback?)`;
  `diagnosticCancel` `"diagnostic:cancel"`;
  `diagnosticProgress` `"diagnostic:progress"` (main→renderer event, `onDiagnosticProgress(cb)`);
  `diagnosticExport` `"diagnostic:export"` `(engagementId, format)` → shows save dialog, returns `{path}|{canceled:true}`.
  All handlers validate ids with the Task 4 guard and return `{error:string}` instead of throwing to the renderer.

- [ ] **Step 1: Add channels and handlers**; extend `src/global.d.ts` typings.
- [ ] **Step 2: Run** `npm run typecheck` → clean; `npm test` → all existing + new tests pass.
- [ ] **Step 3: Commit** `feat(diagnostic): ipc and preload bridge`

### Task 8: Diagnósticos UI

**Files:**
- Create: `src/Diagnostics.tsx`, `src/diagnostic-view-state.ts`
- Test: `src/diagnostic-view-state.test.ts`
- Modify: `src/Library.tsx` (add a "Sessões | Diagnósticos" switch in the existing header), `src/App.css`

**Interfaces:**
- Consumes: Task 7 bridge; `draftReasons`, `isQuickWin` from Task 3.
- Produces: `src/diagnostic-view-state.ts` pure helpers: `canGenerateMap(process, sessionsWithApprovedAnalysis): {ok:boolean, reason?:string}` (needs ≥1 linked session, not stale; 1 session → ok with reason `"Baixa confiança: sem variação medida"`); `confirmField(value: SourcedNumber, newValue?: number): SourcedNumber` (sets `source:"confirmed"`); `nextStep(engagement, maps, opps): "roles"|"processes"|"questionnaire"|"maps"|"baseline"|"opportunities"|"report"`.
- Screens (one component file, sections in spec §5 order): engagement list/create; roles editor; processes with session linking (from `listSessions`, only sessions with an analysis); questionnaire (5 axes, 1–4, "Sugerir a partir das gravações" button, AI-suggested answers visually highlighted until confirmed); per-process "Gerar mapa" with progress + feedback box + "Tentar novamente" on error; baseline inputs with confirm buttons; opportunities list with hide/reorder; draft reasons list; "Exportar HTML" / "Exportar PDF".

- [ ] **Step 1: Write failing tests** for the three helpers (stale process blocked; single session → ok with low-confidence reason; `confirmField` flips source; `nextStep` returns `"questionnaire"` when processes exist but questionnaire empty).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** helpers, then the UI; add test to `package.json`.
- [ ] **Step 4: Run** `npm test` and `npm run build` → pass. Use the `run` skill to launch the app, create a sample engagement against an existing analyzed session, and screenshot each screen.
- [ ] **Step 5: Commit** `feat(diagnostic): Diagnósticos view`

### Task 9: Evals

**Files:**
- Create: `evals/scenarios/diagnostic-reconciliation/` (3 synthetic analyses: planilha + e-mail + ERP), `evals/scenarios/diagnostic-onboarding/` (2 analyses with divergent variants), `evals/diagnostic.ts`
- Modify: `evals/README.md`, `package.json` (`eval:diagnostic` script mirroring existing eval scripts)

**Interfaces:**
- Consumes: `DiagnosticAgent` (Task 5), existing `evals/judge.ts`/`scoring.ts`.
- Checks: map merges equivalent steps across sessions (step count within expected range in scenario file); every step has ≥1 valid `sourceStepRefs`; onboarding scenario reports ≥1 variant; every wave-3 opportunity has ≥1 prerequisite of lower wave; no currency strings in agent output (regex `R\$|\bBRL\b`).

- [ ] **Step 1: Write scenarios and runner** following the layout of an existing scenario under `evals/scenarios/`.
- [ ] **Step 2: Run** `npm run typecheck:evals` → clean; `npm run eval:diagnostic` (needs Copilot sign-in) → all checks pass, or record failures in the PR description.
- [ ] **Step 3: Commit** `test(diagnostic): eval scenarios for map and opportunities`

### Task 10: Avanade design, squad ≤ 5, AI maturity, enablement and expansion

Added after user review (2026-11-12): report in the Avanade visual identity; squads of at most 5 people; beyond process automation, map AI maturity, enablement (trainings, AI workshops, literacy) and new fronts inside the client.

**Files:**
- Modify: `common/diagnostic.ts`, `common/diagnostic-config.ts`, `common/diagnostic-math.ts`, `common/diagnostic-rules.ts`, `common/diagnostic-report.ts`, `common/diagnostic-report-style.ts`, `common/diagnostic-report-svg.ts`, `electron/diagnostic/tools.ts`, `electron/diagnostic/instructions.ts`, `electron/diagnostic/agent.ts`, `electron/diagnostic/store.ts`, `electron/diagnostic/ipc.ts` (+ helpers if needed), `common/ipc.ts`, `src/diagnostics/OpportunityList.tsx`, `src/Diagnostics.tsx` (or a new `src/diagnostics/InitiativesPanel.tsx`), fixture `common/__fixtures__/diagnostic-engagement.json`
- Test: existing test files of those modules

**Interfaces:**
- `common/diagnostic-config.ts`: `MAX_SQUAD_SIZE = 5`; `MATURITY_LEVELS = [{level:1,name:"Inicial",min:0},{level:2,name:"Exploratório",min:20},{level:3,name:"Estruturado",min:40},{level:4,name:"Escalável",min:60},{level:5,name:"Nativo em IA",min:80}]` (min = inclusive lower bound of the AI readiness score).
- `common/diagnostic.ts`:
  - `OpportunitySchema.suggestedSquad.roles` → `.max(MAX_SQUAD_SIZE)`.
  - `EnablementSchema {id, title, format: "treinamento"|"workshop"|"letramento"|"mentoria", audience: string, gap: "processos"|"dados"|"ia", rationale: string, durationDays: number (>0, ≤ 20), hidden: boolean (default false), order: number}`.
  - `ExpansionSchema {id, area: string, rationale: string, evidence: string[] (≥1), relatedApps: string[], hidden: boolean (default false), order: number}`.
  - `OpportunitiesSubmissionSchema` gains `enablement: EnablementSubmission[]` (default `[]`) and `expansion: ExpansionSubmission[]` (default `[]`) — submissions omit hidden/order.
  - `Initiatives {enablement: Enablement[], expansion: Expansion[]}`.
- `common/diagnostic-math.ts`: `aiMaturity(aiScore: number): {level, name, nextLevel: {level, name, pointsNeeded} | null}`; `weakestDimension(processScore, dataScore): "processos" | "dados"` (ties → "dados").
- `common/diagnostic-rules.ts`: `squadByWave(opps: Opportunity[]): {wave, roles: string[]}[]` — distinct roles (case-insensitive, trimmed, first spelling kept) per wave among visible opps; `validateSquadSize(opps): {ok:true}|{ok:false,error}` — error (pt-BR) when any opp has > 5 roles or any wave's distinct roles > 5.
- `electron/diagnostic/store.ts`: `loadInitiatives(engagementId): Initiatives` (missing file → empty), `saveInitiatives(engagementId, i)` → `initiatives.json`, atomic.
- `electron/diagnostic/tools.ts`: `submit_opportunities` also validates enablement/expansion via Zod and rejects (error text to the agent) when `validateSquadSize` fails. `get_diagnostic_context` additionally returns the three scores and the observed apps per process (still no money).
- `electron/diagnostic/agent.ts`: `generateOpportunities` saves opportunities AND initiatives (hidden:false, order=index) only after a validated submission (same cancel rule).
- `electron/diagnostic/instructions.ts` (pt-BR): squads ≤ 5 people per opportunity and per wave; propose 2–5 enablement items tied to the weakest gaps (e.g. low data score → workshop de governança de dados; low AI readiness → letramento em IA para liderança); propose 0–5 expansion fronts grounded in apps/handoffs seen in the recordings but not mapped; never money.
- IPC: `getDiagnostic` result gains `initiatives`; new channel `diagnostic:save-initiatives` → `saveDiagnosticInitiatives(engagementId, initiatives: unknown)` (Zod-parsed); preload + `common/ipc.ts` updated (gate checks parity).
- Report model gains `maturity` (from `aiMaturity(scores.ai)` plus `weakestDimension`), `enablement` and `expansion` (visible, sorted by order), `squadByWave` (with `count` and `MAX_SQUAD_SIZE`). Enablement/expansion never affect money totals.
- Report sections (pt-BR): cover adds the maturity level (e.g. "Nível 2 de 5 — Exploratório") and "o que falta para o próximo nível" (points needed + weakest dimension); new section "Capacitação: treinamentos e workshops de IA" after Oportunidades; new section "Novas frentes no cliente" after the roadmap; roadmap lists enablement items in Onda 1 (capacitação precede a IA); squad section shows per wave "n de 5 pessoas".
- Avanade visual identity in `common/diagnostic-report-style.ts` (+ SVG colors): tokens on `:root` — orange `#FF5800`, dark orange `#DC4600`, greys `#333333/#4c4c4c/#666666/#7f7f7f/#999999/#b3b3b3/#cccccc/#e5e5e5`, aurora `#890078`, master gradient `linear-gradient(135deg, #FF5800 0%, #890078 100%)`; font stack `'Segoe UI', 'Segoe UI Variable', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`; H1/H2 weight 300, H3/H5 600; body text `#333333`; small orange text uses `#DC4600` (contrast); cover with the master gradient and white text; section headers preceded by a 4px orange accent bar; cards with 4px orange top border, radius 2px; tags uppercase with 0.1em tracking; data-structure colors: structured `#00A650`, semi `#FFB414`, unstructured `#C80000`; footer on every page `avanade.com` (Segoe UI 600, 9pt, right); tagline "Do what matters" (bold) only on the cover, never next to a logo. No logo is drawn (official SVG not available). Still no external fonts/URLs/scripts.
- UI: OpportunityList (or a new InitiativesPanel) lists enablement and expansion items with hide/show and up/down, persisted via `saveDiagnosticInitiatives`; detail header shows the maturity level from the report model.

- [ ] **Step 1: Write failing tests**: `aiMaturity(0)` → level 1 "Inicial", next {level 2, pointsNeeded 20}; `aiMaturity(40)` → level 3; `aiMaturity(80)` → level 5, next null; `aiMaturity(79)` → level 4, pointsNeeded 1; `OpportunitySchema` rejects 6 roles; `validateSquadSize` rejects a wave whose opps together need 6 distinct roles and accepts "Analista de dados"/"analista de dados " as one; `submit_opportunities` with 6 roles in one wave returns error text and does not call onSubmit; report HTML contains "Nível", "Capacitação", "Novas frentes no cliente", "Do what matters", "avanade.com", `#FF5800`, and no `http://`/`https://`/`<script`; enablement/expansion titles escaped; totals unchanged when enablement exists; hidden enablement absent; `loadInitiatives` on missing file → empty.
- [ ] **Step 2: Run** each test file → FAIL.
- [ ] **Step 3: Implement** the above.
- [ ] **Step 4: Run** tests → PASS; `npm test`, `npm run typecheck`, `npm run build`; re-render the report sample (html/pdf/png) and UI screenshots; inspect them.
- [ ] **Step 5: Commit** `feat(diagnostic): Avanade report design, squad cap, AI maturity, enablement and expansion`
