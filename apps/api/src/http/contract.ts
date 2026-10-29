/**
 * What a route accepts, recorded where the route is declared. The OpenAPI document is generated
 * from this metadata and Nest's own route metadata, so the published contract is the code's.
 */
import { SetMetadata } from "@nestjs/common";
import type { z } from "zod";

export const BODY_SCHEMA = "cee:body_schema";
export const BODY_XML = "cee:body_xml";

/** The zod schema the handler validates its JSON body with. */
export const Accepts = (schema: z.ZodType) => SetMetadata(BODY_SCHEMA, schema);
/** The handler takes an XML document (ISO 20022) as its body. */
export const AcceptsXml = () => SetMetadata(BODY_XML, true);
