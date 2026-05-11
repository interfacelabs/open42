import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Open42 Button — flat, calm, premium. No glossy gradients.
 *
 * Variants:
 *   - primary:   flat black, white text. The single "do the thing" affordance.
 *   - secondary: white background with thin border. Quiet companion.
 *   - ghost:     no chrome — just a hover wash. Inline chrome only.
 *   - link:      text only, single accent blue.
 *   - destructive: solid red, sparingly used.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[14px] font-medium tracking-[-0.005em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--black-button)] text-white hover:bg-[var(--black-button-hover)]',
        secondary:
          'border border-border bg-white text-text-primary hover:bg-panel-soft',
        ghost:
          'text-text-body hover:bg-panel-soft hover:text-text-primary',
        link: 'text-blue underline-offset-4 hover:underline',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-[13px]',
        lg: 'h-11 px-5',
        icon: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
