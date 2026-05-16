import type React from "react";
import { cn } from "../../lib/utils";

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "outline" | "warning" | "danger";
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 text-xs font-medium",
        variant === "default" && "bg-secondary text-secondary-foreground",
        variant === "outline" && "border border-border text-muted-foreground",
        variant === "warning" && "bg-amber-400/15 text-amber-200",
        variant === "danger" && "bg-red-500/15 text-red-200",
        className,
      )}
      {...props}
    />
  );
}
