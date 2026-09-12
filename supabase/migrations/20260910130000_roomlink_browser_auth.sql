begin;
-- Browser-only RoomLink access.
-- This migration only changes the roomlink_* tables created by the previous
-- migration. It does not grant the browser access to any unrelated table.

alter table public.roomlink_members
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;

create index if not exists roomlink_members_auth_user_id_idx
  on public.roomlink_members(auth_user_id);

alter table public.roomlink_rooms enable row level security;
alter table public.roomlink_members enable row level security;
alter table public.roomlink_messages enable row level security;
alter table public.roomlink_invites enable row level security;

create or replace function public.roomlink_is_member(p_room_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.roomlink_members m join public.roomlink_rooms r on r.id = m.room_id
    where m.room_id = p_room_id and m.auth_user_id = (select auth.uid()) and r.expires_at > now()
  );
$$;

revoke execute on function public.roomlink_is_member(uuid) from public, anon;
grant execute on function public.roomlink_is_member(uuid) to authenticated;

drop policy if exists roomlink_rooms_member_read on public.roomlink_rooms;
create policy roomlink_rooms_member_read on public.roomlink_rooms
  for select to authenticated
  using (public.roomlink_is_member(id));

drop policy if exists roomlink_members_room_read on public.roomlink_members;
create policy roomlink_members_room_read on public.roomlink_members
  for select to authenticated
  using (public.roomlink_is_member(room_id));

drop policy if exists roomlink_messages_member_read on public.roomlink_messages;
create policy roomlink_messages_member_read on public.roomlink_messages
  for select to authenticated
  using (public.roomlink_is_member(room_id));

drop policy if exists roomlink_invites_member_read on public.roomlink_invites;
create policy roomlink_invites_member_read on public.roomlink_invites
  for select to authenticated
  using (public.roomlink_is_member(room_id));

create or replace function public.roomlink_create_room(p_name text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  room_code text;
  now_value timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Anonymous authentication is required'; end if;
  if coalesce(length(trim(p_name)), 0) not between 1 and 80 then raise exception 'Room name must be 1-80 characters'; end if;
  if coalesce(length(trim(p_display_name)), 0) not between 1 and 40 then raise exception 'Display name must be 1-40 characters'; end if;

  loop
    room_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.roomlink_rooms where code = room_code);
  end loop;

  insert into public.roomlink_rooms (id, code, name, created_at, expires_at)
  values (room_id, room_code, trim(p_name), now_value, now_value + interval '24 hours');
  insert into public.roomlink_members (id, room_id, display_name, role, joined_at, online, auth_user_id)
  values (member_id, room_id, trim(p_display_name), 'admin', now_value, true, auth.uid());

  return jsonb_build_object('roomId', room_id, 'memberId', member_id);
end;
$$;

create or replace function public.roomlink_join_room(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.roomlink_rooms%rowtype;
  member_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Anonymous authentication is required'; end if;
  if coalesce(length(trim(p_display_name)), 0) not between 1 and 40 then raise exception 'Display name must be 1-40 characters'; end if;
  if p_code is null or upper(trim(p_code)) !~ '^[A-Z0-9]{6}$' then raise exception 'Invalid room code'; end if;
  select * into room from public.roomlink_rooms
    where code = upper(trim(p_code)) and expires_at > now() for update;
  if room.id is null then raise exception 'That room could not be found'; end if;

  select id into member_id from public.roomlink_members where room_id = room.id and auth_user_id = auth.uid();
  if member_id is not null then
    return jsonb_build_object('roomId', room.id, 'memberId', member_id);
  end if;
  member_id := gen_random_uuid();
  insert into public.roomlink_members (id, room_id, display_name, role, joined_at, online, auth_user_id)
  values (member_id, room.id, trim(p_display_name), 'member', now(), true, auth.uid());
  return jsonb_build_object('roomId', room.id, 'memberId', member_id);
end;
$$;

create or replace function public.roomlink_set_online(p_room_id uuid, p_online boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.roomlink_members
  set online = p_online
  where room_id = p_room_id and auth_user_id = (select auth.uid()) and public.roomlink_is_member(p_room_id);
$$;

create or replace function public.roomlink_send_message(p_room_id uuid, p_body text)
returns public.roomlink_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.roomlink_members%rowtype;
  result public.roomlink_messages;
begin
  perform 1 from public.roomlink_rooms where id = p_room_id for update;
  select * into member from public.roomlink_members
    where room_id = p_room_id and auth_user_id = (select auth.uid()) and public.roomlink_is_member(p_room_id);
  if member.id is null then raise exception 'You are not a member of this room'; end if;
  if coalesce(length(trim(p_body)), 0) not between 1 and 2000 then raise exception 'Message is empty or too long'; end if;

  insert into public.roomlink_messages (id, room_id, sender_id, sender_name, body, sent_at)
  values (gen_random_uuid(), p_room_id, member.id, member.display_name, trim(p_body), now())
  returning * into result;
  delete from public.roomlink_messages where room_id = p_room_id and id not in (
    select id from public.roomlink_messages where room_id = p_room_id order by sent_at desc, id desc limit 100
  );
  return result;
end;
$$;

create or replace function public.roomlink_create_invite(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.roomlink_rooms%rowtype;
begin
  select r.* into room
  from public.roomlink_rooms r
  join public.roomlink_members m on m.room_id = r.id
  where r.id = p_room_id and m.auth_user_id = (select auth.uid()) and m.role = 'admin' and r.expires_at > now();
  if room.id is null then raise exception 'Only the room admin can invite'; end if;

  insert into public.roomlink_invites (code, room_id, room_name, created_at, expires_at)
  values (room.code, room.id, room.name, now(), room.expires_at)
  on conflict (code) do update set created_at = excluded.created_at, expires_at = excluded.expires_at;
  return jsonb_build_object('code', room.code);
end;
$$;

revoke execute on function public.roomlink_create_room(text, text) from public, anon;
revoke execute on function public.roomlink_join_room(text, text) from public, anon;
revoke execute on function public.roomlink_set_online(uuid, boolean) from public, anon;
revoke execute on function public.roomlink_send_message(uuid, text) from public, anon;
revoke execute on function public.roomlink_create_invite(uuid) from public, anon;
grant execute on function public.roomlink_create_room(text, text) to authenticated;
grant execute on function public.roomlink_join_room(text, text) to authenticated;
grant execute on function public.roomlink_set_online(uuid, boolean) to authenticated;
grant execute on function public.roomlink_send_message(uuid, text) to authenticated;
grant execute on function public.roomlink_create_invite(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.roomlink_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.roomlink_members;
exception when duplicate_object then null;
end $$;

-- Explicit table privileges: all mutations go through the bounded RPCs above.
revoke all on public.roomlink_rooms, public.roomlink_members, public.roomlink_messages, public.roomlink_invites from anon, authenticated;
grant select on public.roomlink_rooms, public.roomlink_members, public.roomlink_messages to authenticated;
create unique index if not exists roomlink_members_room_auth_unique
on public.roomlink_members(room_id, auth_user_id);

-- Only RoomLink-prefixed policies; no global Realtime settings or other app policies change.
create or replace function public.roomlink_channel_allowed(topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.roomlink_rooms r
    where topic = 'roomlink:' || r.id::text and public.roomlink_is_member(r.id));
$$;
revoke all on function public.roomlink_channel_allowed(text) from public, anon;
grant execute on function public.roomlink_channel_allowed(text) to authenticated;
drop policy if exists roomlink_realtime_read on realtime.messages;
create policy roomlink_realtime_read on realtime.messages for select to authenticated
using (public.roomlink_channel_allowed((select realtime.topic())) and extension in ('broadcast', 'presence'));
drop policy if exists roomlink_realtime_write on realtime.messages;
create policy roomlink_realtime_write on realtime.messages for insert to authenticated
with check (public.roomlink_channel_allowed((select realtime.topic())) and extension in ('broadcast', 'presence'));
-- Restrictive guards stop pre-existing permissive policies from opening RoomLink topics.
-- Other topics continue to use their existing policies.
drop policy if exists roomlink_realtime_read_guard on realtime.messages;
create policy roomlink_realtime_read_guard on realtime.messages as restrictive for select to authenticated
using ((select realtime.topic()) not like 'roomlink:%' or public.roomlink_channel_allowed((select realtime.topic())));
drop policy if exists roomlink_realtime_write_guard on realtime.messages;
create policy roomlink_realtime_write_guard on realtime.messages as restrictive for insert to authenticated
with check ((select realtime.topic()) not like 'roomlink:%' or public.roomlink_channel_allowed((select realtime.topic())));
commit;
