import "dotenv/config";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

export const config = {
  port,
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  roomTtlMinutes: Number(process.env.ROOM_TTL_MINUTES ?? 1440)
};
