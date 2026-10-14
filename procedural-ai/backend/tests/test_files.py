import io
import zipfile

from .conftest import make_docx, make_pdf, upload

MATERIAL = [
    "РАПОРТ об обнаружении признаков преступления",
    "10.03.2026 около 22 часов 30 минут неизвестный похитил имущество Петрова Ивана Сергеевича, 01.02.1980 года рождения.",
    "Ущерб составил 15 000 рублей. Адрес: г. Тестовск, ул. Лесная, д. 7, кв. 12. Тел. +7 (913) 555-12-34.",
    "Уголовное дело № 12601690001000045, признаки преступления, предусмотренного п. «в» ч. 2 ст. 158 УК РФ.",
]


def test_upload_txt_and_extract(client, users, case):
    r = upload(client, users["inv1"], case["id"], "рапорт.txt", "\n\n".join(MATERIAL).encode("utf-8"), "report")
    assert r.status_code == 201, r.text
    f = r.json()["file"]
    assert r.json()["task"]["status"] == "done"
    frag = client.get(f"/api/v1/files/{f['id']}/fragments", headers=users["inv1"]).json()
    assert frag["file"]["status"] == "processed"
    assert frag["file"]["detected_kind"] == "rapport"
    types = {e["type"] for fr in frag["fragments"] for e in fr["entities"]}
    assert {"person", "birth_date", "incident_date", "money", "address", "phone", "case_number", "legal_ref"} <= types
    facts = client.get(f"/api/v1/cases/{case['id']}/facts", headers=users["inv1"]).json()
    person = next(x for x in facts if x["fact_type"] == "person")
    assert person["sources"][0]["source_code"] == f["source_code"]
    assert person["status"] == "unverified" and person["machine_generated"] is True
    detail = client.get(f"/api/v1/facts/{person['id']}", headers=users["inv1"]).json()
    assert "Петрова" in detail["sources"][0]["fragment_text"]


def test_upload_docx_pdf_rtf_csv_xlsx(client, users, case):
    cid = case["id"]
    assert upload(client, users["inv1"], cid, "объяснение.docx", make_docx(["ОБЪЯСНЕНИЕ", MATERIAL[1]])).status_code == 201
    r = upload(client, users["inv1"], cid, "справка.pdf", make_pdf(["СПРАВКА", "Дата 11.03.2026, сумма 15 000 рублей"]))
    assert r.status_code == 201
    fr = client.get(f"/api/v1/files/{r.json()['file']['id']}/fragments", headers=users["inv1"]).json()
    assert fr["fragments"] and fr["fragments"][0]["page"] == 1
    rtf = r"{\rtf1\ansi\ansicpg1251 {\fonttbl{\f0 Times;}}\f0 \'cf\'f0\'ee\'f2\'ee\'ea\'ee\'eb 12.03.2026\par }".encode("latin-1")
    r = upload(client, users["inv1"], cid, "протокол.rtf", rtf)
    assert r.status_code == 201
    fr = client.get(f"/api/v1/files/{r.json()['file']['id']}/fragments", headers=users["inv1"]).json()
    assert "Протокол" in fr["fragments"][0]["text"]
    r = upload(client, users["inv1"], cid, "таблица.csv", "Дата;Сумма\n12.03.2026;5000 руб.\n".encode("utf-8"))
    assert r.status_code == 201
    import openpyxl

    wb = openpyxl.Workbook()
    wb.active.append(["Дата", "Сумма"])
    wb.active.append(["13.03.2026", "7000 рублей"])
    buf = io.BytesIO()
    wb.save(buf)
    assert upload(client, users["inv1"], cid, "таблица.xlsx", buf.getvalue()).status_code == 201


def test_rejects_unsafe_files(client, users, case):
    cid = case["id"]
    assert upload(client, users["inv1"], cid, "virus.exe", b"MZ\x90\x00").status_code == 422
    assert upload(client, users["inv1"], cid, "fake.pdf", b"not a pdf").status_code == 422
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<x/>")
        z.writestr("word/vbaProject.bin", b"macro")
    assert upload(client, users["inv1"], cid, "macro.docx", buf.getvalue()).status_code == 422
    pdf_js = b"%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF"
    assert upload(client, users["inv1"], cid, "js.pdf", pdf_js).status_code == 422
    assert upload(client, users["inv1"], cid, "../../etc/passwd.txt", b"text").status_code == 201


def test_image_without_ocr_marked(client, users, case):
    import pymupdf

    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), 0)
    r = upload(client, users["inv1"], case["id"], "скан.png", pix.tobytes("png"), "photo")
    assert r.status_code == 201
    f = client.get(f"/api/v1/files/{r.json()['file']['id']}", headers=users["inv1"]).json()
    assert f["status"] == "needs_ocr"
    assert f["machine_generated"] is True


def test_reprocess_is_reproducible(client, users, case):
    r = upload(client, users["inv1"], case["id"], "повтор.txt", "\n\n".join(MATERIAL).encode())
    fid = r.json()["file"]["id"]
    first = client.get(f"/api/v1/files/{fid}/fragments", headers=users["inv1"]).json()
    client.post(f"/api/v1/files/{fid}/reprocess", headers=users["inv1"])
    second = client.get(f"/api/v1/files/{fid}/fragments", headers=users["inv1"]).json()

    def sig(d):
        return [(fr["text"], [(e["type"], e["normalized"], e["start"], e["end"]) for e in fr["entities"]]) for fr in d["fragments"]]

    assert sig(first) == sig(second)


def test_download_is_decrypted_and_storage_encrypted(client, users, case):
    from app.config import settings

    data = "секретный текст материала".encode()
    r = upload(client, users["inv1"], case["id"], "секрет.txt", data)
    f = r.json()["file"]
    assert client.get(f"/api/v1/files/{f['id']}/download", headers=users["inv1"]).content == data
    raw = b"".join(p.read_bytes() for p in settings.files_dir.iterdir())
    assert data not in raw


def test_fact_review_flow(client, users, case):
    upload(client, users["inv1"], case["id"], "факты.txt", "\n\n".join(MATERIAL).encode())
    facts = client.get(f"/api/v1/cases/{case['id']}/facts?fact_type=money", headers=users["inv1"]).json()
    fid = facts[0]["id"]
    r = client.patch(f"/api/v1/facts/{fid}", headers=users["inv1"], json={"content": "15 000 (пятнадцать тысяч) рублей"})
    assert r.json()["edited_manually"] is True and r.json()["original_content"] == "15 000 рублей"
    r = client.patch(f"/api/v1/facts/{fid}", headers=users["inv1"], json={"status": "confirmed"})
    assert r.json()["status"] == "confirmed" and r.json()["verified_by"]
    hist = client.get(f"/api/v1/facts/{fid}", headers=users["inv1"]).json()["history"]
    assert len(hist) == 2
