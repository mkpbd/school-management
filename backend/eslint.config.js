import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/shared/infrastructure/db/schema/**', '*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['error'] }],
      // raw SQL strings must go through drizzle's `sql` template (parameterised); sql.raw only in reviewed places
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
          message: 'sql.raw() bypasses parameterisation. Use sql`...` with interpolated values.',
        },
      ],
    },
  },
  {
    files: ['scripts/**', 'test/**'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
);
