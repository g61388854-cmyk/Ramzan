from __future__ import annotations

from alembic import context
from sqlalchemy import engine_from_config, pool

from app import models  # noqa: F401 - регистрация моделей
from app.config import settings
from app.db import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
MANUAL_INDEXES = {"ix_fragments_fts", "ix_legal_versions_fts"}


def include_object(obj, name, type_, reflected, compare_to):
    # Полнотекстовые индексы создаются отдельной миграцией и не описаны в моделях.
    return not (type_ == "index" and name in MANUAL_INDEXES)


def run_migrations_offline() -> None:
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True,
                      compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section), prefix="sqlalchemy.",
                                     poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True,
                          include_object=include_object, render_as_batch=connection.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
