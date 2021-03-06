'use strict';

const _ = require( 'lodash' );
const keystone = require( 'keystone' );
const P = require( 'bluebird' );
const path = require( 'path' );
const exec = P.promisify( require( 'child_process' ).exec );
const moment = require( 'moment' );
const url = require( 'url' );

const comparisonsService = require( '../services/comparisons' );
const representationsService = require( '../services/representations' );
const assessmentsService = require( '../services/assessments' );
const constants = require( '../models/helpers/constants' );

const Representation = keystone.list( 'Representation' );

const dumpCommandTpl = _.template( 'mongodump ' +
  '--host {{host}} ' +
  '--db {{db}} ' +
  "--out '{{out}}' " +
  '--collection {{collection}} ' +
  "--query '{{query}}'", {
  interpolate: /{{([\s\S]+?)}}/g
} );

module.exports.deleteComparisons = function deleteComparisons(assessment ){
  return comparisonsService.list( {
      assessment: assessment.id
    } )
    .mapSeries( function( comparison ){
      return comparison.remove();
    } );
};

module.exports.resetAssessment = function resetAssessment( assessment ){
  return module.exports.deleteComparisons( assessment )
    .then( function(){
      return representationsService.list( {
        assessment: assessment.id
      } );
    } )
    .mapSeries( function( representation ){
      representation.reset();
      return representation.save();
    } )
    .then( function(){
      assessment.reset();
      return assessment.save();
    } );
};

module.exports.clearAssessment = function clearAssessment( assessment ){
  return module.exports.deleteComparisons( assessment.id )
    .then( function(){
      return representationsService.list( {
        assessment: assessment.id
      } );
    } )
    .mapSeries( function( representation ){
      return representation.remove();
    } )
    .then( function(){
      assessment.reset();
      return assessment.save();
    } );

};

module.exports.prepAssessmentForDeletion= function prepAssessmentForDeletion(assessment){
  return module.exports.deleteComparisons( assessment )
    .then( function(){
      return Representation.model.remove( {
        assessment: assessment.id
      } );
    } );
};

module.exports.deleteAssessment = function deleteAssessment( assessment ){
  return module.exports.prepAssessmentForDeletion(assessment)
    .then( function(){
      return assessmentsService.remove( {
        _id: assessment.id
      } );
    } );
};

module.exports.archiveAssessment = function archiveAssessment( assessment ){
  const uriObj = url.parse( keystone.get( 'mongo' ), false, true );
  const baseArgs = {
    host: uriObj.host,
    db: uriObj.pathname.substring( 1 ),
    out: path.resolve( path.join( constants.directories.archive, assessment.name
      + '-' + moment().format( 'YYYYMMDD-HHmmss' ) ) )
  };
  let result = '';
  return comparisonsService.list( {
      assessment: assessment.id
    } )
    .then( function( comparisonsList ){
      return _.map( comparisonsList, "id" );
    } )
    .map( function( id ){
      return {
        $oid: id
      };
    } )
    .then( function( comparisonIds ){
      const command = dumpCommandTpl( _.defaults( {}, baseArgs, {
        collection: 'timelogs',
        query: JSON.stringify( {
          comparison: { $in: comparisonIds }
        } )
      } ) );

      result += command + '<br/>';
      return exec( command ).spread( function( stdout/*,
                                               stderr*/ ){
        result += stdout;
      } );
    } )
    .then( function(){
      const command = dumpCommandTpl( _.defaults( {}, baseArgs, {
        collection: 'assessments',
        query: JSON.stringify( {
          _id: { $oid: assessment.id }
        } )
      } ) );

      result += command + '<br/>';
      return exec( command ).spread( function( stdout/*,
                                               stderr*/ ){
        result += stdout;
      } );
    } )
    .then( function(){
      const command = dumpCommandTpl( _.defaults( {}, baseArgs, {
        collection: 'representations',
        query: JSON.stringify( {
          assessment: { $oid: assessment.id }
        } )
      } ) );

      result += command + '<br/>';
      return exec( command ).spread( function( stdout/*,
                                               stderr*/ ){
        result += stdout;
      } );
    } )
    .then( function(){
      const command = dumpCommandTpl( _.defaults( {}, baseArgs, {
        collection: 'comparisons',
        query: JSON.stringify( {
          assessment: { $oid: assessment.id }
        } )
      } ) );

      result += command + '<br/>';
      return exec( command ).spread( function( stdout/*,
                                               stderr*/ ){
        result += stdout;
      } );
    } )
    .then( function(){
      return module.exports.deleteAssessment( assessment );
    } )
    .then( function(){
      return {
        out: result,
        assessment: assessment
      };
    } );
};
