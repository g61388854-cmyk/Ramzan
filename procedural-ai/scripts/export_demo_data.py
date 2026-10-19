#!/usr/bin/env python3
"""Формирование данных для демонстрационной (бессерверной) версии интерфейса.

Каталог шаблонов, справочник, правила сроков и начальное состояние демо-дела
берутся из настоящего серверного кода: демо-дело создаётся через API во
временной БД SQLite, материалы обрабатываются штатным конвейером. Все данные
синтетические. Результат: frontend/src/demo/data.json.

Запуск из каталога backend:  python3 ../scripts/export_demo_data.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

tmp = tempfile.mkdtemp(prefix="pai-demo-")
os.environ.update({
    "PAI_DATA_DIR": tmp, "PAI_DATABASE_URL": f"sqlite:///{tmp}/demo.sqlite3", "PAI_TASKS_INLINE": "1",
    "PAI_ADMIN_LOGIN": "admin", "PAI_ADMIN_PASSWORD": "Admin-Pass-2026", "PAI_AI_PROVIDER": "none", "PAI_OCR_ENGINE": "none",
})
BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401
from app.catalog import registry  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.legal.seed_data import ACTS, PROVISIONS  # noqa: E402
from app.main import app  # noqa: E402
from app.services import deadlines_calc, participants_schema  # noqa: E402
from app.services.extractor import DOC_KIND_LABELS, ENTITY_LABELS  # noqa: E402
from app.services.generator import PARTICIPANT_ROLES, STAGE_LABELS  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_demo import MATERIALS  # noqa: E402

Base.metadata.create_all(engine)
OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "demo" / "data.json"


def main() -> None:
    with TestClient(app) as c:
        admin = {"Authorization": "Bearer " + c.post("/api/v1/auth/login", json={"login": "admin", "password": "Admin-Pass-2026"}).json()["token"]}
        c.post("/api/v1/users", headers=admin, json={"login": "demo", "full_name": "Следователев Пётр Андреевич", "role": "investigator",
                                                     "unit": "СО по г. Тестовску (демо)", "position": "следователь следственного отдела (демо)",
                                                     "password": "Demo-Pass-2026"})
        h = {"Authorization": "Bearer " + c.post("/api/v1/auth/login", json={"login": "demo", "password": "Demo-Pass-2026"}).json()["token"]}
        me = c.get("/api/v1/auth/me", headers=h).json()
        case = c.post("/api/v1/cases", headers=h, json={
            "case_number": "12601690001000045", "opened_at": "2026-03-10", "stage": "investigation",
            "investigative_body": "Следственный отдел по г. Тестовску (демо)", "city": "г. Тестовск",
            "investigator_position": "следователь следственного отдела по г. Тестовску лейтенант юстиции",
            "head_name": "О.О. Руководителев", "head_position": "руководитель следственного отдела по г. Тестовску",
            "qualification": "п. «в» ч. 2 ст. 158 УК РФ",
            "fabula": "Синтетическая фабула: 10.03.2026 тайное хищение велосипеда у подъезда жилого дома."}).json()
        cid = case["id"]
        c.post(f"/api/v1/cases/{cid}/participants", headers=h, json={
            "role": "victim", "last_name": "Петров", "first_name": "Иван", "patronymic": "Сергеевич",
            "data": {"birth_date": "1980-02-01", "address_actual": "г. Тестовск, ул. Лесная, д. 7, кв. 12", "phone": "+7 (900) 000-00-01"}})
        c.post(f"/api/v1/cases/{cid}/participants", headers=h, json={
            "role": "witness", "last_name": "Белова", "first_name": "Мария", "patronymic": "Сергеевна", "data": {"birth_date": "1990-12-12"}})
        for name, (cat, text) in MATERIALS.items():
            c.post(f"/api/v1/cases/{cid}/files", headers=h, files={"file": (name, text.encode(), "text/plain")}, data={"category": cat})
        c.post(f"/api/v1/cases/{cid}/events", headers=h, json={"occurred_at": "2026-03-10T12:00:00", "event_type": "decision",
                                                              "title": "Возбуждено уголовное дело, дело принято к производству"})
        c.post(f"/api/v1/cases/{cid}/documents", headers=h, json={"type_code": "victim_recognition"})
        c.post(f"/api/v1/cases/{cid}/deadlines", headers=h, json={"rule_code": "preliminary_investigation", "start_at": "2026-03-10T09:00:00"})

        files = c.get(f"/api/v1/cases/{cid}/files", headers=h).json()
        documents = []
        for d in c.get(f"/api/v1/cases/{cid}/documents", headers=h).json():
            full = c.get(f"/api/v1/documents/{d['id']}", headers=h).json()
            documents.append(full)
        seed = {
            "user": me,
            "case": case,
            "participants": c.get(f"/api/v1/cases/{cid}/participants", headers=h).json(),
            "events": c.get(f"/api/v1/cases/{cid}/events", headers=h).json(),
            "files": files,
            "fragments": {f["id"]: c.get(f"/api/v1/files/{f['id']}/fragments", headers=h).json()["fragments"] for f in files},
            "facts": c.get(f"/api/v1/cases/{cid}/facts", headers=h).json(),
            "discrepancies": c.get(f"/api/v1/cases/{cid}/discrepancies", headers=h).json(),
            "documents": documents,
            "deadlines": c.get(f"/api/v1/cases/{cid}/deadlines", headers=h).json(),
            "history": c.get(f"/api/v1/cases/{cid}/history", headers=h).json(),
        }

    templates = []
    for d in registry.load_all():
        templates.append({
            "code": d["code"], "version": 1, "title": d["title"], "section": d["section"],
            "section_label": registry.SECTIONS[d["section"]], "procedural_kind": d["kind"],
            "procedural_kind_label": registry.PROCEDURAL_KINDS[d["kind"]], "author_role": d["author"],
            "addressee": d.get("addressee"), "requires_court": bool(d.get("requires_court")),
            "requires_head_consent": bool(d.get("requires_head_consent")), "requires_prosecutor_consent": False,
            "stages": d.get("stages", []), "keywords": d.get("keywords", []), "specializations": d.get("specializations", []),
            "origin": "builtin", "legal_bases": d.get("legal_bases", []), "warnings": d.get("warnings", []),
            "value_warnings": d.get("value_warnings", {}), "value_errors": d.get("value_errors", {}),
            "body": d["body"],
            "fields": [{"key": f["key"], "label": f["label"], "type": f["type"], "required": bool(f.get("required")),
                        "condition": f.get("condition"), "binding": f.get("binding"), "participant_role": f.get("participant_role"),
                        "options": f.get("options"), "help": f.get("help"), "group": f.get("group"), "narrative": bool(f.get("narrative"))}
                       for f in d["fields_expanded"]],
        })
    acts = {a["code"]: a for a in ACTS}
    data = {
        "catalog": {"sections": [{"code": k, "label": v} for k, v in registry.SECTIONS.items()], "kinds": registry.PROCEDURAL_KINDS,
                    "templates": templates, "macros": registry.macros_source(), "kits": registry.kits(),
                    "specializations": registry.specializations()},
        "legal": {"acts": ACTS, "provisions": [{"key": f"{a}:{n}", "act_code": a, "act": acts[a]["short_title"], "article": n,
                                                  "heading": h} for a, n, h in PROVISIONS]},
        "deadline_rules": [{"code": r.code, "title": r.title, "basis": r.basis_text, "basis_key": r.basis_key, "unit": r.unit,
                            "amount": r.amount, "include_start_day": r.include_start_day, "shift_nonworking": r.shift_nonworking,
                            "note": r.note} for r in deadlines_calc.RULES.values()],
        "meta": {
            "roles": [{"code": k, "label": v} for k, v in PARTICIPANT_ROLES.items()],
            "schemas": {role: {"person": participants_schema.schema_for(role, "person"),
                               "organization": participants_schema.schema_for(role, "organization")} for role in PARTICIPANT_ROLES},
            "stages": [{"code": k, "label": v} for k, v in STAGE_LABELS.items()],
            "entity_labels": ENTITY_LABELS, "doc_kind_labels": DOC_KIND_LABELS,
        },
        "seed": seed,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print("Записано:", OUT, f"{OUT.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
