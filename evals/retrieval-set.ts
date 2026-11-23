import type { Tier } from "../lib/types";

export interface RetrievalCase {
  query: string;
  tier: Tier | null;
  access?: "open" | "strict";
  /** `Title · Section` of the chunk that answers the query, or null when nothing should. */
  expect: string | null;
}

const BILLING = "Billing and payments";
const REFUNDS = "Refund policy";
const SLA = "Service levels (SLA)";
const FIX = "Troubleshooting guides";
const TRAVEL = "Travel and roaming";
const ACCOUNT = "Account changes";
const SECURITY = "Security intake";

export const RETRIEVAL_SET: RetrievalCase[] = [
  { query: "What does the Plus plan cost?", tier: null, expect: `${BILLING} · Plan prices and monthly charges` },
  { query: "how much is a business line per month", tier: "business", expect: `${BILLING} · Plan prices and monthly charges` },
  { query: "Can I change where my bill gets emailed?", tier: "plus", expect: `${BILLING} · Billing email` },
  { query: "My autopay failed, what happens to my lines?", tier: "plus", expect: `${BILLING} · Late payments and suspension` },
  { query: "Can I get my money back for a travel pass I didn't use?", tier: "plus", expect: `${REFUNDS} · Plus plan` },
  { query: "refund window for business accounts", tier: "business", expect: `${REFUNDS} · Business plan` },
  { query: "Are prepaid refills refundable?", tier: "prepaid", expect: `${REFUNDS} · Prepaid refills` },
  { query: "I'm past due, can I still get a refund?", tier: "plus", expect: `${REFUNDS} · Blocked accounts` },
  { query: "How long until a refund shows up on my card?", tier: "plus", expect: `${REFUNDS} · Refund timing and exclusions` },
  { query: "What's the Business SLA during an outage?", tier: "plus", expect: `${SLA} · Business SLA` },
  { query: "do I get an outage credit on my plan", tier: "plus", expect: `${SLA} · Plus SLA` },
  { query: "Do prepaid customers get anything when the network is down for days?", tier: "prepaid", expect: `${SLA} · Prepaid SLA` },
  { query: "what does P2 severity mean", tier: null, expect: `${SLA} · Severity definitions` },
  { query: "My phone shows SOS only", tier: "plus", access: "strict", expect: `${FIX} · No service or SOS only` },
  { query: "no bars since this morning", tier: "prepaid", access: "strict", expect: `${FIX} · No service or SOS only` },
  { query: "calls keep dropping inside my office", tier: "business", access: "strict", expect: `${FIX} · Dropped calls and Wi-Fi Calling` },
  { query: "how do I turn on wifi calling", tier: "plus", access: "strict", expect: `${FIX} · Dropped calls and Wi-Fi Calling` },
  { query: "my mobile data stopped working", tier: "plus", access: "strict", expect: `${FIX} · Mobile data not working` },
  { query: "internet is really slow on my prepaid line", tier: "prepaid", access: "strict", expect: `${FIX} · Mobile data not working` },
  { query: "move my eSIM to a new iPhone", tier: "plus", access: "strict", expect: `${FIX} · eSIM activation and transfer` },
  { query: "is there a network outage in my area", tier: "plus", expect: `${FIX} · Outage checks` },
  { query: "Does my plan work in Mexico?", tier: "plus", expect: `${TRAVEL} · Plus travel` },
  { query: "roaming in Europe for my team", tier: "business", expect: `${TRAVEL} · Business travel` },
  { query: "can I use my prepaid phone in Canada", tier: "prepaid", expect: `${TRAVEL} · Prepaid travel` },
  { query: "how much is a travel pass", tier: "plus", expect: `${TRAVEL} · Plus travel` },
  { query: "I want to change the name on my account", tier: "plus", expect: `${ACCOUNT} · Profile updates` },
  { query: "Will you ever ask for my PIN?", tier: null, expect: `${ACCOUNT} · What support will never ask` },
  { query: "I want to switch to another carrier and keep my number", tier: "plus", expect: `${ACCOUNT} · Porting out and cancellation` },
  { query: "my phone suddenly lost service and I think someone took my number", tier: "plus", expect: `${SECURITY} · SIM swap and account takeover` },
  { query: "what kinds of questions can Linden Care help with", tier: null, expect: `${SECURITY} · Scope of Linden Care` },

  { query: "Do you integrate with the municipal water department?", tier: "plus", expect: null },
  { query: "What's the best pizza in Brooklyn?", tier: "plus", expect: null },
  { query: "Can I trade in my old laptop for store credit?", tier: "plus", expect: null },
  { query: "What's the weather in Chicago tomorrow?", tier: null, expect: null },
  { query: "Do you sell home fiber broadband?", tier: null, expect: null },
  { query: "who won the game last night", tier: null, expect: null },
];
