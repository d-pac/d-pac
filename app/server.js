// Simulate config options from your production environment by
// customising the .env file in your project's root folder.
var konfy = require( "konfy" );
konfy.load();

// Require keystone
var keystone = require( "keystone" );
keystone.importer( __dirname )( "patches" );

var errors = require( "errors" );

var nodeEnv = process.env.NODE_ENV || "development";

if( "development" === nodeEnv ){
  errors.stacks( true );
}

// Initialise Keystone with your project's configuration.
// See http://keystonejs.com/guide/config for available options
// and documentation.

var pkg = require( "../package.json" );
keystone.init( {

  "name": "d-pac",
  "brand": "d-pac",
  "appversion": pkg.version + " (" + pkg.build + ")",

  "less": "public",
  "static": "public",
  "favicon": "public/favicon.ico",

  "logger": process.env.LOGGER || "dev",

  "views": "templates/views",
  "view engine": "jade",

  "auto update": true,

  "session": true,
  "session store": "connect-mongo",
  "session store options": {
    url: process.env.MONGO_SESSIONS_URI
  },
  "auth": true,
  "user model": "User",
  "cookie secret": process.env.COOKIE_SECRET,
  "api root": "/api",
  mongoose: require( 'mongoose' ),
  'emails': 'templates/emails'
} );

console.log( '------------------------------------------------' );
console.log( 'Environment:', nodeEnv );
console.log( 'Node', process.version, '-', 'Keystone', keystone.version, '-', keystone.get( 'name' ), keystone.get( 'appversion' ) );

// Load your project's Models

keystone.import( "models" );

// Setup common locals for your templates. The following are required for the
// bundled templates and layouts. Any runtime locals (that should be set uniquely
// for each request) should be added to ./routes/middleware.js

keystone.set( "locals", {
  _: require( "lodash" ),
  env: keystone.get( "env" ),
  utils: keystone.utils,
  editable: keystone.content.editable
} );

// Load your project's Routes

keystone.set( "routes", require( "./routes" ) );

// Setup common locals for your emails. The following are required by Keystone's
// default email templates, you may remove them if you're using your own.

// Configure the navigation bar in Keystone's Admin UI

keystone.set( "nav", {
  "content": [
    "pages",
    "posts",
    "post-categories",
    "enquiries"
  ],
  "tool": [
    "phases",
    "assessments",
    "representations",
    "documents",
    "comparisons",
    "organizations",
    "users",
    "notes"
  ],
  "reports": [
    "timelogs",
    {
      label: "comparisons.csv",
      key: "comparisons-report",
      path: "/api/reports/comparisons/csv"
    },
    {
      label: "comparisons.json",
      key: "comparisons-report",
      path: "/api/reports/comparisons/json"
    },
    {
      label: "representations.csv",
      key: "representations-report",
      path: "/api/reports/representations/csv"
    },
    {
      label: "representations.json",
      key: "representations-report",
      path: "/api/reports/representations/json"
    }
  ]
} );

keystone.pre( 'updates', require( './hooks/phases' ) );

// Start Keystone to connect to your database and initialise the web server
keystone.start();
