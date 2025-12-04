import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center gap-1",
      "p-1 rounded-xl",
      // Glass background
      "bg-gradient-to-br from-white/8 to-white/4",
      "backdrop-blur-md",
      "border border-white/10",
      // Light mode
      "light:from-black/5 light:to-black/3",
      "light:border-black/5",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap",
      "px-4 py-2.5 text-sm font-medium",
      "rounded-lg",
      // Minimum touch target
      "min-h-11",
      // Default state
      "text-white/50",
      "transition-all duration-200",
      // Hover
      "hover:text-white/80",
      // Focus
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-50",
      // Active state
      "data-[state=active]:bg-gradient-to-br data-[state=active]:from-white/15 data-[state=active]:to-white/8",
      "data-[state=active]:backdrop-blur-sm data-[state=active]:saturate-[180%]",
      "data-[state=active]:text-white/95",
      "data-[state=active]:shadow-[0_2px_8px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]",
      // Light mode
      "light:text-slate-500",
      "light:hover:text-slate-700",
      "light:data-[state=active]:from-white/80 light:data-[state=active]:to-white/60",
      "light:data-[state=active]:text-slate-900",
      "light:data-[state=active]:shadow-[0_2px_8px_rgba(0,0,0,0.1)]",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2",
      // Animation
      "data-[state=inactive]:hidden",
      "data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-2",
      "duration-200",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
