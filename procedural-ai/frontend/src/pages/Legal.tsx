import { useState } from "react";
import { api, q } from "../lib/api";
import { fmtDate, fmtDateTime, LEGAL_STATUS } from "../lib/format";
import { useSession } from "../lib/session";
import { Badge, Button, DataTable, Field, Loading, Modal, useAsync, useToast } from "../components/ui";

export default function Legal({ query }: { query: URLSearchParams }) {
  const { can } = useSession();
  const status = useAsync(() => api.get("/legal/status"), []);
  const acts = useAsync(() => api.get("/legal/acts"), []);
  const [act, setAct] = useState("upk");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const provs = useAsync(() => api.get(`/legal/acts/${act}/provisions${q({ on })}`), [act, on]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any | null>(null);
  const [open, setOpen] = useState<string | null>(query.get("key"));
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  async function doSearch() {
    try {
      setResults(await api.get(`/legal/search${q({ q: search, on })}`));
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  return (
    <div>
      <div className="page-head">
        <div className="grow"><h1>Правовой справочник</h1><div className="muted">Локальная база нормативных актов с редакциями</div></div>
        {can("legal.manage") ? <Button variant="primary" onClick={() => setImporting(true)}>Импорт официальной редакции</Button> : null}
      </div>
      {status.data ? (
        <div className="notice warn" style={{ marginBottom: 12 }}>
          Дата последнего обновления справочника: <b>{status.data.updated_at ? fmtDateTime(status.data.updated_at) : "обновление не выполнялось"}</b>.
          Норм: {status.data.provisions}; с загруженным текстом: {status.data.with_text}; верифицировано: {status.data.verified}. {status.data.notice}
        </div>
      ) : null}
      <div className="row" style={{ marginBottom: 10 }}>
        <input style={{ maxWidth: 360 }} placeholder="Поиск: «ч. 1 ст. 144 УПК РФ», слово из наименования или текста" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        <Button onClick={doSearch}>Найти</Button>
        <span className="spacer" />
        <label className="row small">Редакция на дату <input type="date" style={{ maxWidth: 160 }} value={on} onChange={(e) => setOn(e.target.value)} /></label>
      </div>
      {results ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Результаты поиска</h3>
          {results.not_found?.length ? <div className="notice danger small">Отсутствуют в справочнике: {results.not_found.join(", ")} — ссылки не могут считаться проверенными.</div> : null}
          <ProvTable rows={results.results} onOpen={setOpen} />
        </div>
      ) : null}
      <div className="row" style={{ marginBottom: 8 }}>
        <select style={{ maxWidth: 480 }} value={act} onChange={(e) => setAct(e.target.value)} aria-label="Нормативный акт">
          {acts.data?.map((a: any) => <option key={a.code} value={a.code}>{a.short_title} — {a.title.slice(0, 80)}{a.number ? `, № ${a.number}` : ""}</option>)}
        </select>
      </div>
      {provs.data ? (
        <>
          <div className="small muted" style={{ marginBottom: 6 }}>{provs.data.act.title}{provs.data.act.number ? `, № ${provs.data.act.number}` : ""}{provs.data.act.adopted_at ? ` от ${fmtDate(provs.data.act.adopted_at)}` : ""}. Официальный источник: {provs.data.act.official_source}</div>
          <ProvTable rows={provs.data.provisions} onOpen={setOpen} />
        </>
      ) : <Loading error={provs.error} />}
      {open ? <ProvisionModal pkey={open} on={on} onClose={() => { setOpen(null); provs.reload(); status.reload(); }} /> : null}
      {importing ? <ImportModal acts={acts.data ?? []} onClose={() => { setImporting(false); provs.reload(); status.reload(); }} /> : null}
    </div>
  );
}

function ProvTable({ rows, onOpen }: { rows: any[]; onOpen: (k: string) => void }) {
  return <DataTable rows={rows} onRow={(r: any) => onOpen(r.key)} columns={[
    { key: "art", label: "Статья", render: (r: any) => <span className="nowrap">ст. {r.article} {r.act}</span> },
    { key: "h", label: "Наименование", render: (r: any) => r.heading ?? <span className="muted">—</span> },
    { key: "st", label: "Статус на дату", render: (r: any) => <Badge tone={LEGAL_STATUS[r.status.status]?.[1]}>{LEGAL_STATUS[r.status.status]?.[0]}</Badge> },
  ]} empty="Нормы не найдены" />;
}

function ProvisionModal({ pkey, on, onClose }: { pkey: string; on: string; onClose: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const p = useAsync(() => api.get(`/legal/provisions/${encodeURIComponent(pkey)}?on=${on}`), [pkey, on]);
  async function verify(id: string, verified: boolean) {
    try {
      await api.post(`/legal/versions/${id}/verify?verified=${verified}`);
      p.reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  }
  return (
    <Modal wide title={p.data ? `ст. ${p.data.article} ${p.data.act}` : pkey} onClose={onClose}>
      {!p.data ? <Loading error={p.error} /> : (
        <div className="col">
          <div><b>{p.data.heading ?? "Наименование отсутствует"}</b></div>
          <div className="row"><Badge tone={LEGAL_STATUS[p.data.status.status]?.[1]}>{LEGAL_STATUS[p.data.status.status]?.[0]}</Badge><span className="small muted">{p.data.status.message}</span></div>
          <h3>Редакции</h3>
          {p.data.versions.map((v: any) => (
            <div key={v.id} className="card">
              <div className="row small">
                <b>{v.valid_from ? `действует с ${fmtDate(v.valid_from)}` : "дата редакции не указана"}{v.valid_to ? ` по ${fmtDate(v.valid_to)}` : ""}</b>
                {v.verified ? <Badge tone="ok">верифицирована {fmtDate(v.verified_at)} ({v.verified_by})</Badge> : <Badge tone="warn">не верифицирована</Badge>}
                <span className="spacer" />
                {can("legal.manage") && v.text ? <Button size="sm" onClick={() => verify(v.id, !v.verified)}>{v.verified ? "Снять верификацию" : "Верифицировать"}</Button> : null}
              </div>
              <div className="small muted">Источник: {v.source}{v.import_batch ? ` · пакет ${v.import_batch}` : ""}</div>
              {v.text ? <div className="pre" style={{ marginTop: 6 }}>{v.text}</div> : <div className="notice warn small" style={{ marginTop: 6 }}>Текст нормы не загружен. Импортируйте официальную редакцию.</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ImportModal({ acts, onClose }: { acts: any[]; onClose: () => void }) {
  const toast = useToast();
  const [act, setAct] = useState("upk");
  const [validFrom, setValidFrom] = useState("");
  const [source, setSource] = useState("");
  const [verified, setVerified] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("act", act); form.append("valid_from", validFrom); form.append("source", source);
    form.append("mark_verified", String(verified)); form.append("file", file);
    try {
      const r = await api.upload("/legal/import", form);
      toast("ok", `Обновлено редакций: ${r.updated}; новых статей: ${r.created}; без изменений: ${r.unchanged}`);
      onClose();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Импорт официальной редакции" onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" busy={busy} disabled={!file || !validFrom || !source} onClick={go}>Импортировать</Button></>}>
      <div className="col">
        <div className="notice small">Принимается текст кодекса (TXT) с заголовками статей вида «Статья 146. Наименование» либо JSON-файл формата справочника. Используйте официальную публикацию (официальный интернет-портал правовой информации).</div>
        <Field label="Нормативный акт"><select value={act} onChange={(e) => setAct(e.target.value)}>{acts.map((a) => <option key={a.code} value={a.code}>{a.short_title}</option>)}</select></Field>
        <Field label="Дата начала действия редакции" required><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
        <Field label="Источник (официальное опубликование, адрес, дата получения)" required><input value={source} onChange={(e) => setSource(e.target.value)} /></Field>
        <Field label="Файл"><input type="file" accept=".txt,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <label className="row small"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Текст сверен мной с официальным источником (редакции будут отмечены как верифицированные)</label>
      </div>
    </Modal>
  );
}
