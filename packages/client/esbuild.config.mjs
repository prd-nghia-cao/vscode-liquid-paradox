import { build } from 'esbuild';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV === 'development';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  minify: !dev,
  sourcemap: dev,
  logLevel: 'info',
});

const serverBundle = resolve(__dirname, '../server/dist/server.cjs');
try {
  await stat(serverBundle);
} catch {
  throw new Error(
    `Server bundle not found at ${serverBundle}. Run "pnpm --filter @vscode-liquid-paradox/server build" first.`,
  );
}

await mkdir(resolve(__dirname, 'dist'), { recursive: true });
await copyFile(serverBundle, resolve(__dirname, 'dist/server.cjs'));
console.log('[client] copied server bundle -> dist/server.cjs');

const serverMap = `${serverBundle}.map`;
try {
  await stat(serverMap);
  await copyFile(serverMap, resolve(__dirname, 'dist/server.cjs.map'));
  console.log('[client] copied server sourcemap -> dist/server.cjs.map');
} catch {
  // no sourcemap in production builds
}
