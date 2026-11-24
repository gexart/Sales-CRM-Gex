/** Bindings the billing module needs. The CRM worker's own Env is a superset of this. */
export interface Env {
  BILLING_DO: DurableObjectNamespace;
  DB: D1Database;
  FILES: R2Bucket;
  ENVIRONMENT?: string;
  [key: string]: any;
}
