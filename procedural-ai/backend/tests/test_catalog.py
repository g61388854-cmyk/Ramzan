from app.catalog import registry, sync
from app.legal.seed_data import PROVISIONS
from app.services import exporter, generator

SECTIONS_REQUIRED = {"check", "organization", "protocols", "participants", "coercion", "court", "requests", "expertise",
                     "evidence", "completion"}


def test_catalog_definitions_valid():
    docs = registry.load_all()
    assert len(docs) >= 90
    errors = [e for d in docs for e in registry.validate_definition(d)]
    assert errors == []
    assert {d["section"] for d in docs} == SECTIONS_REQUIRED


def test_all_templates_render_and_export():
    parts = {"p-sample": {"id": "p-sample", "display_name": "Тестов Тест Тестович", "short_name": "Т.Т. Тестов",
                          "role_label": "Свидетель", "birth_date": "01.01.1990"}}
    for d in registry.load_all():
        t = sync.build_template(d, 1)
        html, missing = generator.render(t, generator.sample_values(t), {}, parts, {})
        assert not missing, d["code"]
        assert exporter.to_docx(html, title=t.title)


def test_legal_bases_exist_in_registry():
    keys = {f"{a}:{n}" for a, n, _ in PROVISIONS}
    for d in registry.load_all():
        for lb in d.get("legal_bases", []):
            assert lb["key"] in keys, (d["code"], lb["key"])


def test_kits_and_specializations_reference_existing_types():
    codes = {d["code"] for d in registry.load_all()}
    for k in registry.kits():
        assert set(k["documents"]) <= codes
    for s in registry.specializations():
        assert set(s["applies_to"]) <= codes


def test_catalog_api(client, users):
    r = client.get("/api/v1/templates", headers=users["inv1"]).json()
    assert len(r["templates"]) >= 90
    t = client.get("/api/v1/templates/expertise_order", headers=users["inv1"]).json()
    assert any(f["key"] == "questions" for f in t["fields"])
    assert t["specialization_profiles"]


def test_custom_template_import(client, admin, users):
    yaml_text = """
documents:
  - code: custom_test_notice
    title: "Тестовое уведомление (пользовательский шаблон)"
    section: requests
    kind: notice
    author: "Следователь"
    stages: [investigation]
    legal_bases: []
    fields:
      - use: header
      - {key: text, label: "Текст", type: textarea, required: true}
    body: |
      {{ m.title("УВЕДОМЛЕНИЕ") }}
      <p>{{ v.text }}</p>
      {{ m.investigator_sign() }}
"""
    assert client.post("/api/v1/templates/import", headers=users["inv1"],
                       files={"file": ("t.yaml", yaml_text.encode(), "text/yaml")}).status_code == 403
    r = client.post("/api/v1/templates/import", headers=admin, files={"file": ("t.yaml", yaml_text.encode(), "text/yaml")})
    assert r.status_code == 200, r.text
    assert client.get("/api/v1/templates/custom_test_notice", headers=users["inv1"]).status_code == 200
    bad = yaml_text.replace("{{ v.text }}", "{{ v.nonexistent }}")
    r = client.post("/api/v1/templates/import", headers=admin, files={"file": ("t.yaml", bad.encode(), "text/yaml")})
    assert r.status_code == 422
