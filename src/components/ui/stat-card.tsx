import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type StatCardProps = {
  title: string;
  value: string;
  description?: string;
  badge?: string;
  icon?: ReactNode;
};

export function StatCard({ title, value, description, badge, icon }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">{title}</p>
          <p className="mt-3 text-3xl font-semibold tracking-normal text-foreground">{value}</p>
        </div>
        {icon ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/12 text-primary">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        {description ? <p className="text-sm text-muted">{description}</p> : <span />}
        {badge ? <Badge>{badge}</Badge> : null}
      </div>
    </Card>
  );
}
