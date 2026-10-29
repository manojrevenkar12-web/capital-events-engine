export type Role = "preparer" | "approver" | "viewer" | "investor" | "admin";

export interface Principal {
  sub: string;
  name: string;
  tenantId: string;
  roles: Role[];
  /** For investor-portal users: the investor they act for. */
  investorId?: string;
}
