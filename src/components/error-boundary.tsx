import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * If anything in the app throws while drawing, show what went wrong with a way out, instead of a blank white screen.
 * Plain inline styles on purpose: it must still look right when the stylesheet itself is the problem.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed:", error.message, info.componentStack?.split("\n").slice(0, 3).join(" | "));
  }

  private reset = async (clear: boolean) => {
    try {
      if (clear) {
        const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = (await window.caches?.keys?.()) ?? [];
        await Promise.all(keys.map((k) => window.caches.delete(k)));
        try { sessionStorage.clear(); } catch { /* blocked */ }
      }
    } finally {
      window.location.reload();
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const btn = { padding: "12px 18px", borderRadius: 10, border: "1px solid #2A3A55", background: "#1E2A3F", color: "#fff", fontSize: 15, marginRight: 10, marginTop: 10 } as const;
    return (
      <div style={{ minHeight: "100vh", background: "#141E2E", color: "#fff", padding: "56px 24px", fontFamily: "system-ui, sans-serif" }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>Something went wrong</h2>
        <p style={{ opacity: 0.7, lineHeight: 1.5 }}>The screen could not be drawn. Your data is safe. Try again, and if it keeps happening send this message to support.</p>
        <p style={{ fontSize: 12, opacity: 0.55, wordBreak: "break-word", background: "#0E1626", padding: 10, borderRadius: 8 }}>{error.message}</p>
        <button style={{ ...btn, background: "#F47A20", border: "none", fontWeight: 600 }} onClick={() => this.reset(false)}>Reload</button>
        <button style={btn} onClick={() => this.reset(true)}>Clear saved files and reload</button>
      </div>
    );
  }
}
