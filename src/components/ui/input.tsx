import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full",
          // Minimum touch target (48px)
          "min-h-12 px-4 py-3",
          // 16px prevents iOS zoom on focus
          "text-base",
          "rounded-xl",
          // Glass styling
          "bg-black/30 backdrop-blur-sm",
          "border border-white/10",
          "text-white/95 placeholder:text-white/40",
          "shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]",
          // Transitions
          "transition-all duration-200",
          // Focus
          "focus:outline-none focus:border-blue-400/60",
          "focus:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2),0_0_0_3px_rgba(96,165,250,0.2)]",
          // Disabled
          "disabled:cursor-not-allowed disabled:opacity-50",
          // File input
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          // Light mode
          "light:bg-white/90 light:border-black/10",
          "light:text-slate-900 light:placeholder:text-slate-400",
          "light:shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]",
          "light:focus:border-blue-500/60",
          "light:focus:shadow-[inset_0_2px_4px_rgba(0,0,0,0.05),0_0_0_3px_rgba(59,130,246,0.2)]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
