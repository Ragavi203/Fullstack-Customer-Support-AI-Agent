import {
  findCustomerByEmail,
  findCustomerById,
  monthlyPrice,
  nextRefundId,
  nextTicketId,
  tierName,
  toPublicCustomer,
} from "../data/customers";
import type {
  AccountUpdate,
  ContractView,
  Customer,
  EscalationTicket,
  RefundDecision,
  SubscriptionView,
  Tier,
  ToolName,
} from "../types";
import { searchKnowledge, type SearchResult } from "../rag/store";
import { evaluateRefund } from "./policy";

export interface ToolContext {
  customer: Customer | null;
  search?: SearchResult;
}

export interface ToolOutput {
  ok: boolean;
  summary: string;
  data: unknown;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function toolLabel(name: ToolName | string): string {
  switch (name) {
    case "verify_identity":
      return "Verifying account…";
    case "get_subscription":
      return "Checking plan and lines…";
    case "get_contract":
      return "Checking contract status…";
    case "search_knowledge":
      return "Searching Linden policies…";
    case "issue_refund":
      return "Issuing refund…";
    case "update_account":
      return "Updating account…";
    case "create_escalation":
      return "Opening escalation…";
    default:
      return "Working…";
  }
}

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutput> {
  switch (name) {
    case "verify_identity":
      return verifyIdentity(String(args.email ?? ""));
    case "get_subscription":
      return getSubscription(ctx);
    case "get_contract":
      return getContract(ctx);
    case "search_knowledge":
      return searchTool(args, ctx);
    case "issue_refund":
      return issueRefund(args, ctx);
    case "update_account":
      return updateAccount(args, ctx);
    case "create_escalation":
      return createEscalation(args, ctx);
    default:
      return { ok: false, summary: "Unknown tool.", data: null };
  }
}

function verifyIdentity(email: string): ToolOutput {
  const customer = findCustomerByEmail(email);
  if (!customer) {
    return {
      ok: false,
      summary: email
        ? `No Linden Mobile account uses ${email}.`
        : "No email was provided, so the account could not be verified.",
      data: null,
    };
  }
  return {
    ok: true,
    summary: `Verified ${customer.name} (${customer.email}).`,
    data: toPublicCustomer(customer),
  };
}

function requireCustomer(ctx: ToolContext): Customer | ToolOutput {
  if (!ctx.customer) {
    return { ok: false, summary: "Identity is not verified, so this tool was not run.", data: null };
  }
  return ctx.customer;
}

function getSubscription(ctx: ToolContext): ToolOutput {
  const customer = requireCustomer(ctx);
  if (!("id" in customer)) return customer;
  const view: SubscriptionView = {
    customerId: customer.id,
    tier: customer.tier,
    priceUsd: monthlyPrice(customer.tier, customer.lines),
    features: featuresFor(customer.tier),
  };
  const lines = customer.lines === 1 ? "1 line" : `${customer.lines} lines`;
  return {
    ok: true,
    summary: `${tierName(customer.tier)} plan, ${lines}, $${view.priceUsd}/month.`,
    data: view,
  };
}

function getContract(ctx: ToolContext): ToolOutput {
  const customer = requireCustomer(ctx);
  if (!("id" in customer)) return customer;
  const blocked = customer.contractStatus !== "active";
  const view: ContractView = {
    customerId: customer.id,
    status: customer.contractStatus,
    renewsOn: customer.renewsOn,
    pastDueUsd: customer.pastDueUsd,
    refundsBlocked: blocked,
    blockReason: blocked
      ? `Contract is ${customer.contractStatus.replaceAll("_", " ")}.`
      : null,
  };
  return {
    ok: true,
    summary: blocked
      ? `${customer.name}'s contract is ${customer.contractStatus.replaceAll("_", " ")}.`
      : `${customer.name}'s contract is active${customer.renewsOn ? ` through ${customer.renewsOn}` : ""}.`,
    data: view,
  };
}

async function searchTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  const query = String(args.query ?? "").trim();
  const access = args.access === "strict" ? "strict" : "open";
  const tier = (ctx.customer?.tier ?? (args.tier as Tier | null) ?? null) as Tier | null;
  const result = await searchKnowledge(query, tier, {
    expanded: Boolean(args.expanded),
    access,
  });
  ctx.search = result;
  const top = result.hits[0];
  return {
    ok: true,
    summary: top
      ? `Best match “${top.title} · ${top.section}” at ${top.score.toFixed(2)} (${result.confident ? "confident" : "below threshold"}).`
      : "The knowledge base returned no chunks.",
    data: result,
  };
}

function issueRefund(args: Record<string, unknown>, ctx: ToolContext): ToolOutput {
  const customer = requireCustomer(ctx);
  if (!("id" in customer)) return customer;
  const live = findCustomerById(customer.id) ?? customer;
  const requested = typeof args.amountUsd === "number" ? args.amountUsd : null;
  const decision: RefundDecision = evaluateRefund(live, requested);
  if (!decision.approved) {
    return { ok: false, summary: decision.reason, data: decision };
  }
  const refundId = nextRefundId();
  const record = {
    id: refundId,
    amountUsd: decision.amountUsd,
    issuedAt: new Date().toISOString(),
    chargeDescription: live.lastCharge.description,
  };
  live.refunds.push(record);
  const approved: RefundDecision = { ...decision, refundId };
  return {
    ok: true,
    summary: `Issued ${refundId} for $${decision.amountUsd.toFixed(2)}.`,
    data: approved,
  };
}

function updateAccount(args: Record<string, unknown>, ctx: ToolContext): ToolOutput {
  const customer = requireCustomer(ctx);
  if (!("id" in customer)) return customer;
  const live = findCustomerById(customer.id) ?? customer;
  const field = args.field === "name" ? "name" : args.field === "billingEmail" ? "billingEmail" : null;
  const value = String(args.value ?? "").trim();
  if (!field || !value) {
    const result: AccountUpdate = {
      updated: false,
      field: "billingEmail",
      previous: live.billingEmail,
      next: value,
      reason: "Say which field to change and the new value. I can update billingEmail or name.",
    };
    return { ok: false, summary: result.reason, data: result };
  }
  if (live.contractStatus === "cancelled") {
    const result: AccountUpdate = {
      updated: false,
      field,
      previous: field === "name" ? live.name : live.billingEmail,
      next: value,
      reason: "Cancelled accounts are read-only.",
    };
    return { ok: false, summary: result.reason, data: result };
  }
  if (field === "billingEmail") {
    if (!EMAIL.test(value)) {
      const result: AccountUpdate = {
        updated: false,
        field,
        previous: live.billingEmail,
        next: value,
        reason: "The new billing email is not a valid email address.",
      };
      return { ok: false, summary: result.reason, data: result };
    }
    const previous = live.billingEmail;
    live.billingEmail = value;
    const result: AccountUpdate = { updated: true, field, previous, next: value, reason: "Billing email updated." };
    return { ok: true, summary: `Billing email updated from ${previous} to ${value}.`, data: result };
  }
  const previous = live.name;
  live.name = value;
  const result: AccountUpdate = { updated: true, field, previous, next: value, reason: "Name updated." };
  return { ok: true, summary: `Name updated from ${previous} to ${value}.`, data: result };
}

function createEscalation(args: Record<string, unknown>, ctx: ToolContext): ToolOutput {
  const customer = ctx.customer;
  const confidence = typeof args.confidence === "number" ? args.confidence : 0;
  const reason = String(args.reason ?? "Caller needs a human teammate.");
  const production = Boolean(args.production);
  let priority: EscalationTicket["priority"] = "P3";
  if (customer?.tier === "business" || production) priority = "P1";
  else if (customer?.tier === "plus") priority = "P2";
  const ticket: EscalationTicket = {
    id: nextTicketId(),
    priority,
    reason,
    confidence,
    status: "queued",
    openedAt: new Date().toISOString(),
  };
  return {
    ok: true,
    summary: `Opened ${ticket.id} at ${ticket.priority}.`,
    data: ticket,
  };
}

function featuresFor(tier: Tier): string[] {
  if (tier === "business") return ["unlimited priority data", "5 roaming days per line monthly", "15-minute P1 response", "eSIM and Wi-Fi Calling"];
  if (tier === "plus") return ["unlimited data, 50 GB priority", "Travel Pass add-on", "4-hour P1 response", "eSIM and Wi-Fi Calling"];
  return ["15 GB high-speed data", "physical SIM only", "no international roaming", "help-center support"];
}
