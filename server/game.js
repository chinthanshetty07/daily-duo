// Pure game rules. No I/O, no clock: callers pass the date key in, so every rule is testable.
import { CATEGORIES, QUESTIONS } from "./questions.js";

export const MAX_ANSWER = 280;

// Couples play at night (most play is 9 pm to midnight), so the "day" is India time, not UTC.
export function dateKeyIST(date) {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function previousDateKey(key) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function hash(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Today's question for a duo. Deterministic (both partners always see the same question, and a
 * server restart cannot change it), weighted toward categories the couple has hearted, and it
 * avoids repeating a question the duo has already answered.
 */
export function pickQuestion(duo, dateKey) {
  const existing = duo.days[dateKey];
  if (existing) return existing.question;

  const weights = CATEGORIES.map((c) => 1 + (duo.hearts[c] ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = hash(`${duo.id}:${dateKey}:category`) % total;
  let category = CATEGORIES[0];
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (roll < weights[i]) {
      category = CATEGORIES[i];
      break;
    }
    roll -= weights[i];
  }

  const asked = new Set(Object.values(duo.days).map((d) => d.question.text));
  const pool = QUESTIONS[category];
  const start = hash(`${duo.id}:${dateKey}:question`) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const text = pool[(start + i) % pool.length];
    if (!asked.has(text)) return { category, text };
  }
  return { category, text: pool[start] }; // every question in this category used: allow a repeat
}

export function ensureDay(duo, dateKey) {
  if (!duo.days[dateKey]) {
    duo.days[dateKey] = { question: pickQuestion(duo, dateKey), answers: {}, hearts: {} };
  }
  return duo.days[dateKey];
}

export function isRevealed(day, duo) {
  return duo.players.length === 2 && duo.players.every((p) => day.answers[p.id] !== undefined);
}

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Answers can be edited until both partners have answered; after the reveal they are locked. */
export function submitAnswer(duo, playerId, dateKey, raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new GameError("empty_answer", "Write something first.");
  if (text.length > MAX_ANSWER) throw new GameError("too_long", `Keep it under ${MAX_ANSWER} characters.`);
  const day = ensureDay(duo, dateKey);
  if (isRevealed(day, duo)) throw new GameError("locked", "Today's answers are already revealed.");
  day.answers[playerId] = text;
  return day;
}

export function toggleHeart(duo, playerId, dateKey) {
  const day = ensureDay(duo, dateKey);
  if (!isRevealed(day, duo)) throw new GameError("not_revealed", "You can react after the reveal.");
  const category = day.question.category;
  if (day.hearts[playerId]) {
    delete day.hearts[playerId];
    duo.hearts[category] = Math.max(0, (duo.hearts[category] ?? 0) - 1);
  } else {
    day.hearts[playerId] = true;
    duo.hearts[category] = (duo.hearts[category] ?? 0) + 1;
  }
  return day;
}

/** Consecutive days both partners answered, ending today (or yesterday, if today is still open). */
export function streak(duo, todayKey) {
  let key = todayKey;
  const today = duo.days[todayKey];
  if (!today || !isRevealed(today, duo)) key = previousDateKey(todayKey);
  let count = 0;
  while (duo.days[key] && isRevealed(duo.days[key], duo)) {
    count += 1;
    key = previousDateKey(key);
  }
  return count;
}

/**
 * What one player is allowed to see. The partner's answer is withheld until both have answered:
 * this is the rule the whole game depends on, so it lives here and is tested directly.
 */
export function viewFor(duo, playerId, dateKey, presence = {}) {
  const day = ensureDay(duo, dateKey);
  const me = duo.players.find((p) => p.id === playerId);
  const partner = duo.players.find((p) => p.id !== playerId) ?? null;
  const revealed = isRevealed(day, duo);
  return {
    duoId: duo.id,
    inviteCode: duo.inviteCode,
    date: dateKey,
    me: { name: me.name },
    partner: partner
      ? {
          name: partner.name,
          online: Boolean(presence[partner.id]?.online),
          typing: Boolean(presence[partner.id]?.typing) && !revealed,
          answered: day.answers[partner.id] !== undefined,
        }
      : null,
    question: day.question,
    myAnswer: day.answers[playerId] ?? null,
    partnerAnswer: revealed && partner ? day.answers[partner.id] : null,
    revealed,
    hearted: Boolean(day.hearts[playerId]),
    partnerHearted: partner ? Boolean(day.hearts[partner.id]) : false,
    streak: streak(duo, dateKey),
  };
}
