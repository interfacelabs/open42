import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Open42 Button — shadcn-shaped primitive themed to the design tokens.
 * Variants follow DESIGN.md: glossy black `primary`, soft white `secondary`,
 * plus standard ghost/link variants for chrome.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-2xl text-[15px] font-medium tracking-[-0.01em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-b from-neutral-800 to-neutral-950 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.18),0_8px_20px_rgba(0,0,0,0.12)] hover:brightness-110',
        secondary:
          'border border-black/10 bg-gradient-to-b from-white to-neutral-100 text-neutral-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.08)] hover:bg-white',
        ghost: 'hover:bg-secondary hover:text-secondary-foreground',
        link: 'text-accent underline-offset-4 hover:underline',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
      },
      size: {
        default: 'h-11 px-6',
        sm: 'h-9 px-4 text-sm',
        lg: 'h-12 px-8',
        icon: 'h-10 w-10 rounded-full',
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
