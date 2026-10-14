import { useState } from "react";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { useSession } from "../lib/session";
import { Badge, Button, DataTable, Field, Loading, Modal, Tabs, useAsync, useToast } from "../components/ui";

export default function Admin() {
  const { can } = useSession();
  const [tab, setTab] = useState(can("users.manage") ? "users" : "settings");
  return (
    <div>
      <div className="page-head"><div className="grow"><h1>Администрирование</h1></div></div>
      <Tabs active={tab} onChange={setTab} tabs={[...(can("users.manage") ? [{ key: "users", label: "Учётные записи" }, { key: "roles", label: "Ролевая модель" }] : []), { key: "settings", label: "Настройки" }]} />
      {tab === "users" ? <Users /> : null}
      {tab === "roles" ? <Roles /> : null}
      {tab === "settings" ? <Settings /> : null}
    </div>
  );
}

function Users() {
  const users = useAsync(() => api.get("/users"), []);
  const roles = useAsync(() => api.get("/users/roles"), []);
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div className="col">
      <div><Button variant="primary" onClick={() => setEdit({ role: "investigator" })}>Создать учётную запись</Button></div>
      {users.data ? <DataTable rows={users.data} onRow={(r) => setEdit(r)} columns={[
        { key: "login", label: "Логин", render: (r: any) => <span className="mono">{r.login}</span> },
        { key: "name", label: "ФИО", render: (r: any) => r.full_name },
        { key: "role", label: "Роль", render: (r: any) => r.role_title },
        { key: "unit", label: "Подразделение", render: (r: any) => r.unit ?? "—" },
        { key: "st", label: "Состояние", render: (r: any) => r.is_active ? <Badge tone="ok">активна</Badge> : <Badge tone="muted">заблокирована</Badge> },
        { key: "last", label: "Последний вход", render: (r: any) => fmtDateTime(r.last_login_at) },
      ]} /> : <Loading error={users.error} />}
      {edit ? <UserModal value={edit} roles={roles.data ?? []} onClose={() => { setEdit(null); users.reload(); }} /> : null}
    </div>
  );
}

function UserModal({ value, roles, onClose }: { value: any; roles: any[]; onClose: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<any>({ ...value, password: "" });
  async function save() {
    try {
      if (v.id) {
        const body: any = { full_name: v.full_name, position: v.position, unit: v.unit, role: v.role, is_active: v.is_active };
        if (v.password) body.password = v.password;
        await api.patch(`/users/${v.id}`, body);
      } else await api.post("/users", { login: v.login, full_name: v.full_name, position: v.position, unit: v.unit, role: v.role, password: v.password });
      toast("ok", "Сохранено");
      onClose();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  return (
    <Modal title={v.id ? v.login : "Новая учётная запись"} onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="form-grid">
        {!v.id ? <Field label="Логин" required><input value={v.login ?? ""} onChange={(e) => setV({ ...v, login: e.target.value })} /></Field> : null}
        <Field label="ФИО" required><input value={v.full_name ?? ""} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
        <Field label="Должность"><input value={v.position ?? ""} onChange={(e) => setV({ ...v, position: e.target.value })} /></Field>
        <Field label="Подразделение"><input value={v.unit ?? ""} onChange={(e) => setV({ ...v, unit: e.target.value })} /></Field>
        <Field label="Роль"><select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{roles.map((r) => <option key={r.code} value={r.code}>{r.title}</option>)}</select></Field>
        <Field label={v.id ? "Новый пароль (при сбросе)" : "Первоначальный пароль"} hint="Пользователь обязан сменить пароль при первом входе"><input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" /></Field>
        {v.id ? <label className="row"><input type="checkbox" checked={!!v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> Учётная запись активна</label> : null}
      </div>
    </Modal>
  );
}

const PERM: Record<string, string> = {
  "users.manage": "управление учётными записями", "legal.manage": "импорт и верификация правовых источников",
  "templates.manage": "управление каталогом шаблонов", "audit.read": "просмотр журнала", "settings.manage": "настройки",
  "cases.create": "создание дел", "cases.unit_access": "доступ к делам подразделения",
};

function Roles() {
  const roles = useAsync(() => api.get("/users/roles"), []);
  if (!roles.data) return <Loading error={roles.error} />;
  return (
    <div className="col">
      <div className="notice small">Доступ к материалам дела предоставляется следователю, в производстве которого находится дело, пользователям, включённым в состав участников доступа, и руководителю подразделения. Администратор системы не имеет доступа к содержанию дел.</div>
      <DataTable rows={roles.data} columns={[
        { key: "t", label: "Роль", render: (r: any) => r.title },
        { key: "p", label: "Полномочия", render: (r: any) => r.permissions.map((p: string) => PERM[p] ?? p).join("; ") || "работа с делами, к которым предоставлен доступ" },
      ]} />
    </div>
  );
}

function Settings() {
  const toast = useToast();
  const { can } = useSession();
  const s = useAsync(() => api.get("/settings"), []);
  const [days, setDays] = useState<string | null>(null);
  if (!s.data) return <Loading error={s.error} />;
  const cur = days ?? (s.data.nonworking_days ?? []).join("\n");
  async function save() {
    try {
      await api.put("/settings/nonworking_days", { value: cur.split(/\s+/).filter(Boolean) });
      toast("ok", "Календарь нерабочих дней сохранён");
      s.reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  return (
    <div className="card col" style={{ maxWidth: 560 }}>
      <h2>Нерабочие праздничные дни</h2>
      <div className="small muted">Используются при переносе окончания срока на следующий рабочий день (ч. 2 ст. 128 УПК РФ). Формат: ГГГГ-ММ-ДД, по одной дате в строке. Календарь утверждается в установленном порядке и вносится ответственным лицом.</div>
      <textarea rows={10} value={cur} disabled={!can("settings.manage")} onChange={(e) => setDays(e.target.value)} />
      {can("settings.manage") ? <div><Button variant="primary" onClick={save}>Сохранить</Button></div> : null}
    </div>
  );
}
