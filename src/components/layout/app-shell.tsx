import type { ReactNode } from "react";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="min-h-screen px-4 pb-28 pt-5 md:ml-[240px] md:px-8 md:pb-10 md:pt-8">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>
      <MobileBottomNav />
    </div>
  );
}
