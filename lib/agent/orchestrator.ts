import { composeAnswer, enforceGrounding, groundingFacts, type AnswerInput } from "./answer";
import { decisionFor, needsIdentity, nextAction, type MachineState } from "./guardrails";
import { classifyIntent, extractAmount, intentLabel } from "./planner";
import { systemPrompt } from "./prompts";
import { findCustomerByEmail, monthlyPrice, toPublicCustomer } from "../data/customers";
import { liveModelEnabled, routerPrompt, routeTurn, streamReply, type RouteDecision, type ToolCallProposal } from "../llm/chat";
import { estimateCost, estimateTokens, modelName } from "../observability/cost";
import { expandQuery } from "../rag/expand";
import type { SearchResult } from "../rag/store";
import { AgentError, delay, isAbortError } from "../resilience";
import { rememberTrace } from "../session/store";
import { executeTool, toolLabel, type ToolContext, type ToolOutput } from "../tools/registry";
import type {
  AccountUpdate,
  Customer,
  Decision,
  EscalationTicket,
  Mode,
  ClassifiedIntent,
  RefundDecision,
  RetrievedChunk,
  RoutingTrace,
  Session,
  SimulateFault,
  StepEvent,
  ToolName,
  TraceStep,
  TurnTrace,
  Usage,
} from "../types";

const TOOLS = new Set<ToolName>([
  "verify_identity",
  "get_subscription",
  "get_contract",
  "search_knowledge",
  "issue_refund",
  "update_account",
  "create_escalation",
]);

const ROUTER_TIMEOUT_MS = 4000;

export interface RunTurnOptions {
  session: Session;
  text: string;
  mode: Mode;
  profileEmail: string | null;
  simulate?: SimulateFault;
  signal?: AbortSignal;
  toolPaceMs?: number;
  tokenPaceMs?: number;
  timeoutMs?: number;
  emit: (event: string, data: unknown) => void;
}

interface LoopState extends MachineState {
  hits: RetrievedChunk[];
  threshold: number;
  retrievalReason: string;
  provider: "openai" | "local";
  expanded: boolean;
  refund: RefundDecision | null;
  update: AccountUpdate | null;
  escalation: EscalationTicket | null;
  verifyError: string | null;
}

export async function runTurn(opts: RunTurnOptions): Promise<void> {
  const started = Date.now();
  const emit = opts.emit;
  const signal = opts.signal;
  const toolPace = opts.toolPaceMs ?? 0;
  const tokenPace = opts.tokenPaceMs ?? 0;
  const usage: Usage = { promptTokens: 0, completionTokens: 0, embeddingTokens: 0 };
  const steps: StepEvent[] = [];
  const traceSteps: TraceStep[] = [];
  const notes: string[] = [];
  let notice: string | undefined;
  let streamed = "";
  let planner: TurnTrace["planner"] = "deterministic";

  const classified = classifyIntent(opts.text, opts.profileEmail);
  const priorMessages = opts.session.messages.map((message) => ({ role: message.role, content: message.content }));
  let routing: RoutingTrace = {
    source: "rules",
    intent: classified.intent,
    rulesIntent: classified.intent,
    searchQuery: classified.query,
    rationale: "Keyword rules routed this turn.",
  };
  let plan: ToolCallProposal[] = [];
  const state: LoopState = {
    intent: classified.intent,
    email: classified.email,
    amountUsd: classified.amountUsd,
    field: classified.field,
    value: classified.value,
    query: classified.query,
    verified: false,
    verifyFailed: false,
    subscriptionLoaded: false,
    contractLoaded: false,
    searchAttempts: 0,
    confident: false,
    topScore: 0,
    refundAttempted: false,
    updateAttempted: false,
    escalationCreated: false,
    hits: [],
    threshold: 0,
    retrievalReason: "Retrieval did not run.",
    provider: "local",
    expanded: false,
    refund: null,
    update: null,
    escalation: null,
    verifyError: null,
    identity: "none",
  };
  const ctx: ToolContext = { customer: null };

  opts.session.profileEmail = opts.profileEmail;
  opts.session.messages.push({
    id: crypto.randomUUID(),
    role: "user",
    content: opts.text,
    mode: opts.mode,
    createdAt: Date.now(),
  });
  opts.session.updatedAt = Date.now();

  const finish = (decision: Decision, content: string, extra?: Partial<TurnTrace>) => {
    const customer = ctx.customer ? toPublicCustomer(ctx.customer) : null;
    const trace = buildTrace({
      opts,
      started,
      state,
      steps: traceSteps,
      usage,
      notes,
      notice,
      planner,
      routing,
      decision,
      reason: extra?.guardrail?.reason ?? "",
      rewritten: extra?.guardrail?.rewritten ?? false,
      violations: extra?.guardrail?.violations ?? [],
      error: extra?.error,
    });
    rememberTrace(opts.session, trace);
    opts.session.messages.push({
      id: trace.id,
      role: "assistant",
      content,
      mode: opts.mode,
      createdAt: Date.now(),
      steps,
      decision,
    });
    emit("guardrail", trace.guardrail);
    emit("metrics", {
      e2eMs: trace.e2eMs,
      model: trace.model,
      planner: trace.planner,
      usage: trace.usage,
      costUsd: trace.costUsd,
    });
    emit("trace", trace);
    emit("done", { messageId: trace.id, decision, customer, notice: notice ?? null });
  };

  try {
    throwIfAborted(signal);
    if (opts.simulate === "rate_limit") {
      throw new AgentError(
        "RATE_LIMIT",
        "This session hit the simulated rate limit. Wait a moment, then send the message again.",
      );
    }

    emit("status", stepPayload("understand", "understand", "Understanding request…", "started"));
    const understandStarted = Date.now();
    if (liveModelEnabled() && !opts.simulate) {
      try {
        const routed = await routeTurn(opts.text, priorMessages, withTimeout(signal, ROUTER_TIMEOUT_MS));
        usage.promptTokens += routed.usage.promptTokens;
        usage.completionTokens += routed.usage.completionTokens;
        Object.assign(state, mergeRoute(classified, routed.route, opts.text, priorMessages));
        plan = routed.route.plan;
        planner = "llm";
        routing = {
          source: "llm",
          intent: routed.route.intent,
          rulesIntent: classified.intent,
          searchQuery: state.query,
          rationale: routed.route.rationale,
        };
        if (routed.route.intent !== classified.intent) {
          notes.push(`Router chose ${intentLabel(routed.route.intent)}. Keyword rules said ${intentLabel(classified.intent)}.`);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        notice = "The router model was unavailable, so keyword rules routed this turn.";
        emit("notice", { code: "DEGRADED", message: notice });
        notes.push(notice);
      }
    } else {
      await delay(toolPace, signal);
    }
    applyIdentityPolicy(state, opts.profileEmail, notes);
    const understood: StepEvent = {
      ...stepPayload("understand", "understand", "Understanding request…", "completed"),
      detail: intentLabel(state.intent),
      latencyMs: Date.now() - understandStarted,
    };
    steps.push(understood);
    emit("status", understood);

    if (plan.length) {
      const followed = await followProposal(plan, state, ctx, { opts, steps, traceSteps, usage, notes, toolPace });
      if (!followed) notes.push("The router's plan did not start with the next required tool, so the state machine took over.");
    }

    const beforeBackfill = traceSteps.length;
    await machineLoop(state, ctx, { opts, steps, traceSteps, usage, notes, toolPace });
    if (planner === "llm" && traceSteps.length > beforeBackfill) {
      planner = "llm+backfill";
      notes.push("Missing tools were backfilled in dependency order.");
    }

    if (opts.simulate === "timeout") {
      emit("status", stepPayload("generate", "generate", "Waiting on the model…", "started"));
      await delay(opts.timeoutMs ?? 2500, signal);
      throw new AgentError(
        "TIMEOUT",
        "The language model timed out. Nothing further was changed on the account.",
      );
    }

    const answerInput = toAnswerInput(state, ctx);
    const decided = refineDecision(state);
    const draft = composeAnswer({ ...answerInput, decision: decided.decision });
    emit("status", stepPayload("generate", "generate", "Composing reply…", "started"));

    let finalText = draft;
    let rewritten = false;
    let violations: string[] = [];

    if (liveModelEnabled() && !opts.simulate && state.intent !== "greeting" && state.intent !== "out_of_scope") {
      try {
        const facts = JSON.stringify(factPayload(answerInput));
        const modelUsage = await streamReply(
          opts.text,
          opts.mode,
          facts,
          draft,
          opts.session.messages.slice(-8, -1).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          (delta) => {
            streamed += delta;
            emit("token", { text: delta });
          },
          signal,
        );
        usage.promptTokens += modelUsage.promptTokens;
        usage.completionTokens += modelUsage.completionTokens;
        const checked = enforceGrounding(streamed, groundingFacts(answerInput, draft, `${facts}\n${opts.text}`));
        rewritten = checked.rewritten;
        violations = checked.violations;
        finalText = checked.text;
        if (rewritten) {
          notes.push(...violations);
          emit("replace", { text: finalText });
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        notice = "The language model failed while composing. This reply uses the verified tool results.";
        emit("notice", { code: "DEGRADED", message: notice });
        notes.push(notice);
        finalText = draft;
        if (streamed) emit("replace", { text: draft });
        else {
          streamed = await emitText(draft, emit, tokenPace, signal);
        }
      }
    } else {
      streamed = await emitText(draft, emit, tokenPace, signal);
      finalText = draft;
      usage.promptTokens += estimateTokens(`${systemPrompt()}\n${opts.text}`);
      usage.completionTokens += estimateTokens(finalText);
    }

    const composed: StepEvent = {
      ...stepPayload("generate", "generate", "Composing reply…", "completed"),
      detail: decided.decision,
    };
    steps.push(composed);
    emit("status", composed);

    finish(decided.decision, finalText, {
      guardrail: {
        decision: decided.decision,
        reason: decided.reason,
        confidence: state.topScore,
        threshold: state.threshold,
        rewritten,
        violations,
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      const partial = streamed || "Interrupted.";
      opts.session.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: partial,
        mode: opts.mode,
        createdAt: Date.now(),
        steps,
        interrupted: true,
      });
      emit("interrupted", { text: partial });
      emit("done", { messageId: null, decision: "error", customer: ctx.customer ? toPublicCustomer(ctx.customer) : null, notice: null });
      return;
    }
    const agentError = error instanceof AgentError ? error : new AgentError("UPSTREAM", "Something went wrong upstream.");
    emit("error", { code: agentError.code, message: agentError.message, recoverable: agentError.recoverable });
    const recovery =
      agentError.code === "TOOL_FAILURE"
        ? composeAnswer({ ...toAnswerInput(state, ctx), toolFailure: agentError.message, decision: "recover" })
        : agentError.message;
    try {
      streamed = await emitText(recovery, emit, tokenPace, signal);
    } catch {
      streamed = recovery;
    }
    notice = agentError.message;
    finish("error", streamed, {
      error: { code: agentError.code, message: agentError.message },
      guardrail: {
        decision: "error",
        reason: agentError.message,
        confidence: state.topScore,
        threshold: state.threshold,
        rewritten: false,
        violations: [],
      },
    });
  }
}

function mergeRoute(
  rules: ClassifiedIntent,
  route: RouteDecision,
  text: string,
  prior: { role: string; content: string }[],
): Partial<LoopState> {
  const lower = text.toLowerCase();
  const said = [lower, ...prior.filter((m) => m.role === "user").map((m) => m.content.toLowerCase())];
  const typed = (value: string | null) => Boolean(value && said.some((content) => content.includes(value.toLowerCase())));

  const field = route.intent === "account_update" ? route.field ?? rules.field : null;
  let value = route.intent === "account_update" && route.value && lower.includes(route.value.toLowerCase()) ? route.value : rules.value;
  if (field === "billingEmail" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) value = null;
  const email = route.email && route.email !== value?.toLowerCase() && typed(route.email) ? route.email : rules.email;

  return {
    intent: route.intent,
    email,
    amountUsd: route.intent === "refund" ? extractAmount(text) : null,
    field,
    value: field ? value : null,
    query: route.searchQuery,
  };
}

function applyIdentityPolicy(state: LoopState, profileEmail: string | null, notes: string[]): void {
  const profile = profileEmail?.toLowerCase() ?? null;
  const claimed = state.email?.toLowerCase() ?? null;
  if (!profile) {
    state.identity = claimed ? "claimed" : "none";
    return;
  }
  state.identity = "session";
  if (claimed && claimed !== profile) {
    notes.push(`Ignored ${claimed} because the caller is signed in as ${profile}.`);
    if (needsIdentity(state.intent)) {
      state.verifyFailed = true;
      state.verifyError = `You are signed in to a different Linden Mobile account, so I cannot look up or change ${claimed} from here. The owner of that account needs to contact us directly.`;
    }
  }
  state.email = profile;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function followProposal(
  calls: { name: string; args: Record<string, unknown> }[],
  state: LoopState,
  ctx: ToolContext,
  bag: RunBag,
): Promise<boolean> {
  let followed = false;
  for (const call of calls) {
    const expected = nextAction(state);
    if (!expected) break;
    if (!isTool(call.name) || call.name !== expected.tool) {
      bag.notes.push(
        `Blocked model tool “${call.name}”. The next legal tool is ${expected.tool}.`,
      );
      break;
    }
    await runOne(expected.tool, mergeArgs(expected.tool, expected.args, call.args, state), state, ctx, bag);
    followed = true;
  }
  return followed;
}

async function machineLoop(state: LoopState, ctx: ToolContext, bag: RunBag): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const action = nextAction(state);
    if (!action) return;
    await runOne(action.tool, action.args, state, ctx, bag);
  }
}

interface RunBag {
  opts: RunTurnOptions;
  steps: StepEvent[];
  traceSteps: TraceStep[];
  usage: Usage;
  notes: string[];
  toolPace: number;
}

async function runOne(
  tool: ToolName,
  args: Record<string, unknown>,
  state: LoopState,
  ctx: ToolContext,
  bag: RunBag,
): Promise<void> {
  const signal = bag.opts.signal;
  throwIfAborted(signal);
  const id = `${tool}-${bag.traceSteps.length + 1}`;
  const prepared = prepareArgs(tool, args, state);
  emitStatus(bag.opts.emit, {
    id,
    tool,
    label: toolLabel(tool),
    status: "started",
  });
  const started = Date.now();
  if ((bag.opts.simulate ?? null) === "tool_failure" && bag.traceSteps.length >= 2) {
    const failed: StepEvent = {
      id,
      tool,
      label: toolLabel(tool),
      status: "error",
      detail: "Simulated upstream failure",
      latencyMs: Date.now() - started,
    };
    bag.steps.push(failed);
    bag.opts.emit("status", failed);
    throw new AgentError("TOOL_FAILURE", `${toolLabel(tool).replace(/…$/, "")} failed with a simulated 503.`);
  }
  let output: ToolOutput;
  try {
    output = await executeTool(tool, prepared, ctx);
  } catch (error) {
    if (isAbortError(error)) throw error;
    const message = error instanceof Error ? error.message : "Tool crashed.";
    const failed: StepEvent = { id, tool, label: toolLabel(tool), status: "error", detail: message };
    bag.steps.push(failed);
    bag.opts.emit("status", failed);
    throw new AgentError("TOOL_FAILURE", message);
  }
  applyOutput(tool, prepared, output, state, ctx, bag.usage);
  const latencyMs = Date.now() - started;
  const decided = output.ok || tool === "issue_refund" || tool === "update_account";
  const done: StepEvent = {
    id,
    tool,
    label: toolLabel(tool),
    status: decided ? "completed" : "error",
    detail: output.summary,
    latencyMs,
  };
  bag.steps.push(done);
  bag.traceSteps.push({
    id,
    tool,
    label: toolLabel(tool),
    args: prepared,
    resultSummary: output.summary,
    ok: output.ok,
    latencyMs,
  });
  bag.opts.emit("status", done);
  await delay(bag.toolPace, signal);
}

function prepareArgs(tool: ToolName, args: Record<string, unknown>, state: LoopState): Record<string, unknown> {
  if (tool !== "search_knowledge") return args;
  const expanded = Boolean(args.expanded);
  const base = String(args.query ?? state.query);
  return {
    ...args,
    query: expanded ? expandQuery(base, state.intent) : base,
    access: state.intent === "troubleshoot" ? "strict" : "open",
  };
}

function mergeArgs(
  tool: ToolName,
  expected: Record<string, unknown>,
  proposed: Record<string, unknown>,
  state: LoopState,
): Record<string, unknown> {
  if (tool === "search_knowledge" && typeof proposed.query === "string" && proposed.query.trim().length > 8) {
    return { ...expected, query: proposed.query.trim() };
  }
  if (tool === "create_escalation" && typeof proposed.reason === "string" && proposed.reason.trim()) {
    return { ...expected, reason: proposed.reason.trim().slice(0, 240), confidence: state.topScore };
  }
  return expected;
}

function applyOutput(
  tool: ToolName,
  args: Record<string, unknown>,
  output: ToolOutput,
  state: LoopState,
  ctx: ToolContext,
  usage: Usage,
): void {
  if (tool === "verify_identity") {
    if (output.ok) {
      state.verified = true;
      ctx.customer = findCustomerByEmail(String(args.email ?? state.email ?? ""));
    } else {
      state.verifyFailed = true;
      state.verifyError = output.summary;
    }
    return;
  }
  if (tool === "get_subscription") {
    state.subscriptionLoaded = true;
    return;
  }
  if (tool === "get_contract") {
    state.contractLoaded = true;
    return;
  }
  if (tool === "search_knowledge") {
    const result = output.data as SearchResult;
    state.searchAttempts += 1;
    state.confident = result.confident;
    state.topScore = result.topScore;
    state.threshold = result.threshold;
    state.hits = result.hits;
    state.retrievalReason = result.reason;
    state.provider = result.provider;
    state.expanded = result.expandedQuery || state.expanded;
    usage.embeddingTokens += result.embeddingTokens;
    return;
  }
  if (tool === "issue_refund") {
    if (ctx.customer) state.refundAttempted = true;
    state.refund = (output.data as RefundDecision) ?? null;
    return;
  }
  if (tool === "update_account") {
    if (ctx.customer) state.updateAttempted = true;
    state.update = (output.data as AccountUpdate) ?? null;
    return;
  }
  if (tool === "create_escalation") {
    state.escalationCreated = true;
    state.escalation = (output.data as EscalationTicket) ?? null;
  }
}

function refineDecision(state: LoopState): { decision: Decision; reason: string } {
  const base = decisionFor(state, false);
  if (state.intent === "refund" && state.refund?.approved) {
    return { decision: "act", reason: state.refund.reason };
  }
  if (state.intent === "refund" && state.refund && !state.refund.approved) {
    return { decision: "answer", reason: state.refund.reason };
  }
  if (state.intent === "account_update" && state.update?.updated) {
    return { decision: "act", reason: "The account tool applied the change." };
  }
  if (state.intent === "account_update" && state.update && !state.update.updated) {
    return { decision: "answer", reason: state.update.reason };
  }
  return base;
}

function toAnswerInput(state: LoopState, ctx: ToolContext): AnswerInput {
  const customer: Customer | null = ctx.customer
    ? findCustomerByEmail(ctx.customer.email) ?? ctx.customer
    : null;
  return {
    intent: state.intent,
    query: state.query,
    identity: state.identity,
    customer,
    confident: state.confident,
    threshold: state.threshold,
    topScore: state.topScore,
    hits: state.confident ? state.hits : [],
    retrievalReason: state.retrievalReason,
    refund: state.refund,
    update: state.update,
    escalation: state.escalation,
    verifyError: state.verifyError,
    toolFailure: null,
    decision: "answer",
  };
}

function factPayload(input: AnswerInput) {
  return {
    intent: input.intent,
    customer: input.customer
      ? {
          name: input.customer.name,
          email: input.customer.email,
          tier: input.customer.tier,
          lines: input.customer.lines,
          monthlyPriceUsd: monthlyPrice(input.customer.tier, input.customer.lines),
          contract: input.customer.contractStatus,
          billingEmail: input.customer.billingEmail,
          lastCharge: input.customer.lastCharge,
          cardLast4: input.customer.cardLast4,
          refunds: input.customer.refunds,
        }
      : null,
    confident: input.confident,
    threshold: input.threshold,
    topScore: input.topScore,
    policy: input.hits.slice(0, 3).map((hit) => ({
      title: hit.title,
      section: hit.section,
      score: hit.score,
      text: hit.text,
    })),
    refund: input.refund,
    update: input.update,
    escalation: input.escalation,
    verifyError: input.verifyError,
  };
}

function buildTrace(input: {
  opts: RunTurnOptions;
  started: number;
  state: LoopState;
  steps: TraceStep[];
  usage: Usage;
  notes: string[];
  notice?: string;
  planner: TurnTrace["planner"];
  routing: RoutingTrace;
  decision: Decision;
  reason: string;
  rewritten: boolean;
  violations: string[];
  error?: { code: string; message: string };
}): TurnTrace {
  const ended = Date.now();
  const model = modelName();
  return {
    id: crypto.randomUUID(),
    sessionId: input.opts.session.id,
    mode: input.opts.mode,
    startedAt: input.started,
    endedAt: ended,
    e2eMs: ended - input.started,
    model,
    planner: input.planner,
    intent: input.state.intent,
    routing: input.routing,
    identity: input.state.identity,
    steps: input.steps,
    retrieval: input.state.searchAttempts
      ? {
          query: input.state.expanded ? expandQuery(input.state.query, input.state.intent) : input.state.query,
          threshold: input.state.threshold,
          topScore: input.state.topScore,
          confident: input.state.confident,
          provider: input.state.provider,
          expanded: input.state.expanded,
          hits: input.state.hits.map((hit) => ({
            id: hit.id,
            title: hit.title,
            section: hit.section,
            score: hit.score,
          })),
          decision: input.state.retrievalReason,
        }
      : null,
    guardrail: {
      decision: input.decision,
      reason: input.reason,
      confidence: input.state.topScore,
      threshold: input.state.threshold,
      rewritten: input.rewritten,
      violations: input.violations,
    },
    usage: input.usage,
    costUsd: estimateCost(model, input.usage),
    systemPrompt: systemPrompt(input.opts.mode),
    routerPrompt: input.routing.source === "llm" ? routerPrompt() : undefined,
    notes: input.notes,
    notice: input.notice,
    error: input.error,
  };
}

function stepPayload(
  id: string,
  tool: string,
  label: string,
  status: StepEvent["status"],
): StepEvent {
  return { id, tool, label, status };
}

function emitStatus(emit: RunTurnOptions["emit"], step: StepEvent): void {
  emit("status", step);
}

async function emitText(
  text: string,
  emit: RunTurnOptions["emit"],
  pace: number,
  signal?: AbortSignal,
): Promise<string> {
  const parts = text.split(/(\s+)/);
  let bucket = "";
  for (let i = 0; i < parts.length; i++) {
    bucket += parts[i];
    if (bucket.length >= 24 || i === parts.length - 1) {
      throwIfAborted(signal);
      emit("token", { text: bucket });
      bucket = "";
      await delay(pace, signal);
    }
  }
  return text;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
}

function isTool(name: string): name is ToolName {
  return TOOLS.has(name as ToolName);
}
