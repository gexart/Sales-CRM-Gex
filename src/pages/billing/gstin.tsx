import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { bill } from "../../lib/billing";

export interface GstinDetails {
  gstin: string;
  valid: boolean;
  error?: string;
  stateCode?: string;
  stateName?: string;
  pan?: string;
  source: "checksum_only" | "gst_network";
  providerConfigured: boolean;
  legalName?: string;
  tradeName?: string;
  status?: string;
  address?: string;
  pincode?: string;
}

/**
 * Type a GSTIN and the customer's details appear. The state and PAN always come from the number itself. The registered name and
 * address come from a GST data provider when one is set up in Settings, Configuration, GST lookup.
 */
export function GstinStatus({ gstin, onFill }: { gstin: string; onFill: (d: GstinDetails) => void }) {
  const g = gstin.trim().toUpperCase();
  const ready = /^[0-9A-Z]{15}$/.test(g);
  const q = useQuery({ queryKey: ["gstin", g], queryFn: () => bill.get<{ details: GstinDetails }>(`/masters/gstin/${g}`), enabled: ready, staleTime: 600_000, retry: false });
  const d = q.data?.details;
  const filled = useRef("");
  useEffect(() => {
    if (d?.valid && filled.current !== g) {
      filled.current = g;
      onFill(d);
    }
  }, [d, g, onFill]);
  if (!g) return null;
  if (!ready) return <p className="mt-1 text-xs text-muted">{g.length}/15 characters</p>;
  if (q.isLoading) return <p className="mt-1 text-xs text-muted">Checking GSTIN…</p>;
  if (q.isError || !d) return <p className="mt-1 text-xs text-amber-700">Could not check this GSTIN right now. You can still save it.</p>;
  if (!d.valid) return <p className="mt-1 text-xs text-red-600">{d.error ?? "This GSTIN is not valid"}</p>;
  if (d.source === "gst_network") return <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">✓ {d.legalName ?? d.tradeName}{d.status ? ` · ${d.status}` : ""}. Name and address filled in.</p>;
  return <p className="mt-1 text-xs text-muted">Valid GSTIN · {d.stateName} · PAN {d.pan}.{d.providerConfigured ? " The GST network had no details for it." : " To fill in the name and address automatically, add a GST data key in Settings → Configuration → GST lookup."}</p>;
}
