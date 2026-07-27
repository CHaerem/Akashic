/**
 * The starfield behind the globe. (MAP-02)
 *
 * ## Why this is a copy rather than an extraction
 *
 * `src/components/MapboxGlobe.tsx` holds an identical `generateStarfield`. Lifting it into a shared
 * module would be the tidier move and is deliberately not done: MAP-05 deletes the Mapbox adapter
 * outright, so extracting now means editing a file that is about to be removed, and MAP-02's brief says
 * not to touch it. **Removal condition: when MAP-05 deletes `MapboxGlobe.tsx`, this becomes the only
 * copy and the duplication is gone.** If MAP-05 is ever abandoned, extract instead.
 *
 * ## Why CSS and not canvas
 *
 * The e2e suite permits exactly ONE `<canvas>` in the tree — `expect(page.locator('canvas'))
 * .toBeVisible()` and `.boundingBox()` both throw a Playwright strict-mode violation on two matches
 * (`e2e/app.spec.ts:29-30`, `e2e/mobile.spec.ts:58-64`). So stars cannot have their own canvas, and
 * drawing them into the globe's canvas would mean repainting ~330 gradients every frame for a layer
 * that never moves. As a static CSS background they cost nothing per frame and they are half of what
 * the committed screenshots look like.
 *
 * Positions are seeded so the layout is identical on every load, which is what makes the screenshot
 * baselines stable.
 */

export function generateStarfield(isMobile: boolean): string {
    const stars: string[] = [];

    const seededRandom = (seed: number) => {
        const x = Math.sin(seed * 9999) * 10000;
        return x - Math.floor(x);
    };

    // Fewer stars on mobile: the same visual density over a much smaller viewport.
    const dimCount = isMobile ? 80 : 200;
    const mediumCount = isMobile ? 35 : 80;
    const brightCount = isMobile ? 15 : 30;
    const veryBrightCount = isMobile ? 8 : 12;

    // Dim background stars (magnitude 5-6, barely visible)
    for (let i = 0; i < dimCount; i++) {
        const x = seededRandom(i * 1.1) * 100;
        const y = seededRandom(i * 2.2) * 100;
        const opacity = 0.15 + seededRandom(i * 3.3) * 0.15;
        stars.push(
            `radial-gradient(0.5px 0.5px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(255,255,255,${opacity.toFixed(2)}), transparent)`,
        );
    }

    // Medium stars (magnitude 3-4)
    for (let i = 0; i < mediumCount; i++) {
        const x = seededRandom(i * 4.4 + 100) * 100;
        const y = seededRandom(i * 5.5 + 100) * 100;
        const opacity = 0.3 + seededRandom(i * 6.6) * 0.3;
        stars.push(
            `radial-gradient(1px 1px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(255,255,255,${opacity.toFixed(2)}), transparent)`,
        );
    }

    // Brighter stars (magnitude 2-3), with slight colour variation
    for (let i = 0; i < brightCount; i++) {
        const x = seededRandom(i * 7.7 + 200) * 100;
        const y = seededRandom(i * 8.8 + 200) * 100;
        const opacity = 0.6 + seededRandom(i * 9.9) * 0.3;
        const colorVar = seededRandom(i * 10.1);
        let color = '255,255,255';
        if (colorVar < 0.2) color = '200,220,255';
        else if (colorVar > 0.8) color = '255,250,230';
        stars.push(
            `radial-gradient(1.5px 1.5px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(${color},${opacity.toFixed(2)}), transparent)`,
        );
    }

    // Bright stars (magnitude 1-2) - fewer, larger
    for (let i = 0; i < veryBrightCount; i++) {
        const x = seededRandom(i * 11.1 + 300) * 100;
        const y = seededRandom(i * 12.2 + 300) * 100;
        const colorVar = seededRandom(i * 13.3);
        let color = '255,255,255';
        if (colorVar < 0.25) color = '180,200,255';
        else if (colorVar > 0.75) color = '255,220,180';
        stars.push(
            `radial-gradient(2px 2px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(${color},0.9), transparent)`,
        );
    }

    // A few hand-placed prominent stars
    const prominentStars = [
        { x: 23, y: 15, color: '180,200,255' },
        { x: 67, y: 42, color: '255,255,255' },
        { x: 82, y: 78, color: '255,210,170' },
        { x: 12, y: 65, color: '255,255,240' },
        { x: 91, y: 23, color: '200,220,255' },
    ];

    prominentStars.forEach(star => {
        stars.push(
            `radial-gradient(2.5px 2.5px at ${star.x}% ${star.y}%, rgba(${star.color},1), rgba(${star.color},0.3) 50%, transparent)`,
        );
    });

    return stars.join(',\n        ');
}

/** The deep-space background the stars sit on, matching the incumbent's `rgb(11, 11, 25)`. */
export const SPACE_BACKGROUND = 'rgb(11, 11, 25)';
