'use strict';
var _ = require( 'underscore' );
var keystone = require( 'keystone' ),
  async = require( 'async' );
var errors = require( 'errors' );
var debug = require( 'debug' )( 'dpac:api.users' );
var apiUtils = require( './utils' );
var User = keystone.list( 'User' );

//TODO: refactor to service AND review how editable fields are enforced

module.exports.list = function( req,
                                res,
                                next ){
  debug( 'list' );
  User.model.find().exec( function( err,
                                    users ){
    if( err ){
      return next( err );
    }
    if( !users ){
      return next( new errors.Http404Error() );
    }
    var results = {};
    users.forEach( function( user ){
      results[user.id] = user;
    } );
    res.apiResponse( users );
  } );
};

module.exports.retrieve = function( req,
                                    res,
                                    next ){
  debug( 'retrieve' );
  User.model.findById( req.user.id ).exec( function( err,
                                                     user ){
    if( err ){
      return next( err );
    }
    if( !user ){
      return next( new errors.Http404Error() );
    }
    return res.apiResponse( user );
  } );
};

var update = module.exports.update = function( req,
                                               res,
                                               next ){
  debug( 'update' );
  //don't use findByIdAndUpdate, since the schema pre save handler isn't called
  //i.e. passwords would be saved in plain text!!
  User.model.findById( req.user.id ).exec( function( err,
                                                     user ){
    if( err ){
      return next( err );
    }
    if( !user ){
      return res.apiError( new errors.Http404Error() );
    }

    user.getUpdateHandler( req, res ).process( req.body, {
      fields      : _.keys( _.pick( req.body, User.api.editable ) ),
      flashErrors : false
    }, function( err,
                 processor ){
      if( err ){
        return next( err );
      }
      var user = processor.item;
      if( !user ){
        return next( new errors.Http500Error() );
      }
      return res.apiResponse( user );
    } );
  } );
};

module.exports.replace = function( req,
                                   res,
                                   next ){
  debug( 'replace' );
  return update( req, res, next );
};
