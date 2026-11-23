import { expandQuery } from "../rag/expand";
import type { Decision, IdentityLevel, Intent, ToolName } from "../types";

export interface MachineState {
  intent: Intent;
  email: string | null;
  amountUsd: number | null;
  field: "billingEmail" | "name" | null;
  value: string | null;
  query: string;
  verified: boolean;
  verifyFailed: boolean;
  subscriptionLoaded: boolean;
  contractLoaded: boolean;
  searchAttempts: number;
  confident: boolean;
  topScore: number;
  refundAttempted: boolean;
  updateAttempted: boolean;
  escalationCreated: boolean;
  identity?: IdentityLevel;
}

function isMutation(intent: Intent): boolean {
  return intent === "refund" || intent === "account_update";
}

export function needsStepUp(state: MachineState): boolean {
  return isMutation(state.intent) && state.identity === "claimed";
}

const IDENTITY = new Set<Intent>([
  "refund",
  "troubleshoot",
  "account_update",
  "account_status",
  "escalate_request",
]);

export function needsIdentity(intent: Intent): boolean {
  return IDENTITY.has(intent);
}

export function nextAction(
  state: MachineState,
): { tool: ToolName; args: Record<string, unknown> } | null {
  if ((state.intent === "greeting" || state.intent === "policy_question") && state.email && !state.verified && !state.verifyFailed) {
    return { tool: "verify_identity", args: { email: state.email } };
  }
  if (state.intent === "greeting") return null;

  if (needsIdentity(state.intent) && !state.verified && !state.verifyFailed) {
    return { tool: "verify_identity", args: { email: state.email ?? "" } };
  }
  if (state.verifyFailed && needsIdentity(state.intent)) return null;

  const wantsSubscription =
    state.intent === "refund" ||
    state.intent === "troubleshoot" ||
    state.intent === "account_update" ||
    state.intent === "account_status" ||
    (state.intent === "policy_question" && state.verified);
  if (wantsSubscription && !state.subscriptionLoaded) {
    return { tool: "get_subscription", args: {} };
  }

  const wantsContract =
    state.intent === "refund" || state.intent === "account_update" || state.intent === "account_status";
  if (wantsContract && !state.contractLoaded) {
    return { tool: "get_contract", args: {} };
  }

  const grounding =
    state.intent === "refund" || state.intent === "troubleshoot" || state.intent === "policy_question" || state.intent === "out_of_scope";
  if (grounding && state.searchAttempts === 0) {
    return {
      tool: "search_knowledge",
      args: {
        query: state.query,
        expanded: false,
        access: state.intent === "troubleshoot" ? "strict" : "open",
      },
    };
  }
  if (grounding && state.intent !== "out_of_scope" && !state.confident && !state.escalationCreated && state.searchAttempts >= 1) {
    const expanded = expandQuery(state.query, state.intent);
    if (expanded !== state.query && state.searchAttempts === 1) {
      return {
        tool: "search_knowledge",
        args: {
          query: state.query,
          expanded: true,
          access: state.intent === "troubleshoot" ? "strict" : "open",
        },
      };
    }
    return {
      tool: "create_escalation",
      args: {
        reason: `Low-confidence ${state.intent.replaceAll("_", " ")}: ${state.query.slice(0, 180)}`,
        confidence: state.topScore,
        production: state.intent === "troubleshoot" && /no service|sos|every line|all (our |my )?lines|whole (office|site)/.test(state.query.toLowerCase()),
      },
    };
  }

  if (needsStepUp(state) && state.verified) {
    if (state.escalationCreated) return null;
    return {
      tool: "create_escalation",
      args: {
        reason: `Step-up verification needed: ${state.intent.replaceAll("_", " ")} requested by a caller identified only by email.`,
        confidence: 1,
      },
    };
  }

  if (state.intent === "refund" && state.confident && !state.refundAttempted) {
    return {
      tool: "issue_refund",
      args: { amountUsd: state.amountUsd },
    };
  }

  if (state.intent === "account_update" && !state.updateAttempted) {
    return {
      tool: "update_account",
      args: { field: state.field, value: state.value },
    };
  }

  if (state.intent === "escalate_request" && !state.escalationCreated) {
    return {
      tool: "create_escalation",
      args: { reason: state.query, confidence: 1 },
    };
  }

  return null;
}

export function decisionFor(state: MachineState, toolFailure: boolean): { decision: Decision; reason: string } {
  if (toolFailure) {
    return { decision: "recover", reason: "A tool failed mid-chain. Account mutations after the failure were not attempted." };
  }
  if (state.intent === "greeting") {
    return { decision: "answer", reason: "Greeting does not need retrieval." };
  }
  if (state.intent === "out_of_scope") {
    return {
      decision: "refuse",
      reason: "The request is outside Linden Mobile support. Retrieval was logged and not used as an answer.",
    };
  }
  if (state.verifyFailed && needsIdentity(state.intent)) {
    return { decision: "refuse", reason: "Identity could not be verified, so no account action ran." };
  }
  if (!state.confident && (state.intent === "refund" || state.intent === "troubleshoot" || state.intent === "policy_question")) {
    return { decision: "escalate", reason: "Retrieval stayed under the confidence threshold, so the agent refused to guess." };
  }
  if (needsStepUp(state)) {
    return { decision: "escalate", reason: "An email address alone cannot authorize account changes, so a teammate will verify the caller." };
  }
  if (state.intent === "refund" || state.intent === "account_update") {
    return { decision: "act", reason: "The action tool returned the source of truth for this turn." };
  }
  if (state.escalationCreated && state.intent === "escalate_request") {
    return { decision: "escalate", reason: "The caller asked for a human." };
  }
  return { decision: "answer", reason: "The reply is limited to verified account tools and confident policy chunks." };
}
