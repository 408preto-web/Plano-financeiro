-- Plano Financeiro — tabela para sincronizar os dados entre aparelhos.
-- Cole este script no Supabase em: SQL Editor → New query → Run.

create table if not exists public.app_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null,
  rev        bigint      not null default 1,
  updated_at timestamptz not null default now()
);

-- Cada pessoa só enxerga e altera os próprios dados.
alter table public.app_state enable row level security;

drop policy if exists "ler os próprios dados" on public.app_state;
create policy "ler os próprios dados" on public.app_state
  for select using (auth.uid() = user_id);

drop policy if exists "criar os próprios dados" on public.app_state;
create policy "criar os próprios dados" on public.app_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "alterar os próprios dados" on public.app_state;
create policy "alterar os próprios dados" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.app_state to authenticated;
