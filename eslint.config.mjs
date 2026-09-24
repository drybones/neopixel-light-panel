// Deliberately small: the recommended set plus the handful of rules that keep
// the server's modernisation (#115) from sliding back. No formatting rules and
// no prettier — a lint that reformats wholesale buries every real diff.

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    {
        ignores: ['**/node_modules/', '**/dist/', 'packages/server/data/'],
    },

    js.configs.recommended,

    {
        rules: {
            // A catch that names its error and ignores it is the house style
            // for "this failure has a fallback", not an oversight.
            'no-unused-vars': ['error', {
                caughtErrors: 'none',
                argsIgnorePattern: '^_',
                // The UI builds with the automatic JSX runtime, so a default
                // `React` import is never needed; the files that still carry
                // one are harmless, and not this lint's business to churn.
                varsIgnorePattern: '^React$',
            }],
            // What keeps the server's modernisation (#115) from sliding back:
            // block scope, no `var self = this` (an arrow keeps `this`), and
            // Object.hasOwn over the prototype dance. `== null` stays legal,
            // since it is the idiomatic null-or-undefined test.
            'no-var': 'error',
            'prefer-const': ['error', { destructuring: 'all' }],
            'prefer-arrow-callback': 'error',
            'prefer-object-has-own': 'error',
            eqeqeq: ['error', 'smart'],
        },
    },

    {
        files: ['packages/server/**/*.js', 'scripts/**/*.js', 'tools/**/*.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: globals.node,
        },
    },

    {
        files: ['packages/ui/**/*.{js,jsx}'],
        languageOptions: {
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: globals.browser,
        },
        plugins: { 'react-hooks': reactHooks },
        rules: {
            // Only the two classic rules. The plugin's newer React Compiler
            // rules police a compiler this project does not use.
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },

    {
        files: ['packages/ui/vite.config.js'],
        languageOptions: { globals: globals.node },
    },
];
