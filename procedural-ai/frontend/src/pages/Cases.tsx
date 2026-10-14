import { useState } from "react";
import { api, q } from "../lib/api";
import { fmtDate } from "../lib/format";
import { navigate, parseHash } from "../lib/router";
import { useSession } from "../lib/session";
import { Badge, Button, DataTable, Loading, Modal, useAsync, useToast } from "../components/ui";
import { CaseForm } from "./case/General";

export default function Cases() {
  const { can, meta } = useSession();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(parseHash().query.get("new") === "1");
  const list = useAsync(() => api.get(`/cases${q({ q: search, stage, archived })}`), [search, stage, archived]);
  return (
    <div>
      <div className="page-head">
        <div className="grow"><h1>Уголовные дела</h1><div className="muted">Дела, к которым предоставлен доступ</div></div>
        {can("cases.create") ? <Button variant="primary" onClick={() => setCreating(true)}>Создать карточку дела</Button> : null}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input style={{ maxWidth: 320 }} placeholder="Номер, фабула, квалификация" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Фильтр" />
        <select style={{ maxWidth: 280 }} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Стадия">
          <option value="">Все стадии</option>
          {meta.stages?.stages.map((s: any) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <label className="row small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Архив</label>
      </div>
      {list.data ? (
        <DataTable rows={list.data} onRow={(r: any) => navigate(`/cases/${r.id}`)} initialSort="updated" columns={[
          { key: "reg_id", label: "Рег. №", sort: (r: any) => r.reg_id, render: (r: any) => <span className="mono">{r.reg_id}</span> },
          { key: "case_number", label: "Номер дела", sort: (r: any) => r.case_number ?? "", render: (r: any) => r.case_number || <span className="muted">не присвоен</span> },
          { key: "opened_at", label: "Возбуждено", sort: (r: any) => r.opened_at ?? "", render: (r: any) => fmtDate(r.opened_at) },
          { key: "qualification", label: "Квалификация", sort: (r: any) => r.qualification ?? "" },
          { key: "stage", label: "Стадия", sort: (r: any) => r.stage, render: (r: any) => <Badge>{r.stage_label}</Badge> },
          { key: "investigator", label: "Следователь", render: (r: any) => r.investigator?.full_name ?? "—" },
          { key: "updated", label: "Изменено", sort: (r: any) => -new Date(r.updated_at).getTime(), render: (r: any) => fmtDate(r.updated_at) },
          { key: "access", label: "Доступ", render: (r: any) => <Badge tone={r.access === "write" ? "info" : "muted"}>{r.access === "write" ? "изменение" : "чтение"}</Badge> },
        ]} empty="Дела не найдены" />
      ) : <Loading error={list.error} />}
      {creating ? <CreateCase onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CreateCase({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState<any>({ stage: "check" });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== "" && v !== undefined));
      const c = await api.post("/cases", body);
      toast("ok", `Создана карточка ${c.reg_id}`);
      navigate(`/cases/${c.id}`);
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title="Новая карточка уголовного дела" onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" busy={busy} onClick={save}>Создать</Button></>}>
      <CaseForm value={value} onChange={setValue} />
    </Modal>
  );
}
