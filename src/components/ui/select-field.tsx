import * as React from "react";
import {
  SelectField as BaseSelectField,
  type SelectProps,
} from "@/components/ui/input";

export interface ExtendedSelectProps extends SelectProps {
  options?: Array<{ value: string; label: string }>;
}

export const SelectField = React.forwardRef<
  HTMLSelectElement,
  ExtendedSelectProps
>(({ options, children, ...props }, ref) => (
  <BaseSelectField ref={ref} {...props}>
    {options
      ? options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))
      : children}
  </BaseSelectField>
));
SelectField.displayName = "SelectField";
