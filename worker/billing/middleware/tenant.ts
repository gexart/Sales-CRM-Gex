/** Request context the billing routes read. Filled in by the CRM bridge (see worker/billing/bridge.ts). */
export interface MembershipContext {
  id: string;
  userId: string;
  businessId: string;
  roleKey: string;
  permissions: string[];
  branchIds: string[];
}

export interface BusinessVariables {
  userId?: string;
  businessId?: string;
  membership?: MembershipContext;
  businessStub?: any;
}

/** One CRM = one billing workspace per company. Resolves the company id used to address the billing Durable Object. */
export function requirePublicBusinessId(c: { get: (k: string) => unknown; req: { header: (n: string) => string | undefined } }): string {
  return String(c.get('businessId') || c.req.header('X-Business-Id') || 'default');
}
