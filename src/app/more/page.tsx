import Link from "next/link";
import { Brain, ChartNoAxesCombined, ChevronRight, PiggyBank, Settings, Target } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

const destinations = [
  { href: "/performance", label: "Performance", description: "Portfolio history and investment gain", icon: ChartNoAxesCombined },
  { href: "/plan/strategy", label: "Strategy", description: "Class and asset-level targets", icon: Target },
  { href: "/plan/contributions", label: "Contributions", description: "Concrete buy list planner", icon: PiggyBank },
  { href: "/intelligence", label: "Intelligence", description: "Portfolio decision support", icon: Brain },
  { href: "/settings", label: "Settings", description: "Market data and integrations", icon: Settings },
] as const;

export default function MorePage() {
  return <><PageHeader title="More" /><div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{destinations.map((destination) => { const Icon = destination.icon; return <Link key={destination.href} href={destination.href} className="flex min-h-20 items-center gap-4 px-4 py-3 hover:bg-surface-strong"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block font-medium text-foreground">{destination.label}</span><span className="mt-1 block text-sm text-muted">{destination.description}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-muted" /></Link>; })}</div></>;
}
