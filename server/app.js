// HTTP for creating/joining a duo, WebSocket for everything live (presence, typing, answers, reveal).
import { randomBytes, randomInt } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { dateKeyIST, GameError, submitAnswer, toggleHeart, viewFor } from "./game.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I: codes get read out over calls
const HELLO_TIMEOUT_MS = 5000;

export function createDuoServer({ clock = () => new Date(), staticDir = null, typingTtlMs = 4000 } = {}) {
  const duos = new Map(); // duoId -> { id, inviteCode, players: [{id, name}], days: {}, hearts: {} }
  const codes = new Map(); // inviteCode -> duoId
  const tokens = new Map(); // token -> { duoId, playerId }
  const sockets = new Map(); // playerId -> Set<WebSocket>
  const typing = new Map(); // playerId -> timeout handle

  const today = () => dateKeyIST(clock());
  const newId = (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`;

  function newCode() {
    let code;
    do {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (codes.has(code));
    return code;
  }

  function addPlayer(duo, name) {
    const player = { id: newId("p"), name };
    duo.players.push(player);
    const token = randomBytes(24).toString("hex");
    tokens.set(token, { duoId: duo.id, playerId: player.id });
    return token;
  }

  function cleanName(raw) {
    const name = String(raw ?? "").trim();
    if (!name || name.length > 30) return null;
    return name;
  }

  function presenceFor(duo) {
    return Object.fromEntries(
      duo.players.map((p) => [p.id, { online: (sockets.get(p.id)?.size ?? 0) > 0, typing: typing.has(p.id) }]),
    );
  }

  function broadcast(duo) {
    const presence = presenceFor(duo);
    for (const player of duo.players) {
      const view = viewFor(duo, player.id, today(), presence);
      for (const ws of sockets.get(player.id) ?? []) send(ws, { type: "state", state: view });
    }
  }

  function setTyping(duo, playerId, on) {
    clearTimeout(typing.get(playerId));
    if (on) typing.set(playerId, setTimeout(() => setTyping(duo, playerId, false), typingTtlMs));
    else typing.delete(playerId);
    broadcast(duo);
  }

  const app = express();
  app.use(express.json({ limit: "4kb" }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok", duos: duos.size }));

  app.post("/api/duos", (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(422).json({ error: "Enter a name (1 to 30 characters)." });
    const duo = { id: newId("duo"), inviteCode: newCode(), players: [], days: {}, hearts: {} };
    duos.set(duo.id, duo);
    codes.set(duo.inviteCode, duo.id);
    const token = addPlayer(duo, name);
    res.status(201).json({ duoId: duo.id, inviteCode: duo.inviteCode, token });
  });

  app.post("/api/duos/join", (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(422).json({ error: "Enter a name (1 to 30 characters)." });
    const code = String(req.body?.code ?? "").trim().toUpperCase();
    const duo = duos.get(codes.get(code));
    if (!duo) return res.status(404).json({ error: "That invite code doesn't match any duo." });
    if (duo.players.length >= 2) return res.status(409).json({ error: "This duo already has two people." });
    const token = addPlayer(duo, name);
    broadcast(duo); // the creator sees their partner arrive without refreshing
    res.status(201).json({ duoId: duo.id, inviteCode: duo.inviteCode, token });
  });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4 * 1024 });

  wss.on("connection", (ws) => {
    let session = null;
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    const helloTimer = setTimeout(() => !session && ws.close(4401, "hello required"), HELLO_TIMEOUT_MS);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: "error", code: "bad_json", message: "Malformed message." });
      }

      if (!session) {
        const found = msg.type === "hello" && tokens.get(msg.token);
        if (!found) return ws.close(4401, "unknown token");
        clearTimeout(helloTimer);
        session = found;
        if (!sockets.has(session.playerId)) sockets.set(session.playerId, new Set());
        sockets.get(session.playerId).add(ws);
        return broadcast(duos.get(session.duoId));
      }

      const duo = duos.get(session.duoId);
      try {
        if (msg.type === "typing") return setTyping(duo, session.playerId, Boolean(msg.on));
        if (msg.type === "answer") {
          submitAnswer(duo, session.playerId, today(), msg.text);
          clearTimeout(typing.get(session.playerId));
          typing.delete(session.playerId);
          send(ws, { type: "ack", requestId: msg.requestId ?? null });
          return broadcast(duo);
        }
        if (msg.type === "heart") {
          toggleHeart(duo, session.playerId, today());
          return broadcast(duo);
        }
        send(ws, { type: "error", code: "unknown_type", message: "Unknown message type." });
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
        send(ws, { type: "error", code: err.code, message: err.message, requestId: msg.requestId ?? null });
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (!session) return;
      const set = sockets.get(session.playerId);
      set?.delete(ws);
      if (set && set.size === 0) {
        clearTimeout(typing.get(session.playerId));
        typing.delete(session.playerId);
      }
      const duo = duos.get(session.duoId);
      if (duo) broadcast(duo);
    });
  });

  // Drop connections that stopped answering pings (phone locked, network gone) so presence stays honest.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on("close", () => clearInterval(heartbeat));

  return {
    server,
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat);
        for (const t of typing.values()) clearTimeout(t);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}
