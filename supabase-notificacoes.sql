-- Plano Financeiro — caixa de entrada das notificações do banco (Android + MacroDroid).
-- Cole este script no Supabase em: SQL Editor → New query → Run.
-- (Precisa ter rodado antes o supabase.sql da sincronização.)

-- Código secreto de cada pessoa, usado pelo MacroDroid para entregar as notificações.
create table if not exists public.inbox_tokens (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token      text        not null unique,
  created_at timestamptz not null default now()
);
alter table public.inbox_tokens enable row level security;
drop policy if exists "código próprio" on public.inbox_tokens;
create policy "código próprio" on public.inbox_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.inbox_tokens to authenticated;

-- Notificações recebidas, aguardando você lançar ou ignorar no app.
create table if not exists public.inbox (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  app        text,
  title      text,
  body       text        not null default '',
  status     text        not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists inbox_user_status on public.inbox (user_id, status);
alter table public.inbox enable row level security;
drop policy if exists "notificações próprias" on public.inbox;
create policy "notificações próprias" on public.inbox
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, update, delete on public.inbox to authenticated;

-- Porta de entrada usada pelo MacroDroid: só aceita quem tem o código secreto.
create or replace function public.add_notification(p_token text, p_app text default '', p_title text default '', p_text text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  select user_id into uid from public.inbox_tokens where token = p_token;
  if uid is null then
    raise exception 'código inválido';
  end if;
  if coalesce(trim(p_text), '') = '' and coalesce(trim(p_title), '') = '' then
    return 'vazia';
  end if;
  -- evita duplicar a mesma notificação enviada duas vezes seguidas
  if exists (select 1 from public.inbox
             where user_id = uid and body = coalesce(p_text, '') and coalesce(title, '') = coalesce(p_title, '')
               and created_at > now() - interval '3 minutes') then
    return 'repetida';
  end if;
  insert into public.inbox (user_id, app, title, body)
  values (uid, left(coalesce(p_app, ''), 100), left(coalesce(p_title, ''), 300), left(coalesce(p_text, ''), 2000));
  return 'ok';
end;
$$;
revoke all on function public.add_notification(text, text, text, text) from public;
grant execute on function public.add_notification(text, text, text, text) to anon, authenticated;
