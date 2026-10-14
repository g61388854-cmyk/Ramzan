def test_case_crud_and_history(client, users, case):
    cid = case["id"]
    assert case["reg_id"].startswith("PAI-")
    r = client.patch(f"/api/v1/cases/{cid}", headers=users["inv1"], json={"qualification": "ч. 1 ст. 158 УК РФ"})
    assert r.status_code == 200 and r.json()["qualification"] == "ч. 1 ст. 158 УК РФ"
    hist = client.get(f"/api/v1/cases/{cid}/history", headers=users["inv1"]).json()
    assert any(h["before"] and h["before"].get("qualification") == "п. «в» ч. 2 ст. 158 УК РФ" for h in hist)
    detail = client.get(f"/api/v1/cases/{cid}", headers=users["inv1"]).json()
    assert detail["access"] == "write"
    assert "counts" in detail


def test_participants_schema_filtering(client, users, case):
    cid = case["id"]
    r = client.post(f"/api/v1/cases/{cid}/participants", headers=users["inv1"], json={
        "role": "defender", "last_name": "Адвокатов", "first_name": "Адам", "patronymic": "Адамович",
        "data": {"warrant": "№ 15 от 11.03.2026", "unknown_field": "x", "birth_date": "1975-05-05"}})
    assert r.status_code == 201, r.text
    p = r.json()
    assert "unknown_field" not in p["data"] and p["data"]["warrant"].startswith("№ 15")
    r = client.patch(f"/api/v1/participants/{p['id']}", headers=users["inv1"], json={"is_archived": True})
    assert r.json()["is_archived"] is True
    active = client.get(f"/api/v1/cases/{cid}/participants", headers=users["inv1"]).json()
    assert p["id"] not in [x["id"] for x in active]


def test_participant_requires_name(client, users, case):
    r = client.post(f"/api/v1/cases/{case['id']}/participants", headers=users["inv1"], json={"role": "witness"})
    assert r.status_code == 422


def test_events_and_timeline(client, users, case):
    cid = case["id"]
    r = client.post(f"/api/v1/cases/{cid}/events", headers=users["inv1"], json={
        "occurred_at": "2026-03-10T12:00:00", "event_type": "decision", "title": "Возбуждено уголовное дело"})
    assert r.status_code == 201
    tl = client.get(f"/api/v1/cases/{cid}/timeline", headers=users["inv1"]).json()
    assert tl and tl[0]["title"] == "Возбуждено уголовное дело"
