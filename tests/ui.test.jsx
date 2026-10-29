import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { backoffDelay, loadSession, partnerLine, streakLabel } from "../src/logic.js";
import DuoScreen from "../src/components/DuoScreen.jsx";
import Onboarding from "../src/components/Onboarding.jsx";

const base = {
  inviteCode: "K7QM2X", date: "2026-10-29", me: { name: "Asha" },
  partner: { name: "Ravi", online: true, typing: false, answered: false },
  question: { category: "dreams", text: "Where would we go for a week?" },
  myAnswer: null, partnerAnswer: null, revealed: false, hearted: false, partnerHearted: false, streak: 2,
};

describe("logic", () => {
  it("backs off exponentially within bounds", () => {
    expect(backoffDelay(0, () => 0)).toBe(250);
    expect(backoffDelay(3, () => 1)).toBe(4000);
    expect(backoffDelay(20, () => 1)).toBe(10000); // capped
  });

  it("picks the most useful partner line", () => {
    expect(partnerLine({ ...base, partner: null }).text).toContain("K7QM2X");
    expect(partnerLine({ ...base, partner: { ...base.partner, typing: true } }).text).toBe("Ravi is typing…");
    expect(partnerLine({ ...base, partner: { ...base.partner, answered: true } }).text).toBe("Ravi has answered. Your turn");
    expect(partnerLine({ ...base, myAnswer: "x", partner: { ...base.partner, online: false } }).text).toContain("(offline)");
    expect(streakLabel(0)).toBe("Start a streak today");
  });

  it("survives broken storage", () => {
    expect(loadSession({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(loadSession({ getItem: () => "{not json" })).toBeNull();
  });
});

const fakeSocket = (state, status = "open") => ({ state, status, error: null, send: vi.fn(), hasPending: () => false });

describe("DuoScreen", () => {
  it("shows a loading skeleton before the first state arrives", () => {
    render(<DuoScreen session={{}} onExpired={() => {}} socket={fakeSocket(null, "connecting")} />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });

  it("sends typing and a trimmed answer", () => {
    const socket = fakeSocket(base);
    render(<DuoScreen session={{}} onExpired={() => {}} socket={socket} />);
    fireEvent.change(screen.getByLabelText(/Your answer/), { target: { value: "  Meghalaya  " } });
    expect(socket.send).toHaveBeenCalledWith({ type: "typing", on: true });
    fireEvent.click(screen.getByRole("button", { name: "Lock in" }));
    expect(socket.send).toHaveBeenCalledWith(expect.objectContaining({ type: "answer", text: "Meghalaya" }));
  });

  it("shows both answers and the heart after the reveal", () => {
    const socket = fakeSocket({ ...base, revealed: true, myAnswer: "Goa", partnerAnswer: "Hampi", partnerHearted: true });
    render(<DuoScreen session={{}} onExpired={() => {}} socket={socket} />);
    expect(screen.getByText("Goa")).toBeInTheDocument();
    expect(screen.getByText("Hampi")).toBeInTheDocument();
    expect(screen.getByText("Ravi loved this question too.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Love this question/ }));
    expect(socket.send).toHaveBeenCalledWith({ type: "heart" });
  });

  it("warns when the connection drops", () => {
    render(<DuoScreen session={{}} onExpired={() => {}} socket={fakeSocket(base, "reconnecting")} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting");
  });

  it("sends the user back to onboarding when the duo has expired", () => {
    const onExpired = vi.fn();
    render(<DuoScreen session={{}} onExpired={onExpired} socket={fakeSocket(null, "expired")} />);
    expect(onExpired).toHaveBeenCalled();
  });
});

describe("Onboarding", () => {
  it("shows the server's error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "That invite code doesn't match any duo." }) });
    render(<Onboarding onReady={() => {}} fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("tab", { name: "I have a code" }));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ravi" } });
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "nope22" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't match");
  });
});
