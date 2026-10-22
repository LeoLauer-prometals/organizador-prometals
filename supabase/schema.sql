-- ════════════════════════════════════════════════════════════════
--  Organizador de Demandas — Prometals
--  Rode este arquivo INTEIRO no Supabase: SQL Editor → New query → Run.
--  Pode rodar de novo sem problema: ele apaga e recria só o que é dele.
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Limpeza (para poder rodar de novo) ──────────────────────────
drop trigger if exists ao_criar_usuario on auth.users;
drop trigger if exists restringir_dominio on auth.users;
drop table if exists public.cards cascade;
drop table if exists public.pedidos cascade;
drop table if exists public.perfis cascade;
drop function if exists public.novo_usuario() cascade;
drop function if exists public.pedidos_proteger() cascade;
drop function if exists public.restringir_dominio() cascade;

-- ── Tabelas ─────────────────────────────────────────────────────

-- Uma linha por pessoa que usa o app (criada automaticamente no cadastro).
create table public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null default '',
  email      text not null default '',
  criado_em  timestamptz not null default now()
);

-- Demandas que uma pessoa pede para outra (aba "Demandas de terceiros").
create table public.pedidos (
  id              uuid primary key default gen_random_uuid(),
  de              uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  para            uuid not null references public.perfis(id) on delete cascade,
  texto           text not null check (char_length(texto) between 1 and 280),
  notas           text not null default '' check (char_length(notas) <= 20000),
  prioridade      text not null default 'media' check (prioridade in ('alta','media','baixa')),
  feito           boolean not null default false,
  feito_em        timestamptz,
  arquivado_para  boolean not null default false,  -- quem recebeu arquivou
  removido_para   boolean not null default false,  -- quem recebeu tirou da lista
  criado_em       timestamptz not null default now()
);

-- Cards pessoais (abas "Lembretes" e "Demandas do dia"). Só o dono vê.
create table public.cards (
  id          uuid primary key default gen_random_uuid(),
  dono        uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  aba         text not null check (aba in ('lembretes','dia')),
  texto       text not null check (char_length(texto) between 1 and 280),
  notas       text not null default '' check (char_length(notas) <= 20000),
  quando      date,
  prioridade  text not null default 'media' check (prioridade in ('alta','media','baixa')),
  feito       boolean not null default false,
  feito_em    timestamptz,
  arquivado   boolean not null default false,
  pedido      uuid references public.pedidos(id) on delete set null,  -- veio de uma demanda de terceiros
  criado_em   timestamptz not null default now()
);

create index cards_dono_idx on public.cards(dono);
create index pedidos_para_idx on public.pedidos(para);
create index pedidos_de_idx on public.pedidos(de);

-- ── Perfil automático no cadastro ───────────────────────────────
create function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''),
             nullif(new.raw_user_meta_data->>'full_name', ''),
             nullif(new.raw_user_meta_data->>'name', ''),
             split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, '')
  );
  return new;
end $$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.novo_usuario();

-- ── (Opcional) Só aceitar e-mails da empresa ────────────────────
-- Para ligar: troque 'prometals.co' pelo domínio certo e apague os "--"
-- das 12 linhas abaixo. Depois rode só esse trecho de novo.
--
-- create function public.restringir_dominio() returns trigger
-- language plpgsql security definer set search_path = public as $$
-- begin
--   if lower(split_part(coalesce(new.email, ''), '@', 2)) <> 'prometals.co' then
--     raise exception 'Use seu e-mail da empresa';
--   end if;
--   return new;
-- end $$;
--
-- create trigger restringir_dominio
--   before insert on auth.users
--   for each row execute function public.restringir_dominio();

-- ── Proteção dos pedidos ────────────────────────────────────────
-- Ninguém muda remetente/destinatário. Quem pediu edita o pedido;
-- quem recebeu marca como feito, arquiva, anota e ajusta a prioridade.
create function public.pedidos_proteger() returns trigger
language plpgsql as $$
begin
  if new.de is distinct from old.de or new.para is distinct from old.para
     or new.criado_em is distinct from old.criado_em then
    raise exception 'Não é permitido mudar quem pediu, para quem ou quando';
  end if;

  if auth.uid() = old.para and auth.uid() is distinct from old.de then
    if new.texto is distinct from old.texto then
      raise exception 'Só quem fez o pedido pode mudar o título';
    end if;
  end if;

  if auth.uid() = old.de and auth.uid() is distinct from old.para then
    if new.feito is distinct from old.feito
       or new.feito_em is distinct from old.feito_em
       or new.arquivado_para is distinct from old.arquivado_para
       or new.removido_para is distinct from old.removido_para then
      raise exception 'Só quem recebeu o pedido pode concluir ou arquivar';
    end if;
  end if;

  return new;
end $$;

create trigger pedidos_proteger
  before update on public.pedidos
  for each row execute function public.pedidos_proteger();

-- ── Segurança por linha (RLS) ───────────────────────────────────
alter table public.perfis  enable row level security;
alter table public.pedidos enable row level security;
alter table public.cards   enable row level security;

-- Perfis: todo mundo logado vê a lista de colegas; cada um edita o seu.
create policy "perfis: ver colegas" on public.perfis
  for select to authenticated using (true);
create policy "perfis: editar o meu" on public.perfis
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Cards: só o dono vê e mexe.
create policy "cards: só o dono" on public.cards
  for all to authenticated using (dono = auth.uid()) with check (dono = auth.uid());

-- Pedidos: quem pediu e quem recebeu veem; só quem pediu cria e exclui.
create policy "pedidos: ver os meus" on public.pedidos
  for select to authenticated using (de = auth.uid() or para = auth.uid());
create policy "pedidos: enviar" on public.pedidos
  for insert to authenticated with check (de = auth.uid());
create policy "pedidos: atualizar os meus" on public.pedidos
  for update to authenticated
  using (de = auth.uid() or para = auth.uid())
  with check (de = auth.uid() or para = auth.uid());
create policy "pedidos: excluir os que enviei" on public.pedidos
  for delete to authenticated using (de = auth.uid());

-- ── Tempo real (a tela atualiza sozinha) ────────────────────────
alter table public.cards   replica identity full;
alter table public.pedidos replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.cards;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pedidos; exception when duplicate_object then null; end;
end $$;

-- Pronto. Confira em Table Editor: devem aparecer perfis, pedidos e cards.
