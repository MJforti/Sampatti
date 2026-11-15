-- Creating a family failed: the access-code default ran new_family_code() with the caller's
-- rights, but execute had been revoked from signed-in users. Run it with owner rights instead.
alter function public.new_family_code() security definer;
grant execute on function public.new_family_code() to authenticated;
