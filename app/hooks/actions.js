'use strict';

var _ = require( 'lodash' );
var keystone = require( 'keystone' );
var P = require( 'bluebird' );
var path = require( 'path' );
var exec = P.promisify( require( 'child_process' ).exec );
var moment = require( 'moment' );
var url = require( 'url' );

var comparisonsService = require( '../services/comparisons' );
var representationsService = require( '../services/representations' );
var assessmentsService = require( '../services/assessments' );
var usersService = require( '../services/users' );
var constants = require( '../models/helpers/constants' );

var Representation = keystone.list( 'Representation' );
var Timelog = keystone.list( 'Timelog' );

var dumpCommandTpl = _.template( 'mongodump ' +
  '--host {{host}} ' +
  '--db {{db}} ' +
  "--out '{{out}}' " +
  '--collection {{collection}} ' +
  "--query '{{query}}'", {
  interpolate: /{{([\s\S]+?)}}/g
} );

function deleteAssessmentAssociates( assessmentId ){
  return comparisonsService.list( {
      assessment: assessmentId.toString()
    } )
    .each( function( comparison ){
      return comparison.remove();
    } )
    .then( function( comparisonsList ){
      return _.map( comparisonsList, "id" );
    } )
    .then( function( comparisonIds ){
      return Timelog.model.remove( {
        comparison: {
          $in: comparisonIds
        }
      } );
    } );
}

function resetAssessment( assessmentId ){
  return deleteAssessmentAssociates( assessmentId )
    .then( function(){
      return representationsService.list( {
        assessment: assessmentId
      } );
    } )
    .each( function( representation ){
      representation.compared = [];
      return representation.save();
    } )
    .then( function(){
      return assessmentsService.retrieve( {
        _id: assessmentId.toString()
      } );
    } );
}

function clearAssessment( assessmentId ){
  return deleteAssessmentAssociates( assessmentId )
    .then( function(){
      return representationsService.list( {
        assessment: assessmentId
      } );
    } )
    .each( function( representation ){
      return representation.remove();
    } )
    .then( function(){
      return assessmentsService.retrieve( {
        _id: assessmentId.toString()
      } );
    } );
}

function removeAssessmentFromUser( assessmentId,
                                   user,
                                   fieldName ){
  var index = _.get( user, [ "assessments", fieldName ], [] ).indexOf( assessmentId );
  if( index >= 0 ){
    user.assessments[ fieldName ].splice( index, 1 );
    return true;
  }
  return false;
}

function deleteAssessment( assessmentId ){
  return deleteAssessmentAssociates( assessmentId )
    .then( function(){
      return Representation.model.remove( {
        assessment: assessmentId
      } );
    } )
    .then( function(){
      return usersService.list();
    } )
    .reduce( function( memo,
                       user ){
      var needsSaving = _.reduce( constants.roles.list, function( dirty,
                                                                  role ){
        return removeAssessmentFromUser( assessmentId, user, role.value ) || dirty;
      }, false );
      if( needsSaving ){
        memo.push( user );
      }
      return memo;
    }, [] )
    .each( function( user ){
      return user.save();
    } )
    .then( function(){
      return assessmentsService.remove( {
        _id: assessmentId.toString()
      } );
    } );
}

function archiveAssessment( assessmentId ){
  var uriObj = url.parse( keystone.get( 'mongo' ), false, true );
  var baseArgs = {
    host: uriObj.host,
    db: uriObj.pathname.substring( 1 )
  };
  var assessment;
  var result = '';
  return assessmentsService.retrieve( { _id: assessmentId.toString() } )
    .then( function( doc ){
      assessment = doc;
      baseArgs.out = path.resolve( path.join( constants.directories.archive, doc.name
        + '-' + moment().format( 'YYYYMMDD-HHmmss' ) ) );
    } )
    .then( function(){
      return comparisonsService.list( {
          assessment: assessmentId.toString()
        } )
        .then( function( comparisonsList ){
          return _.map( comparisonsList, "id" );
        } );
    } )
    .map( function( id ){
      return {
        $oid: id
      };
    } )
    .then( function( comparisonIds ){
      var command = dumpCommandTpl( _.defaults( {}, baseArgs, {
        collection: 'timelogs',
        query: JSON.stringify( {
          comparison: { $in: comparisonIds }
        } )
      } ) );

      result += command + '<br/>';
      return exec( command ).spread( function( stdout,
                                               stderr ){
        result += stdout;
      } );
    } )
    .then( function(){
      var command = dumpCommandTpl( _.defaults( {}, baseArgs, {
        collection: 'assessments',
        query: JSON.stringify( {
          _id: { $oid: assessmentId.toString() }
        } )
      } ) );

      result += command + '<br/>';
      return exec( command ).spread( function( stdout,
                                               stderr ){
        result += stdout;
      } );
    } )
    .then( function(){
      var command = dumpCommandTpl( _.defaults( {}, baseArgs, {
        collection: 'representations',
        query: JSON.stringify( {
          assessment: { $oid: assessmentId.toString() }
        } )
      } ) );

      result += command + '<br/>';
      return exec( command ).spread( function( stdout,
                                               stderr ){
        result += stdout;
      } );
    } )
    .then( function(){
      var command = dumpCommandTpl( _.defaults( {}, baseArgs, {
        collection: 'comparisons',
        query: JSON.stringify( {
          assessment: { $oid: assessmentId.toString() }
        } )
      } ) );

      result += command + '<br/>';
      return exec( command ).spread( function( stdout,
                                               stderr ){
        result += stdout;
      } );
    } )
    .then( function(){
      return deleteAssessment( assessmentId );
    } )
    .then( function(){
      return {
        out: result,
        assessment: assessment
      };
    } );
}

function actionCreatedHandler( next ){
  var action = this;

  function failureHandler( err ){
    action.line = "FAILED";
    action.success = false;
    action.log = err;
    next();
  }

  switch( action.actionType ){
    case "reset":
      resetAssessment( action.assessment )
        .then( function( assessment ){
          action.line = "Assessment: " + assessment.name;
          action.log = "Successfully reset";
          action.success = true;
          next();
        } )
        .catch( failureHandler );
      break;
    case "clear":
      clearAssessment( action.assessment )
        .then( function( assessment ){
          action.line = "Assessment: " + assessment.name;
          action.log = "Successfully cleared";
          action.success = true;
          next();
        } )
        .catch( failureHandler );
      break;
    case "delete":
      deleteAssessment( action.assessment )
        .then( function( assessment ){
          action.line = "Assessment: " + assessment.name;
          action.log = "Successfully deleted";
          action.success = true;
          next();
        } )
        .catch( failureHandler );
      break;
    case "archive":
      archiveAssessment( action.assessment )
        .then( function( result ){
          action.line = "Assessment: " + result.assessment.name;
          action.log = result.out;
          action.success = true;
          next();
        } )
        .catch( failureHandler );
      break;
    default:
      next( new Error( "Unhandled action: " + action.actionType ) );
  }
}

module.exports.init = function(){
  keystone.list( 'Action' ).schema.pre( 'save', actionCreatedHandler );
};

