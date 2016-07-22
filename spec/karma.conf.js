// Karma configuration
module.exports = function (config) {

  var files = [
    // Test dependencies
    'node_modules/sinon/pkg/sinon.js',
    'node_modules/expect.js/index.js',
    'node_modules/happen/happen.js',
    // Leaflet library
    'node_modules/leaflet/dist/leaflet.js',
    { pattern: 'node_modules/leaflet/dist/images/*.png',
      watched: false,
      included: false,
      served: true },
    // Geocoder plugin
    'dist/leaflet-geocoder-mapzen.js',
    // Helpers
    'spec/helpers.js',
    // Tests
    'spec/suites/**/*.js',
    // Fixtures
    { pattern: 'spec/fixtures/*',
      watched: false,
      included: false,
      served: true },
    // Misc
    { pattern: 'dist/images/*.png',
      watched: false,
      included: false,
      served: true }
  ];

  config.set({
    // base path, that will be used to resolve files and exclude
    basePath: '../',

    plugins: [
      'karma-mocha',
      'karma-coverage',
      'karma-coveralls',
      'karma-phantomjs-launcher',
      'karma-chrome-launcher',
      'karma-safari-launcher',
      'karma-firefox-launcher',
      'karma-spec-reporter',
      'karma-browserstack-launcher'
    ],

    // frameworks to use
    frameworks: ['mocha'],

    // list of files / patterns to load in the browser
    files: files,
    exclude: [],

    // serve fixtures from the same relative paths
    proxies: {
      '/fixtures/': '/base/spec/fixtures/',
      '/images/': '/base/dist/images/'
    },

    // test results reporter to use
    // possible values: 'dots', 'progress', 'junit', 'growl', 'coverage'
    reporters: ['spec', 'coverage', 'coveralls'],

    preprocessors: {
      // source files, that you wanna generate coverage for
      // do not include tests or libraries
      // (these files will be instrumented by Istanbul)
      'dist/*.js': ['coverage']
    },

    coverageReporter: {
      type: 'lcov', // lcov or lcovonly are required for generating lcov.info files
      dir: 'coverage/'
    },

    // web server port
    port: 9876,

    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_WARN,

    // enable / disable colors in the output (reporters and logs)
    colors: true,

    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: false,

    // BrowserStack
    browserStack: {
      username: process.env.BROWSERSTACK_USERNAME,
      accessKey: process.env.BROWSERSTACK_KEY
    },

    // define browsers
    customLaunchers: {
      bs_firefox_mac: {
        base: 'BrowserStack',
        browser: 'firefox',
        browser_version: '21.0',
        os: 'OS X',
        os_version: 'Mountain Lion'
      },
      // bs_ie8: {
      //   base: 'BrowserStack',
      //   browser: 'ie',
      //   browser_version: '8',
      //   os: 'Windows',
      //   os_version: '7'
      // },
      // bs_iphone5: {
      //   base: 'BrowserStack',
      //   device: 'iPhone 5',
      //   os: 'ios',
      //   os_version: '6.0'
      // }
    },

    // Start these browsers, currently available:
    // - Chrome
    // - ChromeCanary
    // - Firefox
    // - Opera
    // - Safari (only Mac)
    // - PhantomJS
    // - IE (only Windows)
    browsers: ['PhantomJS', 'bs_firefox_mac', /*'bs_ie8', 'bs_iphone5'*/],

    // If browser does not capture in given timeout [ms], kill it
    captureTimeout: 5000,

    // Workaround for PhantomJS random DISCONNECTED error
    browserDisconnectTimeout: 10000, // default 2000
    browserDisconnectTolerance: 1, // default 0

    // Continuous Integration mode
    // if true, it capture browsers, run tests and exit
    singleRun: true
  });
};
