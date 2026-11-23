import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { runTurn } from "./orchestrator";
import { resetDemoData, findCustomerByEmail } from "../data/customers";
import { createSession } from "../session/store";
import type { SimulateFault } from "../types";

const AVERY = "avery.chen@example.com";
const JORDAN = "jordan.blake@example.com";
const SAM = "sam.okonkwo@example.com";
const RILEY = "riley.shah@example.com";
const REFUND = "I never used my Travel Pass. Can I get a refund for my last charge?";

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.LLM_PROVIDER;
  resetDemoData();
});

async function ask(text: string, profile: string | null, simulate?: SimulateFault) {
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const session = createSession(profile);
  await runTurn({
    session,
    text,
    mode: "chat",
    profileEmail: profile,
    simulate: simulate ?? null,
    toolPaceMs: 0,
    tokenPaceMs: 0,
    timeoutMs: 0,
    emit: (event, data) => events.push({ event, data: data as Record<string, unknown> }),
  });
  const reply = events
    .filter((item) => item.event === "token")
    .map((item) => String(item.data.text))
    .join("");
  const tools = events
    .filter((item) => item.event === "status" && item.data.status !== "started" && item.data.tool !== "generate" && item.data.tool !== "understand")
    .map((item) => String(item.data.tool));
  return { events, reply, tools, session };
}

test("refund for Avery's unused Travel Pass runs the chain and issues a reference", async () => {
  const { reply, tools } = await ask(REFUND, AVERY);
  assert.deepEqual(tools, ["verify_identity", "get_subscription", "get_contract", "search_knowledge", "issue_refund"]);
  assert.match(reply, /RFD-\d+/);
  assert.match(reply, /\$35\.00/);
  assert.equal(findCustomerByEmail(AVERY)?.refunds.length, 1);
});

test("a second refund on the same charge is refused", async () => {
  await ask(REFUND, AVERY);
  const second = await ask(REFUND, AVERY);
  assert.equal(second.tools.includes("issue_refund"), true);
  assert.match(second.reply, /did not issue a refund/i);
  assert.equal(findCustomerByEmail(AVERY)?.refunds.length, 1);
});

test("Prepaid refills are not refunded and Riley is blocked by the past-due contract", async () => {
  const sam = await ask("Can I get a refund for my last charge?", SAM);
  assert.match(sam.reply, /did not issue a refund/i);
  assert.match(sam.reply, /Prepaid refills/);
  assert.equal(/RFD-/.test(sam.reply), false);
  const riley = await ask("Can I get a refund for my last charge?", RILEY);
  assert.match(riley.reply, /past due/i);
});

test("SOS-only troubleshooting cites the no service guide", async () => {
  const { reply, tools } = await ask("My phone shows SOS only since this morning", AVERY);
  assert.equal(tools.includes("search_knowledge"), true);
  assert.match(reply, /airplane mode|outage map/i);
});

test("a Prepaid caller asking about eSIM is escalated, not given a Plus-only guide", async () => {
  const { reply, tools } = await ask("My eSIM is not working on my new phone", SAM);
  assert.equal(tools.includes("create_escalation"), true);
  assert.match(reply, /ESC-\d+/);
  assert.doesNotMatch(reply, /QR code/);
});

test("Business SLA is grounded even when the caller is on Plus", async () => {
  const jordan = await ask("What's the Business SLA during an outage?", JORDAN);
  assert.match(jordan.reply, /15 minutes/);
  const avery = await ask("What's the Business SLA during an outage?", AVERY);
  assert.match(avery.reply, /15 minutes/);
  assert.doesNotMatch(avery.reply, /within 4 hours/);
});

test("travel questions use the caller's plan", async () => {
  const { reply } = await ask("Does my plan work in Mexico? I'm travelling abroad next week", AVERY);
  assert.match(reply, /Travel Pass/);
});

test("out of scope queries are refused instead of answered from policy", async () => {
  const { reply, tools } = await ask("What's the best pizza in Brooklyn?", AVERY);
  assert.equal(tools.includes("search_knowledge"), true);
  assert.match(reply, /outside Linden Mobile support/i);
  assert.equal(/Source:/i.test(reply), false);
});

test("a vague in-scope question below the threshold opens a ticket", async () => {
  const { reply, tools } = await ask("Do you integrate with the municipal water department?", AVERY);
  assert.equal(tools.includes("create_escalation"), true);
  assert.match(reply, /ESC-\d+/);
  assert.match(reply, /did not guess/i);
});

test("porting a number out opens a ticket for a teammate", async () => {
  const { reply, tools } = await ask("I want to port my number to another carrier", AVERY);
  assert.equal(tools.includes("create_escalation"), true);
  assert.match(reply, /ESC-\d+ at priority P2/);
});

test("billing email update is a real mutation", async () => {
  const { reply } = await ask("Change my billing email to finance@acme.com", AVERY);
  assert.match(reply, /finance@acme.com/);
  assert.equal(findCustomerByEmail(AVERY)?.billingEmail, "finance@acme.com");
});

test("a signed-in caller cannot act on another account by typing its email", async () => {
  const { reply, tools } = await ask(`Refund the last charge on ${JORDAN}`, AVERY);
  assert.equal(tools.length, 0);
  assert.match(reply, /signed in to a different/i);
  assert.equal(findCustomerByEmail(JORDAN)?.refunds.length, 0);
});

test("an email-only caller can read policy but needs step-up before a refund", async () => {
  const { reply, tools } = await ask(`${REFUND} My email is ${AVERY}`, null);
  assert.equal(tools.includes("issue_refund"), false);
  assert.equal(tools.includes("create_escalation"), true);
  assert.match(reply, /email address alone is not enough/i);
  assert.equal(findCustomerByEmail(AVERY)?.refunds.length, 0);
});

test("tool failure stops before the refund is issued", async () => {
  const { reply, events } = await ask(REFUND, AVERY, "tool_failure");
  assert.equal(events.some((item) => item.event === "error"), true);
  assert.match(reply, /nothing was refunded|did not|failed/i);
  assert.equal(findCustomerByEmail(AVERY)?.refunds.length, 0);
});

test("simulated timeout keeps the account unchanged and stays recoverable", async () => {
  const { events } = await ask("What's my plan?", AVERY, "timeout");
  const error = events.find((item) => item.event === "error");
  assert.equal(error?.data.code, "TIMEOUT");
  assert.equal(error?.data.recoverable, true);
});
