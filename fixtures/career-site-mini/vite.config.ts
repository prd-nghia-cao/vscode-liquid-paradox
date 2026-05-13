import { pageDiscoveryPlugin } from './fake-plugins';

export default {
  plugins: [
    pageDiscoveryPlugin({
      pagesDir: 'src/pages',
      layoutsDir: 'src/layouts',
      partialsDir: 'src/partials',
      componentsDir: 'src/components',
    }),
  ],
};
