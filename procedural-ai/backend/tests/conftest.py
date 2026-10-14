"""Общие фикстуры. Тесты выполняются на SQLite (по умолчанию) либо на PostgreSQL,
если задана переменная PAI_TEST_DATABASE_URL. Все данные синтетические."""
from __future__ import annotations

import io
import os
import shutil
import tempfile

_tmp = tempfile.mkdtemp(prefix="pai-test-")
os.environ["PAI_DATA_DIR"] = _tmp
os.environ["PAI_DATABASE_URL"] = os.environ.get("PAI_TEST_DATABASE_URL") or f"sqlite:///{_tmp}/test.sqlite3"
os.environ["PAI_TASKS_INLINE"] = "1"
os.environ["PAI_ADMIN_LOGIN"] = "admin"
os.environ["PAI_ADMIN_PASSWORD"] = "Admin-Pass-2026"
os.environ["PAI_AI_PROVIDER"] = "none"
os.environ["PAI_OCR_ENGINE"] = "none"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401
from app.db import Base, engine  # noqa: E402

if engine.dialect.name == "postgresql":
    Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)

from app.main import app  # noqa: E402

PASSWORD = "Test-Pass-2026"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
    shutil.rmtree(_tmp, ignore_errors=True)


def login(client, login_name, password=PASSWORD) -> dict:
    r = client.post("/api/v1/auth/login", json={"login": login_name, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def admin(client):
    return login(client, "admin", "Admin-Pass-2026")


@pytest.fixture(scope="session")
def users(client, admin):
    spec = {
        "inv1": ("Следователев Пётр Андреевич", "investigator", "СО по г. Тестовску"),
        "inv2": ("Другой Иван Иванович", "investigator", "СО по г. Иному"),
        "head1": ("Руководителев Олег Олегович", "head", "СО по г. Тестовску"),
        "legal1": ("Справочников Сергей Сергеевич", "legal_editor", None),
        "viewer1": ("Наблюдателев Нил Нилович", "viewer", "СО по г. Тестовску"),
    }
    out = {}
    for login_name, (name, role, unit) in spec.items():
        r = client.post("/api/v1/users", headers=admin, json={
            "login": login_name, "full_name": name, "role": role, "unit": unit, "password": PASSWORD,
            "position": "следователь следственного отдела по г. Тестовску (синтетические данные)" if role == "investigator" else None})
        assert r.status_code in (201, 409), r.text
        out[login_name] = login(client, login_name)
    return out


@pytest.fixture()
def case(client, users):
    r = client.post("/api/v1/cases", headers=users["inv1"], json={
        "case_number": "12601690001000045", "opened_at": "2026-03-10", "investigative_body": "Следственный отдел по г. Тестовску",
        "investigator_position": "следователь следственного отдела по г. Тестовску лейтенант юстиции",
        "head_name": "О.О. Руководителев", "head_position": "руководитель следственного отдела по г. Тестовску",
        "city": "г. Тестовск", "qualification": "п. «в» ч. 2 ст. 158 УК РФ", "stage": "investigation",
        "fabula": "Синтетическая фабула для автотестов."})
    assert r.status_code == 201, r.text
    return r.json()


def make_docx(paragraphs: list[str]) -> bytes:
    import docx

    d = docx.Document()
    for p in paragraphs:
        d.add_paragraph(p)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def make_pdf(lines: list[str]) -> bytes:
    import pymupdf

    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    for line in lines:
        page.insert_text((60, y), line, fontsize=10, fontname="dv", fontfile=font)
        y += 16
    out = doc.tobytes()
    doc.close()
    return out


def upload(client, headers, case_id, name, data, category="other"):
    r = client.post(f"/api/v1/cases/{case_id}/files", headers=headers,
                    files={"file": (name, data, "application/octet-stream")}, data={"category": category})
    return r
