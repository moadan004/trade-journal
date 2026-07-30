import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy import pool

from alembic import context

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.database import Base  # noqa: E402
from app.models import Account, Trade, User, WeeklyReview  # noqa: E402, F401

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Deliberately NOT config.set_main_option("sqlalchemy.url", ...): that hands the
# value to ConfigParser.set(), which runs pyformat interpolation over it. A
# percent-encoded password - `p%40ssword` for a literal `@`, which is exactly what
# a correctly-escaped connection string looks like - then raises
# "ValueError: invalid interpolation syntax" before a single packet is sent.
# Escaping to `%%` would work, but keeping the URL out of the .ini entirely also
# sidesteps ConfigParser's `;` inline-comment handling, and means the credentials
# never land in an object whose repr gets logged. So the URL is read once here and
# passed straight to SQLAlchemy.
DATABASE_URL = get_settings().database_url

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    # NullPool: a migration run is one short-lived connection, and pooling it
    # would hold the connection open against the pooler after we're done.
    connectable = create_engine(DATABASE_URL, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
