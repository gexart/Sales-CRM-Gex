import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { setTimeZone } from "./format";
import type { Role } from "../../shared/enums";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  timezone: string;
}

interface AuthState {
  user: Me | null;
  needsSetup: boolean;
  loading: boolean;
  refresh: () => Promise<unknown>;
  isManager: boolean;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.get<{ data: { needsSetup: boolean; user: Me | null } }>("/auth/status").then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    const onUnauth = () => qc.invalidateQueries({ queryKey: ["auth-status"] });
    window.addEventListener("gexart:unauthenticated", onUnauth);
    return () => window.removeEventListener("gexart:unauthenticated", onUnauth);
  }, [qc]);
  const user = q.data?.user ?? null;
  if (user) setTimeZone(user.timezone);
  return (
    <Ctx.Provider
      value={{
        user,
        needsSetup: q.data?.needsSetup ?? false,
        loading: q.isLoading,
        // Drop every cached record (they belong to the previous session), then reload who is signed in.
        refresh: async () => {
          qc.removeQueries({ predicate: (x) => x.queryKey[0] !== "auth-status" });
          await qc.refetchQueries({ queryKey: ["auth-status"] });
        },
        isManager: user?.role === "admin" || user?.role === "manager",
        isAdmin: user?.role === "admin",
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
