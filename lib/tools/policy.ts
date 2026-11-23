import { tierName } from "../data/customers";
import type { Customer, RefundDecision } from "../types";

export function daysSince(isoDay: string, now = new Date()): number {
  const [year, month, day] = isoDay.split("-").map(Number);
  const then = new Date(year, (month || 1) - 1, day || 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
}

export function refundWindow(tier: Customer["tier"]): { days: number; capUsd: number } | null {
  if (tier === "plus") return { days: 14, capUsd: 75 };
  if (tier === "business") return { days: 30, capUsd: 500 };
  return null;
}

export function evaluateRefund(customer: Customer, requested: number | null): RefundDecision {
  const window = refundWindow(customer.tier);
  const capUsd = window?.capUsd ?? 0;
  const windowDays = window?.days ?? 0;
  const section =
    customer.tier === "business"
      ? "Business plan"
      : customer.tier === "plus"
        ? "Plus plan"
        : "Prepaid refills";

  const deny = (reason: string): RefundDecision => ({
    approved: false,
    amountUsd: 0,
    reason,
    policySection: section,
    capUsd,
    windowDays,
  });

  if (customer.refunds.length > 0) {
    return deny(
      `A refund (${customer.refunds[0].id}) was already issued for ${customer.lastCharge.description}. The policy allows one refund per charge.`,
    );
  }
  if (customer.contractStatus !== "active") {
    return deny(
      `The contract is ${customer.contractStatus.replace("_", " ")}. Refunds require an active contract.`,
    );
  }
  if (!window) {
    return deny("Prepaid refills are not refundable once the 30-day period has started.");
  }
  if (customer.lastCharge.amountUsd <= 0) {
    return deny("The last charge is $0, so there is nothing to return.");
  }
  const age = daysSince(customer.lastCharge.chargedOn);
  if (age > window.days) {
    return deny(
      `The last charge posted ${age} days ago, outside the ${window.days}-day ${tierName(customer.tier)} window.`,
    );
  }
  if (customer.lastCharge.amountUsd > window.capUsd) {
    return deny(
      `The last charge of $${customer.lastCharge.amountUsd.toFixed(2)} is above the $${window.capUsd} self-serve cap.`,
    );
  }
  const amount = requested ?? customer.lastCharge.amountUsd;
  if (amount > customer.lastCharge.amountUsd) {
    return deny(
      `A request of $${amount.toFixed(2)} is above the last charge of $${customer.lastCharge.amountUsd.toFixed(2)}. The policy does not refund more than the charge.`,
    );
  }
  if (amount > window.capUsd) {
    return deny(`$${amount.toFixed(2)} is above the $${window.capUsd} ${tierName(customer.tier)} cap.`);
  }
  if (amount <= 0) return deny("The refund amount must be greater than zero.");

  return {
    approved: true,
    amountUsd: roundMoney(amount),
    reason: `The charge is inside the ${tierName(customer.tier)} plan's ${window.days}-day window and $${window.capUsd} cap.`,
    policySection: section,
    capUsd,
    windowDays,
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
