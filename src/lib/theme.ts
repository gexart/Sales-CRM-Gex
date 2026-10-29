// Light / dark / system appearance. The choice lives in this browser only (localStorage); index.html
// applies it before first paint so pages never flash the wrong theme.
import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "gexart-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const resolve = (p: ThemePref) => (p === "system" ? (media().matches ? "dark" : "light") : p);

function apply(p: ThemePref) {
  document.documentElement.classList.toggle("dark", resolve(p) === "dark");
}

const listeners = new Set<(p: ThemePref) => void>();

export function setPref(p: ThemePref) {
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* storage unavailable: still apply for this page */
  }
  apply(p);
  listeners.forEach((l) => l(p));
}

/** Current preference and the theme actually shown. */
export function useTheme() {
  const [pref, setState] = useState<ThemePref>(readPref);
  const [systemDark, setSystemDark] = useState(() => media().matches);
  useEffect(() => {
    listeners.add(setState);
    const m = media();
    const onChange = () => {
      setSystemDark(m.matches);
      if (readPref() === "system") apply("system");
    };
    m.addEventListener("change", onChange);
    return () => {
      listeners.delete(setState);
      m.removeEventListener("change", onChange);
    };
  }, []);
  const resolved: "light" | "dark" = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  return { pref, resolved, setPref };
}
