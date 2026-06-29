import { defineServer, defineRoom, monitor } from "colyseus";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express, { type Request, type Response, type NextFunction } from "express";

import { GameRoom } from "./rooms/GameRoom.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/build/index.js  ->  ../../client/dist
const clientDist = join(__dirname, "..", "..", "client", "dist");
const isProd = process.env.NODE_ENV === "production";

/** Minimal HTTP Basic auth — no dependency needed. */
function basicAuth(password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const [, b64] = (req.headers.authorization || "").split(" ");
    const [, pass] = Buffer.from(b64 || "", "base64").toString().split(":");
    if (pass === password) return next();
    res.set("WWW-Authenticate", 'Basic realm="monitor"').status(401).send("Authentication required");
  };
}

export default defineServer({
  rooms: {
    // clients use client.create("game") / client.joinById(roomId)
    game: defineRoom(GameRoom),
  },

  express: (app) => {
    // dev-only health check
    app.get("/health", (_req, res) => res.json({ ok: true }));

    // Monitoring dashboard. Open in dev; in production it's only mounted when a
    // MONITOR_PASSWORD is set, and then behind HTTP Basic auth — so a deploy
    // never exposes the Colyseus internals publicly by default.
    if (!isProd) {
      app.use("/monitor", monitor());
    } else if (process.env.MONITOR_PASSWORD) {
      app.use("/monitor", basicAuth(process.env.MONITOR_PASSWORD), monitor());
    }

    // In production, the same Node service serves the built client so the
    // whole game is one deploy.
    if (isProd) {
      app.use(express.static(clientDist));
      app.get("*", (req, res, next) => {
        // never shadow framework/API routes
        if (req.path.startsWith("/matchmake") || req.path.startsWith("/monitor") || req.path === "/health") {
          return next();
        }
        res.sendFile(join(clientDist, "index.html"));
      });
    }
  },
});
