import type {
  AccountUpdate,
  Customer,
  Decision,
  EscalationTicket,
  IdentityLevel,
  Intent,
  RefundDecision,
  RetrievedChunk,
} from "../types";
import { contractName, monthlyPrice, tierName } from "../data/customers";
import { tokenize } from "../rag/embeddings";

export interface AnswerInput {
  intent: Intent;
  query?: string;
  identity?: IdentityLevel;
  customer: Customer | null;
  confident: boolean;
  threshold: number;
  topScore: number;
  hits: RetrievedChunk[];
  retrievalReason: string;
  refund: RefundDecision | null;
  update: AccountUpdate | null;
  escalation: EscalationTicket | null;
  verifyError: string | null;
  toolFailure: string | null;
  decision: Decision;
}

export function composeAnswer(input: AnswerInput): string {
  if (input.toolFailure) {
    const who = input.customer ? `${input.customer.name} is verified` : "I had not verified an account yet";
    return `${who}, then a downstream tool failed (${input.toolFailure}). I stopped the chain, so nothing was refunded or changed after that error. You can retry this message.`;
  }
  if (input.intent === "greeting") {
    const name = input.customer?.name;
    return name
      ? `Hi ${name.split(" ")[0]}, this is Linden Care. I can check your plan and bill, fix a service or data problem, explain travel options, or review a refund against policy.`
      : "Hi, this is Linden Care. I can help with your Linden Mobile bill, service problems, travel, and published policy. Choose an account on the left, or tell me the email on the account.";
  }
  if (input.verifyError && input.intent !== "policy_question" && input.intent !== "out_of_scope") {
    return input.verifyError;
  }
  if (input.intent === "out_of_scope") {
    return "That's outside Linden Mobile support, so I won't answer it. I can help with your bill, plan, contract, coverage, service problems, and travel.";
  }
  if ((input.intent === "refund" || input.intent === "account_update") && input.identity === "claimed" && input.customer) {
    const action = input.intent === "refund" ? "issue a refund" : "change account details";
    const ticket = input.escalation
      ? ` I opened ${input.escalation.id} at ${input.escalation.priority} so a teammate can verify you and finish this.`
      : "";
    return `I found the ${tierName(input.customer.tier)} account for ${input.customer.name}, but an email address alone is not enough for me to ${action}.${ticket} Nothing on the account was changed.`;
  }
  if (input.intent === "refund") return refundAnswer(input);
  if (input.intent === "account_update") return updateAnswer(input);
  if (input.intent === "account_status") return statusAnswer(input);
  if (input.intent === "escalate_request" && input.escalation) {
    return `I opened ${input.escalation.id} at priority ${input.escalation.priority}. A teammate will call you back from the queue. Cancellations, number transfers, and SIM swaps are handled by that team, so I cannot do them from here.`;
  }
  if (!input.confident && (input.intent === "troubleshoot" || input.intent === "policy_question")) {
    const ticket = input.escalation ? ` I opened ${input.escalation.id} at ${input.escalation.priority}.` : "";
    return `I am not confident enough to answer from the knowledge base. ${input.retrievalReason}${ticket} I did not guess.`;
  }
  return groundedPolicyAnswer(input);
}

function refundAnswer(input: AnswerInput): string {
  const customer = input.customer;
  if (!customer) return "I could not verify an account, so I did not issue a refund.";
  const decision = input.refund;
  if (!input.confident) {
    return `I verified ${customer.name} on the ${tierName(customer.tier)} plan, but the refund policy match was too weak to act on. ${input.escalation ? `Escalation ${input.escalation.id} is open at ${input.escalation.priority}.` : ""} No refund was issued.`;
  }
  if (!decision) return `I verified ${customer.name}, but the refund tool did not run. Nothing was refunded.`;
  if (!decision.approved || !decision.refundId) {
    return `I verified ${customer.name} (${tierName(customer.tier)} plan, contract ${contractName(customer.contractStatus).toLowerCase()}). I did not issue a refund. ${decision.reason}\n\nSource: Refund policy · ${decision.policySection}`;
  }
  const card = customer.cardLast4 ? ` to the card ending ${customer.cardLast4}` : "";
  return `I verified ${customer.name} on the ${tierName(customer.tier)} plan, and the contract is active. ${decision.reason}\n\nI refunded $${decision.amountUsd.toFixed(2)} for “${customer.lastCharge.description}”${card}. Your reference is ${decision.refundId}. It usually appears within 5 to 10 business days.\n\nSource: Refund policy · ${decision.policySection}`;
}

function updateAnswer(input: AnswerInput): string {
  const customer = input.customer;
  if (!customer) return "I could not verify an account, so I did not change anything.";
  const update = input.update;
  if (!update || !update.updated) {
    return `I verified ${customer.name}. I did not change the account. ${update?.reason ?? "The update tool did not run."}`;
  }
  const label = update.field === "billingEmail" ? "billing email" : "name";
  return `I verified ${customer.name} and updated the ${label} from ${update.previous} to ${update.next}. Contract status is ${customer.contractStatus.replaceAll("_", " ")}.`;
}

function statusAnswer(input: AnswerInput): string {
  const customer = input.customer;
  if (!customer) return "I could not verify an account from that email.";
  const due = customer.pastDueUsd > 0 ? ` Past due amount is $${customer.pastDueUsd.toFixed(2)}.` : "";
  const refund = customer.refunds.length
    ? ` Refund ${customer.refunds[0].id} for $${customer.refunds[0].amountUsd.toFixed(2)} is already on this charge.`
    : "";
  const lines = customer.lines === 1 ? "1 line" : `${customer.lines} lines`;
  const price = monthlyPrice(customer.tier, customer.lines);
  return `${customer.name} is verified. Plan: ${tierName(customer.tier)}, ${lines}, $${price.toFixed(2)} a month. Contract: ${contractName(customer.contractStatus).toLowerCase()}. Billing email: ${customer.billingEmail}. Last charge: $${customer.lastCharge.amountUsd.toFixed(2)} on ${customer.lastCharge.chargedOn} (${customer.lastCharge.description}).${due}${refund}`;
}

function groundedPolicyAnswer(input: AnswerInput): string {
  const sentences = supportingSentences(input.hits, input.intent === "troubleshoot" ? 3 : 2, input.query ?? "");
  const top = input.hits[0];
  if (!sentences.length || !top) {
    return `I could not find a published passage that matches closely enough. ${input.escalation ? `I opened ${input.escalation.id}.` : ""}`.trim();
  }
  return `${sentences.join(" ")}\n\nSource: ${top.title} · ${top.section}`;
}

function supportingSentences(hits: RetrievedChunk[], limit: number, query: string): string[] {
  const terms = new Set(tokenize(query).filter((term) => term.length > 3));
  const candidates: Array<{ sentence: string; order: number; overlap: number }> = [];
  for (const hit of hits.slice(0, 3)) {
    const sentences = hit.text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 30);
    for (const sentence of sentences) {
      if (candidates.some((c) => c.sentence === sentence)) continue;
      const overlap = tokenize(sentence).filter((term) => terms.has(term)).length;
      candidates.push({ sentence, order: candidates.length, overlap });
    }
  }
  const picked = candidates.slice(0, limit);
  const best = candidates.slice(limit).sort((a, b) => b.overlap - a.overlap)[0];
  if (best && best.overlap >= 2 && best.overlap > Math.max(...picked.map((c) => c.overlap))) picked.push(best);
  return picked.map((c) => c.sentence);
}

export interface GroundingFacts {
  fallback: string;
  refundId?: string;
  ticketId?: string;
  refundApproved: boolean;
  /** Refunds already on the account before this turn. */
  priorRefundIds?: string[];
  sourceText?: string;
}

export function groundingFacts(input: AnswerInput, fallback: string, sourceText?: string): GroundingFacts {
  const refundId = input.refund?.refundId;
  return {
    fallback,
    refundId,
    ticketId: input.escalation?.id,
    refundApproved: Boolean(input.refund?.approved && refundId),
    priorRefundIds: (input.customer?.refunds ?? []).map((refund) => refund.id).filter((id) => id !== refundId),
    sourceText: sourceText === undefined ? undefined : `${sourceText}\n${fallback}`,
  };
}

const AMOUNT = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
const DURATION = /\b(\d+)[\s-]*(minutes?|hours?|days?|weeks?|months?)\b/gi;

function numbersIn(text: string): Set<number> {
  return new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((raw) => Number(raw.replaceAll(",", ""))));
}

export function ungroundedFigures(reply: string, sourceText: string): string[] {
  const known = numbersIn(sourceText);
  const missing: string[] = [];
  for (const match of reply.matchAll(AMOUNT)) {
    if (!known.has(Number(match[1].replaceAll(",", "")))) missing.push(match[0]);
  }
  for (const match of reply.matchAll(DURATION)) {
    if (!known.has(Number(match[1]))) missing.push(match[0]);
  }
  return missing;
}

// Checks and actions no tool in this agent can perform, so a reply that claims them is inventing a result.
const UNBACKED_CLAIMS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(outage map|network status) (shows|says|indicates|reports)|\bno (reported |known )?outages? (in|for|near) your\b|\bI (checked|looked at|reviewed) the (outage map|network|tower)/i, label: "an outage check" },
  { pattern: /\bI('ve| have)? (reset|refreshed|reprovisioned|restarted|pinged|rebooted) (your|the)\b/i, label: "a remote fix" },
  { pattern: /\bI('ve| have)? (applied|added|issued) (a |an )?(credit|discount)/i, label: "a credit" },
  { pattern: /\bI('ve| have)? (re)?sent (you )?(a |the )?(code|qr code|link|text|email)/i, label: "a message being sent" },
];

export function enforceGrounding(draft: string, facts: GroundingFacts): { text: string; rewritten: boolean; violations: string[] } {
  const violations: string[] = [];
  if (facts.sourceText !== undefined) {
    const missing = ungroundedFigures(draft, facts.sourceText);
    if (missing.length) violations.push(`Stated ${missing.join(", ")}, which no tool result or policy chunk contains.`);
  }
  for (const claim of UNBACKED_CLAIMS) {
    if (claim.pattern.test(draft)) violations.push(`Claimed ${claim.label}, which no tool performed.`);
  }
  if (/\bI('ve| have)? (opened|created|filed|raised) (an? )?(escalation|ticket|case)\b/i.test(draft) && !facts.ticketId) {
    violations.push("Claimed an escalation that was not opened.");
  }
  const prior = facts.priorRefundIds ?? [];
  const mentionedRefunds = draft.match(/RFD-\d+/g) ?? [];
  const describesPriorRefund = mentionedRefunds.some((id) => prior.includes(id));
  const claimsRefund = /refund(ed| has been issued)|I issued|reference is RFD-/i.test(draft);
  if (claimsRefund && !facts.refundApproved && !describesPriorRefund) violations.push("Claimed a refund that billing did not approve.");
  if (facts.refundApproved && facts.refundId && claimsRefund && !draft.includes(facts.refundId)) {
    violations.push("Described a refund without the billing reference.");
  }
  const tickets = draft.match(/ESC-\d+/g) ?? [];
  if (tickets.some((id) => id !== facts.ticketId)) violations.push("Mentioned an escalation id that was not opened.");
  if (mentionedRefunds.some((id) => id !== facts.refundId && !prior.includes(id))) {
    violations.push("Mentioned a refund id that billing did not issue.");
  }
  if (!violations.length) return { text: draft, rewritten: false, violations };
  return { text: facts.fallback, rewritten: true, violations };
}

export function queryTerms(text: string): string[] {
  return tokenize(text);
}
