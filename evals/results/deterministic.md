# Eval report: deterministic (no model key)

Generated 2026-11-22T17:00:22.472Z. Run with `npm run eval`.

## Retrieval

30 answerable queries and 6 that no policy covers. Scores are for the first search pass, before query expansion.

| Mode | Hit@1 | Hit@3 | MRR | Correct and confident | Unanswerable rejected |
| --- | --- | --- | --- | --- | --- |
| vector | 60.0% | 90.0% | 0.747 | 50.0% | 100.0% |
| keyword | 76.7% | 96.7% | 0.869 | 73.3% | 100.0% |
| hybrid (active) | 73.3% | 96.7% | 0.842 | 73.3% | 100.0% |

Threshold sweep for hybrid (current 0.26 unless overridden):

| Threshold | Correct top hit and confident | Wrong top hit but confident | Unanswerable rejected |
| --- | --- | --- | --- |
| 0.10 | 22/30 | 8 | 4/6 |
| 0.12 | 22/30 | 8 | 4/6 |
| 0.14 | 22/30 | 8 | 4/6 |
| 0.16 | 22/30 | 8 | 4/6 |
| 0.18 | 22/30 | 7 | 4/6 |
| 0.20 | 22/30 | 6 | 5/6 |
| 0.22 | 22/30 | 6 | 5/6 |
| 0.24 | 22/30 | 6 | 6/6 |
| 0.26 | 22/30 | 5 | 6/6 |
| 0.28 | 22/30 | 4 | 6/6 |
| 0.30 | 18/30 | 4 | 6/6 |
| 0.32 | 15/30 | 2 | 6/6 |
| 0.34 | 15/30 | 2 | 6/6 |
| 0.36 | 11/30 | 2 | 6/6 |
| 0.38 | 8/30 | 1 | 6/6 |
| 0.40 | 6/30 | 1 | 6/6 |

Active mode, hybrid:

| Metric | Value |
| --- | --- |
| Hit@1 | 73.3% (22/30) |
| Hit@3 | 96.7% (29/30) |
| MRR | 0.842 |
| Correct and confident | 73.3% |
| Unanswerable rejected by the threshold | 100.0% (6/6) |

Misses:

- "What does the Plus plan cost?": want Billing and payments · Plan prices and monthly charges, got Travel and roaming · Plus travel (0.31, confident)
- "how much is a business line per month": want Billing and payments · Plan prices and monthly charges, got Travel and roaming · Business travel (0.44, confident)
- "Can I get my money back for a travel pass I didn't use?": want Refund policy · Plus plan, got Travel and roaming · Plus travel (0.37, confident)
- "How long until a refund shows up on my card?": want Refund policy · Refund timing and exclusions, got Refund policy · How a refund is confirmed (0.26, confident)
- "do I get an outage credit on my plan": want Service levels (SLA) · Plus SLA, got Troubleshooting guides · Outage checks (0.30, confident)
- "no bars since this morning": want Troubleshooting guides · No service or SOS only, got Service levels (SLA) · Prepaid SLA (0.18)
- "Does my plan work in Mexico?": want Travel and roaming · Plus travel, got Troubleshooting guides · Mobile data not working (0.25)
- "roaming in Europe for my team": want Travel and roaming · Business travel, got Travel and roaming · Prepaid travel (0.19)

## End to end

19/24 cases pass (79.2%). Safety cases: 6/6.

| Check | Pass rate |
| --- | --- |
| intent | 89.5% (17/19) |
| tools | 66.7% (2/3) |
| retrieval | 71.4% (5/7) |
| decision | 100.0% (14/14) |
| reply | 82.6% (19/23) |
| sideEffects | 88.9% (8/9) |

Latency p50 0 ms, p95 1 ms. Estimated cost $0.0000 total, $0.00000 per turn.

The grounding check replaced 0 of 24 model replies with the tool-grounded draft.

Failures:

- `plan-cost-general`: reply: missing /\$65/
- `followup-travel-cost`: retrieval: not in the top 3 given to the model: Billing and payments · Plan prices and monthly charges | Travel and roaming · Business travel | Refund policy · Business plan; reply: missing /\$35/
- `followup-refund-timing`: retrieval: not in the top 3 given to the model: Troubleshooting guides · No service or SOS only | Account changes · What support will never ask | Billing and payments · Late payments and suspension; reply: missing /5 to 10 business days/
- `paraphrase-no-signal`: intent: got policy_question, want troubleshoot
- `paraphrase-money-back`: intent: got policy_question, want refund; tools: got [verify_identity, get_subscription, search_knowledge, search_knowledge]; reply: missing /RFD-\d+/; sideEffects: refunds 0, want 1
