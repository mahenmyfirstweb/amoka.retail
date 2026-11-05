import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // host: true lets phones/tablets on the same Wi-Fi open the dev server
  server: { port: 5174, host: true },
});
