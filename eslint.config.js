import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output only. `**/*.ts` and `**/*.tsx` used to be ignored here too, on the theory that
  // "tsc handles TypeScript" — which meant `eslint .` inspected ~20 JavaScript files and zero of
  // the 144 .ts/.tsx files under src/ (both counts measured). tsc checks types; it does not catch
  // unused vars, bad hook deps, or `any` creep. With TS included the run covers 171 files.
  // e2e/ is Playwright's and has its own tsconfig, so it stays out of the type-aware program.
  globalIgnores(['dist', 'e2e', 'dev-dist', 'coverage']),
  // Node.js scripts
  {
    files: ['scripts/**/*.{js,mjs}', 'vite.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      // 2022, not 2020: these are Node ESM build scripts and several use top-level await
      // (scripts/generateOgImage.js, the app-icon generate.mjs it mirrors). Under 2020 that is
      // a hard parse error, which silently skips the whole file rather than linting it.
      ecmaVersion: 2022,
      globals: { ...globals.node },
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
  // React/Browser JavaScript (JSX)
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // TypeScript / TSX — the code that actually ships the showcase.
  {
    files: ['src/**/*.{ts,tsx}', 'workers/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // The base rule cannot see TS type-only declarations and double-reports; the TS rule is
      // authoritative. Underscore prefix is the codebase's existing "intentionally unused"
      // convention (see `_photo` in JourneyTimeline).
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Measured: only 2 sites in the whole tree, both fixed. Keep it an error so it stays that way.
      '@typescript-eslint/no-explicit-any': 'error',

      // `react-refresh/only-export-components` guards the *dev server*: a module exporting both a
      // component and something else falls back to a full reload instead of Fast Refresh. It is a
      // DX cost, not a shipping defect, and the patterns it flags here are the deliberate ones —
      // cva variant objects colocated with their primitive (the shadcn/ui convention), a context
      // provider colocated with its consumer hooks (React's own documented pattern), and two
      // shared layout constant tables. Named allowances rather than switching the rule off, so a
      // *new* stray export still fails.
      'react-refresh/only-export-components': ['error', {
        allowConstantExport: true,
        allowExportNames: [
          'buttonVariants', 'cardVariants',                            // src/components/ui — cva
          'SNAP_POINTS', 'QuickActionIcons',                           // src/components/layout
          'useJourneys', 'useTrekDataById', 'useTrekConfigById',       // src/contexts
          'useTheme',                                                  // src/contexts
        ],
      }],

      // The three rules below arrived as errors when eslint-plugin-react-hooks went to v7, which
      // folded the React Compiler readiness checks into `recommended`. Akashic's web client does
      // not run the React Compiler, and the 16 findings are concentrated in useMapbox.ts (1.8k
      // lines) and DayGallery: almost all are "callback references a const declared later in the
      // component body", which works today and is fixed only by reordering large blocks. The web
      // client is frozen as a showcase view (decision recorded 2026-07-26), so that reordering
      // buys readiness for a compiler we do not use, at real regression risk in code nobody is
      // otherwise touching. Warn, so they are counted and visible, rather than gate on them.
      // Revisit if the freeze lifts or React Compiler is adopted.
      //
      // `react-hooks/rules-of-hooks` and `react-hooks/refs` deliberately stay errors: both were
      // already clean (refs had one finding, in useDragGesture, and it is fixed).
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  // NOTE: there is deliberately no relaxed override block for *.test.ts(x). The obvious one to
  // write is `no-explicit-any: off` for mocks — but the tree has zero `any` in any test file
  // today, and removing the block entirely still gives 0 errors. A pre-emptive exemption for a
  // problem that does not exist only creates somewhere for one to hide later.
])
