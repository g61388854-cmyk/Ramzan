#!/usr/bin/env python3
"""Наполнение установленной системы демонстрационными СИНТЕТИЧЕСКИМИ данными.

Все лица, адреса, номера и обстоятельства вымышлены и предназначены только
для проверки работоспособности. Использование: 
    python3 scripts/seed_demo.py --url http://127.0.0.1:8000 --admin admin --password '...'
"""
from __future__ import annotations

import argparse
import sys

import httpx

DEMO_PASSWORD = "Demo-Pass-2026"

MATERIALS = {
    "И1_заявление.txt": (
        "statement",
        "ЗАЯВЛЕНИЕ\n\nПрошу привлечь к ответственности неизвестное лицо, которое 10.03.2026 около 22 часов 30 минут "
        "похитило мой велосипед марки «Синтетика-26» от подъезда дома по адресу: г. Тестовск, ул. Лесная, д. 7, кв. 12. "
        "Ущерб составил 15 000 рублей.\n\nЗаявитель Петров Иван Сергеевич, 01.02.1980 года рождения, тел. +7 (900) 000-00-01.",
    ),
    "И2_объяснение.txt": (
        "statement",
        "ОБЪЯСНЕНИЕ\n\nСвидетель Белова Мария Сергеевна, 12.12.1990 года рождения, пояснила, что 11.03.2026 около 22 часов "
        "видела, как неизвестный мужчина похитил велосипед у подъезда. Ущерб, со слов потерпевшего, составил 17 000 рублей. "
        "Опрос начат в 10 ч 15 мин, окончен в 09 ч 40 мин.",
    ),
    "И3_рапорт.txt": (
        "report",
        "РАПОРТ\n\nДокладываю, что по уголовному делу № 12601690001000045 получена справка об исследовании № 15 от 12.03.2026. "
        "Признаки преступления, предусмотренного п. «в» ч. 2 ст. 158 УК РФ.",
    ),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--admin", default="admin")
    ap.add_argument("--password", required=True)
    a = ap.parse_args()
    c = httpx.Client(base_url=a.url.rstrip("/") + "/api/v1", timeout=120)

    def login(user, pw):
        r = c.post("/auth/login", json={"login": user, "password": pw})
        r.raise_for_status()
        return {"Authorization": "Bearer " + r.json()["token"]}

    admin = login(a.admin, a.password)
    unit = "СО по г. Тестовску (демо)"
    for login_name, name, role in [("demo.investigator", "Следователев Пётр Андреевич", "investigator"),
                                   ("demo.head", "Руководителев Олег Олегович", "head"),
                                   ("demo.legal", "Справочников Сергей Сергеевич", "legal_editor")]:
        r = c.post("/users", headers=admin, json={"login": login_name, "full_name": name, "role": role, "unit": unit,
                                                  "position": "следователь следственного отдела (демо)" if role == "investigator" else None,
                                                  "password": DEMO_PASSWORD})
        print(login_name, r.status_code)
    inv = login("demo.investigator", DEMO_PASSWORD)
    case = c.post("/cases", headers=inv, json={
        "case_number": "12601690001000045", "opened_at": "2026-03-10", "stage": "investigation",
        "investigative_body": "Следственный отдел по г. Тестовску (демо)", "city": "г. Тестовск",
        "investigator_position": "следователь следственного отдела по г. Тестовску лейтенант юстиции",
        "head_name": "О.О. Руководителев", "head_position": "руководитель следственного отдела по г. Тестовску",
        "qualification": "п. «в» ч. 2 ст. 158 УК РФ",
        "fabula": "Синтетическая фабула: 10.03.2026 тайное хищение велосипеда у подъезда жилого дома."}).json()
    cid = case["id"]
    c.post(f"/cases/{cid}/participants", headers=inv, json={
        "role": "victim", "last_name": "Петров", "first_name": "Иван", "patronymic": "Сергеевич",
        "data": {"birth_date": "1980-02-01", "address_actual": "г. Тестовск, ул. Лесная, д. 7, кв. 12", "phone": "+7 (900) 000-00-01"}})
    c.post(f"/cases/{cid}/participants", headers=inv, json={
        "role": "witness", "last_name": "Белова", "first_name": "Мария", "patronymic": "Сергеевна", "data": {"birth_date": "1990-12-12"}})
    for name, (cat, text) in MATERIALS.items():
        r = c.post(f"/cases/{cid}/files", headers=inv, files={"file": (name, text.encode(), "text/plain")}, data={"category": cat})
        print(name, r.status_code)
    c.post(f"/cases/{cid}/documents", headers=inv, json={"type_code": "victim_recognition"})
    c.post(f"/cases/{cid}/deadlines", headers=inv, json={"rule_code": "preliminary_investigation", "start_at": "2026-03-10T09:00:00"})
    print("Демонстрационное дело:", case["reg_id"], "логин demo.investigator, пароль", DEMO_PASSWORD)
    return 0


if __name__ == "__main__":
    sys.exit(main())
