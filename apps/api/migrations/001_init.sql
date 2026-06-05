create extension if not exists "pgcrypto";

create schema if not exists vault;

create type asset_symbol as enum ('USDT', 'USDC');
create type fiat_currency as enum ('NGN', 'USD', 'GHS', 'KES', 'ZAR');
create type kyc_status as enum ('PENDING', 'VERIFIED', 'REJECTED', 'FROZEN');
create type ad_side as enum ('SELL');
create type ad_status as enum ('ACTIVE', 'PAUSED', 'DEPLETED', 'CLOSED');
create type order_status as enum (
  'ORDER_CREATED',
  'ESCROW_LOCKED',
  'PAYMENT_PENDING',
  'BUYER_MARKED_PAID',
  'SELLER_RELEASE_PENDING',
  'COMPLETED',
  'CANCELLED_EXPIRED',
  'CANCELLED_BY_BUYER_BEFORE_PAYMENT',
  'DISPUTED',
  'RESOLVED_RELEASED_TO_BUYER',
  'RESOLVED_RETURNED_TO_SELLER',
  'FROZEN_COMPLIANCE_REVIEW'
);
create type ledger_entry_type as enum (
  'DEPOSIT',
  'ESCROW_LOCK',
  'ESCROW_RELEASE',
  'ESCROW_RETURN',
  'TRADE_CREDIT',
  'FEE_CREDIT',
  'WITHDRAWAL'
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  pseudonym text unique not null,
  password_hash text,
  role text not null default 'USER',
  kyc_status kyc_status not null default 'PENDING',
  is_mfa_enabled boolean not null default false,
  trade_pin_hash text,
  completion_rate numeric(5,2) not null default 100,
  average_release_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table vault.kyc_vault (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  provider_reference text,
  encrypted_legal_name bytea not null,
  legal_name_hash text not null,
  legal_name_match_key text not null,
  encrypted_document_payload bytea,
  country_code text not null,
  risk_tier integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create view vault.kyc_records as
select
  id,
  user_id,
  provider_reference,
  encrypted_legal_name,
  legal_name_hash,
  encrypted_document_payload,
  country_code,
  risk_tier,
  created_at,
  updated_at
from vault.kyc_vault;

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null,
  provider text not null,
  account_holder_name text not null,
  account_holder_name_hash text not null,
  masked_account_number text not null,
  payment_instructions text,
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  asset asset_symbol not null,
  available_balance numeric(36, 12) not null default 0,
  escrow_balance numeric(36, 12) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, asset),
  check (available_balance >= 0),
  check (escrow_balance >= 0)
);

create table platform_treasury_accounts (
  id uuid primary key default gen_random_uuid(),
  asset asset_symbol not null unique,
  balance numeric(36, 12) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (balance >= 0)
);

create table ads (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references users(id),
  asset asset_symbol not null,
  fiat_currency fiat_currency not null,
  side ad_side not null default 'SELL',
  price numeric(36, 12) not null,
  available_amount numeric(36, 12) not null,
  min_amount numeric(36, 12) not null,
  max_amount numeric(36, 12) not null,
  payment_method_ids uuid[] not null default '{}',
  terms text,
  status ad_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price > 0),
  check (available_amount >= 0),
  check (min_amount > 0),
  check (max_amount >= min_amount)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references ads(id),
  buyer_id uuid not null references users(id),
  seller_id uuid not null references users(id),
  seller_payment_method_id uuid references payment_methods(id),
  asset asset_symbol not null,
  fiat_currency fiat_currency not null,
  asset_amount numeric(36, 12) not null,
  fiat_amount numeric(36, 12) not null,
  price numeric(36, 12) not null,
  fee_amount numeric(36, 12) not null default 0,
  status order_status not null,
  payment_deadline timestamptz not null,
  buyer_marked_paid_at timestamptz,
  released_at timestamptz,
  flagged_payment_name_mismatch boolean not null default false,
  risk_level text not null default 'NORMAL',
  expected_source_name_hash text,
  source_account_name text,
  last_event_id bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (asset_amount > 0),
  check (fiat_amount > 0),
  check (fee_amount >= 0)
);

create table platform_revenue_ledger (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  asset asset_symbol not null,
  fee_amount numeric(36, 12) not null,
  fee_rate numeric(10, 6) not null,
  created_at timestamptz not null default now(),
  unique(order_id),
  check (fee_amount >= 0),
  check (fee_rate >= 0)
);

create table escrow_ledger (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  seller_id uuid not null references users(id),
  buyer_id uuid not null references users(id),
  asset asset_symbol not null,
  amount numeric(36, 12) not null,
  fee_amount numeric(36, 12) not null default 0,
  status text not null default 'LOCKED',
  locked_at timestamptz not null default now(),
  released_at timestamptz,
  check (amount > 0),
  check (fee_amount >= 0)
);

create view escrow_wallet_registry as select * from escrow_ledger;

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  treasury_asset asset_symbol,
  order_id uuid references orders(id),
  asset asset_symbol not null,
  entry_type ledger_entry_type not null,
  amount numeric(36, 12) not null,
  direction text not null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (amount > 0),
  check (direction in ('DEBIT', 'CREDIT'))
);

create table order_events (
  id bigserial primary key,
  order_id uuid not null references orders(id) on delete cascade,
  actor_id uuid references users(id),
  from_status order_status,
  to_status order_status not null,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table order_chat_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sender_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table payment_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  buyer_id uuid not null references users(id),
  source_account_name text not null,
  receipt_url text,
  parsed_metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  opened_by uuid not null references users(id),
  reason text not null,
  status text not null default 'OPEN',
  resolution text,
  assigned_admin_id uuid references users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null,
  auth_key text,
  p256dh_key text,
  fcm_token text,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create table risk_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  order_id uuid references orders(id),
  signal_type text not null,
  severity integer not null default 1,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index ads_marketplace_idx on ads(status, asset, fiat_currency, price);
create index orders_buyer_status_idx on orders(buyer_id, status);
create index orders_seller_status_idx on orders(seller_id, status);
create index order_events_order_idx on order_events(order_id, id);
create index order_chat_order_idx on order_chat_messages(order_id, created_at);
create index disputes_status_idx on disputes(status, created_at);
