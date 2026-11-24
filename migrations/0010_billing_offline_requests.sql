-- Invoice requests made offline on a phone are sent later. The phone-generated reference makes a retry safe:
-- the same request can never create two approvals.
ALTER TABLE billing_approvals ADD COLUMN client_ref TEXT;
CREATE UNIQUE INDEX idx_billing_approvals_client_ref ON billing_approvals(requested_by, client_ref) WHERE client_ref IS NOT NULL;
