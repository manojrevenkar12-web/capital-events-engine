import { Link, useParams } from "@tanstack/react-router";
import { motion } from "motion/react";
import { QueryView } from "../../components/QueryView";
import { EmptyState, Money, Skeleton, StatusPill } from "../../components/ui";
import { formatCents, ratio } from "../../lib/money";
import { useAccounts, useBank, useEvents, useFunds, useProvisions } from "../../lib/queries";
import { DURATION, EASE_OUT, listReveal, reveal } from "../../theme/motion";
import "./overview.css";

const KIND: Record<string, string> = { call: "Capital call", distribution: "Distribution", equalisation: "Closing" };

export const Overview = () => {
  const { fundId } = useParams({ from: "/app/funds/$fundId/" });
  const funds = useFunds();
  const accounts = useAccounts(fundId);
  const events = useEvents(fundId);
  const proposed = useProvisions(fundId, "proposed");
  const unplaced = useBank(fundId, "unmatched");
  const fund = funds.data?.find((f) => f.id === fundId);

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>{fund?.name ?? <Skeleton w={320} h={28} />}</h1>
          {fund ? (
            <p>
              {fund.kind === "feeder" ? "Feeder fund" : "Main fund"}, {fund.default_notice_days} business days' notice, fee{" "}
              {fund.fee_rate_bps / 100}%, carry {fund.carry_bps / 100}% over an {fund.hurdle_bps / 100}% hurdle. Investment period ends{" "}
              {fund.investment_period_end}.
            </p>
          ) : null}
        </div>
        <Link to="/funds/$fundId/events/new" params={{ fundId }} className="btn btn--primary">
          New capital call
        </Link>
      </header>

      <QueryView
        query={accounts}
        skeleton={<Skeleton h={120} />}
        isEmpty={(a) => a.rows.length === 0}
        empty={<EmptyState title="No investors yet">Add commitments at the first closing.</EmptyState>}
      >
        {(a) => {
          const called = ratio(a.totals.contributed, a.totals.commitment);
          const back = ratio(a.totals.distributed, a.totals.commitment);
          return (
            <section className="drawdown panel" aria-label="Drawdown">
              <div className="drawdown__figures">
                <div>
                  <span>Commitments</span>
                  <strong>
                    <Money cents={a.totals.commitment} compact />
                  </strong>
                  <small>{a.totals.investors} investors</small>
                </div>
                <div>
                  <span>Called</span>
                  <strong>
                    <Money cents={a.totals.contributed} compact />
                  </strong>
                  <small>{(called * 100).toFixed(1)}% of commitments</small>
                </div>
                <div>
                  <span>Still to call</span>
                  <strong>
                    <Money cents={a.totals.unfunded} compact />
                  </strong>
                </div>
                <div>
                  <span>Distributed</span>
                  <strong>
                    <Money cents={a.totals.distributed} compact />
                  </strong>
                  <small>
                    {a.totals.contributed !== "0" ? `${ratio(a.totals.distributed, a.totals.contributed).toFixed(2)}× of paid-in` : ""}
                  </small>
                </div>
              </div>
              <div
                className="drawdown__bar"
                role="img"
                aria-label={`${(called * 100).toFixed(1)} percent called, ${(back * 100).toFixed(1)} percent returned`}
              >
                <motion.span
                  className="drawdown__called"
                  initial={{ width: 0 }}
                  animate={{ width: `${called * 100}%` }}
                  transition={{ duration: DURATION.slow, ease: EASE_OUT }}
                />
                <motion.span
                  className="drawdown__back"
                  initial={{ width: 0 }}
                  animate={{ width: `${back * 100}%` }}
                  transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: DURATION.base }}
                />
              </div>
              <p className="drawdown__legend">
                <i className="k k--called" /> called <i className="k k--back" /> returned to investors <i className="k" /> still to call
              </p>
            </section>
          );
        }}
      </QueryView>

      <div className="overview__grid">
        <section className="section">
          <h2>Waiting on someone</h2>
          <motion.ul className="todo" variants={listReveal} initial="hidden" animate="shown">
            {events.data
              ?.filter((e) => e.status === "calculated")
              .map((e) => (
                <motion.li key={e.id} variants={reveal}>
                  <Link to="/events/$eventId" params={{ eventId: e.id }}>
                    {e.reference} is calculated and needs a second person's approval
                  </Link>
                </motion.li>
              ))}
            {events.data
              ?.filter((e) => e.status === "draft" && e.error)
              .map((e) => (
                <motion.li key={e.id} variants={reveal} className="todo--bad">
                  <Link to="/events/$eventId" params={{ eventId: e.id }}>
                    {e.reference} could not be calculated: {e.error?.message}
                  </Link>
                </motion.li>
              ))}
            {proposed.data?.length ? (
              <motion.li variants={reveal}>
                <Link to="/funds/$fundId/side-letters" params={{ fundId }}>
                  {proposed.data.length} side-letter terms to review
                </Link>
              </motion.li>
            ) : null}
            {unplaced.data?.length ? (
              <motion.li variants={reveal} className="todo--bad">
                <Link to="/funds/$fundId/bank" params={{ fundId }}>
                  {unplaced.data.length} bank credits nobody can place (
                  {formatCents(unplaced.data.reduce((s, b) => s + BigInt(b.amount), 0n))})
                </Link>
              </motion.li>
            ) : null}
          </motion.ul>
          {events.isSuccess &&
          proposed.isSuccess &&
          unplaced.isSuccess &&
          !events.data.some((e) => e.status === "calculated" || e.error) &&
          !proposed.data.length &&
          !unplaced.data.length ? (
            <EmptyState title="Nothing is waiting">Every event is decided, every term reviewed and every credit placed.</EmptyState>
          ) : null}
        </section>

        <section className="section">
          <h2>Recent events</h2>
          <QueryView
            query={events}
            isEmpty={(e) => e.length === 0}
            empty={<EmptyState title="No capital events yet">Start with a capital call.</EmptyState>}
          >
            {(list) => (
              <ol className="timeline">
                {list.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <time>{e.issue_date}</time>
                    <Link to="/events/$eventId" params={{ eventId: e.id }}>
                      {KIND[e.kind]} {e.reference}
                    </Link>
                    <StatusPill status={e.status} />
                  </li>
                ))}
              </ol>
            )}
          </QueryView>
        </section>
      </div>
    </div>
  );
};
