// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createDuoServer } from "../server/app.js";

let srv, base, now;

beforeEach(async () => {
  now = new Date("2026-10-29T15:00:00Z"); // 8:30 pm IST
  srv = createDuoServer({ clock: () => now, typingTtlMs: 150 });
  await new Promise((r) => srv.server.listen(0, r));
  base = `127.0.0.1:${srv.server.address().port}`;
});
afterEach(() => srv.close());

const post = (path, body) =>
  fetch(`http://${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

/** A test client that records every raw message so we can assert nothing leaked. */
function client(token) {
  const ws = new WebSocket(`ws://${base}/ws`);
  const c = { ws, raw: [], states: [], closeCode: null };
  ws.on("message", (m) => {
    c.raw.push(m.toString());
    const msg = JSON.parse(m.toString());
    if (msg.type === "state") c.states.push(msg.state);
  });
  ws.on("close", (code) => (c.closeCode = code));
  c.ready = new Promise((r) => ws.on("open", () => { if (token) ws.send(JSON.stringify({ type: "hello", token })); r(); }));
  c.send = (msg) => ws.send(JSON.stringify(msg));
  c.last = () => c.states.at(-1);
  c.until = async (pred, ms = 2000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (c.last() && pred(c.last())) return c.last();
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`condition not met; last state: ${JSON.stringify(c.last())}`);
  };
  return c;
}

async function pair() {
  const a = await post("/api/duos", { name: "Asha" });
  const b = await post("/api/duos/join", { name: "Ravi", code: a.body.inviteCode.toLowerCase() });
  const ca = client(a.body.token), cb = client(b.body.token);
  await Promise.all([ca.ready, cb.ready]);
  await ca.until((s) => s.partner?.online);
  await cb.until((s) => s.partner?.online);
  return { ca, cb };
}

describe("HTTP", () => {
  it("validates names and codes, and caps a duo at two", async () => {
    expect((await post("/api/duos", { name: "" })).status).toBe(422);
    const a = await post("/api/duos", { name: "Asha" });
    expect(a.body.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect((await post("/api/duos/join", { name: "X", code: "NOPE22" })).status).toBe(404);
    expect((await post("/api/duos/join", { name: "Ravi", code: a.body.inviteCode })).status).toBe(201);
    expect((await post("/api/duos/join", { name: "Third", code: a.body.inviteCode })).status).toBe(409);
  });
});

describe("live play", () => {
  it("closes a socket that presents an unknown token", async () => {
    const c = client("not-a-token");
    await c.ready;
    await new Promise((r) => c.ws.on("close", r));
    expect(c.closeCode).toBe(4401);
  });

  it("shows typing, then clears it after the timeout", async () => {
    const { ca, cb } = await pair();
    ca.send({ type: "typing", on: true });
    await cb.until((s) => s.partner.typing);
    await cb.until((s) => !s.partner.typing, 1000);
  });

  it("keeps an answer secret until both answer, then reveals to both", async () => {
    const { ca, cb } = await pair();
    ca.send({ type: "answer", text: "Pondicherry in the rain", requestId: "r1" });
    await cb.until((s) => s.partner.answered);
    expect(cb.raw.join("")).not.toContain("Pondicherry"); // not in any message Ravi received
    cb.send({ type: "answer", text: "Shillong", requestId: "r2" });
    const ashaView = await ca.until((s) => s.revealed);
    const raviView = await cb.until((s) => s.revealed);
    expect(ashaView.partnerAnswer).toBe("Shillong");
    expect(raviView.partnerAnswer).toBe("Pondicherry in the rain");
    expect(raviView.streak).toBe(1);
  });

  it("returns a typed error for a locked answer and keeps the socket open", async () => {
    const { ca, cb } = await pair();
    ca.send({ type: "answer", text: "a" });
    cb.send({ type: "answer", text: "b" });
    await ca.until((s) => s.revealed);
    ca.send({ type: "answer", text: "change", requestId: "late" });
    await new Promise((r) => setTimeout(r, 100));
    const err = ca.raw.map((m) => JSON.parse(m)).find((m) => m.type === "error");
    expect(err).toMatchObject({ code: "locked", requestId: "late" });
    expect(ca.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("marks a partner offline when their last tab closes", async () => {
    const { ca, cb } = await pair();
    cb.ws.close();
    await ca.until((s) => s.partner.online === false);
  });

  it("starts a new question at midnight IST and keeps the streak", async () => {
    const { ca, cb } = await pair();
    ca.send({ type: "answer", text: "a" });
    cb.send({ type: "answer", text: "b" });
    const day1 = await ca.until((s) => s.revealed);
    now = new Date("2026-10-29T18:31:00Z"); // 12:01 am IST, 30 Oct
    ca.send({ type: "typing", on: true }); // any event triggers a fresh view
    const day2 = await ca.until((s) => s.date === "2026-10-30");
    expect(day2.question.text).not.toBe(day1.question.text);
    expect(day2).toMatchObject({ revealed: false, myAnswer: null, streak: 1 });
  });
});
