import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base styles - applied to all buttons
  [
    "inline-flex items-center justify-center gap-2",
    "font-medium tracking-wide",
    "transition-all duration-300 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    // Mobile touch target - 44px minimum
    "min-h-11",
    // Whitespace handling
    "whitespace-nowrap",
  ],
  {
    variants: {
      variant: {
        default: [
          // Glass background - dark mode
          "bg-gradient-to-br from-white/12 to-white/6",
          "backdrop-blur-sm saturate-[180%]",
          "border border-white/15",
          "shadow-[0_4px_16px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "text-white/95",
          // Hover
          "hover:from-white/18 hover:to-white/10",
          "hover:border-white/25",
          "hover:shadow-[0_6px_20px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "hover:-translate-y-0.5",
          // Active
          "active:translate-y-0 active:scale-[0.98]",
          // Focus
          "focus-visible:ring-blue-400/50",
          // Light mode - frosted white button
          "light:from-white/95 light:to-white/85",
          "light:border-black/10",
          "light:text-slate-800",
          "light:shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)]",
          "light:hover:from-white light:hover:to-white/95",
          "light:hover:shadow-[0_6px_20px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,1)]",
        ],
        primary: [
          // Blue glass - dark mode
          "bg-gradient-to-br from-blue-400/25 to-blue-400/15",
          "backdrop-blur-sm saturate-[180%]",
          "border border-blue-400/40",
          "shadow-[0_4px_16px_rgba(96,165,250,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "text-blue-300",
          // Hover
          "hover:from-blue-400/35 hover:to-blue-400/20",
          "hover:border-blue-400/60",
          "hover:shadow-[0_6px_24px_rgba(96,165,250,0.3),inset_0_1px_0_rgba(255,255,255,0.25)]",
          "hover:-translate-y-0.5",
          // Active
          "active:translate-y-0 active:scale-[0.98]",
          // Focus
          "focus-visible:ring-blue-400/50",
          // Light mode - solid blue button
          "light:from-blue-500 light:to-blue-600",
          "light:border-blue-600",
          "light:text-white",
          "light:shadow-[0_4px_16px_rgba(59,130,246,0.25),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "light:hover:from-blue-600 light:hover:to-blue-700",
          "light:hover:shadow-[0_6px_24px_rgba(59,130,246,0.35)]",
        ],
        subtle: [
          // Subtle glass - dark mode
          "bg-gradient-to-br from-white/6 to-white/3",
          "backdrop-blur-[4px]",
          "border border-white/8",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
          "text-white/70",
          // Hover
          "hover:from-white/10 hover:to-white/5",
          "hover:border-white/15",
          "hover:text-white/95",
          "hover:shadow-[0_4px_12px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.1)]",
          // Focus
          "focus-visible:ring-white/30",
          // Light mode
          "light:from-slate-100 light:to-slate-50",
          "light:border-slate-200",
          "light:text-slate-600",
          "light:shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
          "light:hover:from-slate-200 light:hover:to-slate-100",
          "light:hover:text-slate-900",
          "light:hover:border-slate-300",
        ],
        ghost: [
          // Transparent - dark mode
          "bg-transparent",
          "border border-transparent",
          "text-white/50",
          // Hover
          "hover:bg-white/8",
          "hover:border-white/8",
          "hover:text-white/95",
          // Focus
          "focus-visible:ring-white/30",
          // Light mode
          "light:text-slate-600",
          "light:hover:bg-slate-100",
          "light:hover:text-slate-900",
        ],
        danger: [
          // Red glass - dark mode
          "bg-gradient-to-br from-red-400/20 to-red-400/10",
          "backdrop-blur-sm saturate-[180%]",
          "border border-red-400/30",
          "shadow-[0_4px_16px_rgba(248,113,113,0.15),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "text-red-300",
          // Hover
          "hover:from-red-400/30 hover:to-red-400/15",
          "hover:border-red-400/50",
          "hover:shadow-[0_6px_24px_rgba(248,113,113,0.25),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "hover:-translate-y-0.5",
          // Active
          "active:translate-y-0 active:scale-[0.98]",
          // Focus
          "focus-visible:ring-red-400/50",
          // Light mode - solid red button
          "light:from-red-500 light:to-red-600",
          "light:border-red-600",
          "light:text-white",
          "light:shadow-[0_4px_16px_rgba(239,68,68,0.25)]",
          "light:hover:from-red-600 light:hover:to-red-700",
        ],
      },
      size: {
        sm: "h-9 px-3.5 text-xs rounded-lg gap-1.5",
        md: "h-11 px-5 text-sm rounded-xl gap-2",
        lg: "h-13 px-7 text-sm rounded-xl gap-2.5",
        icon: "h-11 w-11 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  icon?: React.ReactNode
  iconPosition?: "left" | "right"
  fullWidth?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, icon, iconPosition = "left", fullWidth, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size }),
          fullWidth && "w-full",
          className
        )}
        ref={ref}
        {...props}
      >
        {icon && iconPosition === "left" && <span className="flex shrink-0">{icon}</span>}
        {children}
        {icon && iconPosition === "right" && <span className="flex shrink-0">{icon}</span>}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
