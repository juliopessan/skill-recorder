import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { Tool } from "@github/copilot-sdk";

import type { Engagement } from "../../common/diagnostic";
import { DiagnosticAgent, shouldPersist } from "./agent";
import { loadInitiatives, loadOpportunities, loadProcessMap, saveEngagement, saveProcessMap } from "./store";

test("shouldPersist requires a submission and no cancel", () => {
  assert.equal(shouldPersist({ submitted: true, cancelled: false }), true);
  assert.equal(shouldPersist({ submitted: true, cancelled: true }), false);
  assert.equal(shouldPersist({ submitted: false, cancelled: false }), false);
});

class FakeAgent extends DiagnosticAgent {
  constructor(private readonly cancelAfterSubmit: boolean) { super(); }
  protected override async runTurn(
    _i: string, tools: Tool[], _p: string, _n: string, _s: () => boolean,
  ): Promise<void> {
    const submit = tools.find((t) => t.name === "submit_process_map")!;
    const args = {
      steps: [{
        id: "m1", title: "P", dataStructure: "structured", manualTransfer: false, rework: false,
        sourceStepRefs: [{ sessionId: "s1", stepId: "a" }],
      }],
      variants: [], confidence: "high",
    };
    await submit.handler!(args, { sessionId: "t", toolCallId: "t", toolName: "submit_process_map", arguments: args });
    if (this.cancelAfterSubmit) this.cancel();
  }
}

async function withDirs(fn: () => Promise<void>) {
  const base = await mkdtemp(path.join(tmpdir(), "diag-agent-"));
  const prev = { e: process.env.SKILL_RECORDER_ENGAGEMENTS_DIR, s: process.env.SKILL_RECORDER_SESSIONS_DIR };
  process.env.SKILL_RECORDER_ENGAGEMENTS_DIR = path.join(base, "eng");
  process.env.SKILL_RECORDER_SESSIONS_DIR = path.join(base, "sess");
  mkdirSync(path.join(base, "sess", "s1"), { recursive: true });
  writeFileSync(path.join(base, "sess", "s1", "analysis.json"), JSON.stringify({
    version: 1, sessionId: "s1", revision: 1, createdAt: 1, narrationSourceUpdatedAt: null, title: "t",
    intent: "i", intentConfidence: "high", intentRationale: "", feedbackLog: [], approved: false,
    steps: [{ id: "a", title: "a", detail: "d", apps: [], evidence: [], confidence: "medium" }],
  }));
  const e: Engagement = {
    version: 1, id: "eng1", clientName: "A", createdAt: 1, currency: "BRL", roles: [],
    dataQuestionnaire: {}, processes: [{ id: "p1", name: "P1", sessionIds: ["s1"], stale: false }], thesisText: "",
  };
  saveEngagement(e);
  try {
    await fn();
  } finally {
    for (const [k, v] of [["SKILL_RECORDER_ENGAGEMENTS_DIR", prev.e], ["SKILL_RECORDER_SESSIONS_DIR", prev.s]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await rm(base, { recursive: true, force: true });
  }
}

test("generateMap saves after a validated submission", async () => {
  await withDirs(async () => {
    const map = await new FakeAgent(false).generateMap("eng1", "p1");
    assert.equal(map.revision, 1);
    assert.equal(loadProcessMap("eng1", "p1")?.steps.length, 1);
  });
});

test("cancel between turn completion and save leaves the stored map untouched", async () => {
  await withDirs(async () => {
    await assert.rejects(new FakeAgent(true).generateMap("eng1", "p1"), /cancelada/);
    assert.equal(loadProcessMap("eng1", "p1"), null);
  });
});

class FakeOppAgent extends DiagnosticAgent {
  constructor(private readonly args: unknown, private readonly cancelAfterSubmit = false) { super(); }
  protected override async runTurn(_i: string, tools: Tool[]): Promise<void> {
    const submit = tools.find((t) => t.name === "submit_opportunities")!;
    await submit.handler!(this.args, { sessionId: "t", toolCallId: "t", toolName: "submit_opportunities", arguments: this.args });
    if (this.cancelAfterSubmit) this.cancel();
  }
}

const oppArgs = (roles: string[]) => ({
  opportunities: [{
    id: "o1", title: "T", processId: "p1", stepIds: ["m1"], wave: 1, prerequisites: [],
    estimatedSavingsPct: { value: 0.2, source: "ai-suggested" }, effort: "S", risk: "low", rationale: "r",
    suggestedSquad: { roles, weeks: 1 },
  }],
  enablement: [
    { id: "c1", title: "Letramento", format: "letramento", audience: "Liderança", gap: "ia", rationale: "r", durationDays: 1 },
    { id: "c2", title: "Workshop", format: "workshop", audience: "TI", gap: "dados", rationale: "r", durationDays: 2 },
  ],
  expansion: [{ id: "x1", area: "Compras", rationale: "r", evidence: ["e"], relatedApps: [] }],
});

const saveMap = () => saveProcessMap("eng1", {
  version: 1, processId: "p1", revision: 1, createdAt: 1, confidence: "high", variants: [],
  steps: [{ id: "m1", title: "P", medianDurationMs: 1, apps: [], dataArtifacts: [], dataStructure: "structured", manualTransfer: false, rework: false, sourceStepRefs: [] }],
});

test("generateOpportunities saves opportunities and initiatives with hidden:false and order=index", async () => {
  await withDirs(async () => {
    saveMap();
    await new FakeOppAgent(oppArgs(["Dev"])).generateOpportunities("eng1");
    assert.equal(loadOpportunities("eng1").length, 1);
    const i = loadInitiatives("eng1");
    assert.deepEqual(i.enablement.map((x) => [x.id, x.hidden, x.order]), [["c1", false, 0], ["c2", false, 1]]);
    assert.deepEqual(i.expansion.map((x) => [x.id, x.hidden, x.order]), [["x1", false, 0]]);
  });
});

test("generateOpportunities saves nothing when the squad is too large or the run is cancelled", async () => {
  await withDirs(async () => {
    saveMap();
    await assert.rejects(new FakeOppAgent(oppArgs(["a", "b", "c", "d", "e", "f"])).generateOpportunities("eng1"));
    await assert.rejects(new FakeOppAgent(oppArgs(["Dev"]), true).generateOpportunities("eng1"), /cancelada/);
    assert.deepEqual(loadOpportunities("eng1"), []);
    assert.deepEqual(loadInitiatives("eng1"), { enablement: [], expansion: [] });
  });
});
