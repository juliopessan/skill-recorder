import assert from "node:assert/strict";
import test from "node:test";

import {
  EngagementSchema,
  EnablementSchema,
  ExpansionSchema,
  OpportunitiesSubmissionSchema,
  OpportunitySchema,
  QuestionnaireAnswerSchema,
  RoleSchema,
  SquadRateSchema,
  SourcedNumberSchema,
} from "./diagnostic";

test("EngagementSchema defaults currency to BRL", () => {
  const e = EngagementSchema.parse({
    version: 1,
    id: "e1",
    clientName: "ACME",
    createdAt: 1,
    roles: [],
    dataQuestionnaire: {},
    processes: [],
    thesisText: "",
  });
  assert.equal(e.currency, "BRL");
});

test("QuestionnaireAnswerSchema rejects answer 5", () => {
  assert.throws(() => QuestionnaireAnswerSchema.parse({ answer: 5, source: "confirmed", evidence: [] }));
});

const baseOpp = {
  id: "o1",
  title: "T",
  processId: "p1",
  stepIds: ["s1"],
  wave: 1,
  prerequisites: [],
  estimatedSavingsPct: { value: 0.2, source: "ai-suggested" },
  effort: "S",
  risk: "low",
  rationale: "r",
  suggestedSquad: { roles: ["dev"], weeks: 2 },
  hidden: false,
  order: 0,
};

test("OpportunitySchema accepts a valid opportunity", () => {
  assert.equal(OpportunitySchema.parse(baseOpp).wave, 1);
});

test("OpportunitySchema rejects wave 4", () => {
  assert.throws(() => OpportunitySchema.parse({ ...baseOpp, wave: 4 }));
});

test("OpportunitySchema rejects savings pct outside [0,1]", () => {
  assert.throws(() =>
    OpportunitySchema.parse({ ...baseOpp, estimatedSavingsPct: { value: 1.2, source: "measured" } }),
  );
  assert.throws(() =>
    OpportunitySchema.parse({ ...baseOpp, estimatedSavingsPct: { value: -0.1, source: "measured" } }),
  );
});

test("OpportunitySchema rejects a squad of 6 roles", () => {
  const roles = ["a", "b", "c", "d", "e"];
  assert.equal(OpportunitySchema.parse({ ...baseOpp, suggestedSquad: { roles, weeks: 1 } }).suggestedSquad.roles.length, 5);
  assert.throws(() => OpportunitySchema.parse({ ...baseOpp, suggestedSquad: { roles: [...roles, "f"], weeks: 1 } }));
});

const baseEnablement = {
  id: "c1", title: "Letramento em IA", format: "letramento", audience: "Liderança",
  gap: "ia", rationale: "r", durationDays: 2, order: 0,
};

test("EnablementSchema defaults hidden and bounds durationDays", () => {
  assert.equal(EnablementSchema.parse(baseEnablement).hidden, false);
  assert.throws(() => EnablementSchema.parse({ ...baseEnablement, durationDays: 0 }));
  assert.throws(() => EnablementSchema.parse({ ...baseEnablement, durationDays: 21 }));
  assert.throws(() => EnablementSchema.parse({ ...baseEnablement, format: "palestra" }));
});

test("ExpansionSchema requires evidence", () => {
  const x = { id: "x1", area: "Compras", rationale: "r", evidence: ["SAP aparece em 3 gravações"], relatedApps: ["SAP"], order: 0 };
  assert.equal(ExpansionSchema.parse(x).hidden, false);
  assert.throws(() => ExpansionSchema.parse({ ...x, evidence: [] }));
});

test("OpportunitiesSubmissionSchema defaults enablement and expansion to []", () => {
  const s = OpportunitiesSubmissionSchema.parse({ opportunities: [] });
  assert.deepEqual(s.enablement, []);
  assert.deepEqual(s.expansion, []);
});

test("SourcedNumber and Role reject negative and non-finite numbers", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(SourcedNumberSchema.safeParse({ value, source: "confirmed" }).success, false, String(value));
    assert.equal(RoleSchema.safeParse({ id: "r", name: "R", hourlyCost: value }).success, false, String(value));
  }
  assert.equal(SourcedNumberSchema.safeParse({ value: 0, source: "confirmed" }).success, true);
  assert.equal(RoleSchema.safeParse({ id: "r", name: "R", hourlyCost: 12.5 }).success, true);
});

const legacyEngagement = {
  version: 1,
  id: "e1",
  clientName: "ACME",
  createdAt: 1,
  roles: [],
  dataQuestionnaire: {},
  processes: [],
  thesisText: "",
};

test("an engagement saved before squad rates existed still parses, with no rates", () => {
  const e = EngagementSchema.parse(legacyEngagement);
  assert.deepEqual(e.squadRates, []);
  assert.equal(e.enablementDayRate, undefined);
});

test("squad rates and the enablement day rate are validated", () => {
  const ok = EngagementSchema.parse({ ...legacyEngagement, squadRates: [{ role: "Dev", weeklyRate: 4000 }], enablementDayRate: 1500 });
  assert.equal(ok.squadRates[0]!.weeklyRate, 4000);
  assert.equal(ok.enablementDayRate, 1500);
  assert.equal(SquadRateSchema.safeParse({ role: "Dev", weeklyRate: 0 }).success, true);
  for (const bad of [{ role: "", weeklyRate: 1 }, { role: "  ", weeklyRate: 1 }, { role: "Dev", weeklyRate: -1 }, { role: "Dev", weeklyRate: Infinity }]) {
    assert.equal(SquadRateSchema.safeParse(bad).success, false);
  }
  assert.equal(EngagementSchema.safeParse({ ...legacyEngagement, enablementDayRate: -5 }).success, false);
});
