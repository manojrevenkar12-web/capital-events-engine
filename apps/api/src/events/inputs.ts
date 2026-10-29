/** Request schemas for capital events. Money is cents as an integer string or number. */
import { z } from "zod";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => String(v));

export const CallComponentInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("expense"), amount: cents, description: z.string().max(200).default("Fund expenses") }),
  z.object({ kind: z.literal("fee"), periodStart: iso, periodEnd: iso }),
  z.object({
    kind: z.literal("investment"),
    deal: z.string().min(1).max(60),
    sectors: z.array(z.string().min(1).max(40)).max(10).default([]),
    amount: cents,
  }),
]);
export type CallComponentInput = z.infer<typeof CallComponentInput>;

export const CreateCall = z.object({
  reference: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,24}$/),
  issueDate: iso,
  components: z.array(CallComponentInput).min(1).max(20),
});

export const CreateDistribution = z.object({
  reference: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,24}$/),
  date: iso,
  deal: z.string().min(1).max(60),
  amount: cents,
});

export const CreateClosing = z.object({
  reference: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,24}$/),
  closeDate: iso,
  admissions: z
    .array(z.object({ investorId: z.string(), amount: cents }))
    .min(1)
    .max(2000),
});
