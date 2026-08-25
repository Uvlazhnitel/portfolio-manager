import type { ReactNode } from "react";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-[100dvh] min-w-0 bg-background">
      <Sidebar />
      <main className="min-h-[100dvh] min-w-0 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] lg:ml-[240px] lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto min-w-0 w-full max-w-7xl">{children}</div>
      </main>
      <MobileBottomNav />
    </div>
  );
}
