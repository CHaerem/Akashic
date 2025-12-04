import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const cardVariants = cva(
  [
    "rounded-xl",
    "transition-all duration-300 ease-out",
  ],
  {
    variants: {
      variant: {
        default: [
          // Glass background - dark mode
          "bg-gradient-to-br from-white/10 via-white/5 to-white/8",
          "backdrop-blur-xl saturate-[180%]",
          "border border-white/15",
          "shadow-[0_8px_32px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.15),inset_0_-1px_0_rgba(0,0,0,0.1)]",
          // Light mode - frosted white
          "light:from-white/95 light:via-white/90 light:to-white/92",
          "light:border-black/8",
          "light:shadow-[0_8px_32px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)]",
        ],
        subtle: [
          // Subtle glass - dark mode
          "bg-gradient-to-br from-white/6 to-white/3",
          "backdrop-blur-md saturate-[180%]",
          "border border-white/8",
          "shadow-[0_4px_16px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.08)]",
          // Light mode
          "light:from-white/80 light:to-white/70",
          "light:border-black/5",
          "light:shadow-[0_4px_16px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]",
        ],
        elevated: [
          // Elevated glass - dark mode
          "bg-gradient-to-b from-white/14 via-white/8 to-white/6",
          "backdrop-blur-2xl saturate-[200%]",
          "border border-white/15",
          "shadow-[0_16px_48px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.1),inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-1px_0_rgba(0,0,0,0.15)]",
          // Light mode
          "light:from-white/98 light:via-white/95 light:to-white/96",
          "light:border-black/10",
          "light:shadow-[0_16px_48px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)]",
        ],
        interactive: [
          // Interactive glass - dark mode
          "bg-gradient-to-br from-white/10 via-white/5 to-white/8",
          "backdrop-blur-xl saturate-[180%]",
          "border border-white/15",
          "shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "cursor-pointer",
          // Hover - dark mode
          "hover:from-white/14 hover:to-white/10",
          "hover:border-white/25",
          "hover:shadow-[0_12px_40px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "hover:-translate-y-0.5",
          // Active
          "active:translate-y-0",
          // Light mode
          "light:from-white/92 light:to-white/85",
          "light:border-black/8",
          "light:shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)]",
          "light:hover:from-white/98 light:hover:to-white/95",
          "light:hover:border-black/12",
          "light:hover:shadow-[0_12px_40px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,1)]",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-white/95 light:text-slate-900",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-white/60 light:text-slate-600", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants }
