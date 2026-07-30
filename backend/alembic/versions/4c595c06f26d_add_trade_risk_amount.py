"""add trade risk_amount

Revision ID: 4c595c06f26d
Revises: c88cfe02c404
Create Date: 2026-07-27 06:49:11.078042

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4c595c06f26d'
down_revision: Union[str, None] = 'c88cfe02c404'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable with no backfill: there is no way to infer the dollar risk of a
    # trade that has already closed, and guessing would poison the R stats. Every
    # pre-existing trade stays NULL and is reported as "excluded" by /stats/risk
    # until the user fills it in from the trade form.
    op.add_column('trades', sa.Column('risk_amount', sa.Numeric(precision=18, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column('trades', 'risk_amount')
