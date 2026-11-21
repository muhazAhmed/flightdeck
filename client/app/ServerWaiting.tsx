/**
 * What shows while the API has not answered yet.
 *
 * Quiet for the first seconds, because on a normal start this is on screen briefly and an error-coloured
 * message would read as a failure. Only once it has clearly taken too long does it say what to do — and it
 * keeps polling either way, so starting the server is enough; no refresh is needed.
 */
export function ServerWaiting({ slow }: { slow: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-(--bg-base) text-center">
      <div className="text-[13.5px] text-text-primary">Starting Flight Deck…</div>
      {slow ? (
        <div className="text-[12.5px] text-danger">
          Cannot reach the Flight Deck server. Start it with <span className="font-mono">npm run dev</span> — this
          page will pick it up.
        </div>
      ) : (
        <div className="text-[12.5px] text-text-muted">Waiting for the server to come up.</div>
      )}
    </div>
  );
}
