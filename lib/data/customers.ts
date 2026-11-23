import type { Customer, PublicCustomer, Tier } from "../types";

const PER_LINE: Record<Tier, number> = {
  prepaid: 30,
  plus: 65,
  business: 45,
};

export function monthlyPrice(tier: Tier, lines = 1): number {
  return PER_LINE[tier] * lines;
}

export function tierName(tier: Tier): string {
  return tier === "business" ? "Business" : tier === "plus" ? "Plus" : "Prepaid";
}

export function contractName(status: Customer["contractStatus"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "past_due":
      return "Past due";
    case "suspended":
      return "Suspended";
    case "cancelled":
      return "Cancelled";
  }
}

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function seedCustomers(): Customer[] {
  return [
    {
      id: "cus_avery",
      email: "avery.chen@example.com",
      name: "Avery Chen",
      tier: "plus",
      contractStatus: "active",
      renewsOn: isoDay(18),
      pastDueUsd: 0,
      lastCharge: {
        amountUsd: 35,
        description: "Travel Pass — Mexico, 7 days",
        chargedOn: isoDay(-4),
      },
      billingEmail: "avery.chen@example.com",
      cardLast4: "4242",
      phone: "(415) 555-0142",
      lines: 1,
      refunds: [],
    },
    {
      id: "cus_jordan",
      email: "jordan.blake@example.com",
      name: "Jordan Blake",
      tier: "business",
      contractStatus: "active",
      renewsOn: isoDay(40),
      pastDueUsd: 0,
      lastCharge: {
        amountUsd: 225,
        description: "Linden Business — 5 lines, monthly",
        chargedOn: isoDay(-10),
      },
      billingEmail: "ap@blakestudio.example",
      cardLast4: "1881",
      phone: "(312) 555-0187",
      lines: 5,
      refunds: [],
    },
    {
      id: "cus_sam",
      email: "sam.okonkwo@example.com",
      name: "Sam Okonkwo",
      tier: "prepaid",
      contractStatus: "active",
      renewsOn: isoDay(18),
      pastDueUsd: 0,
      lastCharge: {
        amountUsd: 30,
        description: "Prepaid refill — 30 days",
        chargedOn: isoDay(-12),
      },
      billingEmail: "sam.okonkwo@example.com",
      cardLast4: "7714",
      phone: "(646) 555-0119",
      lines: 1,
      refunds: [],
    },
    {
      id: "cus_riley",
      email: "riley.shah@example.com",
      name: "Riley Shah",
      tier: "plus",
      contractStatus: "past_due",
      renewsOn: isoDay(-6),
      pastDueUsd: 65,
      lastCharge: {
        amountUsd: 65,
        description: "Linden Plus — monthly",
        chargedOn: isoDay(-3),
      },
      billingEmail: "riley.shah@example.com",
      cardLast4: "9090",
      phone: "(206) 555-0163",
      lines: 1,
      refunds: [],
    },
  ];
}

type StoreGlobal = typeof globalThis & {
  __lindenCustomers?: Customer[];
  __lindenRefundSeq?: number;
  __lindenTicketSeq?: number;
};

function g(): StoreGlobal {
  return globalThis as StoreGlobal;
}

export function customers(): Customer[] {
  const existing = g().__lindenCustomers;
  if (existing) return existing;
  const seeded = seedCustomers();
  g().__lindenCustomers = seeded;
  return seeded;
}

export function resetDemoData(): void {
  g().__lindenCustomers = seedCustomers();
  g().__lindenRefundSeq = 1000;
  g().__lindenTicketSeq = 2400;
}

export function nextRefundId(): string {
  const n = (g().__lindenRefundSeq ?? 1000) + 1;
  g().__lindenRefundSeq = n;
  return `RFD-${n}`;
}

export function nextTicketId(): string {
  const n = (g().__lindenTicketSeq ?? 2400) + 1;
  g().__lindenTicketSeq = n;
  return `ESC-${n}`;
}

export function findCustomerByEmail(email: string | null | undefined): Customer | null {
  if (!email) return null;
  const needle = email.trim().toLowerCase();
  return customers().find((c) => c.email.toLowerCase() === needle) ?? null;
}

export function findCustomerById(id: string): Customer | null {
  return customers().find((c) => c.id === id) ?? null;
}

export function toPublicCustomer(customer: Customer): PublicCustomer {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    tier: customer.tier,
    contractStatus: customer.contractStatus,
    renewsOn: customer.renewsOn,
    pastDueUsd: customer.pastDueUsd,
    lastCharge: customer.lastCharge,
    billingEmail: customer.billingEmail,
    cardLast4: customer.cardLast4,
    phone: customer.phone,
    lines: customer.lines,
    refunds: customer.refunds.map((r) => ({ ...r })),
  };
}

export function listPublicCustomers(): PublicCustomer[] {
  return customers().map(toPublicCustomer);
}
