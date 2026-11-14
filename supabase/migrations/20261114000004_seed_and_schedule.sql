-- Initial family/entity profiles (data, not frontend constants).
insert into public.family_entities (name, entity_type, sort_order) values
  ('Rajesh Kumar Jain', 'individual', 10),
  ('Rajesh Kumar Jain & Sons HUF', 'huf', 20),
  ('Neema Jain', 'individual', 30),
  ('Vishesh Jain', 'individual', 40),
  ('Shradha Jain', 'individual', 50),
  ('Rajesh Bimal and Associates', 'firm', 60)
on conflict do nothing;

-- Scheduling. pg_cron/pg_net exist on Supabase; skipped gracefully elsewhere.
do $outer$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron/pg_net unavailable (%). Schedule generate_reminders() externally.', sqlerrm;
    return;
  end;

  -- Reminder engine: hourly at :05 (idempotent, so frequent runs are safe).
  perform cron.schedule('sampatti-generate-reminders', '5 * * * *', 'select public.generate_reminders()');

  -- Delivery dispatcher (Edge Function) every 10 minutes. Needs two Vault secrets:
  --   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
  --   select vault.create_secret('<random string>', 'dispatch_secret');   -- same as DISPATCH_SECRET fn secret
  perform cron.schedule('sampatti-dispatch-notifications', '*/10 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-notifications',
      headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')),
      body := '{}'::jsonb)
  $job$);
end $outer$;

-- Realtime badge updates for in-app notifications (RLS still applies).
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then raise notice 'realtime publication not available: %', sqlerrm; end $$;
