import { FormEvent, useState } from "react";
import { api, DEMO } from "./lib/api";
import { match, navigate, useRoute } from "./lib/router";
import { useSession } from "./lib/session";
import { Badge, Button, Field, Modal, useToast } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Cases from "./pages/Cases";
import CaseView from "./pages/CaseView";
import DocumentWorkspace from "./pages/DocumentWorkspace";
import Deadlines from "./pages/Deadlines";
import Legal from "./pages/Legal";
import Catalog from "./pages/Catalog";
import Audit from "./pages/Audit";
import Admin from "./pages/Admin";
import Search from "./pages/Search";

export default function App() {
  const { user } = useSession();
  if (!user) return <Login />;
  return <Shell />;
}

function Shell() {
  const { user, can, logout, meta } = useSession();
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");
  const [pwd, setPwd] = useState(!!user?.must_change_password);
  const path = route.path;
  const nav = [
    { to: "/", label: "Главная панель" },
    { to: "/cases", label: "Уголовные дела" },
    { to: "/deadlines", label: "Сроки и календарь" },
    { to: "/legal", label: "Правовой справочник" },
    { to: "/catalog", label: "Каталог документов" },
    ...(can("audit.read") ? [{ to: "/audit", label: "Журнал действий" }] : []),
    ...(can("users.manage") || can("settings.manage") ? [{ to: "/admin", label: "Администрирование" }] : []),
  ];
  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
  const sys = meta.system;

  let page: JSX.Element;
  let m: Record<string, string> | null;
  if ((m = match("/cases/:id", path))) page = <CaseView id={m.id} tab={route.query.get("tab") ?? "general"} query={route.query} />;
  else if ((m = match("/documents/:id", path))) page = <DocumentWorkspace id={m.id} />;
  else if (path === "/cases") page = <Cases />;
  else if (path === "/deadlines") page = <Deadlines />;
  else if (path.startsWith("/legal")) page = <Legal query={route.query} />;
  else if (path === "/catalog") page = <Catalog />;
  else if (path === "/audit") page = <Audit />;
  else if (path === "/admin") page = <Admin />;
  else if (path === "/search") page = <Search q={route.query.get("q") ?? ""} />;
  else page = <Dashboard />;

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  function toggleTheme() {
    const cur = document.documentElement.dataset.theme;
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pai.theme", next); } catch { /* недоступно */ }
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${menu ? "open" : ""}`} onClick={() => setMenu(false)}>
        <div className="brand">PROCEDURAL AI<small>Подготовка процессуальных документов</small></div>
        <nav className="nav" aria-label="Основная навигация">
          {nav.map((n) => <a key={n.to} href={"#" + n.to} className={isActive(n.to) ? "active" : ""}>{n.label}</a>)}
        </nav>
        <div className="foot">
          <div>{user?.full_name}</div>
          <div>{user?.role_title}</div>
          {sys ? (
            <div style={{ marginTop: 6 }} className="col">
              <span>ИИ: {sys.ai.available ? <Badge tone="ok">подключён</Badge> : <Badge tone="muted">не подключён</Badge>}</span>
              <span>OCR: {sys.ocr.engine ? <Badge tone="ok">{sys.ocr.engine}</Badge> : <Badge tone="muted">не установлен</Badge>}</span>
              <span>Справочник: {sys.legal_registry_updated_at ? sys.legal_registry_updated_at.slice(0, 10) : "не обновлялся"}</span>
            </div>
          ) : null}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost menu-btn" aria-label="Меню" onClick={() => setMenu((x) => !x)}>☰</button>
          <form className="search" onSubmit={submitSearch} role="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: номер дела, участник, документ, текст материалов" aria-label="Глобальный поиск" />
          </form>
          <div className="spacer" />
          <Button size="sm" onClick={toggleTheme} title="Сменить цветовую тему">Тема</Button>
          <Button size="sm" onClick={() => setPwd(true)}>Пароль</Button>
          <Button size="sm" onClick={() => logout()}>Выход</Button>
        </header>
        {DEMO ? <DemoBanner /> : null}
        <main className="content">{page}</main>
      </div>
      {pwd ? <PasswordModal forced={!!user?.must_change_password} onClose={() => setPwd(false)} /> : null}
    </div>
  );
}

function PasswordModal({ onClose, forced }: { onClose: () => void; forced: boolean }) {
  const toast = useToast();
  const { user, setUser } = useSession();
  const [oldP, setOld] = useState("");
  const [newP, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.post("/auth/change-password", { old_password: oldP, new_password: newP });
      toast("ok", "Пароль изменён");
      if (user) setUser({ ...user, must_change_password: false });
      onClose();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Смена пароля" onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" busy={busy} onClick={save}>Сохранить</Button></>}>
      {forced ? <div className="notice warn" style={{ marginBottom: 10 }}>Требуется сменить первоначальный пароль.</div> : null}
      <div className="col">
        <Field label="Текущий пароль"><input type="password" value={oldP} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="Новый пароль" hint="Не менее 10 символов, строчные и прописные буквы, цифры"><input type="password" value={newP} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" /></Field>
      </div>
    </Modal>
  );
}

function DemoBanner() {
  const [confirming, setConfirming] = useState(false);
  async function reset() {
    const { resetDemo } = await import("./demo/server");
    resetDemo();
    window.location.hash = "/";
    window.location.reload();
  }
  return (
    <div className="notice warn small" style={{ borderRadius: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span className="grow"><b>Демонстрационная версия.</b> Данные синтетические и хранятся только в этом браузере. Обработка DOCX/PDF/сканов, языковая модель, импорт норм и экспорт PDF доступны в полной версии с сервером.</span>
      {confirming ? (
        <>
          <span>Внесённые изменения будут удалены.</span>
          <Button size="sm" variant="danger" onClick={reset}>Сбросить</Button>
          <Button size="sm" onClick={() => setConfirming(false)}>Отмена</Button>
        </>
      ) : <Button size="sm" onClick={() => setConfirming(true)}>Сбросить демо-данные</Button>}
    </div>
  );
}
