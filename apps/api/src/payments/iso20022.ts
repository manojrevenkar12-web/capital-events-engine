/**
 * ISO 20022 messages: pain.001.001.09 credit transfers (distributions and refunds out) and
 * camt.054.001.08 debit/credit notifications (capital call payments in).
 */
import { XMLParser } from "fast-xml-parser";
import { escapeXml } from "../common/util.js";

export interface CreditTransfer {
  endToEndId: string;
  amount: bigint;
  creditorName: string;
  creditorIban: string;
  creditorBic: string;
  remittance: string;
}

const amt = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;

export const pain001 = (opts: {
  msgId: string;
  createdAt: string;
  debtorName: string;
  debtorIban: string;
  debtorBic: string;
  executionDate: string;
  currency: string;
  transfers: CreditTransfer[];
}): { xml: string; controlSum: bigint } => {
  const controlSum = opts.transfers.reduce((s, t) => s + t.amount, 0n);
  const tx = opts.transfers
    .map(
      (t) => `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${escapeXml(t.endToEndId)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="${opts.currency}">${amt(t.amount)}</InstdAmt></Amt>
        <CdtrAgt><FinInstnId><BICFI>${escapeXml(t.creditorBic)}</BICFI></FinInstnId></CdtrAgt>
        <Cdtr><Nm>${escapeXml(t.creditorName.slice(0, 70))}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${escapeXml(t.creditorIban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${escapeXml(t.remittance.slice(0, 140))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${escapeXml(opts.msgId)}</MsgId>
      <CreDtTm>${opts.createdAt}</CreDtTm>
      <NbOfTxs>${opts.transfers.length}</NbOfTxs>
      <CtrlSum>${amt(controlSum)}</CtrlSum>
      <InitgPty><Nm>${escapeXml(opts.debtorName.slice(0, 70))}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${escapeXml(opts.msgId)}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${opts.transfers.length}</NbOfTxs>
      <CtrlSum>${amt(controlSum)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt><Dt>${opts.executionDate}</Dt></ReqdExctnDt>
      <Dbtr><Nm>${escapeXml(opts.debtorName.slice(0, 70))}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${escapeXml(opts.debtorIban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>${escapeXml(opts.debtorBic)}</BICFI></FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
  return { xml, controlSum };
};

export interface CamtEntry {
  acctSvcrRef: string;
  amount: bigint;
  credit: boolean;
  bookingDate: string;
  endToEndId: string | null;
  remittance: string | null;
  debtorName: string | null;
  debtorIban: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => ["Ntfctn", "Ntry", "NtryDtls", "TxDtls", "Ustrd"].includes(name),
});

const cents = (s: string): bigint => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`bad amount ${s}`);
  return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "0").padEnd(2, "0"));
};

type X = Record<string, unknown>;
const at = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as X)[k] : undefined), o);
const text = (v: unknown): string | null => (v == null ? null : typeof v === "object" ? String((v as X)["#text"] ?? "") : String(v));

/** Parse a camt.054 notification into its booked entries (one per transaction detail). */
export const parseCamt054 = (xml: string): { msgId: string; entries: CamtEntry[] } => {
  const doc = parser.parse(xml) as X;
  const root = at(doc, "Document", "BkToCstmrDbtCdtNtfctn");
  if (!root) throw new Error("not a camt.054 document");
  const msgId = text(at(root, "GrpHdr", "MsgId"));
  if (!msgId) throw new Error("camt.054 without MsgId");
  const entries: CamtEntry[] = [];
  for (const n of (at(root, "Ntfctn") as X[] | undefined) ?? []) {
    for (const e of (at(n, "Ntry") as X[] | undefined) ?? []) {
      const credit = text(at(e, "CdtDbtInd")) === "CRDT";
      const booking = text(at(e, "BookgDt", "Dt")) ?? text(at(e, "BookgDt", "DtTm"))?.slice(0, 10) ?? "";
      const entryRef = text(at(e, "AcctSvcrRef")) ?? text(at(e, "NtryRef")) ?? "";
      const txs = ((at(e, "NtryDtls") as X[] | undefined) ?? []).flatMap((d) => (at(d, "TxDtls") as X[] | undefined) ?? []);
      if (txs.length === 0) {
        entries.push({
          acctSvcrRef: entryRef,
          amount: cents(text(at(e, "Amt")) ?? "0"),
          credit,
          bookingDate: booking,
          endToEndId: null,
          remittance: null,
          debtorName: null,
          debtorIban: null,
        });
        continue;
      }
      txs.forEach((t, i) => {
        const e2e = text(at(t, "Refs", "EndToEndId"));
        entries.push({
          acctSvcrRef: text(at(t, "Refs", "AcctSvcrRef")) ?? (txs.length > 1 ? `${entryRef}/${i + 1}` : entryRef),
          amount: cents(text(at(t, "Amt")) ?? text(at(e, "Amt")) ?? "0"),
          credit,
          bookingDate: booking,
          endToEndId: e2e && e2e !== "NOTPROVIDED" ? e2e : null,
          remittance: ((at(t, "RmtInf", "Ustrd") as unknown[] | undefined) ?? []).map(text).join(" ") || null,
          debtorName: text(at(t, "RltdPties", "Dbtr", "Pty", "Nm")) ?? text(at(t, "RltdPties", "Dbtr", "Nm")),
          debtorIban: text(at(t, "RltdPties", "DbtrAcct", "Id", "IBAN")),
        });
      });
    }
  }
  return { msgId, entries };
};

/** A camt.054 for tests and the simulator: what the fund's bank would send. */
export const camt054 = (
  msgId: string,
  iban: string,
  currency: string,
  entries: Array<Omit<CamtEntry, "credit">>,
): string => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>${escapeXml(msgId)}</MsgId><CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm></GrpHdr>
    <Ntfctn>
      <Id>${escapeXml(msgId)}-1</Id>
      <CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm>
      <Acct><Id><IBAN>${escapeXml(iban)}</IBAN></Id></Acct>
${entries
  .map(
    (e) => `      <Ntry>
        <Amt Ccy="${currency}">${amt(e.amount)}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>${e.bookingDate}</Dt></BookgDt>
        <ValDt><Dt>${e.bookingDate}</Dt></ValDt>
        <AcctSvcrRef>${escapeXml(e.acctSvcrRef)}</AcctSvcrRef>
        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>
        <NtryDtls><TxDtls>
          <Refs><AcctSvcrRef>${escapeXml(e.acctSvcrRef)}</AcctSvcrRef><EndToEndId>${escapeXml(e.endToEndId ?? "NOTPROVIDED")}</EndToEndId></Refs>
          <Amt Ccy="${currency}">${amt(e.amount)}</Amt>
          <RltdPties><Dbtr><Pty><Nm>${escapeXml(e.debtorName ?? "")}</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>${escapeXml(e.debtorIban ?? "")}</IBAN></Id></DbtrAcct></RltdPties>
          ${e.remittance ? `<RmtInf><Ustrd>${escapeXml(e.remittance)}</Ustrd></RmtInf>` : ""}
        </TxDtls></NtryDtls>
      </Ntry>`,
  )
  .join("\n")}
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>
`;
