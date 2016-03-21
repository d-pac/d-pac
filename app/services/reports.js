"use strict";
var keystone = require( "keystone" );
var _ = require( "lodash" );
var fs = require( "fs" );
var P = require( 'bluebird' );
var moment = require( 'moment' );

var Comparison = keystone.list( "Comparison" );
var Representation = keystone.list( "Representation" );
var assessmentsService = require( './assessments' );
var documentsService = require( './documents' );
var timelogsService = require( './timelogs' );
var phasesService = require( './phases' );
var constants = require( '../models/helpers/constants' );

const phaseConfigsMap = _.reduce( constants.phases, function( memo,
                                                              phaseConfig ){
  memo[ phaseConfig.slug ] = phaseConfig;
  return memo;
}, {} );

var LEFT_EMPTY = "empty";
var UNDEFINED = "N/A";
var TRUE = 1;
var FALSE = 0;
var NIL = -1;

module.exports.listRepresentationsForAssessmentIds = function listRepresentationsForAssessmentIds( assessmentIds ){
  var q = Representation.model
    .find()
    .populate( 'document', 'name' )
    .populate( 'assessment', 'name' );
  if( assessmentIds ){
    if( _.isString( assessmentIds ) ){
      assessmentIds = [ assessmentIds ];
    }
    q = q.where( "assessment" ).in( assessmentIds );
  }
  return q.exec().then( function( result ){
    return result;
  } );
};

function getComparisonsList( assessmentIds ){
  var p = Comparison.model
    .find()
    .populate( "assessor" )
    .deepPopulate( [
      'representations.a.document', 'representations.b.document', 'data.selection.document',
      'data.select-other.document'
    ] );
  if( assessmentIds.length ){
    p = p.where( "assessment" ).in( assessmentIds );
  }
  return p.exec();
}

function getDocument( map,
                      representationModel ){
  return _.get( map, [ _.get( representationModel, 'document', '' ).toString(), 'name' ], UNDEFINED );
}

function createMap( memo,
                    item ){
  var id = item.id.toString();
  memo[ id ] = item;
  return memo;
}

function getPhasesMap(){
  return phasesService
    .list()
    .reduce( createMap, {} );
}

function getAssessmentsMap( assessmentIds ){
  var opts = { state: { $ne: null } };
  var p = (assessmentIds.length)
    ? assessmentsService.listById( assessmentIds, opts )
    : assessmentsService.list( opts );
  return p.reduce( createMap, {} );
}

function getTimelogsMap( comparisonIds,
                         phasesMap ){
  return timelogsService
    .listForComparisonIds( comparisonIds )
    .reduce( function( memo,
                       timelog ){
      var comparisonId = timelog.comparison.toString();
      var phaseId = timelog.phase.toString();
      _.set( memo, [ comparisonId, phaseId ], timelog.duration );
      return memo;
    }, {} );
}

function createComparisonsReportData( phasesMap,
                                      assessmentsMap,
                                      comparisonsList ){
  return function( timelogsMap ){
    return _.map( comparisonsList, function( comparisonModel ){
      var comparisonId = comparisonModel.id.toString();
      var assessmentId = _.get( comparisonModel, 'assessment', '' ).toString();
      var assessment = assessmentsMap[ assessmentId ];
      if( !assessment ){
        assessment = {
          name: assessmentId,
          phases: _.keys( phasesMap ),
          enableTimeLogging: true
        };
      }
      var output = {
        comparison: comparisonModel._rid,
        assessment: assessment.name,
        assessor: _.get( comparisonModel, [ 'assessor', 'email' ], UNDEFINED ),
        "representation A": _.get( comparisonModel, [ 'representations', 'a', 'document', 'name' ] ),
        "representation B": _.get( comparisonModel, [ 'representations', 'b', 'document', 'name' ] ),
        // "selected representation": _.get( comparisonModel, [ 'data', 'selection', 'document', 'name' ] ),
        // "selected representation (other)": _.get( comparisonModel, [ 'data', 'select-other', 'document', 'name' ] ),
        "selected at": (comparisonModel.selectionMadeAt)
          ? moment( comparisonModel.selectionMadeAt ).format( "YYYY/MM/DD HH:mm:ss" )
          : UNDEFINED,
        "completed": (comparisonModel.completed)
          ? TRUE
          : FALSE
      };
      _.forEach( assessment.phases, function( phaseId ){
        const phase = phasesMap[ phaseId.toString() ];
        const phaseConfig = phaseConfigsMap[ phase.slug ];
        const values = phaseConfig.format.reports( comparisonModel );
        output = _.merge( output, values );
        // switch( phase.slug ){
        //   case constants.SEQ_COMPARATIVE:
        //   case constants.SEQ_PASSFAIL:
        //   case constants.SEQ_SELECTION:
        //     output[ phase.label ] = _.get( comparisonModel, [ 'data', phase.slug ], NIL );
        //     break;
        //   case constants.COMPARATIVE:
        //     output[ phase.label ] = _.get( comparisonModel, [
        //       'data', phase.slug
        //     ], '' ).replace( /(?:\r\n|\r|\n)/g, "\u21A9" ).replace( /"/g, "'" );
        //     break;
        //   case constants.PROSCONS:
        //     output[ "A+" ] = _.get( comparisonModel, [
        //       'data', phase.slug, 'aPositive'
        //     ], '' ).replace( /(?:\r\n|\r|\n)/g, "\u21A9" ).replace( /"/g, "'" );
        //     output[ "A-" ] = _.get( comparisonModel, [
        //       'data', phase.slug, 'aNegative'
        //     ], '' ).replace( /(?:\r\n|\r|\n)/g, "\u21A9" ).replace( /"/g, "'" );
        //     output[ "B+" ] = _.get( comparisonModel, [
        //       'data', phase.slug, 'bPositive'
        //     ], '' ).replace( /(?:\r\n|\r|\n)/g, "\u21A9" ).replace( /"/g, "'" );
        //     output[ "B-" ] = _.get( comparisonModel, [
        //       'data', phase.slug, 'bNegative'
        //     ], '' ).replace( /(?:\r\n|\r|\n)/g, "\u21A9" ).replace( /"/g, "'" );
        //     break;
        //   case constants.PASSFAIL:
        //     output[ "A passed" ] = _.get( comparisonModel, [ 'data', phase.slug, 'a' ], UNDEFINED );
        //     output[ "B passed" ] = _.get( comparisonModel, [ 'data', phase.slug, 'b' ], UNDEFINED );
        //     break;
        // }
        if( assessment.enableTimeLogging ){
          output[ phase.label + " duration" ] = _.get( timelogsMap, [ comparisonId, phaseId.toString() ], UNDEFINED );
        }
      } );
      if( assessment.enableTimeLogging ){
        output[ "total duration" ] = _.reduce( timelogsMap[ comparisonId ], function( memo,
                                                                                      value ){
          return memo + value;
        }, 0 );
      }
      return output;
    } );
  };
}

module.exports.listComparisons = function listComparisons( assessmentIds ){
  return P.join(
    getPhasesMap(),
    getAssessmentsMap( assessmentIds ),
    getComparisonsList( assessmentIds ),

    function( phasesMap,
              assessmentsMap,
              comparisonsList ){
      return getTimelogsMap( _.map( comparisonsList, "_id" ), phasesMap )
        .then( createComparisonsReportData( phasesMap, assessmentsMap, comparisonsList ) );
    }
  );
};

module.exports.listRepresentations = function listRepresentations( assessmentIds ){
  return module.exports.listRepresentationsForAssessmentIds( assessmentIds )
    .map( function( representationModel ){
      return {
        assessment: _.get( representationModel, [ 'assessment', 'name' ], '' ),
        name: _.get( representationModel, [ 'document', 'name' ], '' ),
        ability: _.get( representationModel, [ 'ability', 'value' ], UNDEFINED ),
        se: _.get( representationModel, [ 'ability', 'se' ], UNDEFINED ),
        rankType: representationModel.rankType || UNDEFINED
      };
    } );
};
