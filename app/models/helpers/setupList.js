"use strict";
var _ = require( "underscore" );
var path = require("path");

module.exports = function( list ){
  var builder = {
    _config       : undefined,
    _exposed      : undefined,
    _guarded      : undefined,
    add           : function( config ){
      builder._config = _.filter( _.toArray( arguments ), function( arg ){
        // filter labels out
        return !_.isString( arg );
      } );
      list.add.apply( list, builder._config );
      return builder;
    },
    virtualize    : function( virtuals ){
      var args = _.flatten( _.toArray( arguments ), true );
      _.each( args, function( arg ){
        _.each( arg, function( fn,
                               field ){
          list.schema.virtual( field ).get( fn );
        } );
      } );
      return builder.expose( _.keys( virtuals ) );
    },
    retain        : function( fields ){
      var args = _.flatten( _.toArray( arguments ), true );
      if( builder._guarded ){
        args = builder._guarded.concat( args );
      }
      builder._guarded = args;
      return builder;
    },
    expose        : function( fields ){
      var args = _.flatten( _.toArray( arguments ), true );
      fields = _.reduce( args, function( memo,
                                         arg ){
        if( _.isObject( arg ) ){
          memo = memo.concat( _.isArray( arg )
            ? arg
            : _.keys( arg ) );
        } else {
          memo.push( arg );
        }
        return memo;
      }, [] );
      if( !builder._exposed ){
        builder._exposed = fields;
        if( !list.schema.options.toJSON ){
          list.schema.options.toJSON = {};
        }
        list.schema.options.toJSON.transform = function( doc,
                                                         ret,
                                                         options ){
          _.each( builder._exposed, function( exposed ){
            var parts = exposed.split( "." );
            if( 1 < parts.length ){
              var dr = doc;
              var rr = ret;
              _.times( parts.length - 1, function( i ){
                var part = parts[ i ];
                rr[ part ] = {};
                rr = rr[ part ];
                dr = dr[ part ];
              } );
              var last = parts[ parts.length - 1 ];
              rr[ last ] = dr[ last ];
            } else {
              ret[ exposed ] = doc[ exposed ];
            }
          } );
          _.each( builder._guarded, function( guarded ){
            delete ret[ guarded ];
          } );
        };
      } else {
        builder._exposed = builder._exposed.concat( fields );
      }
      return builder;
    },
    relate        : function( relationships ){
      relationships = _.flatten( _.toArray( relationships ), true );
      _.each( relationships, function( relConfig ){
        list.relationship( relConfig );
      } );
      return builder;
    },
    validate      : function( map ){
      _.each( map, function( mixed,
                             field ){
        if( _.isFunction( mixed ) ){
          mixed = [ mixed ];
        }
        var p = list.schema.path( field );
        p.validate.apply( p, mixed );
      } );
      return builder;
    },
    register      : function(){
      builder.virtualize( {
        type         : function(){
          return list.options.schema.collection;
        },
        "links.self" : function(){
          return path.join(list.options.schema.collection, this._id.toString());
        }
      });
      list.register();
    },
    getFieldNames : function(){
      return _.keys( builder._config );
    }
  };
  return builder.retain( "__v" );
};