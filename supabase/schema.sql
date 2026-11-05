-- Kairos schema for Supabase. Run once in the SQL Editor (Run). Safe to re-run.

-- Each user's own documents: review state, daily log, settings, own card edits.
create table if not exists public.user_docs (
  user_id    uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  path       text   not null check (length(path) <= 300),
  body       jsonb,                       -- null = deleted
  updated_at bigint not null,             -- client clock, ms; newest write wins
  server_at  timestamptz not null default now(),  -- server clock; used to pull changes
  primary key (user_id, path)
);
create index if not exists user_docs_pull on public.user_docs (user_id, server_at);
alter table public.user_docs enable row level security;
drop policy if exists user_docs_own on public.user_docs;
create policy user_docs_own on public.user_docs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.touch_server_at() returns trigger language plpgsql as $$
begin new.server_at := now(); return new; end $$;
drop trigger if exists user_docs_touch on public.user_docs;
create trigger user_docs_touch before insert or update on public.user_docs
  for each row execute function public.touch_server_at();

-- Write many docs at once; an older write never replaces a newer one.
create or replace function public.put_docs(docs jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.user_docs (user_id, path, body, updated_at)
  select auth.uid(), d->>'path', d->'body', (d->>'updated_at')::bigint
  from jsonb_array_elements(docs) d
  on conflict (user_id, path) do update
    set body = excluded.body, updated_at = excluded.updated_at
    where public.user_docs.updated_at < excluded.updated_at;
$$;
grant execute on function public.put_docs(jsonb) to authenticated;

-- Private decks and cards: each owner reads only their own. Only the ingest job writes.
create table if not exists public.private_docs (
  owner      uuid not null references auth.users(id) on delete cascade,
  coll       text not null check (coll in ('decks', 'cards')),
  id         text not null,
  body       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, coll, id)
);
alter table public.private_docs enable row level security;
drop policy if exists private_docs_read_own on public.private_docs;
create policy private_docs_read_own on public.private_docs for select to authenticated
  using (owner = auth.uid());

-- Ingest job state (key pair, applied chunks). No policies: only the service role reaches it.
create table if not exists public.ingest_state (
  key   text primary key,
  value jsonb not null
);
alter table public.ingest_state enable row level security;
