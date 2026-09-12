import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("RoomLink migrations enforce identity, expiry, membership and RPC-only mutations", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
      create schema realtime; create table realtime.messages(extension text);
      alter table realtime.messages enable row level security;
      create function realtime.topic() returns text language sql stable as $$ select current_setting('test.topic', true) $$;
      grant usage on schema realtime to authenticated; grant select, insert on realtime.messages to authenticated;
      create publication supabase_realtime;
      create table public.unrelated(id int); insert into public.unrelated values (42);`);
    for (const name of [
      "20260910120000_roomlink_persistence.sql",
      "20260910130000_roomlink_browser_auth.sql",
    ]) {
      await db.exec(
        readFileSync(
          new URL(`../../../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    }
    // Reapplying the unfinished migration must be safe after successful conversion.
    await db.exec(
      readFileSync(
        new URL(
          "../../../supabase/migrations/20260910130000_roomlink_browser_auth.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const owner = "00000000-0000-4000-8000-000000000001";
    const guest = "00000000-0000-4000-8000-000000000002";
    const outsider = "00000000-0000-4000-8000-000000000003";
    await db.exec(
      `insert into auth.users values ('${owner}'), ('${guest}'), ('${outsider}'); set role anon;`,
    );
    await assert.rejects(
      db.query(`select public.roomlink_create_room('room','owner')`),
      /permission denied/,
    );
    const as = async (id: string) => {
      await db.exec(
        `reset role; set role authenticated; set test.uid='${id}';`,
      );
    };
    await as(owner);
    await assert.rejects(
      db.query(`select public.roomlink_create_room(null,'owner')`),
      /Room name/,
    );
    const result = await db.query<{
      value: { roomId: string; memberId: string };
    }>(`select public.roomlink_create_room('room','owner') as value`);
    const room = result.rows[0].value;
    const code = (
      await db.query<{ code: string }>("select code from public.roomlink_rooms")
    ).rows[0].code;
    assert.match(code, /^[A-Z0-9]{6}$/);
    await as(outsider);
    assert.equal(
      (await db.query("select * from public.roomlink_rooms")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.roomlink_members")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(`select public.roomlink_send_message('${room.roomId}','spoof')`),
      /not a member/,
    );
    await assert.rejects(
      db.query(
        `insert into public.roomlink_messages (id) values (gen_random_uuid())`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`select public.roomlink_create_invite('${room.roomId}')`),
      /admin/,
    );
    await db.exec(`set test.topic='roomlink:${room.roomId}'`);
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          `select public.roomlink_channel_allowed(realtime.topic()) as allowed`,
        )
      ).rows[0].allowed,
      false,
    );
    await as(guest);
    const joined = (
      await db.query<{ value: { memberId: string } }>(
        `select public.roomlink_join_room('${code}','guest') as value`,
      )
    ).rows[0].value;
    const again = (
      await db.query<{ value: { memberId: string } }>(
        `select public.roomlink_join_room('${code}','guest2') as value`,
      )
    ).rows[0].value;
    assert.equal(joined.memberId, again.memberId);
    assert.equal(
      (await db.query("select * from public.roomlink_members")).rows.length,
      2,
    );
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          `select public.roomlink_channel_allowed(realtime.topic()) as allowed`,
        )
      ).rows[0].allowed,
      true,
    );
    await assert.rejects(
      db.query(`select public.roomlink_create_invite('${room.roomId}')`),
      /admin/,
    );
    await assert.rejects(
      db.query(`select public.roomlink_send_message('${room.roomId}',null)`),
      /empty or too long/,
    );
    const message = (
      await db.query<{ sender_id: string }>(
        `select * from public.roomlink_send_message('${room.roomId}','hello')`,
      )
    ).rows[0];
    assert.equal(message.sender_id, joined.memberId);
    for (let n = 0; n < 101; n++)
      await db.query(
        `select public.roomlink_send_message('${room.roomId}', 'bounded')`,
      );
    assert.equal(
      (await db.query("select * from public.roomlink_messages")).rows.length,
      100,
    );
    await db.exec(
      `reset role; update public.roomlink_rooms set expires_at=now()-interval '1 second';`,
    );
    await as(owner);
    assert.equal(
      (await db.query("select * from public.roomlink_rooms")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        `select public.roomlink_send_message('${room.roomId}','expired')`,
      ),
      /not a member/,
    );
    await assert.rejects(
      db.query(`select public.roomlink_create_invite('${room.roomId}')`),
      /admin/,
    );
    await assert.rejects(
      db.query(`select public.roomlink_join_room('${code}','late')`),
      /not be found/,
    );
    await db.exec("reset role");
    assert.deepEqual((await db.query("select * from public.unrelated")).rows, [
      { id: 42 },
    ]);
  } finally {
    await db.close();
  }
});
