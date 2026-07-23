export default [
  { ignores: ['dist/**', 'dist-v*/**', 'node_modules/**', 'src/**/*.ts', 'tests/**/*.ts'] },
  { files: ['**/*.js'], rules: { 'no-console': 'warn', 'no-unused-vars': 'off' } },
];
