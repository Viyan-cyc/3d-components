import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      entryRoot: 'src',
      outDir: ['dist/es', 'dist/cjs'],
      tsconfigPath: './tsconfig.json',
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        core: resolve(__dirname, 'src/core/index.ts'),
        heat: resolve(__dirname, 'src/heat/index.ts'),
        material: resolve(__dirname, 'src/material/index.ts'),
        utils: resolve(__dirname, 'src/utils/index.ts'),
        helper: resolve(__dirname, 'src/helper/index.ts'),
        graph: resolve(__dirname, 'src/graph/index.ts'),
      },
    },
    rollupOptions: {
      external: ['three', 'gsap', 'three-bvh-csg', 'three-mesh-bvh'],
      output: [
        {
          format: 'es',
          dir: 'dist/es',
          entryFileNames: '[name].js',
          chunkFileNames: 'shared/[name]-[hash].js',
          globals: { three: 'THREE', gsap: 'gsap', 'three-bvh-csg': 'three-bvh-csg', 'three-mesh-bvh': 'three-mesh-bvh' },
        },
        {
          format: 'cjs',
          dir: 'dist/cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'shared/[name]-[hash].cjs',
          globals: { three: 'THREE', gsap: 'gsap', 'three-bvh-csg': 'three-bvh-csg', 'three-mesh-bvh': 'three-mesh-bvh' },
          exports: 'named',
        },
      ],
    },
    sourcemap: true,
    minify: false,
  },
});
