-- Dynamic Reporting Studio metadata schema (PostgreSQL)

create extension if not exists pgcrypto;

create table if not exists reporting_datasets (
    id uuid primary key default gen_random_uuid(),
    key text not null unique,
    name text not null,
    description text,
    source_relation text not null,
    default_scope text not null default 'portfolio',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists reporting_fields (
    id uuid primary key default gen_random_uuid(),
    dataset_id uuid not null references reporting_datasets(id) on delete cascade,
    key text not null,
    label text not null,
    description text,
    source_expression text not null,
    data_type text not null check (data_type in (
        'text','integer','decimal','currency','percentage','date','datetime',
        'boolean','enum','duration','project','department','agency'
    )),
    allowed_operators jsonb not null default '[]'::jsonb,
    allowed_aggregations jsonb not null default '[]'::jsonb,
    enum_options jsonb,
    default_format jsonb not null default '{}'::jsonb,
    is_dimension boolean not null default true,
    is_filterable boolean not null default true,
    is_sortable boolean not null default true,
    is_groupable boolean not null default true,
    is_visible boolean not null default true,
    ordinal integer not null default 0,
    unique (dataset_id, key)
);

create table if not exists reporting_metrics (
    id uuid primary key default gen_random_uuid(),
    dataset_id uuid not null references reporting_datasets(id) on delete cascade,
    key text not null,
    label text not null,
    description text,
    expression jsonb not null,
    result_type text not null,
    default_format jsonb not null default '{}'::jsonb,
    default_filters jsonb not null default '{"logic":"and","items":[]}'::jsonb,
    is_active boolean not null default true,
    version integer not null default 1,
    unique (dataset_id, key, version)
);

create table if not exists report_templates (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text,
    mode text not null check (mode in ('grid','pivot','formatted')),
    dataset_id uuid not null references reporting_datasets(id),
    definition jsonb not null,
    scope_type text not null default 'portfolio',
    status text not null default 'draft' check (status in ('draft','published','archived')),
    version integer not null default 1,
    owner_user_id text,
    created_by text,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_report_templates_dataset on report_templates(dataset_id);
create index if not exists idx_report_templates_definition_gin on report_templates using gin(definition);

create table if not exists report_permissions (
    id uuid primary key default gen_random_uuid(),
    report_template_id uuid not null references report_templates(id) on delete cascade,
    principal_type text not null check (principal_type in ('user','role','department')),
    principal_id text not null,
    permission text not null check (permission in ('view','edit','publish','admin')),
    unique (report_template_id, principal_type, principal_id, permission)
);

create table if not exists saved_report_views (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    dataset_id uuid not null references reporting_datasets(id),
    owner_user_id text not null,
    definition jsonb not null,
    is_shared boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists report_snapshots (
    id uuid primary key default gen_random_uuid(),
    report_template_id uuid not null references report_templates(id),
    template_version integer not null,
    parameters jsonb not null default '{}'::jsonb,
    result jsonb not null,
    generated_by text,
    generated_at timestamptz not null default now(),
    data_as_of timestamptz,
    checksum text
);

create index if not exists idx_report_snapshots_template_generated
    on report_snapshots(report_template_id, generated_at desc);

create table if not exists report_execution_log (
    id uuid primary key default gen_random_uuid(),
    report_template_id uuid references report_templates(id),
    dataset_id uuid references reporting_datasets(id),
    user_id text,
    parameters jsonb not null default '{}'::jsonb,
    compiled_plan jsonb,
    query_count integer,
    duration_ms integer,
    row_count integer,
    status text not null check (status in ('started','succeeded','failed')),
    error_message text,
    created_at timestamptz not null default now()
);

-- Recommended first curated dataset. Replace source relation with the real view.
insert into reporting_datasets (key, name, description, source_relation, default_scope)
values (
    'project_portfolio',
    'Project Portfolio',
    'Curated project, schedule, progress and financial fields for single-project and portfolio reporting.',
    'reporting_project_portfolio',
    'portfolio'
)
on conflict (key) do nothing;
