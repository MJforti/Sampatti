-- Sampatti core schema
-- Money is stored as BIGINT paise (1 rupee = 100 paise). Never floats.
-- Dates that represent a calendar day are DATE; instants are TIMESTAMPTZ.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.entity_type as enum ('individual', 'huf', 'firm', 'company', 'trust', 'other');
create type public.app_role as enum ('admin', 'family_member', 'accountant', 'read_only');
create type public.txn_status as enum (
  'upcoming', 'due_today', 'paid', 'overdue', 'cancelled', 'renewed',
  'auto_debit_scheduled', 'awaiting_confirmation'
);
create type public.frequency as enum ('once', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly');

-- Categories are text + check so new ones can be added without enum churn.
create or replace function public.valid_category(c text) returns boolean
language sql immutable as $$
  select c in (
    'insurance_premium','insurance_renewal','sip','loan_emi','recurring_deposit',
    'fd_maturity','investment_maturity','interest_receipt',
    'vehicle_puc','vehicle_insurance','vehicle_road_tax','vehicle_fitness',
    'vehicle_registration','vehicle_permit','vehicle_service',
    'tax_gst','tax_tds_return','tax_tds_payment','tax_itr','tax_advance','tax_audit',
    'compliance_other','document_expiry','recurring_payment','custom'
  )
$$;

-- Generic updated_at trigger
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Entities (individuals, HUFs, firms, companies)
-- ---------------------------------------------------------------------------
create table public.family_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  entity_type public.entity_type not null default 'individual',
  pan_masked text check (pan_masked is null or pan_masked ~ '^[A-Z0-9X*]{10}$'),
  email text,
  phone text,
  notes text,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index family_entities_name_uq on public.family_entities (lower(name));

-- ---------------------------------------------------------------------------
-- Users (profile row per auth.users row)
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'read_only',
  linked_entity_id uuid references public.family_entities (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- `users` requested by the spec: a safe read-only view over user_profiles.
create view public.users with (security_invoker = true) as
  select id, email, full_name, role, is_active, created_at from public.user_profiles;

-- Per-entity access. categories NULL = all categories of that entity.
create table public.entity_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  entity_id uuid not null references public.family_entities (id) on delete cascade,
  categories text[],          -- module names e.g. {'insurance','loans'}; null = everything
  can_view_documents boolean not null default true,
  receive_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, entity_id)
);
create index entity_permissions_entity_idx on public.entity_permissions (entity_id);

-- ---------------------------------------------------------------------------
-- Settings (singleton) & admin security
-- ---------------------------------------------------------------------------
create table public.admin_settings (
  id int primary key default 1 check (id = 1),
  pin_hash text,                        -- bcrypt; never readable by clients
  pin_set_at timestamptz,
  bootstrap_admin_email text,           -- set by the deployer in SQL; first admin claim
  timezone text not null default 'Asia/Kolkata',
  reminder_offsets int[] not null default '{30,15,7,3,1,0}',
  auto_debit_reminder_hours int not null default 24,
  overdue_repeat_days int not null default 1 check (overdue_repeat_days > 0),
  admin_session_minutes int not null default 10 check (admin_session_minutes between 1 and 240),
  max_pin_attempts int not null default 5 check (max_pin_attempts between 3 and 20),
  lockout_minutes int not null default 15 check (lockout_minutes between 1 and 1440),
  app_url text,
  updated_at timestamptz not null default now()
);
insert into public.admin_settings (id) values (1);

-- user_sessions: admin-mode unlock windows (server-side truth for "Admin Mode")
create table public.user_sessions (
  user_id uuid primary key references public.user_profiles (id) on delete cascade,
  admin_unlocked_at timestamptz,
  admin_expires_at timestamptz,
  last_activity_at timestamptz,
  revoked_at timestamptz
);

create table public.admin_pin_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  success boolean not null,
  attempted_at timestamptz not null default now()
);
create index admin_pin_attempts_user_idx on public.admin_pin_attempts (user_id, attempted_at desc);

create table public.administrator_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_created_idx on public.administrator_audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Bank accounts. Never store passwords, PINs, OTPs or full account numbers.
-- ---------------------------------------------------------------------------
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.family_entities (id),
  bank_name text not null,
  account_type text not null default 'savings'
    check (account_type in ('savings','current','overdraft','cash_credit','nre','nro','other')),
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  ifsc text check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  branch text,
  nickname text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bank_accounts_entity_idx on public.bank_accounts (entity_id);

-- ---------------------------------------------------------------------------
-- Investments
-- ---------------------------------------------------------------------------
create table public.investments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.family_entities (id),
  joint_entity_ids uuid[] not null default '{}',
  category text not null check (category in (
    'mutual_fund','equity','fixed_deposit','recurring_deposit','ppf','epf','nps',
    'bond','gsec','gold','sgb','real_estate','other')),
  name text not null,
  institution text,                 -- AMC / bank / broker
  reference_number text,            -- folio / deposit no / demat id
  mode text check (mode is null or mode in ('sip','lumpsum')),
  units numeric(20,4),
  purchase_price_paise bigint check (purchase_price_paise is null or purchase_price_paise >= 0),
  invested_paise bigint not null default 0 check (invested_paise >= 0),
  current_value_paise bigint check (current_value_paise is null or current_value_paise >= 0),
  value_as_of date,
  value_is_verified boolean not null default false,  -- false = manual estimate
  sip_amount_paise bigint check (sip_amount_paise is null or sip_amount_paise > 0),
  sip_frequency public.frequency,
  next_sip_date date,
  interest_rate numeric(7,4),
  start_date date,
  maturity_date date,
  maturity_amount_paise bigint,
  payout_frequency text,
  auto_renew boolean not null default false,
  bank_account_id uuid references public.bank_accounts (id),
  details jsonb not null default '{}',   -- dividends, TDS, capital gains, corporate actions...
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index investments_entity_idx on public.investments (entity_id);

create table public.investment_transactions (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investments (id) on delete cascade,
  txn_type text not null check (txn_type in ('buy','sip','sell','redeem','dividend','interest','bonus','split','other')),
  txn_date date not null,
  amount_paise bigint not null,
  units numeric(20,4),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Vehicles (declared before insurance/loans which can link to them)
-- ---------------------------------------------------------------------------
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.family_entities (id),
  registration_number text not null,
  make_model text,
  registration_date date,
  fuel_type text,
  insurance_provider text,
  insurance_policy_number text,
  insurance_expiry date,
  puc_expiry date,
  road_tax_expiry date,
  fitness_expiry date,
  registration_expiry date,
  permit_expiry date,
  fastag_id text,
  next_service_date date,
  details jsonb not null default '{}',   -- service history etc.
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index vehicles_reg_uq on public.vehicles (upper(replace(registration_number,' ','')));

-- ---------------------------------------------------------------------------
-- Insurance
-- ---------------------------------------------------------------------------
create table public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.family_entities (id),
  category text not null check (category in (
    'life','term','health','vehicle','personal_accident','property','business','other')),
  insurer text not null,
  policy_name text,
  policy_number text,
  policyholder text,
  nominee text,
  sum_assured_paise bigint,
  premium_paise bigint check (premium_paise is null or premium_paise >= 0),
  premium_frequency public.frequency,
  start_date date,
  next_premium_date date,
  maturity_date date,
  expiry_date date,
  grace_days int not null default 0 check (grace_days >= 0),
  bank_account_id uuid references public.bank_accounts (id),
  auto_debit boolean not null default false,
  agent_name text,
  agent_phone text,
  status text not null default 'active' check (status in ('active','lapsed','matured','surrendered','expired')),
  vehicle_id uuid references public.vehicles (id),
  details jsonb not null default '{}',   -- health: floater, members, NCB, waiting periods, claims...
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index insurance_entity_idx on public.insurance_policies (entity_id);

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.family_entities (id),
  joint_entity_ids uuid[] not null default '{}',
  loan_type text not null check (loan_type in (
    'home','car','personal','business','term','lap','las','other')),
  lender text not null,
  account_last4 text,
  principal_paise bigint not null check (principal_paise >= 0),
  outstanding_paise bigint not null check (outstanding_paise >= 0),
  interest_rate numeric(7,4) not null check (interest_rate >= 0),
  rate_type text not null default 'floating' check (rate_type in ('fixed','floating')),
  emi_paise bigint not null default 0 check (emi_paise >= 0),
  next_emi_date date,
  tenure_months int check (tenure_months is null or tenure_months > 0),
  start_date date,
  expected_closure date,
  moratorium_until date,
  interest_only_until date,
  bank_account_id uuid references public.bank_accounts (id),
  vehicle_id uuid references public.vehicles (id),
  details jsonb not null default '{}',   -- prepayments, rate history
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index loans_entity_idx on public.loans (entity_id);

create table public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  paid_on date not null,
  amount_paise bigint not null check (amount_paise > 0),
  principal_component_paise bigint,
  interest_component_paise bigint,
  is_prepayment boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tax & statutory compliance
-- ---------------------------------------------------------------------------
create table public.tax_compliance (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.family_entities (id),
  compliance_type text not null check (compliance_type in (
    'tax_gst','tax_tds_return','tax_tds_payment','tax_itr','tax_advance','tax_audit','compliance_other')),
  title text not null,
  period_label text,               -- e.g. 'Q3 FY2026-27', 'Nov 2026'
  due_date date,
  amount_paise bigint,
  frequency public.frequency not null default 'once',
  source text,                     -- where the deadline came from (CBDT circular, GST portal...)
  last_verified_on date,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Obligations engine
-- recurring_obligations = the rule; scheduled_transactions = each dated instance.
-- ---------------------------------------------------------------------------
create table public.recurring_obligations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.family_entities (id),
  title text not null,
  category text not null check (public.valid_category(category)),
  amount_paise bigint check (amount_paise is null or amount_paise >= 0),
  frequency public.frequency not null default 'once',
  anchor_day int check (anchor_day between 1 and 31),
  next_due_date date,
  end_date date,
  bank_account_id uuid references public.bank_accounts (id),
  auto_debit boolean not null default false,
  instructions text,
  reminder_offsets int[],            -- null = use admin_settings default
  -- link to the record that generated it (null for custom obligations)
  source_type text check (source_type is null or source_type in
    ('insurance_policies','loans','investments','vehicles','tax_compliance','documents')),
  source_id uuid,
  source_field text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index recurring_obligations_source_uq
  on public.recurring_obligations (source_type, source_id, source_field)
  where source_type is not null;
create index recurring_obligations_entity_idx on public.recurring_obligations (entity_id);

create table public.scheduled_transactions (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.recurring_obligations (id) on delete cascade,
  entity_id uuid not null references public.family_entities (id),
  due_date date not null,
  amount_paise bigint,
  status public.txn_status not null default 'upcoming',
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (obligation_id, due_date)
);
create index scheduled_tx_due_idx on public.scheduled_transactions (due_date);
create index scheduled_tx_open_idx on public.scheduled_transactions (status, due_date)
  where status not in ('paid','cancelled','renewed');
-- at most one open instance per obligation
create unique index scheduled_tx_one_open_uq on public.scheduled_transactions (obligation_id)
  where status not in ('paid','cancelled','renewed');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.family_entities (id),
  category text not null default 'other',
  title text not null,
  record_type text,     -- 'insurance_policies','loans','vehicles','investments','payments',...
  record_id uuid,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  expiry_date date,
  current_version int not null default 1,
  uploaded_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_record_idx on public.documents (record_type, record_id);
create index documents_entity_idx on public.documents (entity_id);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version int not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create view public.vehicle_documents with (security_invoker = true) as
  select d.*, v.registration_number from public.documents d
  join public.vehicles v on d.record_type = 'vehicles' and d.record_id = v.id
  where d.archived_at is null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  scheduled_transaction_id uuid not null references public.scheduled_transactions (id) on delete cascade,
  entity_id uuid not null references public.family_entities (id),
  paid_on date not null,
  amount_paise bigint not null check (amount_paise >= 0),
  bank_account_id uuid references public.bank_accounts (id),
  reference text,
  notes text,
  receipt_document_id uuid references public.documents (id),
  recorded_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reminders & notifications
-- ---------------------------------------------------------------------------
-- One row per (instance, due date, offset) the engine has fired. Idempotency key.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  scheduled_transaction_id uuid not null references public.scheduled_transactions (id) on delete cascade,
  due_date date not null,
  offset_days int not null,            -- days before due (negative = overdue)
  fired_on date not null,
  created_at timestamptz not null default now(),
  unique (scheduled_transaction_id, due_date, offset_days)
);

create table public.notification_preferences (
  user_id uuid primary key references public.user_profiles (id) on delete cascade,
  in_app boolean not null default true,
  email boolean not null default true,
  push boolean not null default true,
  muted_categories text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failed_count int not null default 0
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  reminder_id uuid references public.reminders (id) on delete cascade,
  scheduled_transaction_id uuid references public.scheduled_transactions (id) on delete cascade,
  kind text not null default 'reminder',
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_reminder_user_uq on public.notifications (reminder_id, user_id)
  where reminder_id is not null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('in_app','email','push','whatsapp')),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, channel)
);
create index delivery_pending_idx on public.notification_delivery_logs (status, channel)
  where status in ('pending','failed');

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['family_entities','user_profiles','bank_accounts','investments','vehicles',
    'insurance_policies','loans','tax_compliance','recurring_obligations','scheduled_transactions',
    'documents','notification_delivery_logs','admin_settings','notification_preferences']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;
