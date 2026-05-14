import { build } from 'esbuild';

const dev = process.env.NODE_ENV === 'development';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/server.cjs',
  external: [],
  minify: !dev,
  sourcemap: dev,
  logLevel: 'info',
});
