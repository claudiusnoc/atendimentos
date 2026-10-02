-- Esquema mínimo para o Relatório de Atendimentos Metro.
-- Importar somente as linhas da aba Tipologia. Cada linha original fica
-- preservada em dados (JSONB); site/prioridade/quantidade são campos de busca.

create table if not exists public.tipologia_sites (
  site text primary key,
  priority text,
  quantity text,
  dados jsonb not null,
  updated_at timestamptz not null default now(),
  constraint tipologia_site_uppercase check (site = upper(site))
);

create table if not exists public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  ordem integer not null default 0,
  site text not null references public.tipologia_sites(site) on update cascade on delete restrict,
  priority text not null default '',
  quantity text not null default '',
  technician text not null default '',
  base text not null default '',
  failure text not null default '',
  status text not null default '',
  notes text not null default '',
  voltage numeric(7,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id),
  constraint atendimentos_voltage_nonnegative check (voltage is null or voltage >= 0)
);

-- Safe to rerun after the initial schema has already been applied.
alter table public.atendimentos add column if not exists priority text not null default '';
alter table public.atendimentos add column if not exists quantity text not null default '';

create index if not exists atendimentos_ordem_idx on public.atendimentos (ordem, created_at);
create index if not exists atendimentos_site_idx on public.atendimentos (site);

create or replace function public.touch_atendimento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists atendimentos_touch_updated_at on public.atendimentos;
create trigger atendimentos_touch_updated_at
before update on public.atendimentos
for each row execute function public.touch_atendimento();

-- Login obrigatório: usuários sem sessão não leem nem alteram as tabelas.
alter table public.tipologia_sites enable row level security;
alter table public.atendimentos enable row level security;

revoke all on table public.tipologia_sites from anon, authenticated;
revoke all on table public.atendimentos from anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.tipologia_sites to authenticated;
grant select, insert, update, delete on table public.atendimentos to authenticated;

drop policy if exists tipologia_read_after_login on public.tipologia_sites;
create policy tipologia_read_after_login
on public.tipologia_sites for select
to authenticated
using (true);

drop policy if exists atendimentos_manage_after_login on public.atendimentos;
create policy atendimentos_manage_after_login
on public.atendimentos for all
to authenticated
using (true)
with check (true);

revoke all on function public.touch_atendimento() from public, anon, authenticated;

comment on table public.tipologia_sites is
  'Catálogo carregado exclusivamente da aba Tipologia; dados preserva todas as colunas da fonte.';
comment on table public.atendimentos is
  'Linhas editáveis do relatório operacional, disponíveis para usuários autenticados.';
