import type { Decision, Intent } from "@/lib/types";

export type Tone = "sage" | "neutral" | "amber" | "tomato";

export const DECISION: Record<Decision, { label: string; tone: Tone }> = {
  act: { label: "Action taken", tone: "sage" },
  answer: { label: "Answered", tone: "neutral" },
  escalate: { label: "Escalated", tone: "amber" },
  refuse: { label: "Declined", tone: "neutral" },
  recover: { label: "Recovered", tone: "amber" },
  error: { label: "Failed", tone: "tomato" },
};

export const INTENT: Record<Intent, string> = {
  refund: "Refund",
  troubleshoot: "Troubleshooting",
  account_update: "Account update",
  account_status: "Account status",
  policy_question: "Policy",
  escalate_request: "Escalation",
  out_of_scope: "Out of scope",
  greeting: "Greeting",
};

export function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function cost(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(3)}`;
}

export function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function shortModel(model: string | null | undefined): string {
  if (!model || model === "deterministic-planner") return "Local (no LLM)";
  const bare = model.replace(/^.*·\s*/, "");
  const grok = bare.match(/^grok-(\d+(?:\.\d+)?)/);
  if (grok) return `Grok ${grok[1]}${/-reasoning$/.test(bare) && !/non-reasoning/.test(bare) ? " Reasoning" : ""}`;
  return bare.replace(/^gpt-/, "GPT-");
}

export function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const DONE_LABEL: Record<string, string> = {
  understand: "Classified request",
  verify_identity: "Verified identity",
  get_subscription: "Checked plan and lines",
  get_contract: "Checked contract status",
  search_knowledge: "Searched Linden policies",
  issue_refund: "Refund decision",
  update_account: "Account update",
  create_escalation: "Opened escalation",
  generate: "Composed reply",
};

const ERROR_LABEL: Record<string, string> = {
  verify_identity: "Identity not verified",
  get_subscription: "Plan lookup failed",
  get_contract: "Contract lookup failed",
  search_knowledge: "Policy search failed",
  issue_refund: "Refund failed",
  update_account: "Account update failed",
  create_escalation: "Escalation failed",
};

export function stepLabel(tool: string, label: string, status: "started" | "completed" | "error"): string {
  if (status === "started") return label.endsWith("…") ? label : `${label}…`;
  if (status === "error") return ERROR_LABEL[tool] ?? `${label.replace(/…$/, "")} failed`;
  return DONE_LABEL[tool] ?? label.replace(/…$/, "");
}
