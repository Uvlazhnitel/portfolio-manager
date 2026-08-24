import { Activity, CircleDollarSign, PiggyBank, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";

const allocation = [
  { label: "ETF", current: 0, target: 77 },
  { label: "Crypto", current: 63, target: 12 },
  { label: "Gold", current: 32, target: 9 },
  { label: "Cash", current: 5, target: 2 },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Portfolio Dashboard"
        description="Long-term allocation snapshot and contribution guidance."
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <StatCard
          title="Total portfolio value"
          value="€24,680"
          description="Demo snapshot in EUR"
          badge="Demo"
          icon={<CircleDollarSign className="h-5 w-5" aria-hidden="true" />}
        />
        <StatCard
          title="Portfolio health"
          value="84/100"
          description="Allocation consistency"
          badge="Healthy"
          icon={<Activity className="h-5 w-5" aria-hidden="true" />}
        />
        <StatCard
          title="Allocation"
          value="4 classes"
          description="Current vs target"
          badge="Review"
          icon={<Target className="h-5 w-5" aria-hidden="true" />}
        />
        <StatCard
          title="Suggested next contribution"
          value="ETF"
          description="Prefer future buys first"
          badge="Planned"
          icon={<PiggyBank className="h-5 w-5" aria-hidden="true" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Allocation</h2>
              <p className="mt-1 text-sm text-muted">Current allocation against configurable targets.</p>
            </div>
            <Badge tone="primary">EUR base</Badge>
          </div>

          <div className="mt-6 space-y-5">
            {allocation.map((item) => (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-muted">
                    {item.current}% current · {item.target}% target
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-surface-strong">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${item.current}%` }}
                  />
                  <div
                    className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground/80"
                    style={{ left: `${item.target}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-foreground">Suggested next contribution</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            New investments should currently prioritize ETF exposure before considering sells or rebalancing.
          </p>
          <div className="mt-6 rounded-lg border border-primary/25 bg-primary/10 p-4">
            <p className="text-sm font-medium text-primary">Primary action</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">Buy ETF</p>
            <p className="mt-2 text-sm text-muted">Demo recommendation based on temporary allocation data.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
