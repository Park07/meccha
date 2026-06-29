import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "Chameleon";
  @type("string") role = "hider"; // "hider" | "hunter"

  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") ry = 0;   // body yaw
  @type("float32") aim = 0;  // look yaw (for hunter sight)

  @type("uint32") tint = 0xffffff;

  @type("boolean") connected = true;
  @type("boolean") alive = true;     // false once tagged (hider)
  @type("boolean") exposed = false;  // currently in a hunter's sight (hider feedback)
  @type("number") score = 0;
  @type("number") tauntUntil = 0;    // server epoch ms; scoring multiplier window
}

export class GameState extends Schema {
  @type("string") phase = "lobby"; // "lobby" | "prep" | "hunt" | "ended"
  @type("number") secondsLeft = 0; // counts down during prep/hunt (no clock-skew)
  @type("string") hostId = "";

  // end-of-round summary
  @type("string") resultTeam = "";
  @type("string") mvpName = "";
  @type("number") mvpScore = 0;

  @type({ map: Player }) players = new MapSchema<Player>();
}
