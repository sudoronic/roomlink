# RoomLink

RoomLink is a small browser workspace for creating a room, inviting people,
chatting in real time, and transferring files directly between browsers.
The deployable architecture is **Vercel + Supabase**:

- Vite/React is a static Vercel deployment.
- Supabase anonymous Auth identifies each browser session.
- Postgres and RLS store rooms, members, and chat messages.
- Supabase Realtime `postgres_changes` delivers chat and membership changes.
- Realtime presence tracks people in a room, and Realtime broadcast carries
  WebRTC offer/answer/ICE signaling.
- File bytes travel over WebRTC data channels; they are never uploaded to
  Supabase Storage.

The Express/Socket.IO app remains available as a local legacy development
server, but it is not required for the Vercel deployment.

## Supabase setup

1. Open [Supabase](https://supabase.com/dashboard) and create a dedicated
   RoomLink project. Do not use a shared project that has another app using
   Realtime: private Realtime-channel access is a project-wide setting.
2. Open **Authentication → Providers → Anonymous** and enable anonymous sign-ins.
3. Open **SQL Editor** and run each file in `supabase/migrations/` in filename
   order. The migrations only create or change `roomlink_*` objects. They do
   not touch any other application's tables.
4. Confirm `roomlink_rooms`, `roomlink_members`, `roomlink_messages`, and
   `roomlink_invites` exist and have RLS enabled.
5. Confirm the `supabase_realtime` publication includes
   `roomlink_messages` and `roomlink_members`. The second migration adds these
   entries safely.
6. Open **Realtime → Settings**, disable **Allow public access**, and save.
   The migration adds private-channel policies for `roomlink:<room-id>` topics;
   this is what prevents unaffiliated authenticated users from signaling or
   seeing presence for a room.
7. Open **Project Settings → API**. Copy the project URL and its public
   publishable key. A legacy public `anon` key also works. Do not copy the
   service-role or secret key.

Supabase handles anonymous identity, protected database access, chat events,
presence, and WebRTC signaling metadata. It does not store file bytes,
downloaded files, client-side chat caches, or portable guest identities.

## Local setup

1. Copy `.env.example` to `.env.local` and set:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role
   key in a `VITE_` variable.
2. Install and validate from the repository root:

   ```bash
   npm ci
   npm run build --workspace @roomlink/shared
   npm run build --workspace @roomlink/web
   npm test
   ```

## Vercel deployment

1. Open Vercel and choose **Add New → Project**.
2. Import `sudoronic/roomlink`, select the `main` branch, and set the root
   directory to the repository root (`.`).
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the project's
   Environment Variables settings. Use the public values from Supabase only.
4. Deploy. The checked-in `vercel.json` installs with `npm ci`, builds the
   shared package and `@roomlink/web`, then publishes `apps/web/dist`.
5. Open the generated `.vercel.app` URL and test anonymous sign-in, creating a
   room, joining from a second browser context, chat, presence, an invite code,
   and a small direct file transfer. Check Vercel build logs, the browser
   console, and Supabase logs if an operation fails.

No Express process, `PORT`, `VITE_API_URL`, Docker, Render, or server-side
Supabase key is needed for Vercel.

## Local development

For the browser-only app, set the two Supabase variables and run:

```bash
npm ci
npm run dev --workspace @roomlink/web
```

The legacy all-in-one local server is still available if needed:

```bash
cp .env.example .env
npm run dev
```

It uses the old in-memory/Socket.IO path and is not part of the Vercel
deployment. The server's optional Supabase service-role persistence is retained
only for that legacy workflow.

## Limitations

Chat history is retained to the newest 100 messages per room, and rooms expire
after 24 hours. The client keeps only the same bounded history in memory.
Anonymous sessions are intentionally lightweight and are lost when browser
storage is cleared or on a different device. Anyone with the six-character room
code can join while the room is live.

Direct transfer uses normal WebRTC transport encryption and never routes bytes
through Supabase, but it is not a separately audited end-to-end encryption
scheme. Transfers are limited to 50 MiB, have backpressure and byte-count
checks, and require the recipient to choose a download. A public STUN server is
configured; restrictive NATs can require a TURN service, which this project
does not provide.

Join approval/rejection, owner transfer, admin delegation, locking or removing
members, invitation rotation, rate limits, CAPTCHA/abuse controls, moderation,
SHA-256 file digests, cancellation/retry transfers, TURN configuration,
cross-device/NAT browser tests, monitoring, and production capacity controls
are not implemented.
