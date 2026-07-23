import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        'service-worker': 'src/background/service-worker.ts',
        sidepanel: 'src/sidepanel/sidepanel.html',
      },
      output: { entryFileNames: '[name].js', assetFileNames: '[name][extname]' },
    },
  },
  publicDir: 'public',
});
