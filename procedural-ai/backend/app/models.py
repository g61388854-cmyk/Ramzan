"""Модель данных PROCEDURAL AI.

Все основные сущности имеют устойчивые строковые идентификаторы (UUID).
Сохранённые версии документов неизменяемы: изменение карточки дела не
переписывает ранее сформированные версии (снимок данных хранится в версии).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def _pk() -> Mapped[str]:
    return mapped_column(String(36), primary_key=True, default=new_id)


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    title: Mapped[str] = mapped_column(String(128))
    permissions: Mapped[list] = mapped_column(JSON, default=list)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = _pk()
    login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    position: Mapped[str | None] = mapped_column(String(255))
    unit: Mapped[str | None] = mapped_column(String(255), index=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    role: Mapped[Role] = relationship(lazy="joined")


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[str] = _pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    ip: Mapped[str | None] = mapped_column(String(64))


class Case(Base):
    __tablename__ = "cases"
    id: Mapped[str] = _pk()
    reg_id: Mapped[str] = mapped_column(String(32), unique=True)
    case_number: Mapped[str | None] = mapped_column(String(64), index=True)
    opened_at: Mapped[date | None] = mapped_column(Date)
    investigative_body: Mapped[str | None] = mapped_column(String(512))
    unit: Mapped[str | None] = mapped_column(String(255), index=True)
    investigator_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    head_name: Mapped[str | None] = mapped_column(String(255))
    head_position: Mapped[str | None] = mapped_column(String(255))
    investigator_position: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(255))
    qualification: Mapped[str | None] = mapped_column(String(512))
    fabula: Mapped[str | None] = mapped_column(Text)
    stage: Mapped[str] = mapped_column(String(32), default="check")
    key_dates: Mapped[dict] = mapped_column(JSON, default=dict)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    investigator: Mapped[User | None] = relationship(foreign_keys=[investigator_id], lazy="joined")

    __table_args__ = (
        CheckConstraint(
            "stage in ('check','investigation','suspended','completed','sent_to_prosecutor','terminated')",
            name="ck_cases_stage",
        ),
    )


class CaseMember(Base):
    __tablename__ = "case_members"
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    access: Mapped[str] = mapped_column(String(16), default="write")
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (CheckConstraint("access in ('read','write')", name="ck_case_members_access"),)


class CaseParticipant(Base):
    __tablename__ = "case_participants"
    id: Mapped[str] = _pk()
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="RESTRICT"), index=True)
    role: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="person")
    last_name: Mapped[str | None] = mapped_column(String(128))
    first_name: Mapped[str | None] = mapped_column(String(128))
    patronymic: Mapped[str | None] = mapped_column(String(128))
    org_name: Mapped[str | None] = mapped_column(String(512))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (CheckConstraint("kind in ('person','organization')", name="ck_participant_kind"),)

    @property
    def display_name(self) -> str:
        if self.kind == "organization":
            return self.org_name or "(организация без наименования)"
        parts = [p for p in (self.last_name, self.first_name, self.patronymic) if p]
        return " ".join(parts) or "(без ФИО)"


class ChangeHistory(Base):
    """История изменений карточек (дело, участники, факты, сроки)."""

    __tablename__ = "change_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(32), index=True)
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    case_id: Mapped[str | None] = mapped_column(String(36), index=True)
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(String(512))


class CaseEvent(Base):
    __tablename__ = "case_events"
    id: Mapped[str] = _pk()
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="RESTRICT"), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    event_type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    file_id: Mapped[str | None] = mapped_column(ForeignKey("source_files.id", ondelete="SET NULL"))
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SourceFile(Base):
    __tablename__ = "source_files"
    id: Mapped[str] = _pk()
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="RESTRICT"), index=True)
    source_code: Mapped[str] = mapped_column(String(32))  # человекочитаемый идентификатор «И-001»
    original_name: Mapped[str] = mapped_column(String(512))
    stored_name: Mapped[str] = mapped_column(String(128), unique=True)
    mime: Mapped[str] = mapped_column(String(128))
    ext: Mapped[str] = mapped_column(String(16))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    category: Mapped[str] = mapped_column(String(32), default="other")
    detected_kind: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="uploaded")
    text_method: Mapped[str | None] = mapped_column(String(16))
    machine_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    page_count: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (UniqueConstraint("case_id", "source_code", name="uq_source_code_per_case"),)


class SourceFragment(Base):
    __tablename__ = "source_fragments"
    id: Mapped[str] = _pk()
    file_id: Mapped[str] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    page: Mapped[int | None] = mapped_column(Integer)
    paragraph: Mapped[int | None] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    method: Mapped[str] = mapped_column(String(16), default="digital")
    ocr_confidence: Mapped[float | None] = mapped_column()

    __table_args__ = (UniqueConstraint("file_id", "seq", name="uq_fragment_seq"),)


class ExtractedEntity(Base):
    __tablename__ = "extracted_entities"
    id: Mapped[str] = _pk()
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"), index=True)
    fragment_id: Mapped[str] = mapped_column(ForeignKey("source_fragments.id", ondelete="CASCADE"))
    entity_type: Mapped[str] = mapped_column(String(32), index=True)
    value: Mapped[str] = mapped_column(Text)
    normalized: Mapped[str | None] = mapped_column(Text)
    char_start: Mapped[int] = mapped_column(Integer)
    char_end: Mapped[int] = mapped_column(Integer)
    context: Mapped[str | None] = mapped_column(Text)
    extractor: Mapped[str] = mapped_column(String(64))
    confidence: Mapped[float | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FactClaim(Base):
    __tablename__ = "fact_claims"
    id: Mapped[str] = _pk()
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    entity_id: Mapped[str | None] = mapped_column(ForeignKey("extracted_entities.id", ondelete="SET NULL"))
    fact_type: Mapped[str] = mapped_column(String(32), index=True)
    label: Mapped[str | None] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    normalized: Mapped[str | None] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(16), default="extraction")
    status: Mapped[str] = mapped_column(String(16), default="unverified")
    edited_manually: Mapped[bool] = mapped_column(Boolean, default=False)
    original_content: Mapped[str | None] = mapped_column(Text)
    machine_generated: Mapped[bool] = mapped_column(Boolean, default=True)
    confidence: Mapped[float | None] = mapped_column()
    verified_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sources: Mapped[list["FactSource"]] = relationship(cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        CheckConstraint("status in ('unverified','confirmed','rejected')", name="ck_fact_status"),
        CheckConstraint("origin in ('extraction','manual','ai')", name="ck_fact_origin"),
    )


class FactSource(Base):
    __tablename__ = "fact_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fact_id: Mapped[str] = mapped_column(ForeignKey("fact_claims.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"))
    fragment_id: Mapped[str | None] = mapped_column(ForeignKey("source_fragments.id", ondelete="SET NULL"))
    page: Mapped[int | None] = mapped_column(Integer)
    char_start: Mapped[int | None] = mapped_column(Integer)
    char_end: Mapped[int | None] = mapped_column(Integer)
    quote: Mapped[str | None] = mapped_column(Text)


class Discrepancy(Base):
    __tablename__ = "discrepancies"
    id: Mapped[str] = _pk()
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    signature: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text)
    items: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="open")
    resolution_note: Mapped[str | None] = mapped_column(Text)
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (UniqueConstraint("case_id", "signature", name="uq_discrepancy_sig"),)


class DocumentTemplate(Base):
    __tablename__ = "document_templates"
    id: Mapped[str] = _pk()
    type_code: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(512))
    section: Mapped[str] = mapped_column(String(32))
    procedural_kind: Mapped[str] = mapped_column(String(32))
    author_role: Mapped[str] = mapped_column(String(128))
    addressee: Mapped[str | None] = mapped_column(String(255))
    requires_court: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_head_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_prosecutor_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    stages: Mapped[list] = mapped_column(JSON, default=list)
    legal_bases: Mapped[list] = mapped_column(JSON, default=list)
    specializations: Mapped[list] = mapped_column(JSON, default=list)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(16), default="builtin")
    checksum: Mapped[str] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    fields: Mapped[list["DocumentField"]] = relationship(
        cascade="all, delete-orphan", order_by="DocumentField.order", lazy="selectin"
    )

    __table_args__ = (UniqueConstraint("type_code", "version", name="uq_template_version"),)


class DocumentField(Base):
    __tablename__ = "document_fields"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("document_templates.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(255))
    field_type: Mapped[str] = mapped_column(String(24))
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    condition: Mapped[str | None] = mapped_column(String(1024))
    binding: Mapped[str | None] = mapped_column(String(128))
    participant_role: Mapped[str | None] = mapped_column(String(512))
    options: Mapped[list | None] = mapped_column(JSON)
    help: Mapped[str | None] = mapped_column(Text)
    group: Mapped[str | None] = mapped_column(String(128))
    narrative: Mapped[bool] = mapped_column(Boolean, default=False)
    order: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (UniqueConstraint("template_id", "key", name="uq_field_key"),)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = _pk()
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="RESTRICT"), index=True)
    template_id: Mapped[str | None] = mapped_column(ForeignKey("document_templates.id", ondelete="RESTRICT"))
    type_code: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(24), default="draft")
    generation_mode: Mapped[str] = mapped_column(String(16), default="template")
    kit_id: Mapped[str | None] = mapped_column(String(36), index=True)
    kit_code: Mapped[str | None] = mapped_column(String(64))
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    template: Mapped[DocumentTemplate | None] = relationship(lazy="joined")

    __table_args__ = (
        CheckConstraint(
            "status in ('draft','awaiting_input','analyzing','needs_review','reviewed','approved','exported','archived')",
            name="ck_document_status",
        ),
    )


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    id: Mapped[str] = _pk()
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    content_html: Mapped[str] = mapped_column(Text)
    field_values: Mapped[dict] = mapped_column(JSON, default=dict)
    field_sources: Mapped[dict] = mapped_column(JSON, default=dict)
    case_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    template_version: Mapped[int | None] = mapped_column(Integer)
    validation: Mapped[dict | None] = mapped_column(JSON)
    comment: Mapped[str | None] = mapped_column(String(512))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (UniqueConstraint("document_id", "number", name="uq_doc_version_number"),)


class DocumentExport(Base):
    __tablename__ = "document_exports"
    id: Mapped[str] = _pk()
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"))
    fmt: Mapped[str] = mapped_column(String(8))
    stored_name: Mapped[str] = mapped_column(String(128))
    sha256: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LegalAct(Base):
    __tablename__ = "legal_acts"
    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(32), unique=True)
    kind: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(1024))
    short_title: Mapped[str] = mapped_column(String(128))
    number: Mapped[str | None] = mapped_column(String(64))
    adopted_at: Mapped[date | None] = mapped_column(Date)
    official_source: Mapped[str | None] = mapped_column(String(1024))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    changes_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LegalProvision(Base):
    __tablename__ = "legal_provisions"
    id: Mapped[str] = _pk()
    act_id: Mapped[str] = mapped_column(ForeignKey("legal_acts.id", ondelete="RESTRICT"), index=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    article: Mapped[str] = mapped_column(String(16))
    part: Mapped[str | None] = mapped_column(String(16))
    item: Mapped[str | None] = mapped_column(String(16))
    heading: Mapped[str | None] = mapped_column(String(1024))

    act: Mapped[LegalAct] = relationship(lazy="joined")
    versions: Mapped[list["LegalVersion"]] = relationship(
        cascade="all, delete-orphan", order_by="LegalVersion.valid_from", lazy="selectin"
    )


class LegalVersion(Base):
    __tablename__ = "legal_versions"
    id: Mapped[str] = _pk()
    provision_id: Mapped[str] = mapped_column(ForeignKey("legal_provisions.id", ondelete="CASCADE"), index=True)
    text: Mapped[str | None] = mapped_column(Text)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str | None] = mapped_column(String(1024))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    import_batch: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DocumentLegalBasis(Base):
    __tablename__ = "document_legal_bases"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"))
    provision_id: Mapped[str] = mapped_column(ForeignKey("legal_provisions.id", ondelete="RESTRICT"))
    legal_version_id: Mapped[str | None] = mapped_column(ForeignKey("legal_versions.id", ondelete="SET NULL"))
    reason: Mapped[str | None] = mapped_column(Text)
    mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    verified_on_date: Mapped[bool] = mapped_column(Boolean, default=False)


class Deadline(Base):
    __tablename__ = "deadlines"
    id: Mapped[str] = _pk()
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    rule_code: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(512))
    participant_id: Mapped[str | None] = mapped_column(ForeignKey("case_participants.id", ondelete="SET NULL"))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    adjustments: Mapped[list] = mapped_column(JSON, default=list)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    calculation: Mapped[dict] = mapped_column(JSON, default=dict)
    legal_basis_key: Mapped[str | None] = mapped_column(String(64))
    source_note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="unconfirmed")
    notify_days_before: Mapped[int] = mapped_column(Integer, default=3)
    confirmed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        CheckConstraint("status in ('unconfirmed','confirmed','closed','cancelled')", name="ck_deadline_status"),
    )


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = _pk()
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(String(512))
    case_id: Mapped[str | None] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[str | None] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"))
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    user_login: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), index=True)
    category: Mapped[str] = mapped_column(String(16), default="action")
    object_type: Mapped[str | None] = mapped_column(String(32))
    object_id: Mapped[str | None] = mapped_column(String(64))
    case_id: Mapped[str | None] = mapped_column(String(36), index=True)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    ip: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict | None] = mapped_column(JSON)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | list | str | int | None] = mapped_column(JSON)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


Index("ix_documents_case_status", Document.case_id, Document.status)
Index("ix_deadlines_case_due", Deadline.case_id, Deadline.due_at)
