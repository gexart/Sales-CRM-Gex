import { useEffect } from "react";
import { api, type Row } from "../lib/api";

type Bridge = { isApp(): boolean; recorderConfigured(): boolean; configure(url: string, token: string): boolean };

/**
 * Inside the Gexart Android app: the first time someone signs in, this phone is paired automatically, which switches on
 * approval notifications and call syncing. Nothing to type or copy. Outside the app it does nothing.
 */
export function AppPairing() {
  useEffect(() => {
    const bridge = (window as unknown as { GexartApp?: Bridge }).GexartApp;
    if (!bridge || bridge.recorderConfigured()) return;
    try {
      if (sessionStorage.getItem("gx-pairing")) return; // at most one attempt per app launch
      sessionStorage.setItem("gx-pairing", "1");
    } catch {
      /* storage blocked: still try once */
    }
    api
      .post<{ data: Row }>("/devices", { name: `Android app · ${new Date().toLocaleDateString("en-IN")}` })
      .then((r) => bridge.configure(window.location.origin, String(r.data.token)))
      .catch(() => undefined);
  }, []);
  return null;
}
