"""Сценарий Д. Работа без интернета; глобальный поиск; главная панель."""
from .conftest import upload


def test_offline_operation(client, users, case, monkeypatch):
    import socket

    def blocked(*a, **k):
        raise OSError("Сеть недоступна (тест автономного режима)")

    monkeypatch.setattr(socket, "create_connection", blocked)
    st = client.get("/api/v1/system/status", headers=users["inv1"]).json()
    assert st["ai"]["available"] is False
    assert st["templates"] >= 90
    r = upload(client, users["inv1"], case["id"], "офлайн.txt", "Петров Пётр Петрович, 01.01.1970 года рождения.".encode())
    assert r.status_code == 201
    doc = client.post(f"/api/v1/cases/{case['id']}/documents", headers=users["inv1"], json={"type_code": "acceptance"}).json()
    assert doc["current_version"]["content_html"]
    items = doc["current_version"]["validation"]["items"]
    assert any(i["code"] == "registry_date" for i in items)
    legal = client.get("/api/v1/legal/status", headers=users["inv1"]).json()
    assert legal["mode"] == "local" and "не проверена" in legal["notice"]


def test_global_search(client, users, case):
    upload(client, users["inv1"], case["id"], "поиск.txt", "Обнаружен велосипед марки Уникальныйбренд синего цвета.".encode())
    r = client.get("/api/v1/search", params={"q": "Уникальныйбренд"}, headers=users["inv1"]).json()
    assert r["fragments"] and "Уникальныйбренд" in r["fragments"][0]["snippet"]
    r = client.get("/api/v1/search", params={"q": "Уникальныйбренд"}, headers=users["inv2"]).json()
    assert r["fragments"] == []
    r = client.get("/api/v1/search", params={"q": case["case_number"]}, headers=users["inv1"]).json()
    assert any(c["id"] == case["id"] for c in r["cases"])


def test_dashboard(client, users, case):
    d = client.get("/api/v1/dashboard", headers=users["inv1"]).json()
    assert d["counts"]["active_cases"] >= 1
    assert "deadlines" in d and "missing_data" in d


def test_audit_requires_permission(client, users, admin):
    assert client.get("/api/v1/audit", headers=users["inv1"]).status_code == 403
    r = client.get("/api/v1/audit?category=security", headers=admin)
    assert r.status_code == 200 and r.json()


def test_openapi_available(client):
    spec = client.get("/api/v1/openapi.json").json()
    assert "/api/v1/documents/{doc_id}/export" in spec["paths"]
