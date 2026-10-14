from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditEvent, UserSession
from app.security import token_digest

from .conftest import PASSWORD, login


def test_login_and_me(client, users):
    r = client.get("/api/v1/auth/me", headers=users["inv1"])
    assert r.status_code == 200
    assert r.json()["role"] == "investigator"


def test_requires_auth(client):
    assert client.get("/api/v1/cases").status_code == 401


def test_wrong_password_logged(client, users):
    r = client.post("/api/v1/auth/login", json={"login": "inv2", "password": "wrong"})
    assert r.status_code == 401
    with SessionLocal() as db:
        ev = db.scalar(select(AuditEvent).where(AuditEvent.action == "auth.login_failed").order_by(AuditEvent.id.desc()))
        assert ev is not None and ev.success is False


def test_lockout(client, admin):
    client.post("/api/v1/users", headers=admin, json={"login": "lockme", "full_name": "Блокируемый Тест Тестович",
                                                     "role": "viewer", "password": PASSWORD})
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"login": "lockme", "password": "bad"})
    r = client.post("/api/v1/auth/login", json={"login": "lockme", "password": PASSWORD})
    assert r.status_code == 423


def test_logout_revokes(client, users):
    h = login(client, "inv2")
    assert client.post("/api/v1/auth/logout", headers=h).status_code == 200
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401


def test_idle_timeout(client, users):
    r = client.post("/api/v1/auth/login", json={"login": "inv2", "password": PASSWORD})
    token = r.json()["token"]
    with SessionLocal() as db:
        s = db.scalar(select(UserSession).where(UserSession.token_hash == token_digest(token)))
        s.last_seen_at = datetime.now(timezone.utc) - timedelta(hours=2)
        db.commit()
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_password_policy(client, admin):
    r = client.post("/api/v1/users", headers=admin, json={"login": "weak", "full_name": "Слабый Пароль Тестович",
                                                         "role": "viewer", "password": "short"})
    assert r.status_code == 422


def test_non_admin_cannot_manage_users(client, users):
    r = client.get("/api/v1/users", headers=users["inv1"])
    assert r.status_code == 403
