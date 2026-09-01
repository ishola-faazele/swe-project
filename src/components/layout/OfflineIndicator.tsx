"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Initial check. Deferred via queueMicrotask (not called synchronously in the effect body) —
    // still resolves before paint, but this component must render `false` on both the server
    // pass and the client's first render to avoid a hydration mismatch (navigator is unavailable
    // during SSR), so the real value can only be read once mounted, not from useState's initializer.
    queueMicrotask(() => setIsOffline(!navigator.onLine));

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 font-mono-data text-xs font-semibold text-destructive ring-1 ring-inset ring-destructive/20"
      title="You are currently offline. Changes may not be saved."
    >
      <WifiOff className="h-3 w-3" />
      <span className="hidden sm:inline">OFFLINE</span>
    </div>
  );
}
