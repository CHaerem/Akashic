import * as React from "react"

import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "glass" | "card" | "photo" | "text"
}

function Skeleton({ className, variant = "default", ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse",
        variant === "default" && [
          "rounded-md",
          "bg-white/5 light:bg-black/5",
        ],
        variant === "glass" && [
          "rounded-xl",
          "bg-gradient-to-br from-white/8 to-white/4",
          "backdrop-blur-sm",
          "border border-white/5",
          "light:from-black/5 light:to-black/3",
          "light:border-black/5",
        ],
        variant === "card" && [
          "rounded-xl",
          "bg-gradient-to-br from-white/6 to-white/3",
          "backdrop-blur-md",
          "border border-white/8",
          "shadow-[0_4px_16px_rgba(0,0,0,0.1)]",
          "light:from-black/5 light:to-black/3",
        ],
        variant === "photo" && [
          "rounded-lg",
          "bg-white/8 light:bg-black/8",
          "aspect-square",
        ],
        variant === "text" && [
          "rounded",
          "bg-white/10 light:bg-black/10",
          "h-4",
        ],
        className
      )}
      {...props}
    />
  )
}

// Pre-built skeleton layouts
function SkeletonCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-3", className)} {...props}>
      <Skeleton variant="glass" className="h-32 w-full" />
      <div className="space-y-2 px-1">
        <Skeleton variant="text" className="h-4 w-3/4" />
        <Skeleton variant="text" className="h-3 w-1/2" />
      </div>
    </div>
  )
}

function SkeletonPhotoGrid({
  count = 6,
  columns = 3,
  className,
  ...props
}: {
  count?: number
  columns?: 1 | 2 | 3 | 4
} & React.HTMLAttributes<HTMLDivElement>) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  }

  return (
    <div
      className={cn("grid gap-2", gridCols[columns], className)}
      {...props}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant="photo" />
      ))}
    </div>
  )
}

function SkeletonStat({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <Skeleton variant="text" className="h-3 w-16" />
      <Skeleton variant="default" className="h-8 w-24 rounded-lg" />
    </div>
  )
}

function SkeletonList({
  count = 3,
  className,
  ...props
}: {
  count?: number
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-3", className)} {...props}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton variant="default" className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" className="h-4 w-3/4" />
            <Skeleton variant="text" className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

export {
  Skeleton,
  SkeletonCard,
  SkeletonPhotoGrid,
  SkeletonStat,
  SkeletonList,
}
