import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "./ui";

export type EditorHandle = { getHtml: () => string };

// Редактор документа на основе contentEditable. Формат хранения — ограниченный HTML,
// который очищается на сервере. Выравнивание задаётся классами абзаца.
const Editor = forwardRef<EditorHandle, { html: string; readOnly?: boolean; onDirty: () => void; onSourceClick?: (type: string, id: string) => void }>(
  function Editor({ html, readOnly, onDirty, onSourceClick }, ref) {
    const div = useRef<HTMLDivElement>(null);
    const [find, setFind] = useState("");
    const [repl, setRepl] = useState("");
    const [showFind, setShowFind] = useState(false);
    const [hits, setHits] = useState<number | null>(null);

    useEffect(() => {
      if (div.current && div.current.innerHTML !== html) div.current.innerHTML = html;
    }, [html]);

    useImperativeHandle(ref, () => ({
      getHtml: () => {
        const el = div.current;
        if (!el) return html;
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("span.search-hit").forEach((s) => s.replaceWith(document.createTextNode(s.textContent ?? "")));
        return clone.innerHTML;
      },
    }));

    function exec(cmd: string, arg?: string) {
      div.current?.focus();
      document.execCommand(cmd, false, arg);
      onDirty();
    }
    function blockClass(cls: string | null) {
      const sel = window.getSelection();
      let node = sel?.anchorNode as HTMLElement | null;
      while (node && node !== div.current && !(node instanceof HTMLElement && /^(P|H1|H2|H3|LI)$/.test(node.tagName))) node = node.parentElement;
      if (!node || node === div.current) return;
      node.classList.remove("center", "right");
      if (cls) node.classList.add(cls);
      onDirty();
    }
    function insertTable() {
      exec("insertHTML", '<table class="card"><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></table><p></p>');
    }
    function clearHits() {
      div.current?.querySelectorAll("span.search-hit").forEach((s) => s.replaceWith(document.createTextNode(s.textContent ?? "")));
      div.current?.normalize();
    }
    function textNodes(): Text[] {
      const out: Text[] = [];
      const w = document.createTreeWalker(div.current!, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = w.nextNode())) out.push(n as Text);
      return out;
    }
    function doFind() {
      clearHits();
      if (!find) { setHits(null); return; }
      let count = 0;
      const needle = find.toLowerCase();
      textNodes().forEach((t) => {
        const idx = (t.textContent ?? "").toLowerCase().indexOf(needle);
        if (idx < 0) return;
        const r = document.createRange();
        r.setStart(t, idx);
        r.setEnd(t, idx + find.length);
        const span = document.createElement("span");
        span.className = "search-hit";
        r.surroundContents(span);
        count++;
      });
      setHits(count);
      div.current?.querySelector(".search-hit")?.scrollIntoView({ block: "center" });
    }
    function doReplaceAll() {
      clearHits();
      if (!find) return;
      let count = 0;
      textNodes().forEach((t) => {
        const s = t.textContent ?? "";
        if (s.includes(find)) {
          count += s.split(find).length - 1;
          t.textContent = s.split(find).join(repl);
        }
      });
      setHits(count);
      if (count) onDirty();
    }
    function onClick(e: React.MouseEvent) {
      const el = (e.target as HTMLElement).closest("[data-src-type]") as HTMLElement | null;
      if (el && (e.ctrlKey || e.metaKey || readOnly) && onSourceClick) {
        onSourceClick(el.dataset.srcType!, el.dataset.srcId ?? "");
      }
    }
    return (
      <div>
        {!readOnly ? (
          <div className="editor-toolbar" role="toolbar" aria-label="Форматирование">
            <Button size="sm" title="Отменить (Ctrl+Z)" onClick={() => exec("undo")}>↶</Button>
            <Button size="sm" title="Повторить (Ctrl+Y)" onClick={() => exec("redo")}>↷</Button>
            <Button size="sm" title="Полужирный" onClick={() => exec("bold")}><b>Ж</b></Button>
            <Button size="sm" title="Курсив" onClick={() => exec("italic")}><i>К</i></Button>
            <Button size="sm" title="Подчёркнутый" onClick={() => exec("underline")}><u>Ч</u></Button>
            <Button size="sm" title="Заголовок" onClick={() => exec("formatBlock", "H1")}>Заголовок</Button>
            <Button size="sm" title="Обычный абзац" onClick={() => exec("formatBlock", "P")}>Абзац</Button>
            <Button size="sm" title="По ширине" onClick={() => blockClass(null)}>≡</Button>
            <Button size="sm" title="По центру" onClick={() => blockClass("center")}>☰</Button>
            <Button size="sm" title="По правому краю" onClick={() => blockClass("right")}>⇥</Button>
            <Button size="sm" title="Маркированный список" onClick={() => exec("insertUnorderedList")}>• Список</Button>
            <Button size="sm" title="Нумерованный список" onClick={() => exec("insertOrderedList")}>1. Список</Button>
            <Button size="sm" title="Таблица" onClick={insertTable}>Таблица</Button>
            <Button size="sm" title="Поиск и замена" onClick={() => setShowFind((x) => !x)}>Найти</Button>
          </div>
        ) : null}
        {showFind ? (
          <div className="row" style={{ padding: 6, border: "1px solid var(--border)", borderBottom: "none", background: "var(--surface)" }}>
            <input style={{ maxWidth: 220 }} placeholder="Найти" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doFind()} />
            <input style={{ maxWidth: 220 }} placeholder="Заменить на" value={repl} onChange={(e) => setRepl(e.target.value)} />
            <Button size="sm" onClick={doFind}>Найти</Button>
            <Button size="sm" onClick={doReplaceAll}>Заменить все</Button>
            <Button size="sm" onClick={() => { clearHits(); setHits(null); }}>Сбросить</Button>
            {hits !== null ? <span className="small muted">совпадений: {hits}</span> : null}
          </div>
        ) : null}
        <div ref={div} className="paper" contentEditable={!readOnly} suppressContentEditableWarning spellCheck lang="ru"
          onInput={onDirty} onClick={onClick} aria-label="Текст документа" role="textbox" aria-multiline="true" />
        <div className="hint" style={{ marginTop: 4 }}>Подсветка: жёлтым — незаполненные сведения; фиолетовым — проектные формулировки, не подтверждённые пользователем. Ctrl+клик по подставленному факту открывает источник.</div>
      </div>
    );
  },
);

export default Editor;
