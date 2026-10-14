"""Очистка HTML, поступающего из редактора: допускается только ограниченный
набор тегов и атрибутов, используемый форматом документа."""
from __future__ import annotations

from html import escape
from html.parser import HTMLParser

ALLOWED_TAGS = {"p", "h1", "h2", "h3", "b", "strong", "i", "em", "u", "br", "ul", "ol", "li", "table", "thead",
                "tbody", "tr", "td", "th", "span", "div"}
VOID = {"br"}
ALLOWED_ATTRS = {"class", "data-field", "data-src-type", "data-src-id", "data-required", "colspan", "rowspan"}


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip_depth = 0
        self.stack: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "iframe", "object", "embed"):
            self.skip_depth += 1
            return
        if self.skip_depth or tag not in ALLOWED_TAGS:
            return
        parts = []
        for k, v in attrs:
            if k in ALLOWED_ATTRS and v is not None:
                if k in ("colspan", "rowspan") and not v.isdigit():
                    continue
                parts.append(f'{k}="{escape(v, quote=True)}"')
        self.out.append(f"<{tag}{(' ' + ' '.join(parts)) if parts else ''}>")
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in ("script", "style", "iframe", "object", "embed"):
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth or tag not in ALLOWED_TAGS or tag in VOID:
            return
        if tag in self.stack:
            while self.stack:
                t = self.stack.pop()
                self.out.append(f"</{t}>")
                if t == tag:
                    break

    def handle_data(self, data):
        if not self.skip_depth:
            self.out.append(escape(data, quote=False))

    def close(self):
        super().close()
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")


def clean(html: str) -> str:
    s = _Sanitizer()
    s.feed(html or "")
    s.close()
    return "".join(s.out)
