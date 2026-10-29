/**
 * Tenancy guard: a Kysely plugin that refuses any query touching a tenant table unless the query
 * itself restricts that table by tenant_id (a WHERE or JOIN condition naming the table's
 * tenant_id column) or, for inserts, writes a tenant_id. MySQL has no row-level security; this
 * makes "forgot the tenant filter" a crash in tests rather than a data leak in production.
 */
import type {
  KyselyPlugin,
  OperationNode,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from "kysely";
import { TENANT_TABLES } from "./schema.js";

export class TenancyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenancyViolation";
  }
}

type AnyNode = OperationNode & Record<string, unknown>;

const children = (node: AnyNode): AnyNode[] => {
  const out: AnyNode[] = [];
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === "object" && "kind" in x) out.push(x as AnyNode);
    } else if (v && typeof v === "object" && "kind" in v) {
      out.push(v as AnyNode);
    }
  }
  return out;
};

const walk = (node: AnyNode, visit: (n: AnyNode) => void): void => {
  visit(node);
  for (const c of children(node)) walk(c, visit);
};

const tableName = (n: AnyNode): string | undefined => {
  // TableNode { table: SchemableIdentifierNode { identifier: IdentifierNode { name } } }
  const t = n.table as AnyNode | undefined;
  const id = t?.identifier as AnyNode | undefined;
  return typeof id?.name === "string" ? (id.name as string) : undefined;
};

/** Tables a query reads or writes, with the name they go by in it (alias or table name). */
const referencedTables = (root: AnyNode): Array<{ table: string; as: string }> => {
  const out: Array<{ table: string; as: string }> = [];
  walk(root, (n) => {
    if (n.kind === "AliasNode" && (n.node as AnyNode)?.kind === "TableNode") {
      const t = tableName(n.node as AnyNode);
      const alias = (n.alias as AnyNode)?.name;
      if (t && typeof alias === "string") out.push({ table: t, as: alias });
    }
  });
  walk(root, (n) => {
    if (n.kind === "TableNode") {
      const t = tableName(n);
      if (t && !out.some((o) => o.table === t)) out.push({ table: t, as: t });
    }
  });
  return out.filter((o) => TENANT_TABLES.has(o.table));
};

/** Names qualifying tenant_id references in the conditions ("" for an unqualified one). */
const tenantQualifiers = (root: AnyNode): Set<string> => {
  const quals = new Set<string>();
  walk(root, (n) => {
    if (n.kind !== "ReferenceNode") return;
    const col = n.column as AnyNode;
    const colName = (col?.column as AnyNode)?.name;
    if (colName !== "tenant_id") return;
    const t = n.table as AnyNode | undefined;
    quals.add(t ? (tableName(t) ?? "") : "");
  });
  return quals;
};

export const checkTenancy = (node: RootOperationNode): void => {
  const root = node as unknown as AnyNode;
  const tables = referencedTables(root);
  if (tables.length === 0) return;

  if (root.kind === "InsertQueryNode") {
    const cols = ((root.columns as AnyNode[] | undefined) ?? []).map((c) => (c.column as AnyNode)?.name);
    if (!cols.includes("tenant_id")) throw new TenancyViolation(`insert into ${tables[0]?.table} without tenant_id`);
    return;
  }
  // conditions live in where / on / having clauses; collect their tenant_id references
  const conds: AnyNode[] = [];
  walk(root, (n) => {
    if (n.kind === "WhereNode" || n.kind === "OnNode") conds.push(n);
  });
  const quals = new Set<string>();
  for (const c of conds) for (const q of tenantQualifiers(c)) quals.add(q);
  for (const t of tables) {
    const ok = quals.has(t.as) || quals.has(t.table) || (quals.has("") && tables.length === 1);
    if (!ok) throw new TenancyViolation(`${root.kind} on ${t.table} is not restricted by tenant_id`);
  }
};

export class TenancyGuard implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    if (args.node.kind !== "RawNode") checkTenancy(args.node);
    return args.node;
  }
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}
