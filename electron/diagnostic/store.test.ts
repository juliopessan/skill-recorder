import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { Engagement, Opportunity, ProcessMap } from "../../common/diagnostic";
import {
  deleteEngagement,
  engagementsRoot,
  linkedAnalyses,
  listEngagements,
  loadEngagement,
  loadInitiatives,
  loadOpportunities,
  loadProcessMap,
  refreshStale,
  saveEngagement,
  saveInitiatives,
  saveOpportunities,
  saveProcessMap,
} from "./store";

const engagement = (over: Partial<Engagement> = {}): Engagement => ({
  version: 1,
  id: "eng1",
  clientName: "ACME",
  createdAt: 1,
  currency: "BRL",
  roles: [{ id: "r1", name: "Analista", hourlyCost: 50 }],
  dataQuestionnaire: {},
  processes: [{ id: "p1", name: "P1", sessionIds: ["s1"], stale: false }],
  thesisText: "",
  ...over,
});

const analysisJson = (sessionId: string) => ({
  version: 1,
  sessionId,
  revision: 1,
  createdAt: 1,
  narrationSourceUpdatedAt: null,
  title: "t",
  intent: "i",
  intentConfidence: "high",
  intentRationale: "",
  steps: [],
  feedbackLog: [],
  approved: false,
});

async function withRoots(fn: (roots: { eng: string; sess: string }) => void | Promise<void>) {
  const base = await mkdtemp(path.join(tmpdir(), "diag-store-"));
  const eng = path.join(base, "engagements");
  const sess = path.join(base, "sessions");
  mkdirSync(sess, { recursive: true });
  const prevE = process.env.SKILL_RECORDER_ENGAGEMENTS_DIR;
  const prevS = process.env.SKILL_RECORDER_SESSIONS_DIR;
  process.env.SKILL_RECORDER_ENGAGEMENTS_DIR = eng;
  process.env.SKILL_RECORDER_SESSIONS_DIR = sess;
  try {
    await fn({ eng, sess });
  } finally {
    if (prevE === undefined) delete process.env.SKILL_RECORDER_ENGAGEMENTS_DIR;
    else process.env.SKILL_RECORDER_ENGAGEMENTS_DIR = prevE;
    if (prevS === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR;
    else process.env.SKILL_RECORDER_SESSIONS_DIR = prevS;
    await rm(base, { recursive: true, force: true });
  }
}

function writeSession(sess: string, id: string, withAnalysis = true) {
  mkdirSync(path.join(sess, id), { recursive: true });
  if (withAnalysis) writeFileSync(path.join(sess, id, "analysis.json"), JSON.stringify(analysisJson(id)));
}

test("engagement round-trip, list, delete, no .tmp left", async () => {
  await withRoots(({ eng }) => {
    assert.equal(engagementsRoot(), path.resolve(eng));
    assert.deepEqual(listEngagements(), []);
    assert.equal(loadEngagement("eng1"), null);
    const e = engagement();
    saveEngagement(e);
    assert.deepEqual(loadEngagement("eng1"), e);
    assert.equal(listEngagements().length, 1);
    assert.deepEqual(readdirSync(path.join(eng, "eng1")), ["engagement.json"]);
    deleteEngagement("eng1");
    assert.equal(existsSync(path.join(eng, "eng1")), false);
    assert.equal(loadEngagement("eng1"), null);
  });
});

test("process map and opportunities round-trip", async () => {
  await withRoots(({ eng }) => {
    saveEngagement(engagement());
    assert.equal(loadProcessMap("eng1", "p1"), null);
    assert.deepEqual(loadOpportunities("eng1"), []);
    const map: ProcessMap = {
      version: 1,
      processId: "p1",
      revision: 1,
      createdAt: 1,
      steps: [],
      variants: [],
      confidence: "high",
    };
    saveProcessMap("eng1", map);
    assert.deepEqual(loadProcessMap("eng1", "p1"), map);
    const opp: Opportunity = {
      id: "o1",
      title: "T",
      processId: "p1",
      stepIds: [],
      wave: 1,
      prerequisites: [],
      estimatedSavingsPct: { value: 0.5, source: "ai-suggested" },
      effort: "S",
      risk: "low",
      rationale: "r",
      suggestedSquad: { roles: [], weeks: 1 },
      hidden: false,
      order: 0,
    };
    saveOpportunities("eng1", [opp]);
    assert.deepEqual(loadOpportunities("eng1"), [opp]);
    assert.deepEqual(readdirSync(path.join(eng, "eng1", "maps")), ["p1.json"]);
    assert.equal(readdirSync(path.join(eng, "eng1")).some((f) => f.endsWith(".tmp")), false);
  });
});

test("invalid ids throw", async () => {
  await withRoots(() => {
    assert.throws(() => loadEngagement("../x"));
    assert.throws(() => saveEngagement(engagement({ id: "../x" })));
    assert.throws(() => deleteEngagement("../x"));
    saveEngagement(engagement());
    assert.throws(() => loadProcessMap("eng1", "../p"));
    assert.throws(() => loadProcessMap("../e", "p1"));
  });
});

test("corrupt or schema-invalid engagement throws pt-BR message", async () => {
  await withRoots(({ eng }) => {
    mkdirSync(path.join(eng, "bad"), { recursive: true });
    writeFileSync(path.join(eng, "bad", "engagement.json"), "{not json");
    assert.throws(() => loadEngagement("bad"), { message: "Diagnóstico corrompido: bad" });
    writeFileSync(path.join(eng, "bad", "engagement.json"), JSON.stringify({ version: 1 }));
    assert.throws(() => loadEngagement("bad"), { message: "Diagnóstico corrompido: bad" });
  });
});

test("deleting a linked session makes refreshStale mark stale and linkedAnalyses throw", async () => {
  await withRoots(({ sess }) => {
    writeSession(sess, "s1");
    const e = engagement();
    assert.equal(refreshStale(e).processes[0].stale, false);
    const ok = linkedAnalyses(e, "p1");
    assert.equal(ok.length, 1);
    assert.equal(ok[0].sessionId, "s1");

    rmSync(path.join(sess, "s1"), { recursive: true, force: true });
    const fresh = refreshStale(e);
    assert.equal(fresh.processes[0].stale, true);
    assert.equal(e.processes[0].stale, false, "input not mutated");
    assert.throws(() => linkedAnalyses(fresh, "p1"), /desatualizado|removid|ausente/i);
  });
});

test("missing analysis.json marks stale", async () => {
  await withRoots(({ sess }) => {
    writeSession(sess, "s1", false);
    assert.equal(refreshStale(engagement()).processes[0].stale, true);
  });
});

test("initiatives: missing file is empty; round-trip is atomic", async () => {
  await withRoots(({ eng }) => {
    saveEngagement(engagement());
    assert.deepEqual(loadInitiatives("eng1"), { enablement: [], expansion: [] });
    const i = {
      enablement: [{ id: "c1", title: "Workshop", format: "workshop" as const, audience: "TI", gap: "dados" as const, rationale: "r", durationDays: 1, hidden: false, order: 0 }],
      expansion: [{ id: "x1", area: "Compras", rationale: "r", evidence: ["e"], relatedApps: ["SAP"], hidden: true, order: 0 }],
    };
    saveInitiatives("eng1", i);
    assert.deepEqual(loadInitiatives("eng1"), i);
    assert.ok(readdirSync(path.join(eng, "eng1")).includes("initiatives.json"));
    assert.equal(readdirSync(path.join(eng, "eng1")).some((f) => f.endsWith(".tmp")), false);
  });
});
