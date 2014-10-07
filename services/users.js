'use strict';

var _ = require( 'underscore' );
var keystone = require( 'keystone' );
var errors = require( 'errors' );
var debug = require( 'debug' )( 'dpac:services.users' );
var extend = require('deep-extend');

var Promise = require( 'mpromise' );

var User = keystone.list( 'User' );

/**
 *
 * @param opts
 * @param opts._id User.id
 * @returns {Promise}
 */
module.exports.retrieve = function retrieve( opts ){
  debug( '#retrieve' );
  return User.model
    .findById( opts._id )
    .lean()
    .exec();
};

/**
 *
 * @param opts
 * @param {string} opts._id User.id
 * @param {function} validator
 */
var update = module.exports.update = function update( opts ){
  debug( 'update' );
  return User.model
    .findById( opts._id )
    .exec()
    .then( function( item ){
      extend( item, opts );
      var promise = new Promise();
      item.save( function( err,
                           comparison ){
        if( err ){
          return promise.reject( err );
        }
        promise.fulfill( comparison );
      } );
      return promise;
    } );
};