import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'index.js'),
      name: 'EasyNostrClient',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.cjs'),
    },
    rollupOptions: {
      external: [
        'nostr-tools/pure',
        'nostr-tools/nip04',
        'nostr-tools/pool',
        'nostr-tools/nip19',
        '@noble/hashes/utils',
        'events'
      ],
      output: {
        exports: 'named',
      },
    },
    sourcemap: true,
    target: 'es2019',
    emptyOutDir: true,
  },
});
