import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tailwind()],
  publicDir: '../../assets',
  logLevel: 'warn',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        splash: 'splash.html',
        app: 'app.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
        sourcemapFileNames: '[name].js.map',
      },
      onwarn(warning, warn) {
        if (warning.code === 'EVAL') return;
        warn(warning);
      },
    },
  },
});
