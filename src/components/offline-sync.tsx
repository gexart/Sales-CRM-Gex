import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { flushQueue, queuedCount } from "../lib/offline-queue";
import { useToast } from "./ui";

/** Sends invoice requests saved while offline, and shows a small notice while any are waiting. */
export function OfflineSync() {
  const [n, setN] = useState(queuedCount());
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    const run = async () => {
      if (!queuedCount() || navigator.onLine === false) return;
      const r = await flushQueue();
      if (r.sent) {
        toast("success", `${r.sent} saved invoice request${r.sent === 1 ? "" : "s"} sent for approval`);
        qc.invalidateQueries({ queryKey: ["billing-approvals"] });
        qc.invalidateQueries({ queryKey: ["billing-pending"] });
      }
      if (r.dropped) toast("error", `${r.dropped} saved request${r.dropped === 1 ? " was" : "s were"} rejected by the server and removed`);
    };
    const upd = () => setN(queuedCount());
    window.addEventListener("online", run);
    window.addEventListener("gexart:queue", upd);
    const t = setInterval(run, 60_000);
    run();
    return () => {
      window.removeEventListener("online", run);
      window.removeEventListener("gexart:queue", upd);
      clearInterval(t);
    };
  }, [toast, qc]);
  if (!n) return null;
  return (
    <div className="fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-white shadow">
      <CloudOff className="size-3.5" /> {n} request{n === 1 ? "" : "s"} waiting to send
    </div>
  );
}
