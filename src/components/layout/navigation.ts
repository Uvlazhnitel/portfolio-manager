import {
  Bot,
  Brain,
  ChartNoAxesCombined,
  Gauge,
  Landmark,
  PiggyBank,
  Settings,
  Target,
} from "lucide-react";

export const navigationItems = [
  { label: "Dashboard", href: "/dashboard", icon: Gauge },
  { label: "Portfolio", href: "/portfolio", icon: Landmark },
  { label: "Performance", href: "/performance", icon: ChartNoAxesCombined },
  {
    label: "Plan",
    href: "/plan",
    icon: Target,
    children: [
      { label: "Strategy", href: "/plan/strategy", icon: ChartNoAxesCombined },
      { label: "Contributions", href: "/plan/contributions", icon: PiggyBank },
    ],
  },
  { label: "Intelligence", href: "/intelligence", icon: Brain },
  { label: "Assistant", href: "/assistant", icon: Bot },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

export const mobileNavigationItems = [
  { label: "Home", href: "/dashboard", icon: Gauge },
  { label: "Portfolio", href: "/portfolio", icon: Landmark },
  { label: "Assistant", href: "/assistant", icon: Bot },
  { label: "More", href: "/more", icon: Settings },
] as const;
