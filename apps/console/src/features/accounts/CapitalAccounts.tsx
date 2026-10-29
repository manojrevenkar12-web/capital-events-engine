import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { QueryView } from "../../components/QueryView";
import { EmptyState, Money } from "../../components/ui";
import { useAccounts, useLedgerVerify } from "../../lib/queries";
import type { CapitalAccounts as Accounts } from "../../lib/types";
import "./accounts.css";

const route = getRouteApi("/app/funds/$fundId/accounts");
type Row = Accounts["rows"][number];
const SORTS = {
  name: { label: "Investor", by: (a: Row, b: Row) => a.name.localeCompare(b.name) },
  commitment: { label: "Commitment", by: (a: Row, b: Row) => Number(BigInt(b.commitment) - BigInt(a.commitment)) },
  receivable: { label: "Owed to the fund", by: (a: Row, b: Row) => Number(BigInt(b.receivable) - BigInt(a.receivable)) },
} as const;

const Terms = ({ t }: { t: Row["terms"] }) => {
  const parts: string[] = [];
  if (t.feeDiscountBps) parts.push(`fee −${t.feeDiscountBps / 100} pts`);
  if (t.carryDiscountBps) parts.push(`carry −${t.carryDiscountBps / 100} pts`);
  if (t.noticeDays) parts.push(`${t.noticeDays} days' notice`);
  if (t.excuseSectors.length) parts.push(`excused: ${t.excuseSectors.map((s) => s.replaceAll("_", " ")).join(", ")}`);
  if (t.hasMfn) parts.push("MFN");
  return parts.length ? (
    <ul className="terms-inline">
      {parts.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  ) : (
    <span className="muted">fund terms</span>
  );
};

export const CapitalAccounts = () => {
  const { fundId } = route.useParams();
  const accounts = useAccounts(fundId);
  const ledger = useLedgerVerify(fundId);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<keyof typeof SORTS>("commitment");

  const rows = useMemo(
    () => (accounts.data?.rows ?? []).filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())).sort(SORTS[sort].by),
    [accounts.data, q, sort],
  );

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Capital accounts</h1>
          <p>
            Balances from the double-entry ledger, one account per investor and purpose. Approved side-letter terms are shown with each
            investor.
          </p>
        </div>
        {ledger.data ? (
          <p className={`ledger-check${ledger.data.ok ? "" : " ledger-check--bad"}`} role="status">
            {ledger.data.ok
              ? `Ledger balances: ${ledger.data.accounts} accounts, trial balance zero`
              : `Ledger does not balance: trial balance ${ledger.data.trialBalance}`}
          </p>
        ) : null}
      </header>
      <div className="toolbar">
        <label className="field field--inline">
          Find an investor
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" />
        </label>
        <label className="field field--inline">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="panel lines">
        <QueryView
          query={accounts}
          isEmpty={(a) => a.rows.length === 0}
          empty={<EmptyState title="No investors in this fund yet">Commitments appear here after the first closing.</EmptyState>}
        >
          {(a) =>
            rows.length === 0 ? (
              <EmptyState title={`No investor matches "${q}"`}>Clear the search to see all {a.rows.length}.</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Investor</th>
                    <th className="n">Commitment</th>
                    <th className="n">Paid in</th>
                    <th className="n">Unfunded</th>
                    <th className="n">Distributed</th>
                    <th className="n">Owed to the fund</th>
                    <th>Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.investorId}>
                      <td>{r.name}</td>
                      <td className="n">
                        <Money cents={r.commitment} />
                      </td>
                      <td className="n">
                        <Money cents={r.contributed} />
                      </td>
                      <td className="n">
                        <Money cents={r.unfunded} />
                      </td>
                      <td className="n">
                        <Money cents={r.distributed} />
                      </td>
                      <td className="n">
                        {r.receivable !== "0" ? <Money cents={r.receivable} flow="in" /> : <span className="muted">none</span>}
                      </td>
                      <td>
                        <Terms t={r.terms} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {q ? null : (
                  <tfoot>
                    <tr>
                      <td>{a.totals.investors} investors</td>
                      <td className="n">
                        <Money cents={a.totals.commitment} />
                      </td>
                      <td className="n">
                        <Money cents={a.totals.contributed} />
                      </td>
                      <td className="n">
                        <Money cents={a.totals.unfunded} />
                      </td>
                      <td className="n">
                        <Money cents={a.totals.distributed} />
                      </td>
                      <td className="n">
                        <Money cents={a.totals.receivable} />
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            )
          }
        </QueryView>
      </div>
    </div>
  );
};
