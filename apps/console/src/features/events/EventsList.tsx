import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { QueryView } from "../../components/QueryView";
import { EmptyState, StatusPill } from "../../components/ui";
import { can } from "../../lib/api";
import { useEvents } from "../../lib/queries";
import type { CapitalEvent } from "../../lib/types";
import { KIND_LABEL } from "./labels";
import "./events.css";

const route = getRouteApi("/app/funds/$fundId/events");

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "open", label: "Not issued", test: (e: CapitalEvent) => ["draft", "calculated", "approved"].includes(e.status) },
  { id: "issued", label: "Issued", test: (e: CapitalEvent) => e.status === "issued" || e.status === "settled" },
] as const;

export const EventsList = () => {
  const { fundId } = route.useParams();
  const events = useEvents(fundId);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const test = FILTERS.find((f) => f.id === filter)?.test ?? (() => true);

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Capital events</h1>
          <p>
            Calls, subsequent closings and distributions. An event reaches investors only after a second person approves its calculated
            result.
          </p>
        </div>
        {can("preparer") ? (
          <Link to="/funds/$fundId/events/new" params={{ fundId }} className="btn btn--primary">
            New capital call
          </Link>
        ) : null}
      </header>
      <fieldset className="segmented">
        <legend className="visually-hidden">Show</legend>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            {events.data ? <span>{events.data.filter(f.test).length}</span> : null}
          </button>
        ))}
      </fieldset>
      <div className="panel">
        <QueryView
          query={events}
          isEmpty={(e) => e.length === 0}
          empty={<EmptyState title="No capital events yet">A first capital call starts the fund's capital accounts.</EmptyState>}
        >
          {(list) => {
            const rows = list.filter(test);
            if (!rows.length) return <EmptyState title="Nothing matches this filter">Choose All to see every event.</EmptyState>;
            return (
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Kind</th>
                    <th>Issue date</th>
                    <th>Prepared by</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} data-href onClick={() => navigate({ to: "/events/$eventId", params: { eventId: e.id } })}>
                      <td>
                        <Link to="/events/$eventId" params={{ eventId: e.id }} className="strong-link">
                          {e.reference}
                        </Link>
                        {e.error ? <div className="row-error">Stopped: {e.error.message}</div> : null}
                      </td>
                      <td>{KIND_LABEL[e.kind]}</td>
                      <td>{e.issue_date}</td>
                      <td>{e.created_by.split("@")[0]}</td>
                      <td>
                        <StatusPill status={e.status} />
                      </td>
                    </tr>
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
