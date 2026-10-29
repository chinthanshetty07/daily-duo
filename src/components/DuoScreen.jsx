import { useEffect, useRef, useState } from "react";
import { MAX_ANSWER, partnerLine, streakLabel } from "../logic.js";
import { useDuoSocket } from "../useDuoSocket.js";
import ConnectionBanner from "./ConnectionBanner.jsx";

export default function DuoScreen({ session, onExpired, socket: injected }) {
  const live = useDuoSocket(injected ? null : session.token);
  const { state, status, error, send, hasPending } = injected ?? live;
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const typingRef = useRef({ on: false, lastSent: 0, idle: null });

  useEffect(() => {
    if (status === "expired") onExpired("That duo no longer exists (the demo server restarted). Start a new one.");
  }, [status, onExpired]);

  useEffect(() => () => clearTimeout(typingRef.current.idle), []);

  if (!state) {
    return (
      <section className="card skeleton" aria-busy="true">
        <ConnectionBanner status={status} />
        <div className="shimmer line" />
        <div className="shimmer block" />
      </section>
    );
  }

  const line = partnerLine(state);
  const answering = !state.revealed && (!state.myAnswer || editing);

  function onType(value) {
    setDraft(value);
    const t = typingRef.current;
    const now = Date.now();
    if (!t.on || now - t.lastSent > 2000) {
      send({ type: "typing", on: true });
      t.on = true;
      t.lastSent = now;
    }
    clearTimeout(t.idle);
    t.idle = setTimeout(() => {
      send({ type: "typing", on: false });
      t.on = false;
    }, 2500);
  }

  function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    clearTimeout(typingRef.current.idle);
    typingRef.current.on = false;
    send({ type: "answer", text, requestId: crypto.randomUUID?.() ?? String(Date.now()) });
    setEditing(false);
  }

  return (
    <section className="duo">
      <ConnectionBanner status={status} hasPending={hasPending?.()} />
      <header className="duo-head">
        <span className="names">{state.me.name}{state.partner ? ` & ${state.partner.name}` : ""}</span>
        <span className="streak" aria-label={streakLabel(state.streak)}>🔥 {streakLabel(state.streak)}</span>
      </header>

      <article className="card question">
        <p className="category">{state.question.category}</p>
        <h2>{state.question.text}</h2>
        <p className={`partner-line tone-${line.tone}`} aria-live="polite">{line.text}</p>
      </article>

      {answering && (
        <form className="card answer" onSubmit={submit}>
          <label htmlFor="answer">Your answer (only you can see it until you've both answered)</label>
          <textarea
            id="answer"
            value={draft}
            maxLength={MAX_ANSWER}
            rows={4}
            onChange={(e) => onType(e.target.value)}
            placeholder="Be honest. That's the fun part."
          />
          <div className="row">
            <span className="count">{draft.length}/{MAX_ANSWER}</span>
            <button className="primary" disabled={!draft.trim()}>{state.myAnswer ? "Update answer" : "Lock in"}</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}

      {!answering && !state.revealed && (
        <article className="card mine">
          <p className="label">Your answer</p>
          <p>{state.myAnswer}</p>
          <button className="link" onClick={() => { setDraft(state.myAnswer); setEditing(true); }}>Edit until they answer</button>
        </article>
      )}

      {state.revealed && (
        <div className="reveal" aria-live="polite">
          <Answer who={state.me.name} text={state.myAnswer} />
          <Answer who={state.partner.name} text={state.partnerAnswer} />
          <button className={`heart ${state.hearted ? "on" : ""}`} aria-pressed={state.hearted} onClick={() => send({ type: "heart" })}>
            {state.hearted ? "♥ You loved this question" : "♡ Love this question"}
          </button>
          {state.partnerHearted && <p className="hint">{state.partner.name} loved this question too.</p>}
          <p className="hint">Questions you both love shape what you get next. Come back tomorrow for a new one.</p>
        </div>
      )}
    </section>
  );
}

function Answer({ who, text }) {
  return (
    <article className="card bubble">
      <p className="label">{who}</p>
      <p>{text}</p>
    </article>
  );
}
