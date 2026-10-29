import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { QueryView } from "../../components/QueryView";
import { Button, EmptyState, Fingerprint, Money, Skeleton, SkeletonRows, Stamp, StatusPill } from "../../components/ui";
import { api, can, currentSession, problemText } from "../../lib/api";
import { shortHash } from "../../lib/fingerprint";
import { sumCents } from "../../lib/money";
import { keys, useEvent, useFeederPlan, useLines } from "../../lib/queries";
import type { CapitalEvent, Line } from "../../lib/types";
import { DURATION, EASE_OUT } from "../../theme/motion";
import { columnsFor, flowOf, KIND_LABEL, STEPS, stepIndex } from "./labels";
import "./events.css";

const route = getRouteApi("/app/events/$eventId");

const Lifecycle = ({ ev }: { ev: CapitalEvent }) => {
  const at = stepIndex(ev.status);
  return (
    <ol className={`lifecycle${ev.status === "cancelled" ? " lifecycle--cancelled" : ""}`} aria-label="Where this event is">
      {STEPS.map((s, i) => (
        <li key={s.status} data-state={i < at ? "done" : i === at ? "now" : "todo"} aria-current={i === at ? "step" : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
};

/** The memorable element: the approved result's fingerprint and the stamps signed against it. */
const Seal = ({ ev }: { ev: CapitalEvent }) => {
  if (!ev.result_hash) {
    return (
      <section className="seal seal--none panel" aria-label="Result fingerprint">
        <Fingerprint hash={"0".repeat(64)} label="Not calculated yet" />
        <div>
          <h2>Not calculated yet</h2>
          <p>
            When the event is calculated, its result gets a fingerprint. Approvals are signed against that fingerprint, not against the
            event.
          </p>
        </div>
      </section>
    );
  }
  const approvals = ev.approvals ?? [];
  return (
    <section className="seal panel" aria-label="Result fingerprint">
      <Fingerprint hash={ev.result_hash} />
      <div>
        <h2>
          Result <code>{shortHash(ev.result_hash)}</code>
        </h2>
        <p>
          {approvals.some((a) => a.current)
            ? "Approved as calculated. If an input or a side-letter term changes, the event must be recalculated and this approval stops counting."
            : approvals.length
              ? "The result changed after it was approved. It needs a new approval before notices can go out."
              : "Calculated and waiting for a second person to approve this exact result."}
        </p>
      </div>
      {approvals.length ? (
        <div className="seal__stamps">
          {approvals.map((a) => (
            <Stamp
              key={`${a.user_id}${a.result_hash}`}
              who={a.user_id.split("@")[0] ?? a.user_id}
              when={a.decided_at}
              hash={a.result_hash}
              current={a.current}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
};

const downloadPaymentFile = async (id: string) => {
  const f = await api.get<{ msg_id: string; xml: string }>(`/v1/events/${id}/payment-file`);
  const url = URL.createObjectURL(new Blob([f.xml], { type: "application/xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${f.msg_id}.pain.001.xml`;
  a.click();
  URL.revokeObjectURL(url);
};

const Actions = ({ ev }: { ev: CapitalEvent }) => {
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const act = useMutation({
    mutationFn: ({ verb, body }: { verb: string; body?: unknown }) =>
      api.post<CapitalEvent>(`/v1/events/${ev.id}/${verb}`, body ?? {}, crypto.randomUUID()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.event(ev.id) });
      void qc.invalidateQueries({ queryKey: keys.lines(ev.id) });
      void qc.invalidateQueries({ queryKey: keys.events(ev.fund_id) });
      void qc.invalidateQueries({ queryKey: keys.accounts(ev.fund_id) });
      setConfirmCancel(false);
    },
  });
  const download = useMutation({ mutationFn: () => downloadPaymentFile(ev.id) });
  const me = currentSession()?.sub;
  const ownEvent = ev.created_by === me;
  const busy = act.isPending;
  const open = ["draft", "calculated", "approved"].includes(ev.status);

  return (
    <div>
      <div className="ev-actions">
        {can("preparer") && (ev.status === "draft" || ev.status === "calculated") ? (
          <Button tone={ev.status === "draft" ? "primary" : undefined} disabled={busy} onClick={() => act.mutate({ verb: "calculate" })}>
            {ev.status === "draft" ? "Calculate" : "Recalculate"}
          </Button>
        ) : null}
        {can("approver") && ev.status === "calculated" && ev.result_hash ? (
          <Button
            tone="stamp"
            disabled={busy || ownEvent}
            title={ownEvent ? "You prepared this event; a second person must approve it" : undefined}
            onClick={() => act.mutate({ verb: "approve", body: { resultHash: ev.result_hash } })}
          >
            Approve result {shortHash(ev.result_hash)}
          </Button>
        ) : null}
        {can("preparer", "approver") && ev.status === "approved" ? (
          <Button tone="primary" disabled={busy} onClick={() => act.mutate({ verb: "issue" })}>
            Issue notices
          </Button>
        ) : null}
        {ev.kind === "distribution" && (ev.status === "issued" || ev.status === "settled") ? (
          <Button disabled={download.isPending} onClick={() => download.mutate()}>
            Download payment file
          </Button>
        ) : null}
        {can("preparer") && open ? (
          confirmCancel ? (
            <>
              <Button tone="quiet" onClick={() => setConfirmCancel(false)}>
                Keep event
              </Button>
              <Button disabled={busy} onClick={() => act.mutate({ verb: "cancel" })}>
                Cancel {ev.reference}
              </Button>
            </>
          ) : (
            <Button tone="quiet" onClick={() => setConfirmCancel(true)}>
              Cancel event
            </Button>
          )
        ) : null}
      </div>
      <AnimatePresence>
        {act.isError || download.isError ? (
          <motion.p
            className="form-error"
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.quick, ease: EASE_OUT }}
          >
            {problemText(act.error ?? download.error)}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

const FeederPlan = ({ ev }: { ev: CapitalEvent }) => {
  const enabled = ev.kind === "call" && (ev.status === "approved" || ev.status === "issued");
  const plan = useFeederPlan(ev.id, enabled);
  const qc = useQueryClient();
  const [issueDate, setIssueDate] = useState(ev.issue_date);
  const create = useMutation({
    mutationFn: (feederFundId: string) =>
      api.post<CapitalEvent>(`/v1/events/${ev.id}/feeder-calls`, { feederFundId, issueDate }, crypto.randomUUID()),
    onSuccess: (r) => void qc.invalidateQueries({ queryKey: keys.events(r.fund_id) }),
  });
  if (!enabled || !plan.data?.length) return null;
  return (
    <section className="section">
      <h2>Feeder funds in this call</h2>
      {plan.data.map((f) => (
        <div key={f.feederFundId} className="feeder panel">
          <dl className="feeder__row">
            <div>
              <dt>Feeder</dt>
              <dd>{f.feederName}</dd>
            </div>
            <div>
              <dt>Owes the main fund</dt>
              <dd>
                <Money cents={f.masterLineTotal} />
              </dd>
            </div>
            <div>
              <dt>Due at the main fund</dt>
              <dd>{f.masterDueDate}</dd>
            </div>
            <div>
              <dt>Latest feeder issue</dt>
              <dd>{f.latestIssue}</dd>
            </div>
            <span className={`pill pill--${f.bridgeRequired ? "debit" : "credit"}`}>{f.bridgeRequired ? "bridge needed" : "in time"}</span>
          </dl>
          <p className={`notice${f.bridgeRequired ? " notice--bad" : ""}`}>
            {f.bridgeRequired
              ? `The feeder's ${f.investors} investors cannot be called in time for the main fund's due date. The feeder needs a bridge facility for this call.`
              : `Issue the feeder call by ${f.latestIssue} so its ${f.investors} investors pay before the main fund's due date.`}
          </p>
          {can("preparer") ? (
            <div className="call-form__foot">
              <label className="field">
                Feeder call issue date
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <Button disabled={create.isPending} onClick={() => create.mutate(f.feederFundId)}>
                Create feeder call
              </Button>
              {create.isSuccess ? (
                <Link to="/events/$eventId" params={{ eventId: create.data.id }}>
                  Open {create.data.reference}
                </Link>
              ) : null}
              {create.isError ? <p className="form-error">{problemText(create.error)}</p> : null}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
};

const LinesTable = ({ ev, lines }: { ev: CapitalEvent; lines: Line[] }) => {
  const cols = columnsFor(ev, lines);
  return (
    <div className="panel lines">
      <table className="table">
        <thead>
          <tr>
            <th>Investor</th>
            {cols.map((c) => (
              <th key={c.label} className="n">
                {c.label}
              </th>
            ))}
            <th className="n">Total</th>
            <th className="n">Paid</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.investor_id}>
              <td className="investor">
                {l.investor_name}
                {l.end_to_end_id.startsWith("DRAFT-") ? null : <div className="e2e">{l.end_to_end_id}</div>}
              </td>
              {cols.map((c) => (
                <td key={c.label} className="n">
                  <Money cents={c.value(l)} />
                </td>
              ))}
              <td className="n">
                <Money cents={l.total} flow={flowOf(ev, l.total)} />
              </td>
              <td className="n">
                <Money cents={l.paid} />
              </td>
              <td>{l.due_date ?? ""}</td>
              <td>
                <StatusPill status={l.status} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{lines.length} investors</td>
            {cols.map((c) => (
              <td key={c.label} className="n">
                <Money cents={sumCents(lines.map(c.value))} />
              </td>
            ))}
            <td className="n">
              <Money cents={sumCents(lines.map((l) => l.total))} />
            </td>
            <td className="n">
              <Money cents={sumCents(lines.map((l) => l.paid))} />
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

export const EventDetail = () => {
  const { eventId } = route.useParams();
  const event = useEvent(eventId);
  const lines = useLines(eventId, event.data?.status !== "draft");

  return (
    <QueryView
      query={event}
      skeleton={
        <div style={{ display: "grid", gap: "var(--s-4)" }}>
          <Skeleton w={360} h={30} />
          <Skeleton h={120} />
          <SkeletonRows />
        </div>
      }
    >
      {(ev) => (
        <div>
          <p>
            <Link to="/funds/$fundId/events" params={{ fundId: ev.fund_id }}>
              Capital events
            </Link>
          </p>
          <header className="ev-head">
            <div>
              <h1>
                {KIND_LABEL[ev.kind]} {ev.reference}
              </h1>
              <p>
                Issue date {ev.issue_date}, prepared by {ev.created_by.split("@")[0]}. <StatusPill status={ev.status} />
              </p>
            </div>
            <Actions ev={ev} />
          </header>
          <Lifecycle ev={ev} />
          {ev.error ? (
            <section className="halt" role="alert">
              <h2>The calculation stopped</h2>
              <p>
                {ev.error.message} (<code>{ev.error.code}</code>){ev.error.ids.length ? `, ${ev.error.ids.length} investors affected` : ""}.
                Change the event's inputs or the investors' terms, then calculate again.
              </p>
            </section>
          ) : null}
          <Seal ev={ev} />
          <FeederPlan ev={ev} />
          <section className="section">
            <h2>Investor lines</h2>
            {ev.status === "calculated" || ev.status === "approved" ? (
              <p className="field-hint">
                Payment references are assigned when notices are issued; investors quote them on their transfers.
              </p>
            ) : null}
            {ev.status === "draft" ? (
              <EmptyState title="No lines until the event is calculated">
                Calculating splits the event across investors by their commitments and terms.
              </EmptyState>
            ) : (
              <QueryView query={lines} isEmpty={(l) => l.length === 0} empty={<EmptyState title="No investor takes part in this event" />}>
                {(l) => <LinesTable ev={ev} lines={l} />}
              </QueryView>
            )}
          </section>
        </div>
      )}
    </QueryView>
  );
};
