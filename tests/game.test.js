// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  dateKeyIST, pickQuestion, ensureDay, submitAnswer, toggleHeart, streak, viewFor, GameError, MAX_ANSWER,
} from "../server/game.js";
import { CATEGORIES } from "../server/questions.js";

const duo = (over = {}) => ({
  id: "duo_test", inviteCode: "ABC234", days: {}, hearts: {},
  players: [{ id: "a", name: "Asha" }, { id: "b", name: "Ravi" }], ...over,
});
const answerBoth = (d, key) => { submitAnswer(d, "a", key, "mine"); submitAnswer(d, "b", key, "theirs"); };

describe("day boundaries", () => {
  it("rolls over at midnight India time, not UTC", () => {
    expect(dateKeyIST(new Date("2026-10-29T18:29:00Z"))).toBe("2026-10-29"); // 11:59 pm IST
    expect(dateKeyIST(new Date("2026-10-29T18:31:00Z"))).toBe("2026-10-30"); // 12:01 am IST
  });
});

describe("question choice", () => {
  it("is the same for both partners and stable once the day exists", () => {
    const d = duo();
    const q = ensureDay(d, "2026-10-29").question;
    expect(pickQuestion(d, "2026-10-29")).toEqual(q);
    expect(pickQuestion(duo(), "2026-10-29")).toEqual(q); // same duo id + date -> same question
  });

  it("does not repeat a question while unused ones remain", () => {
    const d = duo();
    const seen = new Set();
    for (let day = 1; day <= 20; day++) {
      const key = `2026-11-${String(day).padStart(2, "0")}`;
      const { text } = ensureDay(d, key).question;
      expect(seen.has(text)).toBe(false);
      seen.add(text);
    }
  });

  it("leans toward categories the couple has loved", () => {
    const counts = (hearts) => {
      const tally = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
      for (let i = 0; i < 400; i++) tally[pickQuestion(duo({ id: `duo_${i}`, hearts }), "2026-11-01").category]++;
      return tally;
    };
    const neutral = counts({});
    const lovesDreams = counts({ dreams: 9 });
    expect(lovesDreams.dreams).toBeGreaterThan(neutral.dreams * 2);
  });
});

describe("answers and the reveal", () => {
  it("never shows a partner's answer before both have answered", () => {
    const d = duo();
    submitAnswer(d, "a", "2026-10-29", "Goa, obviously");
    const ravi = viewFor(d, "b", "2026-10-29");
    expect(ravi.partner.answered).toBe(true);
    expect(ravi.partnerAnswer).toBeNull();
    expect(JSON.stringify(ravi)).not.toContain("Goa");
  });

  it("reveals both answers once both are in, then locks them", () => {
    const d = duo();
    submitAnswer(d, "a", "2026-10-29", "first");
    submitAnswer(d, "a", "2026-10-29", "edited before reveal");
    submitAnswer(d, "b", "2026-10-29", "theirs");
    const asha = viewFor(d, "a", "2026-10-29");
    expect(asha).toMatchObject({ revealed: true, myAnswer: "edited before reveal", partnerAnswer: "theirs" });
    expect(() => submitAnswer(d, "a", "2026-10-29", "too late")).toThrow(GameError);
  });

  it("does not reveal while the duo has only one person", () => {
    const d = duo({ players: [{ id: "a", name: "Asha" }] });
    submitAnswer(d, "a", "2026-10-29", "solo");
    expect(viewFor(d, "a", "2026-10-29")).toMatchObject({ revealed: false, partner: null });
  });

  it("rejects empty and over-long answers", () => {
    expect(() => submitAnswer(duo(), "a", "2026-10-29", "   ")).toThrow(/Write something/);
    expect(() => submitAnswer(duo(), "a", "2026-10-29", "x".repeat(MAX_ANSWER + 1))).toThrow(/under 280/);
  });

  it("only allows a heart after the reveal, and a second tap removes it", () => {
    const d = duo();
    expect(() => toggleHeart(d, "a", "2026-10-29")).toThrow(/after the reveal/);
    answerBoth(d, "2026-10-29");
    const category = d.days["2026-10-29"].question.category;
    toggleHeart(d, "a", "2026-10-29");
    expect(d.hearts[category]).toBe(1);
    toggleHeart(d, "a", "2026-10-29");
    expect(d.hearts[category]).toBe(0);
  });

  it("hides the typing indicator after the reveal", () => {
    const d = duo();
    answerBoth(d, "2026-10-29");
    expect(viewFor(d, "a", "2026-10-29", { b: { online: true, typing: true } }).partner.typing).toBe(false);
  });
});

describe("streaks", () => {
  it("counts consecutive answered days and survives today still being open", () => {
    const d = duo();
    for (const key of ["2026-10-26", "2026-10-27", "2026-10-28"]) answerBoth(d, key);
    expect(streak(d, "2026-10-29")).toBe(3); // today not answered yet: streak still alive
    answerBoth(d, "2026-10-29");
    expect(streak(d, "2026-10-29")).toBe(4);
  });

  it("breaks on a missed day or a one-sided day", () => {
    const d = duo();
    answerBoth(d, "2026-10-25");
    submitAnswer(d, "a", "2026-10-27", "only me"); // 26th missed, 27th one-sided
    answerBoth(d, "2026-10-28");
    expect(streak(d, "2026-10-29")).toBe(1);
  });
});
