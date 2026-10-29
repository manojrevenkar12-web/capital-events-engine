import { useMemo, useState } from "react";
import { QueryView } from "../../components/QueryView";
import { EmptyState, Skeleton } from "../../components/ui";
import { useAudit, useAuditVerify } from "../../lib/queries";
import "../accounts/accounts.css";
import "./audit.css";

const PAGE = 50;

export const AuditTrail = () => {
  const audit = useAudit();
  const verify = useAuditVerify();
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (audit.data ?? []).filter((r) => !t || `${r.actor} ${r.action} ${r.entity} ${r.entity_id}`.toLowerCase().includes(t));
  }, [audit.data, q]);

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Audit trail</h1>
          <p>
            Every change is a record whose hash covers the one before it. The database refuses updates and deletes on this table, and the
            chain is re-verified from the first record.
          </p>
        </div>
        {verify.isPending ? (
          <Skeleton w={240} h={32} />
        ) : verify.data ? (
          <p className={`ledger-check${verify.data.ok ? "" : " ledger-check--bad"}`} role="status">
            {verify.data.ok ? `Chain intact: ${verify.data.records} records verified` : `Chain broken at record ${verify.data.brokenAt}`}
          </p>
        ) : null}
      </header>
      <div className="toolbar">
        <label className="field field--inline">
          Filter
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Person, action or record"
          />
        </label>
      </div>
      <div className="panel lines">
        <QueryView
          query={audit}
          isEmpty={(a) => a.length === 0}
          empty={<EmptyState title="Nothing has happened yet">Records appear with the first change.</EmptyState>}
        >
          {() =>
            rows.length === 0 ? (
              <EmptyState title="No record matches this filter" />
            ) : (
              <table className="table audit">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((r) => (
                    <tr key={r.seq}>
                      <td className="n">{r.seq}</td>
                      <td>{new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" })}</td>
                      <td>{r.actor.split("@")[0]}</td>
                      <td>
                        {r.action.replaceAll(".", " ").replaceAll("_", " ")}
                        <div className="e2e">
                          {r.entity} {r.entity_id}
                        </div>
                      </td>
                      <td>
                        <code className="hash">{r.hash.slice(0, 12)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </QueryView>
      </div>
      {rows.length > shown ? (
        <p>
          <button type="button" className="btn" onClick={() => setShown((s) => s + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown)} more
          </button>
        </p>
      ) : null}
      {audit.data ? (
        <p className="field-hint">The newest {audit.data.length} records are shown; the verification covers the whole chain.</p>
      ) : null}
    </div>
  );
};
