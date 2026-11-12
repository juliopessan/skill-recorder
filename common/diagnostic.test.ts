import assert from "node:assert/strict";
import test from "node:test";

import {
  EngagementSchema,
  OpportunitySchema,
  QuestionnaireAnswerSchema,
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
