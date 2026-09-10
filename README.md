# RoomLink

RoomLink is a small, self-hostable workspace for creating a room, inviting people,
chatting in real time, and transferring files directly between browsers.

## What is included

- npm workspaces monorepo with `apps/web`, `apps/server`, and `packages/shared`
- Room creation and join flow with short invite codes
- In-memory room membership, admin role, invitations, and chat history
- Socket.IO events for presence, chat, and invitation updates
- Responsive React UI (desktop sidebar and mobile-friendly panels)
- WebRTC data-channel file transfer foundation with a signaling adapter
- Unit tests for room lifecycle and validation
- Dockerfile, compose example, environment template, and GitHub Actions CI

Data is intentionally in memory for this starter. Restarting the server removes rooms.
Add a durable store and authentication before deploying it for sensitive collaboration.

## Run locally

Requirements: Node.js 20+ and npm 10+.

```bash
npm install
cp .env.example .env
npm run dev
```

The web app is at <http://localhost:5173> and the API is at <http://localhost:3001>.
For a production build:

```bash
npm run build
npm run typecheck
npm test
```

The production Docker image serves both the compiled web app and Socket.IO from
one origin. Set `CLIENT_ORIGIN` to the public HTTPS URL and expose the platform's
`PORT`; do not run the Vite development server in production.

## Environment

`.env.example` contains safe local defaults only. Never commit real credentials.
The server supports `PORT`, `CLIENT_ORIGIN`, and `ROOM_TTL_MINUTES`; the web app
uses `VITE_API_URL`.

## WebRTC notes

`apps/web/src/webrtc/fileTransfer.ts` contains an intentionally small data-channel
protocol. Socket.IO is used for offer/answer/ICE signaling in the UI. A production
deployment should add TURN servers, transfer authorization, size limits, and
resumable/chunk integrity checks.
