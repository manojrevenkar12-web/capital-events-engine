import { Counter, collectDefaultMetrics, Histogram, Registry } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpDuration = new Histogram({
  name: "cee_http_request_duration_seconds",
  help: "HTTP request duration by route and status",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const eventsIssued = new Counter({
  name: "cee_capital_events_issued_total",
  help: "Capital events issued, by kind",
  labelNames: ["kind"],
  registers: [registry],
});

export const bankEntries = new Counter({
  name: "cee_bank_entries_total",
  help: "Bank credits imported, by reconciliation outcome",
  labelNames: ["status"],
  registers: [registry],
});
