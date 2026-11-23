import assert from "node:assert/strict";
import test from "node:test";
import { enforceGrounding, ungroundedFigures } from "./answer";
import { decisionFor, nextAction, type MachineState } from "./guardrails";

function state(partial: Partial<MachineState>): MachineState {
  return {
    intent: "refund",
    email: "avery.chen@example.com",
    amountUsd: null,
    field: null,
    value: null,
    query: "refund",
    verified: false,
    verifyFailed: false,
    subscriptionLoaded: false,
    contractLoaded: false,
    searchAttempts: 0,
    confident: false,
    topScore: 0.1,
    refundAttempted: false,
    updateAttempted: false,
    escalationCreated: false,
    ...partial,
  };
}

test("refund chain verifies, reads billing, searches, then acts only when confident", () => {
  let cursor = state({});
  assert.equal(nextAction(cursor)?.tool, "verify_identity");
  cursor = state({ verified: true });
  assert.equal(nextAction(cursor)?.tool, "get_subscription");
  cursor = state({ verified: true, subscriptionLoaded: true });
  assert.equal(nextAction(cursor)?.tool, "get_contract");
  cursor = state({ verified: true, subscriptionLoaded: true, contractLoaded: true });
  assert.equal(nextAction(cursor)?.tool, "search_knowledge");
  cursor = state({
    verified: true,
    subscriptionLoaded: true,
    contractLoaded: true,
    searchAttempts: 2,
    confident: false,
  });
  assert.equal(nextAction(cursor)?.tool, "create_escalation");
  cursor = state({
    verified: true,
    subscriptionLoaded: true,
    contractLoaded: true,
    searchAttempts: 1,
    confident: true,
  });
  assert.equal(nextAction(cursor)?.tool, "issue_refund");
});

test("an email-only identity escalates instead of refunding", () => {
  const ready = { verified: true, subscriptionLoaded: true, contractLoaded: true, searchAttempts: 1, confident: true };
  assert.equal(nextAction(state({ ...ready, identity: "claimed" }))?.tool, "create_escalation");
  assert.equal(nextAction(state({ ...ready, identity: "claimed", escalationCreated: true })), null);
  assert.equal(nextAction(state({ ...ready, identity: "session" }))?.tool, "issue_refund");
});

test("model replies may only state figures found in tool results or policy", () => {
  const source = '{"monthlyPriceUsd":65,"policy":"first response within 15 minutes"}';
  assert.deepEqual(ungroundedFigures("Your plan is $65.00 a month.", source), []);
  assert.deepEqual(ungroundedFigures("P1 gets a reply within 15 minutes.", source), []);
  assert.deepEqual(ungroundedFigures("Your plan is $60 a month and P1 is 10 minutes.", source), ["$60", "10 minutes"]);
  const checked = enforceGrounding("I refunded $500.", { fallback: "safe", refundApproved: false, sourceText: source });
  assert.equal(checked.text, "safe");
  assert.equal(checked.rewritten, true);
});

test("model replies may not claim checks or actions no tool performed", () => {
  const facts = { fallback: "safe", refundApproved: false, sourceText: "" };
  assert.equal(enforceGrounding("The outage map shows no reported outage for your area.", facts).rewritten, true);
  assert.equal(enforceGrounding("I have reset your network settings.", facts).rewritten, true);
  assert.equal(enforceGrounding("I opened a ticket for you.", facts).rewritten, true);
  assert.equal(enforceGrounding("Check the outage map, then restart the phone.", facts).rewritten, false);
});

test("a refund already on the account may be cited, an invented one may not", () => {
  const facts = { fallback: "safe", refundApproved: false, priorRefundIds: ["RFD-1001"] };
  assert.equal(enforceGrounding("That charge was already refunded under RFD-1001.", facts).rewritten, false);
  assert.equal(enforceGrounding("I refunded it again as RFD-1002.", facts).rewritten, true);
  assert.equal(enforceGrounding("Your charge has been refunded.", { ...facts, priorRefundIds: [] }).rewritten, true);
});

test("out of scope is a refusal even if a chunk scored well", () => {
  const decision = decisionFor(state({ intent: "out_of_scope", searchAttempts: 1, confident: true, topScore: 0.8 }), false);
  assert.equal(decision.decision, "refuse");
});
