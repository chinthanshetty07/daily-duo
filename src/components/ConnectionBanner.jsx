const COPY = {
  connecting: "Connecting…",
  reconnecting: "Connection lost. Reconnecting…",
  offline: "You're offline. We'll reconnect when you're back.",
};

export default function ConnectionBanner({ status, hasPending }) {
  if (!COPY[status]) return null;
  return (
    <div className={`banner banner-${status}`} role="status">
      {COPY[status]}
      {hasPending && status !== "connecting" ? " Your answer will send then." : ""}
    </div>
  );
}
