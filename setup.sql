-- ═══════════════════════════════════════════
-- ZARYN DATABASE SETUP
-- Paste this entire file into Supabase SQL Editor
-- Click Run — all tables created in one go
-- ═══════════════════════════════════════════

-- 1. SCENARIOS — your scenario bank
create table if not exists scenarios (
  id text primary key,
  scenario text not null,
  option_count int not null default 2,
  options jsonb not null,
  category text not null,
  category_key text not null default 'general',
  estimated_split jsonb,
  quality jsonb,
  score int default 0,
  verdict text default 'APPROVED',
  source text default 'generated',
  banked_at timestamptz default now()
);

-- 2. DAILY SLOTS — 3 slots per day, each holds one scenario
create table if not exists daily_slots (
  id uuid default gen_random_uuid() primary key,
  slot_date date not null,
  slot_number int not null check (slot_number between 1 and 3),
  scenario_id text references scenarios(id) on delete set null,
  anchor_a int default 620,
  anchor_b int default 480,
  anchor_c int default 0,
  anchor_d int default 0,
  anchor_enabled boolean default true,
  unique(slot_date, slot_number)
);

-- 3. VOTES — one real vote per player per scenario
create table if not exists votes (
  id uuid default gen_random_uuid() primary key,
  scenario_id text not null references scenarios(id),
  slot_date date not null,
  option_letter text not null,
  player_id text not null,
  created_at timestamptz default now(),
  unique(scenario_id, player_id)
);

-- 4. SUBMISSIONS — dilemmas submitted by users
create table if not exists submissions (
  id text primary key,
  situation text not null,
  opt_a text,
  opt_b text,
  status text default 'pending',
  processed_scenario jsonb,
  submitted_at timestamptz default now()
);

-- 5. SETTINGS — global app settings
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- Default settings
insert into app_settings (key, value) values
  ('questions_per_day', '3'),
  ('vote_threshold', '20'),
  ('default_anchor_a', '620'),
  ('default_anchor_b', '480')
on conflict (key) do nothing;

-- Indexes for performance
create index if not exists idx_votes_scenario on votes(scenario_id);
create index if not exists idx_votes_player on votes(player_id);
create index if not exists idx_slots_date on daily_slots(slot_date);
create index if not exists idx_submissions_status on submissions(status);

-- Disable RLS (access is controlled via service key in Netlify functions)
alter table scenarios disable row level security;
alter table daily_slots disable row level security;
alter table votes disable row level security;
alter table submissions disable row level security;
alter table app_settings disable row level security;

-- Done! All tables created successfully.
