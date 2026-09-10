create table if not exists public.roomlink_rooms (
  id uuid primary key,
  code text not null unique,
  name text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists public.roomlink_members (
  id uuid primary key,
  room_id uuid not null references public.roomlink_rooms(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin', 'member')),
  joined_at timestamptz not null,
  online boolean not null default false
);

create table if not exists public.roomlink_messages (
  id uuid primary key,
  room_id uuid not null references public.roomlink_rooms(id) on delete cascade,
  sender_id uuid not null references public.roomlink_members(id) on delete cascade,
  sender_name text not null,
  body text not null,
  sent_at timestamptz not null
);

create table if not exists public.roomlink_invites (
  code text primary key,
  room_id uuid not null references public.roomlink_rooms(id) on delete cascade,
  room_name text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists roomlink_members_room_id_idx on public.roomlink_members(room_id);
create index if not exists roomlink_messages_room_sent_at_idx on public.roomlink_messages(room_id, sent_at desc);
create index if not exists roomlink_invites_expires_at_idx on public.roomlink_invites(expires_at);

alter table public.roomlink_rooms enable row level security;
alter table public.roomlink_members enable row level security;
alter table public.roomlink_messages enable row level security;
alter table public.roomlink_invites enable row level security;
