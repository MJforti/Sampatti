-- A user belongs to at most one family. Joining another family moves them
-- (old family's access is withdrawn by the membership trigger).
delete from public.family_memberships m using public.family_memberships n
 where m.user_id = n.user_id and m.joined_at < n.joined_at;
create unique index family_memberships_one_per_user on public.family_memberships (user_id);

create or replace function public.join_family(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f public.families;
  old_name text;
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.family_join_attempts where user_id = auth.uid() and not success and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many wrong codes. Try again in 15 minutes';
  end if;
  if length(c) = 8 then c := substr(c, 1, 4) || '-' || substr(c, 5, 4); end if;
  select * into f from public.families where access_code = c and is_active;
  insert into public.family_join_attempts (user_id, success) values (auth.uid(), f.id is not null);
  if f.id is null then raise exception 'That family code isn’t right. Check it with your administrator'; end if;
  if exists (select 1 from public.family_memberships where user_id = auth.uid() and family_id = f.id) then
    return jsonb_build_object('family', f.name, 'already', true);
  end if;
  select fa.name into old_name from public.family_memberships m join public.families fa on fa.id = m.family_id where m.user_id = auth.uid();
  delete from public.family_memberships where user_id = auth.uid();
  insert into public.family_memberships (user_id, family_id) values (auth.uid(), f.id);
  update public.user_profiles set role = 'family_member' where id = auth.uid() and role = 'read_only';
  insert into public.administrator_audit_logs (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'family.joined', 'families', f.id::text, jsonb_build_object('name', f.name, 'left', old_name));
  return jsonb_build_object('family', f.name, 'left', old_name);
end $$;
revoke execute on function public.join_family(text) from public, anon;
grant execute on function public.join_family(text) to authenticated;
