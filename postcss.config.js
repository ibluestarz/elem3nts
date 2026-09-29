import autoprefixer from 'autoprefixer';

/**
 * Autoprefixer lit la configuration Browserslist de package.json.
 * @type {{ plugins: import('postcss').Plugin[] }}
 */
export default {
  plugins: [autoprefixer()],
};
