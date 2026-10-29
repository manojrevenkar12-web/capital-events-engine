import type { CapitalEvent, Line } from "../../lib/types";

export const KIND_LABEL: Record<CapitalEvent["kind"], string> = {
  call: "Capital call",
  distribution: "Distribution",
  equalisation: "Subsequent closing",
};

/** The lifecycle every event follows; a cancelled event leaves it. */
export const STEPS = [
  { status: "draft", label: "Drafted" },
  { status: "calculated", label: "Calculated" },
  { status: "approved", label: "Approved by a second person" },
  { status: "issued", label: "Notices issued" },
  { status: "settled", label: "Settled" },
] as const;

export const stepIndex = (s: CapitalEvent["status"]) => STEPS.findIndex((x) => x.status === s);

type CallInput = { components?: Array<{ kind: string; deal?: string; description?: string; periodStart?: string; periodEnd?: string }> };

/** Column headings for an event's lines, from what the event was created with. */
export const columnsFor = (ev: CapitalEvent, lines: Line[]): Array<{ label: string; value: (l: Line) => string }> => {
  if (ev.kind === "distribution") {
    return [
      { label: "Return of capital", value: (l) => l.detail.roc ?? "0" },
      { label: "Preferred return", value: (l) => l.detail.pref ?? "0" },
      { label: "Profit share", value: (l) => l.detail.lp_split ?? "0" },
    ];
  }
  if (ev.kind === "equalisation") {
    const kinds = (() => {
      try {
        return JSON.parse(lines[0]?.detail.kinds ?? "[]") as string[];
      } catch {
        return [];
      }
    })();
    const named = kinds.map((k, i) => ({
      label: k === "fee" ? "Fee catch-up" : k === "expense" ? "Expenses" : "Capital",
      value: (l: Line) => l.components[i] ?? "0",
    }));
    return [...named, { label: "Interest", value: (l) => l.detail.interest_paid ?? "0" }];
  }
  const comps = (ev.input as CallInput).components ?? [];
  return comps.map((c, i) => ({
    label: c.kind === "investment" ? (c.deal ?? "Investment") : c.kind === "fee" ? "Management fee" : (c.description ?? "Expenses"),
    value: (l: Line) => l.components[i] ?? "0",
  }));
};

/** Calls and closings collect money; distributions pay it out; a negative closing line is a refund. */
export const flowOf = (ev: CapitalEvent, cents: string): "in" | "out" | undefined => {
  if (cents === "0") return undefined;
  if (ev.kind === "distribution") return "out";
  return cents.startsWith("-") ? "out" : "in";
};
