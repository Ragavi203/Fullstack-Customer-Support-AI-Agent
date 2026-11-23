"use client";

import { contractName, monthlyPrice, tierName } from "@/lib/data/customers";
import type { PublicCustomer, SimulateFault } from "@/lib/types";
import { initials, shortDate, usd } from "./format";
import type { HealthInfo } from "./useAgentStream";

export const CALLERS: Array<{ email: string | null; name: string }> = [
  { email: "avery.chen@example.com", name: "Avery Chen" },
  { email: "jordan.blake@example.com", name: "Jordan Blake" },
  { email: "sam.okonkwo@example.com", name: "Sam Okonkwo" },
  { email: "riley.shah@example.com", name: "Riley Shah" },
  { email: null, name: "Unverified caller" },
];

interface CallerPanelProps {
  customers: PublicCustomer[];
  selected: string | null;
  onSelect: (email: string | null) => void;
  fault: SimulateFault;
  onFault: (fault: SimulateFault) => void;
  onReset: () => void;
  health: HealthInfo | null;
  sessionId: string | null;
}

export function CallerPanel({
  customers,
  selected,
  onSelect,
  fault,
  onFault,
  onReset,
  health,
  sessionId,
}: CallerPanelProps) {
  const active = customers.find((customer) => customer.email === selected) ?? null;

  return (
    <aside className="sidebar">
      <section className="side-section">
        <h2 className="section-label">Caller</h2>
        <select
          className="input caller-select"
          value={selected ?? ""}
          onChange={(event) => onSelect(event.target.value || null)}
          aria-label="Caller"
        >
          {CALLERS.map((caller) => (
            <option key={caller.name} value={caller.email ?? ""}>
              {caller.name}
            </option>
          ))}
        </select>
        <ul className="caller-list">
          {CALLERS.map((caller) => {
            const live = customers.find((customer) => customer.email === caller.email);
            const isActive = caller.email === selected;
            return (
              <li key={caller.name}>
                <button
                  type="button"
                  className={`caller ${isActive ? "is-active" : ""}`}
                  onClick={() => onSelect(caller.email)}
                  aria-pressed={isActive}
                >
                  <span className={`avatar ${caller.email ? "" : "is-empty"}`}>
                    {caller.email ? initials(caller.name) : "?"}
                  </span>
                  <span className="caller-text">
                    <span className="caller-name">{live?.name ?? caller.name}</span>
                    <span className="caller-sub">{live?.phone ?? (caller.email ? "" : "No account on file")}</span>
                  </span>
                  {live && <span className={`tier tier-${live.tier}`}>{tierName(live.tier)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="side-section">
        <h2 className="section-label">Account</h2>
        {active ? (
          <dl className="facts">
            <div>
              <dt>Plan</dt>
              <dd>
                {tierName(active.tier)}{" "}
                <span className="muted">
                  · {active.lines === 1 ? "1 line" : `${active.lines} lines`} · {usd(monthlyPrice(active.tier, active.lines))}/mo
                </span>
              </dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>
                <span className={`status status-${active.contractStatus}`}>{contractName(active.contractStatus)}</span>
              </dd>
            </div>
            <div>
              <dt>Last charge</dt>
              <dd>
                {usd(active.lastCharge.amountUsd)} <span className="muted">· {shortDate(active.lastCharge.chargedOn)}</span>
                <span className="fact-sub">{active.lastCharge.description}</span>
              </dd>
            </div>
            {active.pastDueUsd > 0 && (
              <div>
                <dt>Past due</dt>
                <dd className="text-tomato">{usd(active.pastDueUsd)}</dd>
              </div>
            )}
            <div>
              <dt>Billing email</dt>
              <dd className="wrap-anywhere">{active.billingEmail}</dd>
            </div>
            <div>
              <dt>Autopay</dt>
              <dd>{active.cardLast4 ? `Visa ending ${active.cardLast4}` : "—"}</dd>
            </div>
            <div>
              <dt>Refunds</dt>
              <dd>
                {active.refunds.length ? (
                  <>
                    <span className="mono">{active.refunds[0].id}</span>{" "}
                    <span className="muted">· {usd(active.refunds[0].amountUsd)}</span>
                  </>
                ) : (
                  <span className="muted">None</span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="side-note">No account on this call. Linden Care asks for the account email before any account tool runs.</p>
        )}
      </section>

      <section className="side-section">
        <h2 className="section-label">Testing</h2>
        <div className="testing-row">
          <select
            className="input"
            aria-label="Fault injection"
            value={fault ?? ""}
            onChange={(event) => onFault((event.target.value || null) as SimulateFault)}
          >
            <option value="">No fault injected</option>
            <option value="timeout">Model timeout</option>
            <option value="rate_limit">Rate limit</option>
            <option value="tool_failure">Tool failure mid-chain</option>
          </select>
          <button type="button" className="btn" onClick={onReset} title="Reset demo data">
            Reset
          </button>
        </div>
      </section>

      <footer className="side-footer">
        <span>
          {health ? `${health.chunks} policy chunks · ${health.provider === "openai" ? "OpenAI" : "local"} embeddings` : "Indexing policies…"}
        </span>
        {sessionId && <span className="mono">Session {sessionId.slice(0, 8)}</span>}
      </footer>
    </aside>
  );
}
