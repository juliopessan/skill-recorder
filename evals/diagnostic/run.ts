// Eval harness for the AI Readiness Diagnostic's two LLM turns (process map, opportunities).
// Scoring is layered: deterministic checks always run (checks.ts, no LLM); the LLM-as-judge
// rubric runs only with --judge.
//
// Run:
//   node --experimental-transform-types --import ./evals/register.mjs evals/diagnostic/run.ts [flags]
// Flags:
//   --only=slug,slug   run a subset of scenarios
//   --judge            also run the LLM-as-judge rubric
//   --keep             print the temp dirs (artifacts kept for inspection)
//   --model=<id>       override the agent/judge model
//
// Needs a signed-in GitHub Copilot CLI; fails fast with a clear message otherwise.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isCopilotSignedOutError } from "../../common/ipc";
import { DiagnosticAgent } from "../../electron/diagnostic/agent";
import { loadInitiatives, saveEngagement } from "../../electron/diagnostic/store";
import { allPass, checkMap, checkOpportunities, recordingTerms, type CheckResult, type RecordedSession } from "./checks";
import { judgeDiagnostic, type DiagnosticJudgeResult } from "./judge";
import { diagnosticScenarios } from "./scenarios/index";

interface Flags {
  only: Set<string> | null;
  judge: boolean;
  keep: boolean;
  model?: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { only: null, judge: false, keep: false };
  for (const arg of argv) {
    if (arg.startsWith("--only=")) flags.only = new Set(arg.slice(7).split(",").map((s) => s.trim()).filter(Boolean));
    else if (arg === "--judge") flags.judge = true;
    else if (arg === "--keep") flags.keep = true;
    else if (arg.startsWith("--model=")) flags.model = arg.slice(8);
  }
  return flags;
}

interface ScenarioResult {
  id: string;
  title: string;
  ok: boolean;
  error?: string;
  durationMs: number;
  checks: CheckResult[];
  judge?: DiagnosticJudgeResult;
  /** Set when the judge call itself failed, so a missing score is not mistaken for a skipped judge. */
  judgeError?: string;
}

const bar = "─".repeat(64);

/** Creates the temp work dir, runs, and removes the dir afterwards (unless --keep) on every exit path. */
async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.model) process.env.SKILL_RECORDER_MODEL = flags.model;

  const base = mkdtempSync(path.join(os.tmpdir(), "sr-diag-evals-"));
  try {
    return await runScenarios(flags, base);
  } finally {
    if (!flags.keep) rmSync(base, { recursive: true, force: true });
  }
}

async function runScenarios(flags: Flags, base: string): Promise<number> {
  const sessionsRoot = path.join(base, "sessions");
  process.env.SKILL_RECORDER_SESSIONS_DIR = sessionsRoot;
  process.env.SKILL_RECORDER_ENGAGEMENTS_DIR = path.join(base, "engagements");

  const selected = diagnosticScenarios.filter((s) => !flags.only || flags.only.has(s.id));
  if (selected.length === 0) {
    console.error("No scenarios matched", flags.only ? [...flags.only] : "");
    return 2;
  }

  console.error(`\nSkill Recorder — diagnostic evals`);
  console.error(`${selected.length} scenario(s) · work dir: ${base}`);
  if (flags.judge) console.error("LLM judge: ON");
  console.error(bar);

  const agent = new DiagnosticAgent();
  const results: ScenarioResult[] = [];
  let signedOut = false;

  for (const scenario of selected) {
    console.error(`\n▶ ${scenario.id} — ${scenario.title}`);
    const started = Date.now();
    const res: ScenarioResult = { id: scenario.id, title: scenario.title, ok: false, durationMs: 0, checks: [] };
    try {
      for (const a of scenario.analyses) {
        const dir = path.join(sessionsRoot, a.sessionId);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "analysis.json"), JSON.stringify(a, null, 2));
      }
      saveEngagement(scenario.engagement);
      const sessions: RecordedSession[] = scenario.analyses.map((a) => ({ sessionId: a.sessionId, analysis: a }));
      const progress = (m: string) => process.stderr.write(`   · ${m}\n`);

      const map = await agent.generateMap(scenario.engagement.id, scenario.processId, undefined, progress);
      res.checks.push(...checkMap(map, sessions, scenario.mapExpect));

      const opps = await agent.generateOpportunities(scenario.engagement.id, undefined, progress);
      const { enablement, expansion } = loadInitiatives(scenario.engagement.id);
      res.checks.push(
        ...checkOpportunities(
          {
            opportunities: opps,
            enablement,
            expansion,
          },
          { ...scenario.oppExpect, recordingTerms: recordingTerms(sessions, scenario.handoffTerms) },
        ),
      );
      res.ok = allPass(res.checks);

      if (flags.judge) {
        try {
          res.judge = await judgeDiagnostic(scenario, map, opps, enablement, expansion, flags.model);
        } catch (err) {
          res.judgeError = err instanceof Error ? err.message : String(err);
          console.error(`   judge failed: ${res.judgeError}`);
        }
      }
    } catch (err) {
      res.error = err instanceof Error ? err.message : String(err);
      if (isCopilotSignedOutError(res.error)) signedOut = true;
    }
    res.durationMs = Date.now() - started;
    results.push(res);
    printScenario(res);
    if (signedOut) break; // every remaining scenario would fail the same way
  }

  await agent.dispose();

  if (signedOut) {
    console.error(`\n${bar}\nCopilot não autenticado: entre no GitHub Copilot (CLI) neste computador e rode "npm run eval:diagnostic" novamente.`);
    console.error("Nenhum resultado foi gravado.\n");
    return 2;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(process.cwd(), "evals", "results", `diagnostic-${stamp}.json`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ at: stamp, base, results }, null, 2));

  console.error(`\n${bar}\nSummary`);
  for (const r of results) {
    const passed = r.checks.filter((c) => c.pass).length;
    const status = r.error ? "ERROR" : r.ok ? "PASS " : "FAIL ";
    const j = r.judge ? `  judge ${r.judge.mean.toFixed(1)}/5` : r.judgeError ? "  judge FAILED" : "";
    console.error(`  ${status}  ${passed}/${r.checks.length} checks${j}  ${r.id}${r.error ? `  (${r.error})` : ""}`);
  }
  const ok = results.filter((r) => r.ok).length;
  console.error(`\n  ${ok}/${results.length} scenarios passed`);
  if (flags.keep) console.error(`  artifacts: ${base}`);
  console.error(`  results:   ${path.relative(process.cwd(), outFile)}\n`);
  return ok === results.length ? 0 : 1;
}

function printScenario(r: ScenarioResult): void {
  if (r.error) {
    console.error(`   ✗ error: ${r.error}`);
    return;
  }
  console.error(`   checks: ${r.checks.filter((c) => c.pass).length}/${r.checks.length} · ${r.ok ? "PASS" : "FAIL"} · ${(r.durationMs / 1000).toFixed(1)}s`);
  for (const c of r.checks) if (!c.pass) console.error(`     ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  if (r.judge) {
    console.error(`   judge: ${r.judge.mean.toFixed(1)}/5 ${JSON.stringify(r.judge.scores)}${r.judge.notes ? ` — ${r.judge.notes}` : ""}`);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Harness crashed:", err);
    process.exit(3);
  },
);
