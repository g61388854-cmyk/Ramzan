"""Сценарий Г. Неподтверждённая правовая ссылка."""
from app.services import ai_provider


def test_unverified_reference_not_marked_verified(client, users, case):
    doc = client.post(f"/api/v1/cases/{case['id']}/documents", headers=users["inv1"], json={"type_code": "acceptance"}).json()
    legal = client.get(f"/api/v1/documents/{doc['id']}/legal", headers=users["inv1"]).json()["legal"]
    assert legal and all(item["verified"] is False for item in legal)
    assert all(item["status"] in ("text_missing", "unverified", "missing") for item in legal)
    items = doc["current_version"]["validation"]["items"]
    assert any(i["code"] == "legal_unverified" for i in items)


def test_unknown_article_in_text_flagged(client, users, case):
    doc = client.post(f"/api/v1/cases/{case['id']}/documents", headers=users["inv1"],
                      json={"mode": "manual", "title": "Ручной документ"}).json()
    r = client.post(f"/api/v1/documents/{doc['id']}/versions", headers=users["inv1"], json={
        "edited": True, "content_html": "<p>Руководствуясь ст. 999 УПК РФ и ст. 146 УПК РФ</p>"})
    val = r.json()["current_version"]["validation"]
    keys = {li["key"]: li for li in val["legal"]}
    assert keys["upk:999"]["status"] == "missing"
    assert keys["upk:146"]["status"] in ("text_missing", "unverified", "verified")
    assert any(i["code"] == "legal_missing" for i in val["items"])


def test_import_and_verify_flow(client, users, case):
    text = ("Статья 156. Начало производства предварительного расследования\n"
            "1. Предварительное расследование начинается с момента возбуждения уголовного дела... (синтетический текст для теста)\n"
            "Статья 38. Следователь\n1. Следователь является должностным лицом... (синтетический текст)\n")
    r = client.post("/api/v1/legal/import", headers=users["legal1"], data={
        "act": "upk", "valid_from": "2026-01-01", "source": "тестовый источник", "mark_verified": "false"},
        files={"file": ("upk.txt", text.encode(), "text/plain")})
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 2
    prov = client.get("/api/v1/legal/provisions/upk:156", headers=users["inv1"]).json()
    assert prov["status"]["status"] == "unverified"
    vid = next(v["id"] for v in prov["versions"] if v["text"])
    # Следователь не может верифицировать норму
    assert client.post(f"/api/v1/legal/versions/{vid}/verify", headers=users["inv1"]).status_code == 403
    r = client.post(f"/api/v1/legal/versions/{vid}/verify", headers=users["legal1"])
    assert r.json()["verified"] is True
    prov = client.get("/api/v1/legal/provisions/upk:156?on=2026-03-11", headers=users["inv1"]).json()
    assert prov["status"]["verified"] is True
    # До даты начала действия редакции норма не считается проверенной
    prov = client.get("/api/v1/legal/provisions/upk:156?on=2025-06-01", headers=users["inv1"]).json()
    assert prov["status"]["verified"] is False
    status = client.get("/api/v1/legal/status", headers=users["inv1"]).json()
    assert status["updated_at"]


def test_search_and_check(client, users):
    r = client.get("/api/v1/legal/search", params={"q": "ч. 1 ст. 144 УПК РФ"}, headers=users["inv1"]).json()
    assert r["results"][0]["key"] == "upk:144"
    r = client.get("/api/v1/legal/check", params={"key": "upk:9999"}, headers=users["inv1"]).json()
    assert r["status"] == "missing" and r["verified"] is False


def test_model_generated_references_removed():
    res = ai_provider.postprocess("Лицо похитило имущество [F:11111111-1111-1111-1111-111111111111]. "
                                  "Деяние квалифицируется по п. «в» ч. 2 ст. 158 УК РФ [F:11111111-1111-1111-1111-111111111111].",
                                  {"11111111-1111-1111-1111-111111111111"})
    assert "158" not in res.text
    assert any("удалено" in w for w in res.warnings)
