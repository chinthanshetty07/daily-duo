// Small pure helpers, kept out of components so they can be unit-tested.

export const MAX_ANSWER = 280;

/** Exponential backoff with jitter, capped, so a whole city reconnecting doesn't arrive at once. */
export function backoffDelay(attempt, random = Math.random) {
  const base = Math.min(10_000, 500 * 2 ** attempt);
  return Math.round(base / 2 + random() * (base / 2));
}

/** The one-line status under the question. Order matters: the most useful fact wins. */
export function partnerLine(state) {
  const p = state.partner;
  if (!p) return { tone: "invite", text: `Waiting for your partner to join. Share code ${state.inviteCode}` };
  if (state.revealed) return { tone: "done", text: `You and ${p.name} both answered` };
  if (p.typing) return { tone: "live", text: `${p.name} is typing…` };
  if (p.answered && state.myAnswer) return { tone: "live", text: `Both answered. Revealing…` };
  if (p.answered) return { tone: "nudge", text: `${p.name} has answered. Your turn` };
  if (state.myAnswer) return { tone: "wait", text: `Locked in. Waiting for ${p.name}${p.online ? "" : " (offline)"}` };
  return { tone: p.online ? "live" : "wait", text: p.online ? `${p.name} is here` : `${p.name} is offline` };
}

export function streakLabel(n) {
  if (n === 0) return "Start a streak today";
  return n === 1 ? "1 day streak" : `${n} day streak`;
}

export function loadSession(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem("dailyDuo.session");
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.token ? parsed : null;
  } catch {
    return null; // private mode or blocked storage: just start fresh
  }
}

export function saveSession(session, storage = globalThis.localStorage) {
  try {
    if (session) storage?.setItem("dailyDuo.session", JSON.stringify(session));
    else storage?.removeItem("dailyDuo.session");
  } catch {
    /* storage unavailable: the session lasts for this tab only */
  }
}
