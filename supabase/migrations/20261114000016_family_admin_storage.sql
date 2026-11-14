-- Document files: family admins may write only into their own family's members' folders.
drop policy if exists "documents write in admin mode" on storage.objects;
drop policy if exists "documents update in admin mode" on storage.objects;
drop policy if exists "documents delete in admin mode" on storage.objects;
create or replace function public.can_admin_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e uuid;
begin
  begin e := (string_to_array(p_name, '/'))[1]::uuid; exception when others then return false; end;
  return public.can_admin_entity(e);
end $$;
grant execute on function public.can_admin_path(text) to authenticated;
create policy "documents write by entity admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_admin_path(name));
create policy "documents update by entity admin" on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.can_admin_path(name));
create policy "documents delete by entity admin" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_admin_path(name));
