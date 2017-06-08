const del = require('del');
const gulp = require('gulp');
const gutil = require('gulp-util');
const gulpFilter = require('gulp-filter');
const uglify = require('gulp-uglify');
const svgSprite = require('gulp-svg-sprite');
const webpack = require('webpack');
const i18n = require('./scripts/i18n');
const json = require('./scripts/json');
const pkg = require('./package.json');

const isProd = process.env.NODE_ENV === 'production';
const webpackConfig = require('./scripts/webpack.conf');

const paths = {
  manifest: 'src/manifest.json',
  copy: [
    'src/public/**',
  ],
  locales: [
    'src/_locales/**',
  ],
  templates: [
    'src/**/*.@(js|html|json|yml|vue)',
  ],
};

function webpackCallback(err, stats) {
  if (err) {
    gutil.log('[FATAL]', err);
    return;
  }
  if (stats.hasErrors()) {
    gutil.log('[ERROR] webpack compilation failed\n', stats.toJson().errors.join('\n'));
    return;
  }
  if (stats.hasWarnings()) {
    gutil.log('[WARNING] webpack compilation has warnings\n', stats.toJson().warnings.join('\n'));
  }
  [stats].forEach(stat => {
    const timeCost = (stat.endTime - stat.startTime) / 1000;
    const chunks = Object.keys(stat.compilation.namedChunks).join(' ');
    gutil.log(`Webpack built: [${timeCost.toFixed(3)}s] ${chunks}`);
  });
}

gulp.task('clean', () => del(['dist']));

gulp.task('pack', ['manifest', 'copy-files', 'copy-i18n']);

gulp.task('watch', ['pack', 'js-dev', 'svg'], () => {
  gulp.watch(paths.manifest, ['manifest']);
  gulp.watch(paths.copy, ['copy-files']);
  gulp.watch(paths.locales.concat(paths.templates), ['copy-i18n']);
});

gulp.task('build', ['pack', 'js-prd', 'svg']);

gulp.task('js-dev', () => webpack(webpackConfig).watch({}, webpackCallback));
gulp.task('js-prd', () => webpack(webpackConfig, webpackCallback));

gulp.task('manifest', () => (
  gulp.src(paths.manifest, { base: 'src' })
  .pipe(json(data => {
    data.version = pkg.version.replace(/-[^.]*/, '');
    return data;
  }))
  .pipe(gulp.dest('dist'))
));

gulp.task('copy-files', () => {
  const jsFilter = gulpFilter(['**/*.js'], { restore: true });
  let stream = gulp.src(paths.copy, { base: 'src' });
  if (isProd) stream = stream
  .pipe(jsFilter)
  .pipe(uglify())
  .pipe(jsFilter.restore);
  return stream
  .pipe(gulp.dest('dist/'));
});

gulp.task('copy-i18n', () => (
  gulp.src(paths.templates)
  .pipe(i18n.extract({
    base: 'src',
    prefix: '_locales',
    touchedOnly: true,
    useDefaultLang: true,
    markUntouched: false,
    extension: '.json',
  }))
  .pipe(gulp.dest('dist'))
));

gulp.task('svg', () => (
  gulp.src('icons/*.svg')
  .pipe(svgSprite({
    mode: {
      symbol: {
        dest: '',
        sprite: 'sprite.svg',
      },
    },
  }))
  .pipe(gulp.dest('dist/public'))
));

/**
 * Load locale files (src/_locales/<lang>/message.[json|yml]), and
 * update them with keys in template files, then store in `message.yml`.
 */
gulp.task('i18n', () => (
  gulp.src(paths.templates)
  .pipe(i18n.extract({
    base: 'src',
    prefix: '_locales',
    touchedOnly: false,
    useDefaultLang: false,
    markUntouched: true,
    extension: '.yml',
  }))
  .pipe(gulp.dest('src'))
));
