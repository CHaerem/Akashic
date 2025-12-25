/**
 * Comment Input component
 * Textarea with submit button for adding new comments
 */

import { memo, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { colors, radius, glassInput, glassInputFocus, transitions } from '../../styles/liquidGlass';
import { SendIcon } from '../icons';

interface CommentInputProps {
    onSubmit: (content: string) => Promise<void>;
    disabled?: boolean;
    placeholder?: string;
}

const MAX_LENGTH = 2000;

export const CommentInput = memo(function CommentInput({
    onSubmit,
    disabled = false,
    placeholder = 'Add a comment...',
}: CommentInputProps) {
    const [content, setContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const charCount = content.length;
    const isNearLimit = charCount > MAX_LENGTH * 0.9;
    const isOverLimit = charCount > MAX_LENGTH;
    const canSubmit = content.trim().length > 0 && !isOverLimit && !disabled && !isSubmitting;

    const handleSubmit = useCallback(async () => {
        if (!canSubmit) return;

        setIsSubmitting(true);
        try {
            await onSubmit(content.trim());
            setContent('');
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        } catch (error) {
            console.error('Failed to submit comment:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [canSubmit, content, onSubmit]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setContent(e.target.value);
        // Auto-resize textarea
        const textarea = e.target;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }, []);

    if (disabled) {
        return (
            <div
                style={{
                    padding: 12,
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: radius.md,
                    textAlign: 'center',
                }}
            >
                <p style={{ fontSize: 13, color: colors.text.tertiary, margin: 0 }}>
                    Sign in to add comments
                </p>
            </div>
        );
    }

    return (
        <div
            style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
            }}
        >
            <div style={{ flex: 1, position: 'relative' }}>
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={placeholder}
                    disabled={isSubmitting}
                    style={{
                        ...glassInput,
                        ...(isFocused ? glassInputFocus : {}),
                        width: '100%',
                        minHeight: 40,
                        maxHeight: 150,
                        padding: '10px 12px',
                        paddingRight: isNearLimit ? 50 : 12,
                        fontSize: 13,
                        color: colors.text.primary,
                        borderRadius: radius.md,
                        resize: 'none',
                        outline: 'none',
                        overflow: 'hidden',
                        transition: `all ${transitions.normal}`,
                    }}
                />
                {/* Character count */}
                {isNearLimit && (
                    <span
                        style={{
                            position: 'absolute',
                            right: 10,
                            bottom: 10,
                            fontSize: 10,
                            fontWeight: 500,
                            color: isOverLimit ? colors.accent.error : colors.text.subtle,
                        }}
                    >
                        {charCount}/{MAX_LENGTH}
                    </span>
                )}
            </div>

            {/* Submit button */}
            <motion.button
                whileHover={canSubmit ? { scale: 1.05 } : undefined}
                whileTap={canSubmit ? { scale: 0.95 } : undefined}
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: canSubmit
                        ? 'rgba(96, 165, 250, 0.2)'
                        : 'rgba(255, 255, 255, 0.05)',
                    border: 'none',
                    borderRadius: radius.md,
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                    color: canSubmit ? colors.accent.primary : colors.text.disabled,
                    transition: `all ${transitions.normal}`,
                }}
            >
                {isSubmitting ? (
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        style={{
                            width: 16,
                            height: 16,
                            border: `2px solid ${colors.accent.primary}`,
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                        }}
                    />
                ) : (
                    <SendIcon size={18} />
                )}
            </motion.button>
        </div>
    );
});

export default CommentInput;
