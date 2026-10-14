import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";

export type User = { id: string; login: string; full_name: string; role: string; role_title: string; permissions: string[]; unit?: string; must_change_password?: boolean; idle_minutes?: number };
type Session = { user: User | null; setUser: (u: User | null) => void; can: (p: string) => boolean; logout: (reason?: string) => void; meta: any };

const Ctx = createContext<Session>({ user: null, setUser: () => {}, can: () => false, logout: () => {}, meta: {} });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<any>({});
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.get<User>("/auth/me").then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    Promise.all([api.get("/meta/stages"), api.get("/participants/schema"), api.get("/files/categories"), api.get("/system/status")])
      .then(([stages, participants, files, system]) => setMeta({ stages, participants, files, system }))
      .catch(() => {});
  }, [user]);

  // Автоматическая блокировка при бездействии (дублирует серверный контроль сессии)
  useEffect(() => {
    if (!user) return;
    const limit = (user.idle_minutes ?? 30) * 60 * 1000;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const evs = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => { if (Date.now() - last > limit) logout("Сеанс заблокирован после периода бездействия."); }, 15000);
    return () => { evs.forEach((e) => window.removeEventListener(e, touch)); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const on = (e: Event) => { setUser(null); setReason((e as CustomEvent).detail ?? null); };
    window.addEventListener("pai:logout", on);
    return () => window.removeEventListener("pai:logout", on);
  }, []);

  function logout(r?: string) {
    api.post("/auth/logout").catch(() => {});
    setToken(null);
    setUser(null);
    setReason(r ?? null);
  }

  const can = (p: string) => !!user?.permissions?.includes(p);
  if (!ready) return null;
  return <Ctx.Provider value={{ user, setUser: (u) => { setUser(u); setReason(null); }, can, logout, meta: { ...meta, logoutReason: reason } }}>{children}</Ctx.Provider>;
}
