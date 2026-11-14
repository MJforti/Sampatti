-- Families group member profiles. Each family has an access code; users who
-- enter it are granted view access to every member profile of that family.
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  access_code text not null unique check (access_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger families_touch before update on public.families for each row execute function public.touch_updated_at();

alter table public.family_entities add column family_id uuid references public.families (id) on delete set null;
create index family_entities_family_idx on public.family_entities (family_id);

create table public.family_memberships (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (user_id, family_id)
);
-- remember which permissions came from a family so they can be withdrawn with it
alter table public.entity_permissions add column granted_via_family uuid references public.families (id) on delete cascade;

create or replace function public.new_family_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  c text;
begin
  loop
    c := '';
    for i in 1..8 loop
      c := c || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
      if i = 4 then c := c || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.families where access_code = c);
  end loop;
  return c;
end $$;
alter table public.families alter column access_code set default public.new_family_code();

-- Keep permissions in step with memberships and with which family a profile is in
create or replace function public.sync_family_access(p_family uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- grant: every member user x every profile in the family
  insert into public.entity_permissions (user_id, entity_id, categories, granted_via_family)
  select m.user_id, e.id, null, p_family
    from public.family_memberships m join public.family_entities e on e.family_id = p_family
   where m.family_id = p_family
  on conflict (user_id, entity_id) do nothing;
  -- withdraw family grants that no longer apply
  delete from public.entity_permissions ep
   where ep.granted_via_family = p_family
     and (not exists (select 1 from public.family_memberships m where m.user_id = ep.user_id and m.family_id = p_family)
          or not exists (select 1 from public.family_entities e where e.id = ep.entity_id and e.family_id = p_family));
end $$;

create or replace function public.trg_entity_family() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.family_id is not null and old.family_id is distinct from new.family_id then
    perform public.sync_family_access(old.family_id);
  end if;
  if new.family_id is not null then perform public.sync_family_access(new.family_id); end if;
  return null;
end $$;
create trigger family_entities_family_sync after insert or update of family_id on public.family_entities
  for each row execute function public.trg_entity_family();

create or replace function public.trg_membership_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_family_access(coalesce(new.family_id, old.family_id));
  return null;
end $$;
create trigger family_memberships_sync after insert or delete on public.family_memberships
  for each row execute function public.trg_membership_sync();

-- Join a family with its code (any signed-in user). Rate limited.
create table public.family_join_attempts (id bigint generated always as identity primary key, user_id uuid not null, success boolean not null, created_at timestamptz not null default now());
alter table public.family_join_attempts enable row level security;
revoke all on public.family_join_attempts from anon, authenticated;

create or replace function public.join_family(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.families; c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.family_join_attempts where user_id = auth.uid() and not success and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many wrong codes. Try again in 15 minutes';
  end if;
  if length(c) = 8 then c := substr(c, 1, 4) || '-' || substr(c, 5, 4); end if;
  select * into f from public.families where access_code = c and is_active;
  insert into public.family_join_attempts (user_id, success) values (auth.uid(), f.id is not null);
  if f.id is null then raise exception 'That family code isn’t right. Check it with your administrator'; end if;
  insert into public.family_memberships (user_id, family_id) values (auth.uid(), f.id) on conflict do nothing;
  update public.user_profiles set role = 'family_member' where id = auth.uid() and role = 'read_only';
  insert into public.administrator_audit_logs (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'family.joined', 'families', f.id::text, jsonb_build_object('name', f.name));
  return jsonb_build_object('family', f.name);
end $$;
revoke execute on function public.join_family(text) from public, anon;
grant execute on function public.join_family(text) to authenticated;

create or replace function public.regenerate_family_code(p_family uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  update public.families set access_code = public.new_family_code() where id = p_family returning access_code into c;
  return c;
end $$;
revoke execute on function public.regenerate_family_code(uuid) from public, anon;
grant execute on function public.regenerate_family_code(uuid) to authenticated;

-- guard_profile_update allowed only admins to change role; join_family runs as definer (postgres) so it passes.

-- RLS
alter table public.families enable row level security;
alter table public.family_memberships enable row level security;
create policy families_select on public.families for select to authenticated
  using (public.is_admin() or exists (select 1 from public.family_memberships m where m.family_id = id and m.user_id = auth.uid()));
create policy families_write on public.families for all to authenticated
  using (public.admin_unlocked()) with check (public.admin_unlocked());
-- non-admins never see the access code
revoke select on public.families from authenticated;
grant select (id, name, is_active, created_at, updated_at) on public.families to authenticated;
grant insert, update, delete on public.families to authenticated;
create or replace function public.family_codes() returns table (id uuid, access_code text)
language sql stable security definer set search_path = public as $$
  select id, access_code from public.families where public.is_admin()
$$;
revoke execute on function public.family_codes() from public, anon;
grant execute on function public.family_codes() to authenticated;

create policy memberships_select on public.family_memberships for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy memberships_write on public.family_memberships for all to authenticated
  using (public.admin_unlocked() or user_id = auth.uid()) with check (public.admin_unlocked());

create trigger families_audit after insert or update or delete on public.families for each row execute function public.audit_row();
create trigger family_memberships_audit after insert or delete on public.family_memberships for each row execute function public.audit_row();

revoke execute on function public.sync_family_access(uuid), public.trg_entity_family(), public.trg_membership_sync(), public.new_family_code() from public, anon, authenticated;

-- Seed: one family holding the six initial profiles
insert into public.families (name) values ('Jain Family');
update public.family_entities set family_id = (select id from public.families where name = 'Jain Family') where family_id is null;
