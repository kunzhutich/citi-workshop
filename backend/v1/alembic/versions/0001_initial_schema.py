"""Initial schema: extensions, enum types, ticket sequence and all MVP tables.

Revision ID: 0001
Revises:
Create Date: 2026-09-22

Written once, then frozen. The enum type names and the order of operations
matter and are spelled out rather than left to autogenerate:

1. **Extensions first.** ``pgcrypto`` provides ``gen_random_uuid()``, which
   every primary key defaults to, and ``citext`` provides the case-insensitive
   type ``users.email`` uses. Both must exist before any table is created.
2. **Enum types next**, created explicitly so that the table definitions below
   can all use ``create_type=False``. Letting SQLAlchemy create a type
   implicitly works only while exactly one table references it; the moment a
   second one does, the migration fails with "type already exists". Creating
   them up front removes that trap for good.

   The names are listed in ``ENUM_TYPES_AT_0001`` rather than read out of
   ``app.models.enums.ENUM_TYPES``, which is what this revision did until
   revision 0005. A migration that iterates a live application constant is not
   frozen: adding a twelfth enum to the registry would silently change what
   *this* revision does, so a database created today would get a type that
   every database created before it was given by a later revision. Revision
   0005 hit exactly that — it creates ``notification_type``, and a fresh
   database would have had 0001 create it first and 0005 fail on
   "type already exists". The list below is the eleven types this revision has
   always created, so it now does the same thing everywhere, for ever.
3. **The ticket sequence**, because ``incidents.ticket_number`` defaults to
   ``nextval('incident_ticket_seq')``.
4. **Tables**, parents before children.

This migration creates schema only. Reference data — the category tree — is
seeded separately by ``app.seed.categories``, which the ``migrate`` ops action
runs immediately afterwards.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.models.enums import ENUM_TYPES

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Name of the sequence behind the human-facing INC-000123 ticket numbers.
TICKET_SEQUENCE = "incident_ticket_seq"


#: The enum types **this revision** creates, frozen as a list of names.
#:
#: Deliberately not ``ENUM_TYPES.keys()``. See the module docstring: a revision
#: that reads a live application constant changes meaning when the application
#: does. The values still come from the registry, because changing a member of
#: an existing enum is a different question and would need its own revision.
ENUM_TYPES_AT_0001: tuple[str, ...] = (
    "user_role",
    "engineer_level",
    "incident_status",
    "incident_priority",
    "blocked_reason_type",
    "close_reason",
    "note_visibility",
    "availability_status",
    "seat_type",
    "location_detail",
    "event_type",
)


def _create_enum_types() -> None:
    """Create the PostgreSQL enum types this revision is responsible for."""
    for type_name in ENUM_TYPES_AT_0001:
        enum_cls = ENUM_TYPES[type_name]
        values = ", ".join(f"'{member.value}'" for member in enum_cls)
        op.execute(f"CREATE TYPE {type_name} AS ENUM ({values})")


def _drop_enum_types() -> None:
    """Drop every enum type this revision created."""
    for type_name in ENUM_TYPES_AT_0001:
        op.execute(f"DROP TYPE IF EXISTS {type_name}")


def upgrade() -> None:
    """Apply this revision."""
    # 1. Extensions. IF NOT EXISTS because a shared database may already have
    #    them, and because this must be safe to run against Aurora more than once.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    # 2. Enum types, before any table refers to them.
    _create_enum_types()

    # 3. Ticket numbers are a sequence, not a row count: stable, never reused,
    #    and safe under concurrency.
    op.execute(f"CREATE SEQUENCE {TICKET_SEQUENCE} AS BIGINT START WITH 1 INCREMENT BY 1")

    # 4. Tables.
    op.create_table('buildings',
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('code', sa.Text(), nullable=False),
    sa.Column('address', sa.Text(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_buildings')),
    sa.UniqueConstraint('code', name=op.f('uq_buildings_code')),
    sa.UniqueConstraint('name', name=op.f('uq_buildings_name'))
    )
    op.create_table('categories',
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('hint', sa.Text(), nullable=True),
    sa.Column('icon', sa.Text(), nullable=True),
    sa.Column('location_detail', postgresql.ENUM('BUILDING', 'FLOOR', 'SEAT', name='location_detail', create_type=False), server_default=sa.text("'FLOOR'"), nullable=False),
    sa.Column('sort_order', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['parent_id'], ['categories.id'], name=op.f('fk_categories_parent_id_categories'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_categories')),
    sa.UniqueConstraint('parent_id', 'name', name=op.f('uq_categories_parent_id_name'), postgresql_nulls_not_distinct=True)
    )
    op.create_index(op.f('ix_categories_parent_id'), 'categories', ['parent_id'], unique=False)
    op.create_table('floors',
    sa.Column('building_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('level_number', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], name=op.f('fk_floors_building_id_buildings'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_floors')),
    sa.UniqueConstraint('building_id', 'level_number', name=op.f('uq_floors_building_id_level_number'))
    )
    op.create_index(op.f('ix_floors_building_id'), 'floors', ['building_id'], unique=False)
    op.create_table('seats',
    sa.Column('floor_id', sa.UUID(), nullable=False),
    sa.Column('code', sa.Text(), nullable=False),
    sa.Column('seat_type', postgresql.ENUM('DESK', 'MEETING_ROOM', 'COMMON_AREA', 'OTHER', name='seat_type', create_type=False), server_default=sa.text("'DESK'"), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['floor_id'], ['floors.id'], name=op.f('fk_seats_floor_id_floors'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_seats')),
    sa.UniqueConstraint('floor_id', 'code', name=op.f('uq_seats_floor_id_code'))
    )
    op.create_index(op.f('ix_seats_floor_id'), 'seats', ['floor_id'], unique=False)
    op.create_table('users',
    sa.Column('email', postgresql.CITEXT(), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('full_name', sa.Text(), nullable=False),
    sa.Column('role', postgresql.ENUM('EMPLOYEE', 'ENGINEER', 'FACILITY_ADMIN', name='user_role', create_type=False), server_default=sa.text("'EMPLOYEE'"), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('must_change_password', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_building_id', sa.UUID(), nullable=True),
    sa.Column('last_floor_id', sa.UUID(), nullable=True),
    sa.Column('last_seat_id', sa.UUID(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['last_building_id'], ['buildings.id'], name=op.f('fk_users_last_building_id_buildings'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['last_floor_id'], ['floors.id'], name=op.f('fk_users_last_floor_id_floors'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['last_seat_id'], ['seats.id'], name=op.f('fk_users_last_seat_id_seats'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('email', name=op.f('uq_users_email'))
    )
    op.create_index(op.f('ix_users_role'), 'users', ['role'], unique=False)
    op.create_table('engineer_profiles',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('level', postgresql.ENUM('JUNIOR', 'SENIOR', 'LEAD', name='engineer_level', create_type=False), server_default=sa.text("'JUNIOR'"), nullable=False),
    sa.Column('specialty_group_ids', postgresql.ARRAY(sa.UUID()), server_default=sa.text("'{}'::uuid[]"), nullable=False),
    sa.Column('home_building_id', sa.UUID(), nullable=True),
    sa.Column('phone', sa.Text(), nullable=True),
    sa.Column('availability', postgresql.ENUM('AVAILABLE', 'BUSY', 'OFF_DUTY', 'ON_LEAVE', name='availability_status', create_type=False), server_default=sa.text("'AVAILABLE'"), nullable=False),
    sa.Column('max_active_tickets', sa.Integer(), server_default=sa.text('10'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('max_active_tickets > 0', name=op.f('ck_engineer_profiles_max_active_tickets_positive')),
    sa.ForeignKeyConstraint(['home_building_id'], ['buildings.id'], name=op.f('fk_engineer_profiles_home_building_id_buildings'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_engineer_profiles_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_engineer_profiles'))
    )
    op.create_table('incidents',
    sa.Column('ticket_number', sa.BIGINT(), server_default=sa.text("nextval('incident_ticket_seq')"), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('category_id', sa.UUID(), nullable=False),
    sa.Column('building_id', sa.UUID(), nullable=False),
    sa.Column('floor_id', sa.UUID(), nullable=True),
    sa.Column('seat_id', sa.UUID(), nullable=True),
    sa.Column('status', postgresql.ENUM('OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED', name='incident_status', create_type=False), server_default=sa.text("'OPEN'"), nullable=False),
    sa.Column('priority', postgresql.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', name='incident_priority', create_type=False), server_default=sa.text("'MEDIUM'"), nullable=False),
    sa.Column('reporter_id', sa.UUID(), nullable=False),
    sa.Column('assignee_id', sa.UUID(), nullable=True),
    sa.Column('is_escalated', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('escalation_reason', sa.Text(), nullable=True),
    sa.Column('escalated_at', sa.DateTime(), nullable=True),
    sa.Column('escalated_by', sa.UUID(), nullable=True),
    sa.Column('blocked_reason_type', postgresql.ENUM('WAITING_ON_PARTS', 'WAITING_ON_EMPLOYEE', 'WAITING_ON_VENDOR', 'ACCESS_REQUIRED', 'OTHER', name='blocked_reason_type', create_type=False), nullable=True),
    sa.Column('blocked_reason', sa.Text(), nullable=True),
    sa.Column('resolution_summary', sa.Text(), nullable=True),
    sa.Column('close_reason', postgresql.ENUM('CONFIRMED_FIXED', 'CLOSED_BY_ENGINEER', 'DUPLICATE', 'INVALID', 'CANCELLED_BY_REPORTER', 'ADMIN_CLOSED', name='close_reason', create_type=False), nullable=True),
    sa.Column('duplicate_of_id', sa.UUID(), nullable=True),
    sa.Column('reopen_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('assigned_at', sa.DateTime(), nullable=True),
    sa.Column('acknowledged_at', sa.DateTime(), nullable=True),
    sa.Column('resolved_at', sa.DateTime(), nullable=True),
    sa.Column('closed_at', sa.DateTime(), nullable=True),
    sa.Column('search_vector', postgresql.TSVECTOR(), sa.Computed("setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')", persisted=True), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status <> 'BLOCKED' OR blocked_reason_type IS NOT NULL", name=op.f('ck_incidents_blocked_has_reason')),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], name=op.f('fk_incidents_assignee_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], name=op.f('fk_incidents_building_id_buildings'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_incidents_category_id_categories'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['duplicate_of_id'], ['incidents.id'], name=op.f('fk_incidents_duplicate_of_id_incidents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['escalated_by'], ['users.id'], name=op.f('fk_incidents_escalated_by_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['floor_id'], ['floors.id'], name=op.f('fk_incidents_floor_id_floors'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], name=op.f('fk_incidents_reporter_id_users'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['seat_id'], ['seats.id'], name=op.f('fk_incidents_seat_id_seats'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_incidents')),
    sa.UniqueConstraint('ticket_number', name=op.f('uq_incidents_ticket_number'))
    )
    op.create_index(op.f('ix_incidents_assignee_id'), 'incidents', ['assignee_id'], unique=False)
    op.create_index(op.f('ix_incidents_building_id'), 'incidents', ['building_id'], unique=False)
    op.create_index(op.f('ix_incidents_category_id'), 'incidents', ['category_id'], unique=False)
    op.create_index(op.f('ix_incidents_floor_id'), 'incidents', ['floor_id'], unique=False)
    op.create_index(op.f('ix_incidents_is_escalated'), 'incidents', ['is_escalated'], unique=False)
    op.create_index(op.f('ix_incidents_priority'), 'incidents', ['priority'], unique=False)
    op.create_index(op.f('ix_incidents_reporter_id'), 'incidents', ['reporter_id'], unique=False)
    op.create_index('ix_incidents_search_vector', 'incidents', ['search_vector'], unique=False, postgresql_using='gin')
    op.create_index(op.f('ix_incidents_seat_id'), 'incidents', ['seat_id'], unique=False)
    op.create_index(op.f('ix_incidents_status'), 'incidents', ['status'], unique=False)
    op.create_table('refresh_tokens',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.Text(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_refresh_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_refresh_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_refresh_tokens_token_hash'))
    )
    op.create_index(op.f('ix_refresh_tokens_user_id'), 'refresh_tokens', ['user_id'], unique=False)
    op.create_table('incident_events',
    sa.Column('incident_id', sa.UUID(), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('event_type', postgresql.ENUM('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'UNASSIGNED', 'PRIORITY_CHANGED', 'ESCALATED', 'ESCALATION_CLEARED', 'NOTE_ADDED', 'MARKED_DUPLICATE', 'REOPENED', name='event_type', create_type=False), nullable=False),
    sa.Column('from_value', sa.Text(), nullable=True),
    sa.Column('to_value', sa.Text(), nullable=True),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_incident_events_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['incident_id'], ['incidents.id'], name=op.f('fk_incident_events_incident_id_incidents'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_incident_events'))
    )
    op.create_index('ix_incident_events_incident_id_created_at', 'incident_events', ['incident_id', 'created_at'], unique=False)
    op.create_table('incident_notes',
    sa.Column('incident_id', sa.UUID(), nullable=False),
    sa.Column('author_id', sa.UUID(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('visibility', postgresql.ENUM('PUBLIC', 'INTERNAL', name='note_visibility', create_type=False), server_default=sa.text("'PUBLIC'"), nullable=False),
    sa.Column('edited_at', sa.DateTime(), nullable=True),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('fk_incident_notes_author_id_users'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['incident_id'], ['incidents.id'], name=op.f('fk_incident_notes_incident_id_incidents'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_incident_notes'))
    )
    op.create_index(op.f('ix_incident_notes_author_id'), 'incident_notes', ['author_id'], unique=False)
    op.create_index('ix_incident_notes_incident_id_created_at', 'incident_notes', ['incident_id', 'created_at'], unique=False)


def downgrade() -> None:
    """Revert this revision.

    Extensions are deliberately not dropped: other schemas in the same database
    may rely on them, and creating them again is cheap.
    """
    op.drop_index('ix_incident_notes_incident_id_created_at', table_name='incident_notes')
    op.drop_index(op.f('ix_incident_notes_author_id'), table_name='incident_notes')
    op.drop_table('incident_notes')
    op.drop_index('ix_incident_events_incident_id_created_at', table_name='incident_events')
    op.drop_table('incident_events')
    op.drop_index(op.f('ix_refresh_tokens_user_id'), table_name='refresh_tokens')
    op.drop_table('refresh_tokens')
    op.drop_index(op.f('ix_incidents_status'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_seat_id'), table_name='incidents')
    op.drop_index('ix_incidents_search_vector', table_name='incidents', postgresql_using='gin')
    op.drop_index(op.f('ix_incidents_reporter_id'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_priority'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_is_escalated'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_floor_id'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_category_id'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_building_id'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_assignee_id'), table_name='incidents')
    op.drop_table('incidents')
    op.drop_table('engineer_profiles')
    op.drop_index(op.f('ix_users_role'), table_name='users')
    op.drop_table('users')
    op.drop_index(op.f('ix_seats_floor_id'), table_name='seats')
    op.drop_table('seats')
    op.drop_index(op.f('ix_floors_building_id'), table_name='floors')
    op.drop_table('floors')
    op.drop_index(op.f('ix_categories_parent_id'), table_name='categories')
    op.drop_table('categories')
    op.drop_table('buildings')

    op.execute(f"DROP SEQUENCE IF EXISTS {TICKET_SEQUENCE}")
    _drop_enum_types()
