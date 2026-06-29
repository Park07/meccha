import { listen } from "@colyseus/tools";
import app from "./app.config.js";

// Honors process.env.PORT (defaults to 2567) — Render/Railway friendly.
listen(app);
