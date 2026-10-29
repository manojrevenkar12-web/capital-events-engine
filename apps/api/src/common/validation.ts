import type { z } from "zod";

/** Parse with a zod schema; a ZodError becomes a 400 problem in the filter. */
export const parse = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => schema.parse(value);
