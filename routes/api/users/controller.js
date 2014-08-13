'use strict';
var keystone = require( 'keystone' ),
  async = require( 'async' );
var User = keystone.list( 'User' );

module.exports.retrieve = function( req,
                                    res,
                                    next ){
  User.model.findById( res.locals.user.id, function( err,
                                                     user ){
    if( err || !user ){
      return res.apiError( 404, "Resource not found");
    }
    return res.apiResponse( user.toJSON() );
  } );
};

module.exports.update = function( req,
                                  res,
                                  next ){
  User.model.findOneAndUpdate(
    { _id : res.locals.user.id },
    req.body,
    function( err,
              user ){
      return res.apiResponse( user.toJSON() );
    }
  );
};
