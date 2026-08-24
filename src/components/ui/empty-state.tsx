import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

type EmptyStateProps = {
  title: string;
  description: string;
  icon?: ReactNode;
};

export function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <Card className="flex min-h-[320px] flex-col items-center justify-center text-center">
      {icon ? (
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/12 text-primary">
          {icon}
        </div>
      ) : null}
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
    </Card>
  );
}
