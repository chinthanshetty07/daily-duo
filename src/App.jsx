import { useState } from "react";
import { loadSession, saveSession } from "./logic.js";
import Onboarding from "./components/Onboarding.jsx";
import DuoScreen from "./components/DuoScreen.jsx";

export default function App() {
  const [session, setSession] = useState(() => loadSession());
  const [notice, setNotice] = useState(null);

  const start = (s) => {
    saveSession(s);
    setNotice(null);
    setSession(s);
  };
  const leave = (message = null) => {
    saveSession(null);
    setNotice(message);
    setSession(null);
  };

  return (
    <main className="shell">
      {session ? <DuoScreen session={session} onExpired={leave} /> : <Onboarding onReady={start} notice={notice} />}
    </main>
  );
}
