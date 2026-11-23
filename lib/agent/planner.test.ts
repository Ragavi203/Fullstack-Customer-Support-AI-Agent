import assert from "node:assert/strict";
import test from "node:test";
import { classifyIntent } from "./planner";

const AVERY = "avery.chen@example.com";

test("classifies the demo prompts", () => {
  assert.equal(classifyIntent("I never used my Travel Pass. Can I get a refund for my last charge?", AVERY).intent, "refund");
  assert.equal(classifyIntent("What's your refund policy?", AVERY).intent, "policy_question");
  assert.equal(classifyIntent("My phone shows SOS only since this morning", AVERY).intent, "troubleshoot");
  assert.equal(classifyIntent("What's the Business SLA during an outage?", "jordan.blake@example.com").intent, "policy_question");
  assert.equal(classifyIntent("Does my plan work in Mexico? I'm travelling abroad", AVERY).intent, "policy_question");
  assert.equal(classifyIntent("I want to port my number to another carrier", AVERY).intent, "escalate_request");
  const update = classifyIntent("Change my billing email to finance@acme.com", AVERY);
  assert.equal(update.intent, "account_update");
  assert.equal(update.field, "billingEmail");
  assert.equal(update.value, "finance@acme.com");
  assert.equal(classifyIntent("What's the best pizza in Brooklyn?", null).intent, "out_of_scope");
  assert.equal(classifyIntent("Hi there", AVERY).intent, "greeting");
});

test("routes price questions about the caller's plan to account status", () => {
  assert.equal(classifyIntent("whats the plan cost", AVERY).intent, "account_status");
  assert.equal(classifyIntent("How much do I pay each month?", AVERY).intent, "account_status");
  assert.equal(classifyIntent("What's the price of my lines?", AVERY).intent, "account_status");
  assert.equal(classifyIntent("How much does a Travel Pass cost?", AVERY).intent, "policy_question");
  assert.equal(classifyIntent("What does the Plus plan cost?", null).intent, "policy_question");
});
