"""Сценарий В. Противоречивые сведения в разных материалах."""
from .conftest import upload


def test_conflicting_materials(client, users, case):
    cid = case["id"]
    a = ("ОБЪЯСНЕНИЕ. Потерпевший Сидоров Олег Петрович, 05.06.1985 года рождения, пояснил, что 10.03.2026 "
         "неизвестный похитил его имущество. Ущерб составил 15 000 рублей. Опрос начат в 10 ч 15 мин, окончен в 09 ч 40 мин.")
    b = ("ПРОТОКОЛ ДОПРОСА. Потерпевший Сидоров Олег Петрович, 06.06.1985 года рождения, показал, что 11.03.2026 "
         "неизвестный похитил его имущество. Ущерб составил 17 000 рублей. Упоминается заключение эксперта № 77 от 12.03.2026. "
         "Уголовное дело № 12601690009999999.")
    fa = upload(client, users["inv1"], cid, "объяснение_А.txt", a.encode()).json()["file"]
    fb = upload(client, users["inv1"], cid, "допрос_Б.txt", b.encode()).json()["file"]
    disc = client.get(f"/api/v1/cases/{cid}/discrepancies", headers=users["inv1"]).json()
    kinds = {d["kind"] for d in disc}
    assert {"birth_date", "incident_date", "money", "time_sequence", "missing_document", "case_number_card"} <= kinds
    inc = next(d for d in disc if d["kind"] == "incident_date")
    codes = {i.get("source_code") for i in inc["items"]}
    assert {fa["source_code"], fb["source_code"]} <= codes
    # Ни один вариант не помечается как достоверный
    assert all("verified" not in i and "true_value" not in i for i in inc["items"])
    assert inc["status"] == "open"
    # Отметка о рассмотрении
    r = client.patch(f"/api/v1/discrepancies/{inc['id']}", headers=users["inv1"],
                     json={"status": "resolved", "resolution_note": "Дата уточнена дополнительным допросом"})
    assert r.json()["status"] == "resolved"


def test_card_birth_date_mismatch(client, users, case):
    cid = case["id"]
    client.post(f"/api/v1/cases/{cid}/participants", headers=users["inv1"], json={
        "role": "victim", "last_name": "Карточкин", "first_name": "Карп", "patronymic": "Карпович",
        "data": {"birth_date": "1990-01-01"}})
    upload(client, users["inv1"], cid, "мат.txt", "Карточкин Карп Карпович, 02.01.1990 года рождения, пояснил.".encode())
    disc = client.get(f"/api/v1/cases/{cid}/discrepancies", headers=users["inv1"]).json()
    assert any(d["kind"] == "birth_date_card" for d in disc)
