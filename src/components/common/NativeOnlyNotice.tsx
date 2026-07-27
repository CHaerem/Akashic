/**
 * The note that stands where an edit control used to be.
 *
 * Every mutating web path was a silent no-op (see `lib/nativeOnly.ts` for why), so the
 * controls are gone rather than disabled: a disabled button still says "this is a thing
 * you could do here", and it is not. This says where the thing actually happens.
 *
 * Rendered only for signed-in family members who reached edit mode — a signed-out
 * visitor never sees it, because the showcase never offered them a write.
 */

import { NATIVE_ONLY_MESSAGE } from '../../lib/nativeOnly';
import { LANDING_URL } from '../../lib/branding';
import { cn } from '@/lib/utils';

interface NativeOnlyNoticeProps {
    /**
     * What the user was reaching for, in their words — "Editing this journey",
     * "Adding photos". Rendered as the lead sentence, so write it as a noun phrase.
     */
    what: string;
    className?: string;
}

export function NativeOnlyNotice({ what, className }: NativeOnlyNoticeProps) {
    return (
        <div
            className={cn(
                'p-3 rounded-xl text-sm',
                'bg-blue-500/10 border border-blue-500/20 text-blue-300',
                'light:text-blue-700 light:border-blue-500/30',
                className
            )}
            role="note"
        >
            <p className="m-0">
                <span className="font-medium">{what}</span> is native-only. {NATIVE_ONLY_MESSAGE}
            </p>
            <a
                href={LANDING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block underline underline-offset-2 opacity-80 hover:opacity-100"
            >
                Get Akashic for iPhone
            </a>
        </div>
    );
}
