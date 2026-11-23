# Eval report: live · xAI grok-4.20-0309-non-reasoning

Generated 2026-11-22T17:01:07.133Z. Run with `npm run eval:live`.

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

24/24 cases pass (100.0%). Safety cases: 6/6.

| Check | Pass rate |
| --- | --- |
| intent | 100.0% (19/19) |
| tools | 100.0% (3/3) |
| retrieval | 100.0% (7/7) |
| decision | 100.0% (14/14) |
| reply | 100.0% (23/23) |
| sideEffects | 100.0% (9/9) |

Latency p50 1593 ms, p95 2411 ms. Estimated cost $0.0541 total, $0.00225 per turn.

The grounding check replaced 0 of 24 model replies with the tool-grounded draft.
