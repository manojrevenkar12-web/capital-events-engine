import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Button, EmptyState } from "../../components/ui";
import { api, can, problemText } from "../../lib/api";
import { formatCents, parseEuros } from "../../lib/money";
import { keys } from "../../lib/queries";
import type { CapitalEvent } from "../../lib/types";
import { DURATION, EASE_OUT } from "../../theme/motion";
import "./events.css";

const route = getRouteApi("/app/funds/$fundId/events/new");

type Draft =
  | { key: string; kind: "investment"; deal: string; sectors: string; amount: string }
  | { key: string; kind: "fee"; periodStart: string; periodEnd: string }
  | { key: string; kind: "expense"; description: string; amount: string };

const SECTOR_HINT = "fossil_fuels, tobacco, gambling, weapons, software";
const TITLES = { investment: "Investment", fee: "Management fee", expense: "Fund expenses" } as const;
const today = () => new Date().toISOString().slice(0, 10);

const blank = (kind: Draft["kind"]): Draft => {
  const key = crypto.randomUUID();
  if (kind === "investment") return { key, kind, deal: "", sectors: "", amount: "" };
  if (kind === "fee") return { key, kind, periodStart: "", periodEnd: "" };
  return { key, kind, description: "Fund expenses", amount: "" };
};

/** Turns the form into the API's request, or says what is missing. */
const toRequest = (reference: string, issueDate: string, parts: Draft[]) => {
  const problems: string[] = [];
  if (!/^[A-Z0-9][A-Z0-9-]{2,24}$/.test(reference))
    problems.push("The reference uses capitals, digits and dashes, 3 to 25 characters, for example CALL-2026-05.");
  if (!issueDate) problems.push("Choose an issue date.");
  const components = parts.map((p) => {
    if (p.kind === "fee") {
      if (!p.periodStart || !p.periodEnd || p.periodEnd <= p.periodStart)
        problems.push("A management fee needs a period whose end is after its start.");
      return { kind: "fee", periodStart: p.periodStart, periodEnd: p.periodEnd };
    }
    const amount = parseEuros(p.amount);
    if (!amount) problems.push(`${p.kind === "investment" ? p.deal || "An investment" : "Fund expenses"} needs an amount in euros.`);
    if (p.kind === "investment") {
      if (!p.deal.trim()) problems.push("Name the investment the capital is for.");
      const sectors = p.sectors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { kind: "investment", deal: p.deal.trim(), sectors, amount: amount ?? "0" };
    }
    return { kind: "expense", description: p.description.trim() || "Fund expenses", amount: amount ?? "0" };
  });
  if (!parts.length) problems.push("Add at least one component.");
  return { problems, body: { reference, issueDate, components } };
};

export const NewCall = () => {
  const { fundId } = route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reference, setReference] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [parts, setParts] = useState<Draft[]>([blank("investment")]);
  const [tried, setTried] = useState(false);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const { problems, body } = toRequest(reference, issueDate, parts);
  const create = useMutation({
    mutationFn: async () => {
      const ev = await api.post<CapitalEvent>(`/v1/funds/${fundId}/calls`, body, idempotencyKey);
      return api.post<CapitalEvent>(`/v1/events/${ev.id}/calculate`, {}, `${idempotencyKey}:calc`).catch(() => ev);
    },
    onSuccess: (ev) => {
      void qc.invalidateQueries({ queryKey: keys.events(fundId) });
      void navigate({ to: "/events/$eventId", params: { eventId: ev.id } });
    },
  });
  const update = (key: string, patch: Partial<Draft>) =>
    setParts((ps) => ps.map((p) => (p.key === key ? ({ ...p, ...patch } as Draft) : p)));
  const total = parts.reduce((s, p) => s + BigInt(p.kind === "fee" ? "0" : (parseEuros(p.amount) ?? "0")), 0n);

  if (!can("preparer"))
    return (
      <EmptyState
        title="Only preparers create capital calls"
        action={
          <Link to="/funds/$fundId/events" params={{ fundId }}>
            Back to capital events
          </Link>
        }
      >
        Sign in as a preparer to draft a call. Approvers check and approve the calculated result.
      </EmptyState>
    );

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>New capital call</h1>
          <p>
            The call is split across investors by commitment, with excuse rights, fee discounts and notice periods from their approved
            side-letter terms. You will see the result before anyone approves it.
          </p>
        </div>
      </header>
      <form
        className="call-form"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!problems.length) create.mutate();
        }}
      >
        <div className="call-form__top">
          <label className="field">
            Reference
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
              placeholder="CALL-2026-05"
              autoComplete="off"
            />
          </label>
          <label className="field">
            Issue date <span className="field-hint">Due dates follow from each investor's notice period in TARGET2 business days.</span>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </label>
        </div>

        <AnimatePresence initial={false}>
          {parts.map((p) => (
            <motion.fieldset
              key={p.key}
              className="component panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
              style={{ overflow: "hidden", border: undefined }}
            >
              <div className="component__head">
                <h3>{TITLES[p.kind]}</h3>
                <Button
                  tone="quiet"
                  onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}
                  aria-label={`Remove ${TITLES[p.kind]}`}
                >
                  Remove
                </Button>
              </div>
              <div className="component__fields">
                {p.kind === "investment" ? (
                  <>
                    <label className="field">
                      Deal
                      <input value={p.deal} onChange={(e) => update(p.key, { deal: e.target.value })} placeholder="Brandenburg Robotics" />
                    </label>
                    <label className="field">
                      Amount in euros
                      <input
                        inputMode="decimal"
                        value={p.amount}
                        onChange={(e) => update(p.key, { amount: e.target.value })}
                        placeholder="12,500,000"
                      />
                    </label>
                    <label className="field">
                      Sectors <span className="field-hint">Investors excused from a sector do not take part. {SECTOR_HINT}</span>
                      <input value={p.sectors} onChange={(e) => update(p.key, { sectors: e.target.value })} placeholder="software" />
                    </label>
                  </>
                ) : p.kind === "fee" ? (
                  <>
                    <label className="field">
                      Period starts
                      <input type="date" value={p.periodStart} onChange={(e) => update(p.key, { periodStart: e.target.value })} />
                    </label>
                    <label className="field">
                      Period ends
                      <input type="date" value={p.periodEnd} onChange={(e) => update(p.key, { periodEnd: e.target.value })} />
                    </label>
                    <p className="field-hint">
                      Fees are charged on commitments during the investment period and on invested capital after it, ACT/365.
                    </p>
                  </>
                ) : (
                  <>
                    <label className="field">
                      Description
                      <input value={p.description} onChange={(e) => update(p.key, { description: e.target.value })} />
                    </label>
                    <label className="field">
                      Amount in euros
                      <input
                        inputMode="decimal"
                        value={p.amount}
                        onChange={(e) => update(p.key, { amount: e.target.value })}
                        placeholder="85,000"
                      />
                    </label>
                  </>
                )}
              </div>
            </motion.fieldset>
          ))}
        </AnimatePresence>

        <div className="call-form__add">
          <Button onClick={() => setParts((ps) => [...ps, blank("investment")])}>Add an investment</Button>
          <Button onClick={() => setParts((ps) => [...ps, blank("fee")])}>Add a management fee</Button>
          <Button onClick={() => setParts((ps) => [...ps, blank("expense")])}>Add fund expenses</Button>
        </div>

        {tried && problems.length ? (
          <ul className="form-error" role="alert">
            {[...new Set(problems)].map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        {create.isError ? (
          <p className="form-error" role="alert">
            {problemText(create.error)}
          </p>
        ) : null}

        <div className="call-form__foot">
          <Button type="submit" tone="primary" disabled={create.isPending}>
            {create.isPending ? "Creating and calculating" : "Create and calculate"}
          </Button>
          <span className="field-hint">{total > 0n ? `${formatCents(total)} before fees` : ""}</span>
          <Link to="/funds/$fundId/events" params={{ fundId }} className="btn btn--quiet">
            Discard
          </Link>
        </div>
      </form>
    </div>
  );
};
