import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useState } from "react";
import { QueryView } from "../../components/QueryView";
import { Button, EmptyState, Money, StatusPill } from "../../components/ui";
import { api, can, postRaw, problemText } from "../../lib/api";
import { formatCents } from "../../lib/money";
import { useBank, useEvents, useLines } from "../../lib/queries";
import type { BankEntry } from "../../lib/types";
import { DURATION, EASE_OUT } from "../../theme/motion";
import "../accounts/accounts.css";
import "./bank.css";

const route = getRouteApi("/app/funds/$fundId/bank");
const FILTERS = [
  { id: "unmatched", label: "Needs placing" },
  { id: "duplicate", label: "Duplicates" },
  { id: "matched", label: "Matched" },
  { id: "resolved", label: "Placed by hand" },
  { id: "all", label: "All" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const invalidateBank = (qc: ReturnType<typeof useQueryClient>) => {
  for (const k of ["bank", "accounts", "events", "lines", "event"]) void qc.invalidateQueries({ queryKey: [k] });
};

/** An unmatched credit is placed on an investor's line by a person, with a reason that goes to the audit trail. */
const Place = ({ fundId, entry, onDone }: { fundId: string; entry: BankEntry; onDone: () => void }) => {
  const events = useEvents(fundId);
  const open = (events.data ?? []).filter((e) => e.status === "issued" && e.kind !== "distribution");
  const [eventId, setEventId] = useState("");
  const lines = useLines(eventId, !!eventId);
  const [investorId, setInvestorId] = useState("");
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const place = useMutation({
    mutationFn: () => api.post(`/v1/funds/${fundId}/bank/entries/${entry.id}/resolve`, { eventId, investorId, note }, crypto.randomUUID()),
    onSuccess: () => {
      invalidateBank(qc);
      onDone();
    },
  });
  const unpaid = (lines.data ?? []).filter((l) => l.status === "open" || l.status === "partial");
  return (
    <motion.form
      className="place"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      onSubmit={(e) => {
        e.preventDefault();
        place.mutate();
      }}
    >
      <label className="field">
        Event
        <select
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value);
            setInvestorId("");
          }}
        >
          <option value="">Choose an issued event</option>
          {open.map((e) => (
            <option key={e.id} value={e.id}>
              {e.reference}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Investor line
        <select value={investorId} onChange={(e) => setInvestorId(e.target.value)} disabled={!eventId || lines.isPending}>
          <option value="">{eventId && lines.isPending ? "Loading lines" : "Choose a line still open"}</option>
          {unpaid.map((l) => (
            <option key={l.investor_id} value={l.investor_id}>
              {l.investor_name}, {formatCents(BigInt(l.total) - BigInt(l.paid))} open
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Why this line
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Remittance names the investor's custodian" />
      </label>
      <Button type="submit" tone="primary" disabled={!eventId || !investorId || note.trim().length < 3 || place.isPending}>
        Place credit
      </Button>
      {place.isError ? <p className="form-error">{problemText(place.error)}</p> : null}
    </motion.form>
  );
};

const Import = ({ fundId }: { fundId: string }) => {
  const qc = useQueryClient();
  const imp = useMutation({
    mutationFn: (xml: string) =>
      postRaw<{ matched: number; unmatched: number; duplicates: number }>(`/v1/funds/${fundId}/bank/camt054`, xml, "application/xml"),
    onSuccess: () => invalidateBank(qc),
  });
  return (
    <div className="import">
      <label className="btn">
        Import a camt.054 statement
        <input
          type="file"
          accept=".xml,application/xml,text/xml"
          className="visually-hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) imp.mutate(await f.text());
            e.target.value = "";
          }}
        />
      </label>
      <span role="status" className="field-hint">
        {imp.isPending
          ? "Reading the statement"
          : imp.isSuccess
            ? `${imp.data.matched} matched, ${imp.data.unmatched} need placing, ${imp.data.duplicates} duplicates ignored`
            : ""}
      </span>
      {imp.isError ? <p className="form-error">{problemText(imp.error)}</p> : null}
    </div>
  );
};

export const Bank = () => {
  const { fundId } = route.useParams();
  const [filter, setFilter] = useState<FilterId>("unmatched");
  const all = useBank(fundId);
  const [placing, setPlacing] = useState<string | null>(null);
  const count = (id: FilterId) => (all.data ? (id === "all" ? all.data.length : all.data.filter((e) => e.status === id).length) : null);

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Bank</h1>
          <p>
            Credits from the fund's account statements (ISO 20022 camt.054). A credit is matched by its end-to-end reference; one that
            cannot be matched waits here until a person places it.
          </p>
        </div>
        {can("preparer") ? <Import fundId={fundId} /> : null}
      </header>
      <fieldset className="segmented">
        <legend className="visually-hidden">Show</legend>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            {count(f.id) != null ? <span>{count(f.id)}</span> : null}
          </button>
        ))}
      </fieldset>
      <div className="panel lines">
        <QueryView
          query={all}
          isEmpty={(e) => e.length === 0}
          empty={<EmptyState title="No statements imported yet">Import the bank's camt.054 file to reconcile payments.</EmptyState>}
        >
          {(list) => {
            const rows = filter === "all" ? list : list.filter((e) => e.status === filter);
            if (!rows.length)
              return (
                <EmptyState title={filter === "unmatched" ? "Every credit is placed" : "Nothing in this list"}>
                  {filter === "unmatched"
                    ? "All imported credits matched an investor's line or were placed by hand."
                    : "Choose All to see every credit."}
                </EmptyState>
              );
            return (
              <table className="table">
                <thead>
                  <tr>
                    <th>Booked</th>
                    <th>From</th>
                    <th>Reference</th>
                    <th className="n">Amount</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <Fragment key={e.id}>
                      <tr>
                        <td>{e.booking_date}</td>
                        <td>{e.debtor_name ?? <span className="muted">unknown</span>}</td>
                        <td>
                          {e.end_to_end_id ?? <span className="muted">none</span>}
                          {e.remittance ? <div className="e2e">{e.remittance}</div> : null}
                          {e.note ? <div className="e2e">{e.note}</div> : null}
                        </td>
                        <td className="n">
                          <Money cents={e.amount} flow="in" />
                        </td>
                        <td>
                          <StatusPill status={e.status} />
                        </td>
                        <td className="n">
                          {e.status === "unmatched" && can("preparer") ? (
                            <Button
                              tone="quiet"
                              onClick={() => setPlacing(placing === e.id ? null : e.id)}
                              aria-expanded={placing === e.id}
                            >
                              {placing === e.id ? "Close" : "Place"}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                      {placing === e.id ? (
                        <tr className="place-row">
                          <td colSpan={6}>
                            <AnimatePresence>
                              <Place fundId={fundId} entry={e} onDone={() => setPlacing(null)} />
                            </AnimatePresence>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            );
          }}
        </QueryView>
      </div>
    </div>
  );
};
