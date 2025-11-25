import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard } from './StatCard';

describe('StatCard', () => {
    it('renders label and value', () => {
        render(<StatCard label="Distance" value="10 km" />);
        expect(screen.getByText('Distance')).toBeInTheDocument();
        expect(screen.getByText('10 km')).toBeInTheDocument();
    });

    it('applies custom color', () => {
        render(<StatCard label="Ascent" value="+1000m" color="#4ade80" />);
        const valueElement = screen.getByText('+1000m');
        expect(valueElement).toHaveStyle({ color: '#4ade80' });
    });
});
