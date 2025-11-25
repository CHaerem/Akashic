import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TabButton } from './TabButton';

describe('TabButton', () => {
    it('renders correctly', () => {
        render(<TabButton tab="overview" activeTab="journey" onClick={() => {}} />);
        expect(screen.getByText('overview')).toBeInTheDocument();
    });

    it('calls onClick when clicked', () => {
        const handleClick = vi.fn();
        render(<TabButton tab="overview" activeTab="journey" onClick={handleClick} />);
        
        fireEvent.click(screen.getByText('overview'));
        expect(handleClick).toHaveBeenCalledWith('overview');
    });

    it('shows active state styling', () => {
        render(<TabButton tab="overview" activeTab="overview" onClick={() => {}} />);
        const button = screen.getByText('overview');
        expect(button).toHaveStyle({ borderBottom: '2px solid rgba(255,255,255,0.6)' });
    });
});
