import { FormEvent, useState } from "react";
import { api, setToken } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Field } from "../components/ui";

export default function Login() {
  const { setUser, meta } = useSession();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/auth/login", { login, password });
      setToken(r.token);
      setUser({ ...r.user, idle_minutes: r.idle_minutes });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card col" onSubmit={submit}>
        <h1>PROCEDURAL AI</h1>
        <p className="muted small">Система подготовки процессуальных документов следователя. Доступ только для авторизованных пользователей; действия фиксируются в журнале.</p>
        {meta.logoutReason ? <div className="notice info">{meta.logoutReason}</div> : null}
        {error ? <div className="notice danger" role="alert">{error}</div> : null}
        <Field label="Логин"><input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoFocus /></Field>
        <Field label="Пароль"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <Button variant="primary" type="submit" busy={busy} disabled={!login || !password}>Войти</Button>
      </form>
    </div>
  );
}
