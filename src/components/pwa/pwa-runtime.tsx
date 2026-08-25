"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function PwaRuntime() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const updateConnectivity = () => setIsOffline(!navigator.onLine);

    updateConnectivity();
    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", updateConnectivity);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    }

    return () => {
      window.removeEventListener("online", updateConnectivity);
      window.removeEventListener("offline", updateConnectivity);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-warning/35 bg-card/95 px-4 py-2 text-sm font-medium text-warning shadow-lg shadow-background/40 backdrop-blur"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      Offline · portfolio data is not updating
    </div>
  );
}
