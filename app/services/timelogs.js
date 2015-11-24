"use strict";

var debug = require( "debug" )( "dpac:services.timelogs" );
var keystone = require( "keystone" );
var schema = keystone.list( "Timelog" );
var _ = require( 'lodash' );

var Service = require( "./helpers/Service" );
var base = new Service( schema );
module.exports = base.mixin();

module.exports.list = function list( opts ){
  debug( "list" );
  return base.list( opts )
    .sort( "comparison begin" )
    .execAsync();
};

module.exports.listForComparisonIds = function listForComparisonIds( comparisonIds,
                                                                     opts ){
  if( comparisonIds && _.isString( comparisonIds ) ){
    comparisonIds = [ comparisonIds ];
  }
  return base.list( opts )
    .where( "comparison" ).in( comparisonIds )
    .execAsync();
};

module.exports.retrieveFinalForComparisons = function( phaseId, comparisonIds){
  return base.list( {
      phase: phaseId
    } )
    .where("comparison").in(comparisonIds)
    .sort( "-end" )
    .execAsync()
    .then( function( timelogs ){
      if( timelogs && timelogs.length ){
        return _.chain(timelogs)
          .groupBy("comparison")
          .reduce(function(memo, timelogs, id){
            memo[id] = timelogs[0];
            return memo;
          }, {})
          .value();
      }
      return {};
    } );
};
