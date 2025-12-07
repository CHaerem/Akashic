import { motion } from 'framer-motion';
import type { TrekConfig } from '../../types/trek';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { cn } from '@/lib/utils';

interface GlobeSelectionPanelProps {
    selectedTrek: TrekConfig;
    onBack: () => void;
    onExplore: () => void;
    isMobile: boolean;
}

// Mountain peak icon
const MountainIcon = () => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-white/40"
    >
        <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </svg>
);

// Dark mode gradient for mobile bottom fade
const MOBILE_GRADIENT = `linear-gradient(
    to top,
    rgba(12, 12, 18, 0.98) 0%,
    rgba(12, 12, 18, 0.9) 50%,
    rgba(12, 12, 18, 0.6) 80%,
    transparent 100%
)`;

// Animation variants
const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.4,
            ease: [0.25, 0.46, 0.45, 0.94],
            staggerChildren: 0.08
        }
    },
    exit: {
        opacity: 0,
        y: 10,
        transition: { duration: 0.2 }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.3, ease: 'easeOut' }
    }
};

export function GlobeSelectionPanel({ selectedTrek, onBack, onExplore, isMobile }: GlobeSelectionPanelProps) {
    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
                "absolute bottom-0 z-20",
                isMobile
                    ? "left-0 right-0 px-5 pt-6 pb-[max(32px,env(safe-area-inset-bottom))]"
                    : "left-6 pb-12 max-w-[420px]"
            )}
            style={isMobile ? { background: MOBILE_GRADIENT } : undefined}
            role="dialog"
            aria-label={`${selectedTrek.name} journey details`}
        >
            {/* Back button */}
            <motion.div variants={itemVariants}>
                <Button
                    variant="ghost"
                    size={isMobile ? 'md' : 'sm'}
                    onClick={onBack}
                    aria-label="Go back to journey selection"
                    className={cn(
                        "tracking-[0.15em] uppercase text-[10px]",
                        isMobile ? "mb-5" : "mb-7"
                    )}
                >
                    ← Back
                </Button>
            </motion.div>

            {/* Country label */}
            <motion.p
                variants={itemVariants}
                className={cn(
                    "tracking-[0.2em] uppercase text-white/40",
                    isMobile ? "text-[11px] mb-2.5" : "text-[10px] mb-3.5"
                )}
            >
                {selectedTrek.country}
            </motion.p>

            {/* Trek info card - consistent on both platforms */}
            <motion.div variants={itemVariants}>
                <Card
                    variant="elevated"
                    className={cn(
                        "mb-5",
                        isMobile ? "p-5" : "p-6"
                    )}
                >
                    <h2 className={cn(
                        "font-medium mb-3 text-white/95",
                        isMobile ? "text-[28px]" : "text-[32px]"
                    )}>
                        {selectedTrek.name}
                    </h2>

                    {/* Summit elevation with icon */}
                    <div className="flex items-center gap-2 text-white/50">
                        <MountainIcon />
                        <span className={cn(
                            isMobile ? "text-sm" : "text-[15px]"
                        )}>
                            Summit: {selectedTrek.elevation}
                        </span>
                    </div>
                </Card>
            </motion.div>

            {/* Explore button */}
            <motion.div variants={itemVariants}>
                <Button
                    variant="default"
                    size={isMobile ? 'lg' : 'md'}
                    onClick={onExplore}
                    aria-label={`Explore ${selectedTrek.name} journey`}
                    className={cn(
                        "tracking-[0.15em]",
                        isMobile && "w-full"
                    )}
                >
                    Explore Journey →
                </Button>
            </motion.div>
        </motion.div>
    );
}
