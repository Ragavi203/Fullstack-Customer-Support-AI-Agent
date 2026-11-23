import type { ClassifiedIntent, Intent } from "../types";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const RULES: Array<{ intent: Intent; patterns: RegExp[] }> = [
  { intent: "refund", patterns: [/refund/, /money back/, /reimburse/, /\bcharge(d)?\b/, /overcharg/] },
  {
    intent: "account_update",
    patterns: [/billing email/, /change (my )?(name|email)/, /update (my )?(name|email|billing)/],
  },
  {
    intent: "escalate_request",
    patterns: [
      /\bhuman\b/,
      /real (person|agent)/,
      /\bescalat/,
      /talk to (someone|an agent|support)/,
      /\bcancel/,
      /port (out|my number)/,
      /switch(ing)? carriers?/,
      /sim swap/,
    ],
  },
  {
    intent: "troubleshoot",
    patterns: [
      /no (service|signal|bars)/,
      /\bsos\b/,
      /drop(ped|ping|s)? calls?|calls? (keep )?drop/,
      /(not|stopped) working/,
      /fail(ing|ed|ure)?/,
      /\berror\b/,
      /can(?:not|'t) (call|text|connect|get|make|send|receive)/,
      /outage/,
      /\besim\b/,
      /wi-?fi calling/,
      /(slow|no) data|data (is )?(slow|not)/,
      /broken/,
      /voicemail/,
    ],
  },
  {
    intent: "account_status",
    patterns: [
      /my plan/,
      /what plan/,
      /which plan/,
      /(plan|bill|lines?)\b.{0,15}\b(cost|price)|\b(cost|price)s?\b.{0,15}\b(plan|bill|lines?)\b/,
      /how much (do i pay|am i paying|is my)/,
      /my bill\b/, /how much do i owe/, /contract status/, /who am i/, /my account/, /my lines?\b/, /past due/],
  },
  {
    intent: "policy_question",
    patterns: [
      /policy/,
      /\bsla\b/,
      /how long/,
      /eligible/,
      /response time/,
      /do you (support|offer|cover)/,
      /outage credit|service credit/,
      /roam/,
      /travel pass/,
      /international|abroad|overseas/,
    ],
  },
  { intent: "greeting", patterns: [/^(hi|hello|hey|good morning|good afternoon|thanks|thank you)\b/] },
  {
    intent: "out_of_scope",
    patterns: [/weather/, /pizza/, /\bjoke\b/, /recipe/, /capital of/, /\bpoem\b/, /stock price/, /who won/, /sports/],
  },
];

export function classifyIntent(text: string, profileEmail: string | null): ClassifiedIntent {
  const cleaned = text.trim().toLowerCase();
  const scores = new Map<Intent, number>();
  for (const rule of RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(cleaned)) score += 1;
    }
    if (score) scores.set(rule.intent, score);
  }

  let intent: Intent = "policy_question";
  let best = 0;
  for (const [name, score] of scores) {
    if (score > best) {
      best = score;
      intent = name;
    }
  }
  if (!scores.size) {
    intent = cleaned.length < 12 ? "greeting" : "policy_question";
  }
  if (scores.get("out_of_scope") && (scores.get("out_of_scope") ?? 0) >= best && best > 0 && !scores.has("refund") && !scores.has("troubleshoot")) {
    intent = "out_of_scope";
  }
  if ((scores.get("refund") ?? 0) > 0 && (scores.get("policy_question") ?? 0) > 0 && /refund/.test(cleaned) && !/policy|eligible|window|sla/.test(cleaned)) {
    intent = "refund";
  }
  if (/\bsla\b|service level|outage credit|response time/.test(cleaned) && intent === "troubleshoot") {
    intent = "policy_question";
  }
  if (/roam|travel|abroad|overseas|international/.test(cleaned) && intent === "account_status") {
    intent = "policy_question";
  }
  if (intent === "account_status" && !profileEmail && /\b(cost|price)s?\b/.test(cleaned) && !/\b(my|i)\b/.test(cleaned)) {
    intent = "policy_question";
  }
  if ((scores.get("account_update") ?? 0) > 0) intent = "account_update";
  if ((scores.get("escalate_request") ?? 0) > 0 && (scores.get("refund") ?? 0) === 0 && (scores.get("troubleshoot") ?? 0) === 0) {
    intent = "escalate_request";
  }

  const wantsRefund =
    /refund (me|my)|get a refund|issue a refund|money back|reimburse me/.test(cleaned);
  const asksRefundPolicy = /refund policy|refund window|eligible for a refund|how long.{0,40}refund/.test(cleaned);
  if (wantsRefund && !asksRefundPolicy) intent = "refund";
  if (asksRefundPolicy && !wantsRefund) intent = "policy_question";

  const emails = text.match(EMAIL)?.map((email) => email.toLowerCase()) ?? [];
  const amount = extractAmount(text);
  const field = /billing email|update (my )?email|change (my )?email/.test(cleaned)
    ? "billingEmail"
    : /change my name|update my name/.test(cleaned)
      ? "name"
      : null;
  let value: string | null = null;
  if (field === "billingEmail") {
    value = emails.find((email) => email !== profileEmail?.toLowerCase()) ?? null;
  } else if (field === "name") {
    const match = text.match(/(?:change|update) my name to ([A-Za-z][A-Za-z .'-]{1,40})/i);
    value = match?.[1]?.trim().replace(/[.?]$/, "") ?? null;
  }

  const accountEmail =
    intent === "account_update"
      ? profileEmail
      : emails.find((email) => email !== value) ?? profileEmail;

  return {
    intent,
    confidence: scores.size ? Math.min(0.95, 0.45 + best * 0.2) : 0.35,
    email: accountEmail,
    amountUsd: intent === "refund" ? amount : null,
    field: intent === "account_update" ? field : null,
    value: intent === "account_update" ? value : null,
    query: text.trim(),
  };
}

export function extractAmount(text: string): number | null {
  const match = text.match(/\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*dollars/i);
  if (!match) return null;
  return Number(match[1] ?? match[2]);
}

export function intentLabel(intent: Intent): string {
  switch (intent) {
    case "refund":
      return "Refund request";
    case "troubleshoot":
      return "Troubleshooting";
    case "account_update":
      return "Account update";
    case "account_status":
      return "Account status";
    case "policy_question":
      return "Policy question";
    case "escalate_request":
      return "Human escalation";
    case "out_of_scope":
      return "Outside support scope";
    case "greeting":
      return "Greeting";
  }
}
