-- ================================================================
-- QuantumTree — Supabase Schema
-- Run this in the Supabase SQL editor: Dashboard → SQL Editor → New query
-- ================================================================

-- ── Enable UUID extension ──────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Table: datasets ───────────────────────────────────────────
create table if not exists datasets (
    id             uuid primary key default uuid_generate_v4(),
    session_id     text             not null,
    name           text             not null,
    headers        jsonb            not null,  -- ["col1","col2",...,"label"]
    rows           jsonb            not null,  -- [[val,val,...], ...]
    feature_types  jsonb            not null,  -- {"col1":"numerical","col2":"categorical"}
    row_count      integer          not null default 0,
    created_at     timestamptz      not null default now()
);

-- Index for fast session-scoped lookups
create index if not exists idx_datasets_session on datasets(session_id);

-- ── Table: tree_sessions ──────────────────────────────────────
create table if not exists tree_sessions (
    id             uuid primary key default uuid_generate_v4(),
    session_id     text             not null,
    dataset_id     uuid             references datasets(id) on delete set null,
    dataset_name   text             not null,  -- denormalized for list view
    criterion      text             not null check (criterion in ('entropy', 'gini')),
    max_depth      integer          not null check (max_depth between 1 and 20),
    min_samples    integer          not null check (min_samples >= 2),
    tree_json      jsonb            not null,  -- serialized tree root node
    stats          jsonb            not null,  -- {nodes, leaves, maxDepth}
    created_at     timestamptz      not null default now()
);

-- Index for fast session-scoped lookups
create index if not exists idx_tree_sessions_session on tree_sessions(session_id);
create index if not exists idx_tree_sessions_created on tree_sessions(created_at desc);

-- ── Row Level Security ─────────────────────────────────────────
-- Enable RLS so each session can only see its own rows

alter table datasets      enable row level security;
alter table tree_sessions enable row level security;

-- Datasets: allow all operations where session_id matches the request header
-- We pass session_id as a filter param in queries from the backend,
-- so we use a permissive policy scoped to the service role (backend controls access).
-- For anon key usage, uncomment the policies below:

-- create policy "datasets_session_isolation" on datasets
--     using (session_id = current_setting('app.session_id', true));

-- create policy "tree_sessions_isolation" on tree_sessions
--     using (session_id = current_setting('app.session_id', true));

-- Since we use the SERVICE ROLE key in the backend (bypasses RLS),
-- the isolation is enforced at the API layer (routers filter by session_id).
-- This is the standard pattern for server-side Supabase usage.

-- ── Cleanup function (optional) ───────────────────────────────
-- Automatically delete sessions older than 30 days
create or replace function cleanup_old_sessions()
returns void language sql as $$
    delete from tree_sessions where created_at < now() - interval '30 days';
    delete from datasets      where created_at < now() - interval '30 days';
$$;
