import type { Intent } from "../types";

const EXPANSIONS: Array<{ test: RegExp; extra: string }> = [
  { test: /refund|money|reimburse|charge/, extra: "refund eligibility window last charge plus business prepaid" },
  { test: /service|signal|sos|bars|tower/, extra: "no service sos airplane mode restart outage map" },
  { test: /outage|down|area/, extra: "outage map restore time outage credit" },
  { test: /sla|response|credit|p1|severity/, extra: "severity first response outage credit service level" },
  { test: /call|wi-?fi/, extra: "dropped calls wifi calling coverage" },
  { test: /data|internet|apn|slow/, extra: "mobile data access point carrier settings priority data" },
  { test: /esim|sim|new phone|transfer/, extra: "esim activation transfer qr code" },
  { test: /roam|travel|abroad|international|mexico|canada/, extra: "travel pass roaming international days" },
  { test: /cost|price|pric(e|ing)|how much|per month|monthly|fee/, extra: "plan prices monthly charges per line prepaid plus business" },
  { test: /billing|bill|invoice|email|autopay/, extra: "billing email autopay payment past due" },
  { test: /cancel|port|leave/, extra: "porting out cancellation escalation teammate" },
];

export function expandQuery(query: string, intent: Intent): string {
  const extras = new Set<string>();
  const haystack = `${intent} ${query}`.toLowerCase();
  for (const rule of EXPANSIONS) {
    if (rule.test.test(haystack)) extras.add(rule.extra);
  }
  if (!extras.size) return query;
  return `${query} ${[...extras].join(" ")}`.trim();
}
