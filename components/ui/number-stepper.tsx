"use client";

import { NumberField } from "@base-ui/react/number-field";
import { MinusIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Quantity entry with press-and-hold −/+ steppers (Phase 11). Built on
// Base UI NumberField: keyboard arrows, wheel, min/max clamping, and ARIA
// come from the primitive. `size="field"` gives the 44px touch targets the
// crew phone flows need.
export function NumberStepper({
  value,
  onValueChange,
  min = 0,
  max,
  step = 1,
  disabled = false,
  size = "default",
  ariaLabel,
  className,
  inputClassName,
  name,
  id,
}: {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  size?: "default" | "field";
  ariaLabel: string;
  className?: string;
  inputClassName?: string;
  name?: string;
  id?: string;
}) {
  const buttonClass = cn(
    "flex shrink-0 items-center justify-center border-border bg-surface-sunken text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40",
    size === "field" ? "size-11" : "size-8"
  );
  return (
    <NumberField.Root
      value={value}
      onValueChange={onValueChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      name={name}
      id={id}
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-lg border border-border bg-surface shadow-e1",
        className
      )}
    >
      <NumberField.Decrement
        className={cn(buttonClass, "border-r")}
        aria-label={`Decrease ${ariaLabel}`}
      >
        <MinusIcon
          aria-hidden
          className={size === "field" ? "size-5" : "size-3.5"}
        />
      </NumberField.Decrement>
      <NumberField.Input
        aria-label={ariaLabel}
        inputMode="numeric"
        className={cn(
          "num w-14 min-w-0 bg-transparent text-center text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:bg-brand-subtle/40 disabled:opacity-50",
          size === "field" ? "h-11 w-16 text-base" : "h-8",
          inputClassName
        )}
      />
      <NumberField.Increment
        className={cn(buttonClass, "border-l")}
        aria-label={`Increase ${ariaLabel}`}
      >
        <PlusIcon
          aria-hidden
          className={size === "field" ? "size-5" : "size-3.5"}
        />
      </NumberField.Increment>
    </NumberField.Root>
  );
}
