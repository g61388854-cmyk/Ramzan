"""Сценарий Е. Попытка доступа к чужому делу."""
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditEvent


def test_foreign_case_denied_and_logged(client, users, case):
    r = client.get(f"/api/v1/cases/{case['id']}", headers=users["inv2"])
    assert r.status_code == 404
    r = client.get(f"/api/v1/cases/{case['id']}/files", headers=users["inv2"])
    assert r.status_code == 404
    with SessionLocal() as db:
        ev = db.scalar(select(AuditEvent).where(AuditEvent.action == "case.access_denied",
                                                AuditEvent.object_id == case["id"]).order_by(AuditEvent.id.desc()))
        assert ev is not None
        assert ev.success is False and ev.category == "security"


def test_foreign_case_not_listed(client, users, case):
    ids = [c["id"] for c in client.get("/api/v1/cases", headers=users["inv2"]).json()]
    assert case["id"] not in ids


def test_head_of_unit_has_access(client, users, case):
    assert client.get(f"/api/v1/cases/{case['id']}", headers=users["head1"]).status_code == 200


def test_admin_has_no_case_content_access(client, admin, case):
    assert client.get(f"/api/v1/cases/{case['id']}", headers=admin).status_code == 404


def test_viewer_member_is_read_only(client, users, case):
    me = client.get("/api/v1/auth/me", headers=users["viewer1"]).json()
    r = client.post(f"/api/v1/cases/{case['id']}/members", headers=users["inv1"],
                    json={"user_id": me["id"], "access": "write"})
    assert r.status_code == 200
    assert client.get(f"/api/v1/cases/{case['id']}", headers=users["viewer1"]).status_code == 200
    r = client.patch(f"/api/v1/cases/{case['id']}", headers=users["viewer1"], json={"fabula": "изменение"})
    assert r.status_code == 403


def test_foreign_document_and_file_denied(client, users, case):
    r = client.post(f"/api/v1/cases/{case['id']}/documents", headers=users["inv1"], json={"type_code": "acceptance"})
    doc_id = r.json()["id"]
    assert client.get(f"/api/v1/documents/{doc_id}", headers=users["inv2"]).status_code == 404
    assert client.post(f"/api/v1/documents/{doc_id}/export?fmt=docx", headers=users["inv2"]).status_code == 404
