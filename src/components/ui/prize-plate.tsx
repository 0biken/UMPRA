import * as React from "react";
import {
  PrizePlate as BasePrizePlate,
  type PrizePlateProps as BasePrizePlateProps,
} from "@/components/tournament/PrizePlate";

export interface UnifiedPrizePlateProps extends Partial<BasePrizePlateProps> {
  poolCents?: number;
  maxPoolCents?: number;
  paidSlots?: number;
  simulatedSlots?: number;
  totalSlots?: number;
  className?: string;
}

export function PrizePlate({
  collectedCents,
  projectedPoolCents,
  paidCount,
  poolCents,
  maxPoolCents,
  paidSlots,
  simulatedSlots,
  totalSlots = 8,
  className,
}: UnifiedPrizePlateProps) {
  return (
    <BasePrizePlate
      collectedCents={collectedCents ?? poolCents ?? 0}
      projectedPoolCents={projectedPoolCents ?? maxPoolCents ?? 0}
      paidCount={paidCount ?? paidSlots ?? 0}
      simulatedCount={simulatedSlots ?? 0}
      totalSlots={totalSlots}
      className={className}
    />
  );
}
