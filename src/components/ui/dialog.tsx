"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-ink/50 transition-opacity duration-[var(--dur-base)]",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-panel)] border border-line bg-paper p-5 md:p-6 shadow-[var(--shadow-float)] transition-all duration-[var(--dur-base)]",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("type-h3 text-ink", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("type-body text-muted mt-2", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export interface ManagedDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  onClose,
  title,
  description,
  actions,
  children,
}: ManagedDialogProps) {
  const descriptionId = React.useId();
  // Opened from state rather than a Dialog.Trigger, so Radix has nothing to return focus to.
  // Remember the element that opened it and give focus back on close (06: return focus on close).
  const openerRef = React.useRef<HTMLElement | null>(null);
  // Layout effect: runs before Radix's focus effect moves focus into the dialog.
  React.useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
  }, [open]);
  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
    if (!next) onClose?.();
  };
  const restoreFocus = (event: Event) => {
    const opener = openerRef.current;
    if (opener && opener.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  };

  if (title !== undefined || description !== undefined || actions !== undefined) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          aria-describedby={description ? descriptionId : undefined}
          onCloseAutoFocus={restoreFocus}
        >
          {title && <DialogTitle>{title}</DialogTitle>}
          {description && <DialogDescription id={descriptionId}>{description}</DialogDescription>}
          {children && <div className="mt-3">{children}</div>}
          {actions && (
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
              {actions}
            </div>
          )}
        </DialogContent>
      </DialogPrimitive.Root>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}
