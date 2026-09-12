begin;

-- The host can close only their own room. Deleting the parent row cascades to
-- every RoomLink member, message, and invite without touching other tables.
create or replace function public.roomlink_close_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.roomlink_members m
    join public.roomlink_rooms r on r.id = m.room_id
    where m.room_id = p_room_id
      and m.auth_user_id = (select auth.uid())
      and m.role = 'admin'
  ) then
    raise exception 'Only the room host can close this room';
  end if;

  delete from public.roomlink_rooms where id = p_room_id;
end;
$$;

revoke execute on function public.roomlink_close_room(uuid) from public, anon;
grant execute on function public.roomlink_close_room(uuid) to authenticated;

commit;
