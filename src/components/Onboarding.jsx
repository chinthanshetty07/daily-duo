import { useState } from "react";

export default function Onboarding({ onReady, notice, fetchImpl = globalThis.fetch }) {
  const [mode, setMode] = useState("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetchImpl(mode === "create" ? "/api/duos" : "/api/duos/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "create" ? { name } : { name, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Something went wrong. Try again.");
      onReady({ token: body.token, duoId: body.duoId });
    } catch (err) {
      setError(err.message === "Failed to fetch" ? "Can't reach the server. Check your connection." : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card onboarding">
      <h1>Daily Duo</h1>
      <p className="lede">One question a day. You both answer privately, then see each other's answers together.</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === "create"} onClick={() => setMode("create")}>Start a duo</button>
        <button role="tab" aria-selected={mode === "join"} onClick={() => setMode("join")}>I have a code</button>
      </div>
      <form onSubmit={submit}>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required autoComplete="given-name" />
        </label>
        {mode === "join" && (
          <label>
            Invite code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              required
              autoCapitalize="characters"
              inputMode="text"
              placeholder="e.g. K7QM2X"
            />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "One moment…" : mode === "create" ? "Create our duo" : "Join"}
        </button>
      </form>
    </section>
  );
}
