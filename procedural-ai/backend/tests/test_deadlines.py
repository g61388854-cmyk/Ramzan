from datetime import datetime

from app.services.deadlines_calc import add_months, compute


def test_add_months_end_of_month():
    from datetime import date

    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 3, 10), 2) == date(2026, 5, 10)


def test_investigation_term_with_suspension():
    base = compute("preliminary_investigation", datetime(2026, 1, 10, 10, 0))
    assert base["due_at"].startswith("2026-03-09")
    res = compute("preliminary_investigation", datetime(2026, 1, 10, 10, 0),
                  adjustments=[{"type": "suspension", "from": "2026-02-01", "to": "2026-02-11"}])
    assert res["due_at"].startswith("2026-03-19")
    assert any("не включается" in s for s in res["steps"])


def test_open_suspension_stops_clock():
    res = compute("preliminary_investigation", datetime(2026, 1, 10), adjustments=[{"type": "suspension", "from": "2026-02-01"}])
    assert res["due_at"] is None and res["suspended"] is True


def test_nonworking_shift_and_detention_not_shifted():
    res = compute("report_check", datetime(2026, 3, 12, 10, 0))  # окончание 15.03.2026 — воскресенье
    assert res["due_at"].startswith("2026-03-16")
    res = compute("detention_48h", datetime(2026, 3, 13, 10, 30))
    assert res["due_at"].startswith("2026-03-15T10:30")
    res = compute("report_check", datetime(2026, 3, 9, 10, 0), holidays=["2026-03-12"])
    assert res["due_at"].startswith("2026-03-13")


def test_extension():
    res = compute("report_check", datetime(2026, 3, 10), adjustments=[{"type": "extension", "new_due": "2026-03-20",
                                                                      "basis": "решение руководителя СО"}])
    assert res["due_at"].startswith("2026-03-20")


def test_api_deadline_lifecycle(client, users, case):
    cid = case["id"]
    r = client.post(f"/api/v1/cases/{cid}/deadlines", headers=users["inv1"], json={
        "rule_code": "preliminary_investigation", "start_at": "2026-03-10T09:00:00"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["status"] == "unconfirmed"
    assert d["calculation"]["basis"].startswith("ч. 1, 2 ст. 162")
    assert d["due_at"].startswith("2026-05-11")  # 09.05.2026 — суббота, перенос на понедельник 11.05
    r = client.patch(f"/api/v1/deadlines/{d['id']}", headers=users["inv1"], json={"status": "confirmed"})
    assert r.json()["status"] == "confirmed" and r.json()["confirmed_by"]
    r = client.patch(f"/api/v1/deadlines/{d['id']}", headers=users["inv1"],
                     json={"adjustments": [{"type": "extension", "months": 3, "basis": "постановление руководителя"}]})
    assert r.json()["status"] == "unconfirmed"
    hist = client.get(f"/api/v1/deadlines/{d['id']}/history", headers=users["inv1"]).json()
    assert len(hist) == 3
    cal = client.get("/api/v1/deadlines?days=400", headers=users["inv1"]).json()
    assert any(x["id"] == d["id"] for x in cal)
