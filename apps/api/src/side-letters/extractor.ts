/**
 * Side-letter extraction: turn a letter's text into proposed provisions, each tied to the exact
 * sentence it came from. Two implementations: deterministic rules (default, used in CI) and
 * Claude with a tool schema. Both go through the same grounding check: a provision whose quote
 * is not found verbatim in the letter is dropped. Nothing extracted takes effect until a
 * reviewer approves it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export interface ExtractContext {
  feeRateBps: number;
  carryBps: number;
}

export interface Proposed {
  type: string;
  params: Record<string, unknown>;
  category: string;
  quote: string;
  start: number;
  end: number;
}

export interface Extractor {
  readonly name: string;
  extract(text: string, ctx: ExtractContext): Promise<Proposed[]>;
}

export const CATEGORIES = [
  "ECONOMIC",
  "REPORTING",
  "GOVERNANCE",
  "REGULATORY_LP_SPECIFIC",
  "TAX_LP_SPECIFIC",
  "LPAC_SEAT",
  "FIRST_CLOSE_INCENTIVE",
  "CO_INVEST",
] as const;

export const ParamSchemas: Record<string, z.ZodType> = {
  FEE_DISCOUNT: z.object({ bps: z.number().int().min(1).max(10_000) }),
  CARRY_DISCOUNT: z.object({ bps: z.number().int().min(1).max(10_000) }),
  NOTICE_PERIOD: z.object({ days: z.number().int().min(1).max(90) }),
  EXCUSE_RIGHT: z.object({ sectors: z.array(z.string()).min(1) }),
  REPORTING: z.object({ report: z.string().min(1) }),
  MFN: z.object({}),
  LPAC_SEAT: z.object({ seat: z.literal(true) }),
  CO_INVEST: z.object({ rights: z.string().min(1) }),
  TAX: z.object({ topic: z.string().min(1) }),
  DISCLOSURE: z.object({ topic: z.string().min(1) }),
};

/** Sector vocabulary the engine's excuse rules use; side letters name them many ways. */
const SECTORS: Array<[RegExp, string]> = [
  [/tobacco/i, "tobacco"],
  [/gambling|gaming|betting/i, "gambling"],
  [/weapon|arms|munition|defen[cs]e/i, "weapons"],
  [/fossil|coal|oil and gas|oil & gas|thermal coal/i, "fossil_fuels"],
  [/adult entertainment|pornograph/i, "adult_entertainment"],
  [/alcohol|spirits/i, "alcohol"],
  [/nuclear/i, "nuclear"],
  [/cannabis|marijuana/i, "cannabis"],
];

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  "twenty-one": 21,
  "twenty-five": 25,
  thirty: 30,
  "forty-five": 45,
  sixty: 60,
};

/** Sentences with their offsets; clause numbers like "3.1" do not end a sentence. */
export const sentences = (text: string): Array<{ s: string; start: number; end: number }> => {
  const out: Array<{ s: string; start: number; end: number }> = [];
  const re = /[^.;\n]*(?:\d\.\d[^.;\n]*)*(?:[.;]|\n|$)/g;
  let m: RegExpExecArray | null;
  for (;;) {
    m = re.exec(text);
    if (!m || m[0] === "") {
      if (!m || re.lastIndex >= text.length) break;
      re.lastIndex += 1;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const s = raw.trim();
    if (s.length > 3) out.push({ s, start: m.index + lead, end: m.index + lead + s.length });
  }
  return out;
};

const pct = (x: string) => Math.round(Number(x) * 100);

export class RulesExtractor implements Extractor {
  readonly name = "rules-v1";

  async extract(text: string, ctx: ExtractContext): Promise<Proposed[]> {
    const out: Proposed[] = [];
    for (const { s, start, end } of sentences(text)) {
      const add = (type: string, params: Record<string, unknown>, category: string) =>
        out.push({ type, params, category, quote: s, start, end });
      const firstClose = /first clos/i.test(s);

      let m = /management fee[^.;]*?(?:reduc\w*|discount\w*|rebate\w*)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(?:basis points|bps|bp)\b/i.exec(s);
      if (m?.[1]) add("FEE_DISCOUNT", { bps: Math.round(Number(m[1])) }, firstClose ? "FIRST_CLOSE_INCENTIVE" : "ECONOMIC");
      else {
        m = /management fee[^.;]*?(?:at a rate of|equal to|shall be)\s+(\d+(?:\.\d+)?)\s*(?:%|per cent|percent)/i.exec(s);
        if (m?.[1] && pct(m[1]) < ctx.feeRateBps) {
          add("FEE_DISCOUNT", { bps: ctx.feeRateBps - pct(m[1]) }, firstClose ? "FIRST_CLOSE_INCENTIVE" : "ECONOMIC");
        }
      }

      m = /(?:carried interest|carry)[^.;]*?(?:reduced to|shall be|equal to|of)\s+(\d+(?:\.\d+)?)\s*(?:%|per cent|percent)/i.exec(s);
      if (m?.[1] && pct(m[1]) < ctx.carryBps) add("CARRY_DISCOUNT", { bps: ctx.carryBps - pct(m[1]) }, "ECONOMIC");

      if (/\bexcus/i.test(s) || /shall not be required to (?:participate|fund|contribute)/i.test(s)) {
        const sectors = SECTORS.filter(([re]) => re.test(s)).map(([, name]) => name);
        if (sectors.length > 0) {
          const lpSpecific = /\b(?:law|regulat\w*|statut\w*|Sharia|religio\w*|charter|investment policy)\b/i.test(s);
          add("EXCUSE_RIGHT", { sectors: [...new Set(sectors)].sort() }, lpSpecific ? "REGULATORY_LP_SPECIFIC" : "ECONOMIC");
        }
      }

      m = /(?:not less than|at least|no fewer than|minimum of)\s+([a-z-]+|\d+)\s*(?:\((\d+)\)\s*)?business days/i.exec(s);
      if (m && /notice/i.test(s) && /(?:drawdown|capital call|call|contribution)/i.test(s)) {
        const days = m[2] ? Number(m[2]) : (WORDS[(m[1] ?? "").toLowerCase()] ?? Number(m[1]));
        if (Number.isInteger(days) && days > 0) add("NOTICE_PERIOD", { days }, "GOVERNANCE");
      }

      m =
        /\b(quarterly|annual|annually|semi-annual|monthly)\b[^.;]*?\b(ESG|sustainability|SFDR|principal adverse impact|PAI|carbon|climate|portfolio company|valuation)\b[^.;]*?\breports?\b/i.exec(
          s,
        ) ??
        /\b(ESG|sustainability|SFDR|principal adverse impact|PAI|carbon|climate|portfolio company|valuation)\b[^.;]*?\breports?\b[^.;]*?\b(quarterly|annual|annually|semi-annual|monthly)\b/i.exec(
          s,
        );
      if (m && /(?:shall|will|agrees to)\s+(?:provide|deliver|furnish|send|prepare)/i.test(s)) {
        const freq =
          /quarterly|annual|annually|semi-annual|monthly/i.exec(s)?.[0]?.toLowerCase().replace("annually", "annual") ?? "periodic";
        const topic =
          /ESG|sustainability|SFDR|principal adverse impact|PAI|carbon|climate|portfolio company|valuation/i.exec(s)?.[0] ?? "report";
        add("REPORTING", { report: `${freq} ${topic.toLowerCase().replace("principal adverse impact", "pai")}` }, "REPORTING");
      }

      if (/most[- ]favou?red[- ]nation/i.test(s) && /(?:elect|entitled|receive|benefit)/i.test(s)) add("MFN", {}, "GOVERNANCE");
      if (/advisory committee/i.test(s) && /(?:seat|appoint|representative|member)/i.test(s)) add("LPAC_SEAT", { seat: true }, "LPAC_SEAT");
      if (/co-?invest/i.test(s) && /(?:offer|opportunit|right)/i.test(s)) add("CO_INVEST", { rights: "co-investment offers" }, "CO_INVEST");
      if (
        /(?:withholding|tax (?:status|treaty|exempt)|tax-exempt|FATCA|CRS)/i.test(s) &&
        /(?:shall|will|use (?:reasonable|commercially))/i.test(s)
      ) {
        add("TAX", { topic: /withholding/i.test(s) ? "withholding" : "tax status" }, "TAX_LP_SPECIFIC");
      }
      if (/freedom of information|public records|transparency (?:law|act)|Informationsfreiheit/i.test(s) && /disclos/i.test(s)) {
        add("DISCLOSURE", { topic: "public disclosure laws" }, "REGULATORY_LP_SPECIFIC");
      }
    }
    return out;
  }
}

const ToolInput = z.object({
  provisions: z.array(
    z.object({
      type: z.enum(Object.keys(ParamSchemas) as [string, ...string[]]),
      params: z.record(z.string(), z.unknown()),
      category: z.enum(CATEGORIES),
      quote: z.string().min(10),
    }),
  ),
});

export class ClaudeExtractor implements Extractor {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
    this.name = `claude:${model}`;
  }

  async extract(text: string, ctx: ExtractContext): Promise<Proposed[]> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system:
        "You extract obligations from private-fund side letters for a fund administrator. " +
        "Record only terms the letter actually grants. Quote the sentence verbatim; never paraphrase. " +
        `The fund's management fee is ${ctx.feeRateBps} bps and its carried interest ${ctx.carryBps} bps: express fee and ` +
        "carry terms as discounts in bps from those. Sectors for excuse rights use these names: tobacco, gambling, " +
        "weapons, fossil_fuels, adult_entertainment, alcohol, nuclear, cannabis.",
      tools: [
        {
          name: "record_provisions",
          description: "Record every provision granted by the side letter.",
          input_schema: z.toJSONSchema(ToolInput) as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "record_provisions" },
      messages: [{ role: "user", content: `<side_letter>\n${text}\n</side_letter>` }],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") return [];
    const parsed = ToolInput.safeParse(call.input);
    if (!parsed.success) return [];
    return parsed.data.provisions.map((p) => ({ ...p, start: -1, end: -1 }));
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Keep only provisions whose quote appears verbatim in the letter (whitespace-insensitive) and
 * whose parameters validate; set their offsets from the letter itself.
 */
export const ground = (text: string, proposed: Proposed[]): { kept: Proposed[]; dropped: Array<{ p: Proposed; why: string }> } => {
  const kept: Proposed[] = [];
  const dropped: Array<{ p: Proposed; why: string }> = [];
  const flat = norm(text);
  for (const p of proposed) {
    const schema = ParamSchemas[p.type];
    if (!schema) {
      dropped.push({ p, why: `unknown type ${p.type}` });
      continue;
    }
    if (!schema.safeParse(p.params).success) {
      dropped.push({ p, why: "parameters do not validate" });
      continue;
    }
    const q = norm(p.quote);
    let start = text.indexOf(p.quote);
    if (start < 0 && flat.includes(q)) {
      // locate by walking the original text with whitespace collapsed
      const re = new RegExp(
        q
          .split(" ")
          .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\s+"),
      );
      start = re.exec(text)?.index ?? -1;
    }
    if (start < 0) {
      dropped.push({ p, why: "quote not found in the letter" });
      continue;
    }
    const m = new RegExp(
      q
        .split(" ")
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+"),
    ).exec(text.slice(start));
    kept.push({ ...p, start, end: start + (m?.[0].length ?? p.quote.length) });
  }
  return { kept, dropped };
};
