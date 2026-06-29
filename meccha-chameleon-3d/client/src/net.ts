import { Client, getStateCallbacks } from "@colyseus/sdk";
import type { Room } from "@colyseus/sdk";
import type { MoveMsg, PaintMsg, PaintRelay } from "shared";
import { PROTOCOL } from "shared";

function serverUrl(): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:2567`;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}

export class Net {
  private client: Client;
  room?: Room;

  onAdd?: (id: string, player: any) => void;
  onRemove?: (id: string) => void;
  onPaint?: (relay: PaintRelay) => void;
  onShot?: (id: string) => void;
  onTagged?: (data: { id: string; by: string }) => void;
  onTauntPing?: (id: string) => void;

  constructor() { this.client = new Client(serverUrl()); }

  private wire() {
    const room = this.room!;
    const $ = getStateCallbacks(room);
    const state: any = room.state;
    $(state).players.onAdd((player: any, id: string) => this.onAdd?.(id, player));
    $(state).players.onRemove((_player: any, id: string) => this.onRemove?.(id));
    room.onMessage("paint", (r: PaintRelay) => this.onPaint?.(r));
    room.onMessage("shot", (m: { id: string }) => this.onShot?.(m.id));
    room.onMessage("tagged", (m: { id: string; by: string }) => this.onTagged?.(m));
    room.onMessage("taunt", (m: { id: string }) => this.onTauntPing?.(m.id));
  }

  async create(name: string): Promise<string> {
    this.room = await this.client.create(PROTOCOL.ROOM_NAME, { name });
    this.wire();
    return this.room.roomId;
  }
  async join(code: string, name: string): Promise<void> {
    this.room = await this.client.joinById(code, { name });
    this.wire();
  }

  get sessionId(): string { return this.room?.sessionId ?? ""; }
  get state(): any { return this.room?.state; }

  sendMove(m: MoveMsg) { this.room?.send("move", m); }
  sendPaint(p: PaintMsg) { this.room?.send("paint", p); }
  sendTag(id: string) { this.room?.send("tag", { id }); }
  sendTaunt() { this.room?.send("taunt"); }
  startRound() { this.room?.send("startRound"); }

  leave() { this.room?.leave(); this.room = undefined; }
}
