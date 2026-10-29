import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { QueryView } from "../../components/QueryView";
import { Button, EmptyState, StatusPill } from "../../components/ui";
import { api, can, problemText } from "../../lib/api";
import { keys, useInvestors, useLetters, useProvisions } from "../../lib/queries";
import type { SideLetter } from "../../lib/types";
import { DURATION, EASE_OUT } from "../../theme/motion";
import "./letters.css";

const route = getRouteApi("/app/funds/$fundId/side-letters");
const MAX_BYTES = 500_000;

const Upload = ({ fundId, onClose }: { fundId: string; onClose: () => void }) => {
  const investors = useInvestors();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [investorId, setInvestorId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const key = useMemo(() => crypto.randomUUID(), []);
  const upload = useMutation({
    mutationFn: () => api.post<SideLetter>(`/v1/funds/${fundId}/side-letters`, { investorId, title, body }, key),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: keys.letters(fundId) });
      void navigate({ to: "/side-letters/$letterId", params: { letterId: l.id } });
    },
  });
  const ready = investorId && title.trim() && body.trim().length >= 20;
  return (
    <motion.form
      className="upload panel"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) upload.mutate();
      }}
    >
      <div className="upload__row">
        <label className="field">
          Investor
          <select
            value={investorId}
            onChange={(e) => {
              setInvestorId(e.target.value);
              const name = investors.data?.find((i) => i.id === e.target.value)?.name;
              if (name && !title) setTitle(`${name} side letter`);
            }}
          >
            <option value="">{investors.isPending ? "Loading investors" : "Choose an investor"}</option>
            {investors.data?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          From a text file
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f && f.size <= MAX_BYTES) setBody(await f.text());
            }}
          />
        </label>
      </div>
      <label className="field">
        Letter text{" "}
        <span className="field-hint">
          Paste the signed letter. Terms are proposed from it with the sentence they came from; nothing applies until an approver accepts
          it.
        </span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {upload.isError ? <p className="form-error">{problemText(upload.error)}</p> : null}
      <div className="call-form__foot">
        <Button type="submit" tone="primary" disabled={!ready || upload.isPending}>
          {upload.isPending ? "Uploading" : "Upload and read terms"}
        </Button>
        <Button tone="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
    </motion.form>
  );
};

export const SideLetters = () => {
  const { fundId } = route.useParams();
  const letters = useLetters(fundId);
  const proposed = useProvisions(fundId, "proposed");
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Side letters</h1>
          <p>
            Each letter's terms are read into structured provisions: excuse rights, fee and carry discounts, notice periods, MFN.
            Calculations use only provisions a second person approved.
          </p>
        </div>
        {can("preparer") && !uploading ? (
          <Button tone="primary" onClick={() => setUploading(true)}>
            Upload a side letter
          </Button>
        ) : null}
      </header>
      <AnimatePresence>{uploading ? <Upload fundId={fundId} onClose={() => setUploading(false)} /> : null}</AnimatePresence>
      {proposed.data?.length ? (
        <p className="notice">
          {proposed.data.length} proposed {proposed.data.length === 1 ? "term is" : "terms are"} waiting for an approver.
        </p>
      ) : null}
      <div className="panel">
        <QueryView
          query={letters}
          isEmpty={(l) => l.length === 0}
          empty={<EmptyState title="No side letters yet">Upload a signed letter to propose its terms for review.</EmptyState>}
        >
          {(list) => (
            <table className="table">
              <thead>
                <tr>
                  <th>Letter</th>
                  <th>Investor</th>
                  <th>Uploaded</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.id} data-href onClick={() => navigate({ to: "/side-letters/$letterId", params: { letterId: l.id } })}>
                    <td>
                      <Link to="/side-letters/$letterId" params={{ letterId: l.id }} className="strong-link">
                        {l.title}
                      </Link>
                    </td>
                    <td>{l.investor_name}</td>
                    <td>
                      {new Date(l.created_at).toLocaleDateString("en-GB", { dateStyle: "medium" })} by {l.uploaded_by.split("@")[0]}
                    </td>
                    <td>
                      <StatusPill status={l.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryView>
      </div>
    </div>
  );
};
