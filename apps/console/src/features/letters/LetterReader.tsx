import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { QueryView } from "../../components/QueryView";
import { Button, EmptyState, Skeleton, SkeletonRows, StatusPill } from "../../components/ui";
import { api, can, currentSession, problemText } from "../../lib/api";
import { keys, useLetter } from "../../lib/queries";
import type { Provision, SideLetter } from "../../lib/types";
import { DURATION, EASE_OUT, listReveal, reveal } from "../../theme/motion";
import "./letters.css";

const route = getRouteApi("/app/side-letters/$letterId");

const TYPE_LABEL: Record<string, string> = {
  EXCUSE_RIGHT: "Excuse right",
  FEE_DISCOUNT: "Management fee discount",
  CARRY_DISCOUNT: "Carry discount",
  NOTICE_PERIOD: "Notice period",
  MFN: "Most favoured nation",
  REPORTING: "Reporting",
  LPAC_SEAT: "Advisory committee seat",
  CO_INVEST: "Co-investment",
  TAX: "Tax",
  DISCLOSURE: "Disclosure",
};

const text = (v: unknown) => String(v ?? "").replaceAll("_", " ");

/** One line in plain words for each provision type's parameters. */
const summarize = (p: Provision): string => {
  const v = p.params as Record<string, unknown>;
  switch (p.type) {
    case "EXCUSE_RIGHT":
      return `Excused from ${(Array.isArray(v.sectors) ? (v.sectors as string[]) : []).map(text).join(", ")}`;
    case "FEE_DISCOUNT":
      return `${Number(v.bps) / 100} percentage points off the management fee`;
    case "CARRY_DISCOUNT":
      return `${Number(v.bps) / 100} percentage points off carried interest`;
    case "NOTICE_PERIOD":
      return `${Number(v.days)} business days' notice of each call`;
    case "MFN":
      return "May elect terms granted to other investors of the same size or smaller";
    case "LPAC_SEAT":
      return "A seat on the advisory committee";
    case "REPORTING":
      return text(v.report);
    case "CO_INVEST":
      return text(v.rights);
    default:
      return text(v.topic) || "No parameters";
  }
};

/** The letter with every proposed term's source sentence marked, so a reviewer reads the term where it was written. */
const Marked = ({ letter, active }: { letter: SideLetter; active: string | null }) => {
  const spans = letter.provisions
    .filter((p) => p.quote_start != null && p.quote_end != null)
    .sort((a, b) => (a.quote_start ?? 0) - (b.quote_start ?? 0));
  const out: ReactNode[] = [];
  let at = 0;
  for (const p of spans) {
    const s = p.quote_start ?? 0;
    const e = p.quote_end ?? 0;
    if (s < at) continue; // overlapping quotes: the first one wins the mark
    out.push(letter.body.slice(at, s));
    out.push(
      <mark key={p.id} id={`q-${p.id}`} data-status={p.status} data-active={active === p.id}>
        {letter.body.slice(s, e)}
      </mark>,
    );
    at = e;
  }
  out.push(letter.body.slice(at));
  return <div className="letter__body">{out}</div>;
};

const Term = ({ p, letter, active, onPick }: { p: Provision; letter: SideLetter; active: boolean; onPick: () => void }) => {
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => api.post(`/v1/provisions/${p.id}/decision`, { decision }, crypto.randomUUID()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.letter(letter.id) });
      void qc.invalidateQueries({ queryKey: ["provisions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
  const uploader = letter.uploaded_by === currentSession()?.sub;
  return (
    <motion.li variants={reveal} className="term" data-active={active}>
      <button type="button" className="term__pick" onClick={onPick} aria-label={`Show where ${TYPE_LABEL[p.type] ?? p.type} is written`}>
        <span className="term__type">{TYPE_LABEL[p.type] ?? p.type}</span>
        <span>{summarize(p)}</span>
      </button>
      <div className="term__meta">
        <StatusPill status={p.status} />
        <span>{p.category.toLowerCase()}</span>
        <span>read by {p.extractor}</span>
        {p.quote == null ? <span className="term__warn">no source sentence</span> : null}
      </div>
      {p.status === "proposed" && can("approver") ? (
        <div className="term__actions">
          <Button tone="stamp" disabled={decide.isPending || uploader} onClick={() => decide.mutate("approve")}>
            Approve term
          </Button>
          <Button disabled={decide.isPending || uploader} onClick={() => decide.mutate("reject")}>
            Reject
          </Button>
          {uploader ? <span className="field-hint">You uploaded this letter, so a second person reviews it.</span> : null}
        </div>
      ) : null}
      {p.decided_by ? <p className="field-hint">Decided by {p.decided_by.split("@")[0]}</p> : null}
      {decide.isError ? <p className="form-error">{problemText(decide.error)}</p> : null}
    </motion.li>
  );
};

export const LetterReader = () => {
  const { letterId } = route.useParams();
  const letter = useLetter(letterId);
  const [active, setActive] = useState<string | null>(null);
  const pick = (id: string) => {
    setActive(id);
    document.getElementById(`q-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <QueryView
      query={letter}
      skeleton={
        <div style={{ display: "grid", gap: "var(--s-4)" }}>
          <Skeleton w={420} h={30} />
          <SkeletonRows rows={10} cols={2} />
        </div>
      }
    >
      {(l) => (
        <div>
          <p>
            <Link to="/funds/$fundId/side-letters" params={{ fundId: l.fund_id }}>
              Side letters
            </Link>
          </p>
          <header className="page-head">
            <div>
              <h1>{l.title}</h1>
              <p>
                Uploaded by {l.uploaded_by.split("@")[0]} on {new Date(l.created_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}.{" "}
                <StatusPill status={l.status} />
              </p>
            </div>
          </header>
          <div className="reader">
            <motion.article
              className="letter panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
            >
              <Marked letter={l} active={active} />
            </motion.article>
            <aside className="terms" aria-label="Terms read from the letter">
              <h2>Terms</h2>
              {l.status === "extracting" ? (
                <div role="status">
                  <p className="field-hint">Reading the letter. Proposed terms appear here in a moment.</p>
                  <SkeletonRows rows={3} cols={1} />
                </div>
              ) : l.provisions.length === 0 ? (
                <EmptyState title="No terms found">
                  Nothing in this letter changes how calls, fees or distributions are calculated.
                </EmptyState>
              ) : (
                <motion.ul className="term-list" variants={listReveal} initial="hidden" animate="shown">
                  {l.provisions.map((p) => (
                    <Term key={p.id} p={p} letter={l} active={active === p.id} onPick={() => pick(p.id)} />
                  ))}
                </motion.ul>
              )}
            </aside>
          </div>
        </div>
      )}
    </QueryView>
  );
};
