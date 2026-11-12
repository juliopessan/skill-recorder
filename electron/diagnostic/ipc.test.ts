import assert from "node:assert/strict";
import test from "node:test";

import type { Engagement } from "../../common/diagnostic";
import { deleteBlockedError, exportFileName, recomputeStale, safely } from "./ipc-helpers";

const base = (stale: boolean[]): Engagement =>
  ({
    processes: stale.map((s, i) => ({ id: `p${i}`, name: `P${i}`, sessionIds: [], stale: s })),
  }) as unknown as Engagement;

test("recomputeStale clears stale flags that refresh no longer re-flags", () => {
  const { engagement, changed } = recomputeStale(base([true, false]), (e) => e);
  assert.deepEqual(engagement.processes.map((p) => p.stale), [false, false]);
  assert.equal(changed, true);
});

test("recomputeStale re-flags what refresh flags and reports no change when identical", () => {
  const flagFirst = (e: Engagement): Engagement => ({
    ...e,
    processes: e.processes.map((p, i) => (i === 0 ? { ...p, stale: true } : p)),
  });
  const { engagement, changed } = recomputeStale(base([true, false]), flagFirst);
  assert.deepEqual(engagement.processes.map((p) => p.stale), [true, false]);
  assert.equal(changed, false);
});

test("exportFileName slugs the client name", () => {
  assert.equal(exportFileName("Açaí & Filhos Ltda.", "pdf"), "diagnostico-acai-filhos-ltda.pdf");
  assert.equal(exportFileName("  ", "html"), "diagnostico-cliente.html");
  assert.equal(exportFileName("../../etc", "html"), "diagnostico-etc.html");
});

test("safely converts throws and rejections into { error }", async () => {
  assert.deepEqual(await safely(() => { throw new Error("falhou"); }), { error: "falhou" });
  assert.deepEqual(await safely(async () => { throw new Error("async"); }), { error: "async" });
  assert.equal(await safely(() => 7), 7);
});

test("deleteBlockedError blocks only while a generation runs", () => {
  assert.equal(deleteBlockedError(false), null);
  assert.match(deleteBlockedError(true)!.error, /Cancele a geração primeiro/);
});
