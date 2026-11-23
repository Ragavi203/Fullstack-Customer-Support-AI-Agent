export type Mode = "chat" | "voice";

export type Tier = "prepaid" | "plus" | "business";

export type ContractStatus = "active" | "past_due" | "suspended" | "cancelled";

export type Intent =
  | "refund"
  | "troubleshoot"
  | "account_update"
  | "account_status"
  | "policy_question"
  | "escalate_request"
  | "out_of_scope"
  | "greeting";

export type Decision = "answer" | "act" | "escalate" | "refuse" | "recover" | "error";

export type SimulateFault = "timeout" | "rate_limit" | "tool_failure" | null;

export type ToolName =
  | "verify_identity"
  | "get_subscription"
  | "get_contract"
  | "search_knowledge"
  | "issue_refund"
  | "update_account"
  | "create_escalation";

export interface Charge {
  amountUsd: number;
  description: string;
  chargedOn: string;
}

export interface RefundRecord {
  id: string;
  amountUsd: number;
  issuedAt: string;
  chargeDescription: string;
}

export interface Customer {
  id: string;
  email: string;
  name: string;
  tier: Tier;
  contractStatus: ContractStatus;
  renewsOn: string | null;
  pastDueUsd: number;
  lastCharge: Charge;
  billingEmail: string;
  cardLast4: string | null;
  phone: string;
  lines: number;
  refunds: RefundRecord[];
}

export interface PublicCustomer {
  id: string;
  email: string;
  name: string;
  tier: Tier;
  contractStatus: ContractStatus;
  renewsOn: string | null;
  pastDueUsd: number;
  lastCharge: Charge;
  billingEmail: string;
  cardLast4: string | null;
  phone: string;
  lines: number;
  refunds: RefundRecord[];
}

export interface StepEvent {
  id: string;
  tool: string;
  label: string;
  status: "started" | "completed" | "error";
  detail?: string;
  latencyMs?: number;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: Mode;
  createdAt: number;
  steps?: StepEvent[];
  decision?: Decision;
  interrupted?: boolean;
}

export interface RetrievedChunk {
  id: string;
  docId: string;
  title: string;
  section: string;
  text: string;
  score: number;
  tiers: string[];
}

export interface RefundDecision {
  approved: boolean;
  amountUsd: number;
  refundId?: string;
  reason: string;
  policySection: string;
  capUsd: number;
  windowDays: number;
}

export interface AccountUpdate {
  updated: boolean;
  field: "billingEmail" | "name";
  previous: string;
  next: string;
  reason: string;
}

export interface EscalationTicket {
  id: string;
  priority: "P1" | "P2" | "P3";
  reason: string;
  confidence: number;
  status: "queued";
  openedAt: string;
}

export interface SubscriptionView {
  customerId: string;
  tier: Tier;
  priceUsd: number;
  features: string[];
}

export interface ContractView {
  customerId: string;
  status: ContractStatus;
  renewsOn: string | null;
  pastDueUsd: number;
  refundsBlocked: boolean;
  blockReason: string | null;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
}

export interface TraceStep {
  id: string;
  tool: string;
  label: string;
  args: unknown;
  resultSummary: string;
  ok: boolean;
  latencyMs: number;
}

export interface RetrievalTrace {
  query: string;
  threshold: number;
  topScore: number;
  confident: boolean;
  provider: "openai" | "local";
  expanded: boolean;
  hits: Array<{ id: string; title: string; section: string; score: number }>;
  decision: string;
}

export interface RoutingTrace {
  source: "llm" | "rules";
  intent: Intent;
  rulesIntent: Intent;
  searchQuery: string;
  rationale: string;
}

export type IdentityLevel = "session" | "claimed" | "none";

export interface TurnTrace {
  id: string;
  sessionId: string;
  mode: Mode;
  startedAt: number;
  endedAt: number;
  e2eMs: number;
  model: string;
  planner: "deterministic" | "llm" | "llm+backfill";
  intent: Intent;
  routing?: RoutingTrace;
  identity?: IdentityLevel;
  steps: TraceStep[];
  retrieval: RetrievalTrace | null;
  guardrail: {
    decision: Decision;
    reason: string;
    confidence: number;
    threshold: number;
    rewritten: boolean;
    violations: string[];
  };
  usage: Usage;
  costUsd: number;
  systemPrompt: string;
  routerPrompt?: string;
  notes: string[];
  notice?: string;
  error?: { code: string; message: string };
}

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  profileEmail: string | null;
  messages: StoredMessage[];
  traces: TurnTrace[];
}

export interface ClassifiedIntent {
  intent: Intent;
  confidence: number;
  email: string | null;
  amountUsd: number | null;
  field: "billingEmail" | "name" | null;
  value: string | null;
  query: string;
}
