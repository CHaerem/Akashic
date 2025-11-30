import { memo } from 'react';
import { colors, radius, typography } from '../../styles/liquidGlass';

interface StatCardProps {
    label: string;
    value: string;
    sublabel?: string;
    color?: string;
    size?: 'sm' | 'md' | 'lg';
}

const sizeConfig = {
    sm: { padding: 12, valueSize: 14, labelSize: 9 },
    md: { padding: 16, valueSize: 16, labelSize: 10 },
    lg: { padding: 20, valueSize: 20, labelSize: 11 },
};

export const StatCard = memo(function StatCard({
    label,
    value,
    sublabel,
    color = colors.text.primary,
    size = 'md'
}: StatCardProps) {
    const config = sizeConfig[size];

    return (
        <div style={{
            background: `linear-gradient(
                135deg,
                rgba(255, 255, 255, 0.06) 0%,
                rgba(255, 255, 255, 0.02) 100%
            )`,
            backdropFilter: 'blur(12px) saturate(150%)',
            WebkitBackdropFilter: 'blur(12px) saturate(150%)',
            border: `1px solid ${colors.glass.borderSubtle}`,
            boxShadow: `
                0 4px 12px rgba(0, 0, 0, 0.15),
                inset 0 1px 0 rgba(255, 255, 255, 0.08)
            `,
            padding: config.padding,
            borderRadius: radius.md,
            transition: 'all 0.25s ease-out',
        }}>
            <p style={{
                ...typography.label,
                fontSize: config.labelSize,
                color: colors.text.subtle,
                marginBottom: 6,
            }}>
                {label}
            </p>
            <p style={{
                ...typography.heading,
                fontSize: config.valueSize,
                color,
                margin: 0,
            }}>
                {value}
            </p>
            {sublabel && (
                <p style={{
                    fontSize: config.labelSize - 1,
                    color: colors.text.subtle,
                    marginTop: 4,
                    opacity: 0.7,
                }}>
                    {sublabel}
                </p>
            )}
        </div>
    );
});
