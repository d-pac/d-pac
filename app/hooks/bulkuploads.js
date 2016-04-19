'use strict';

var keystone = require( 'keystone' );
var _ = require( 'lodash' );
var P = require( 'bluebird' );
var unzip = P.promisify( require( 'extract-zip' ) );
var rimraf = P.promisify( require( 'rimraf' ) );
var fs = P.promisifyAll( require( 'fs' ) );
var dirops = P.promisifyAll( require( 'node-dir' ) );
var path = require( 'path' );
var mime = require( 'mime' );
var uuid = require( 'uuid' );
const crypto = require( 'crypto' );

const convertersService = require( '../services/converters' );
var assessmentsService = require( '../services/assessments' );
var documentsService = require( '../services/documents' );
const usersService = require( '../services/users' );
var Document = keystone.list( 'Document' );
var Representation = keystone.list( 'Representation' );
var constants = require( '../models/helpers/constants' );
const handleHook = require( './helpers/handleHook' );

var ignored = [ '.DS_Store' ];

function extractZipfile( opts ){
  return unzip( opts.file, {
    dir: opts.temp
  } )
    .catch( function( err ){
      console.error( 'ERROR:', err );
    } )
}

function retrieveJSONData( opts ){
  if( opts.json ){
    return _.reduce( require( opts.json ), function( memo,
                                                     item ){
      memo[ item.fileName ] = item;
      return memo;
    }, {} );
  }

  return false;
}

function updateDocument( document,
                         fileData,
                         opts ){
  document.title = path.basename( fileData.filename, path.extname( fileData.filename ) );
  document.file = {
    filename: fileData.filename,
    originalname: fileData.originalname || fileData.filename,
    path: opts.dest,
    size: fileData.stats.size,
    filetype: mime.lookup( fileData.filename )
  };
  document.host = 'local';
  return document;
}

function readDirectoryContents( opts ){
  return dirops.filesAsync( opts.temp )
    .then( function( files ){
      return files.filter( function( file ){
        return ignored.indexOf( file ) < 0;
      } );
    } );
}

function createFileData( filepath,
                         dir ){
  var fileData = {};
  fileData.filename = path.basename( filepath );
  fileData.resolved = (dir)
    ? path.join( dir, fileData.filename )
    : filepath;
  try{
    fileData.stats = fs.statSync( fileData.resolved );
  } catch( err ) {
    //file doesn't exist
    fileData.stats = {
      isFile: function(){
        return false;
      }
    };
  }
  return fileData;
}

function moveFile( src,
                   dest ){
  return fs.renameAsync( src.resolved, dest.resolved );
}

function createRepresentation( document,
                               assessment ){
  return new Representation.model( {
    document: document.id.toString(),
    assessment: assessment.id.toString()
  } );
}

function findDocuments( fileData ){
  return documentsService.list( {
    'file.filename': fileData.filename
  } );
}

function removeFile( fileData ){
  return fs.unlinkAsync( fileData.resolved );
}

function reuseStrategy( files,
                        assessment,
                        opts ){
  files.src.originalname = files.src.filename;
  return findDocuments( files.dest )
    .then( function( documents ){
      var document = (documents && documents.length)
        ? documents[ 0 ]
        : new Document.model();
      document = updateDocument( document, files.src, opts );
      return {
        document: document,
        representation: createRepresentation( document, assessment )
      };
    } );
}

function overwriteStrategy( files,
                            assessment,
                            opts ){
  files.dest.stats = files.src.stats;
  files.dest.originalname = files.src.filename;
  return P.join(
    findDocuments( files.dest ),
    removeFile( files.dest )
      .then( function(){
        return moveFile( files.src, files.dest );
      } ),
    function( documents ){
      var document = (documents && documents.length)
        ? documents[ 0 ]
        : new Document.model();
      document = updateDocument( document, files.dest, opts );
      return {
        document: document,
        representation: createRepresentation( document, assessment )
      };
    }
  );
}

function createStrategy( files,
                         assessment,
                         opts ){
  files.src.originalname = files.src.filename;
  return moveFile( files.src, files.dest )
    .then( function(){
      var document = updateDocument( new Document.model(), files.src, opts );
      return {
        document: document,
        representation: createRepresentation( document, assessment )
      };
    } );
}

function renameStrategy( files,
                         jsonData,
                         assessment,
                         opts ){
  files.dest = createFileData( uuid.v4() + path.extname( files.src.filename ), constants.directories.documents );
  files.dest.originalname = files.src.filename;
  files.dest.stats = files.src.stats;
  return moveFile( files.src, files.dest )
    .then( function(){
      var document = updateDocument( new Document.model(), files.dest, opts );
      return {
        document: document,
        representation: createRepresentation( document, assessment, jsonData[ files.dest.originalname ] )
      };
    } );
}

var strategies = {
  create: createStrategy
};
strategies[ constants.RENAME ] = renameStrategy;
strategies[ constants.REUSE ] = reuseStrategy;
strategies[ constants.OVERWRITE ] = overwriteStrategy;

/*
 conflict resolution:
 overwrite: reuse document and overwrite the file
 reuse: reuse the document discard new file
 rename: create a new document and rename the file
 */

function processFiles( bulkupload,
                       jsonData,
                       assessment,
                       opts ){
  return readDirectoryContents( opts )
    .reduce( function( memo,
                       filepath ){
      var files = {
        src: createFileData( filepath )
      };
      if( !files.src.stats.isFile() ){
        return memo;
      }
      files.dest = createFileData( filepath, opts.dest );
      var strategy = ( files.dest.stats.isFile() )
        ? strategies[ bulkupload.conflicts ]
        : strategies.create;

      return new P( function( resolve,
                              reject ){
        strategy( files, assessment, opts )
          .then( function( result ){
            var id = result.document.file.originalname;
            memo.documents[ id ] = result.document;
            memo.representations[ id ] = result.representation;
            resolve( memo );
          } );
      } );
    }, {
      documents: {},
      representations: {}
    } )
    .then( function( mapByFilename ){
      if( jsonData ){
        _.forEach( jsonData, function( item ){
          var representation = mapByFilename.representations[ item.fileName ];
          if( item.closeTo ){
            representation.closeTo = mapByFilename.representations[ item.closeTo ].id;
          }
          representation.ability.value = Number( item.ability.value );
          representation.ability.se = Number( item.ability.se );
          representation.rankType = item.rankType;
        } );
      }
      return _.values( mapByFilename.documents ).concat( _.values( mapByFilename.representations ) );
    } )
    .each( function( doc ){
      return doc.save();
    } );
}

function cleanup( bulkupload,
                  opts ){
  return removeFile( { resolved: opts.file } )
    .then( function(){
      if( opts.json ){
        return removeFile( { resolved: opts.json } );
      }
    } )
    .then( function(){
      return rimraf( opts.temp );
    } )
    .then( function(){
      bulkupload.completed = true;
    } );
}

function handleRepresentations( bulkupload ){
  if( !bulkupload.zipfile || !bulkupload.zipfile.filename ){
    return P.reject( new Error( 'Zipfile is required!' ) );
  }

  var opts = {
    dest: constants.directories.documents,
    temp: path.join( constants.directories.bulk, bulkupload._rid.toString() ),
    file: path.join( constants.directories.bulk, _.get( bulkupload, [ 'zipfile', 'filename' ] ) ),
    json: false
  };

  var jsonfile = _.get( bulkupload, [ 'jsonfile', 'filename' ], false );
  if( jsonfile ){
    opts.json = path.resolve( path.join( constants.directories.bulk, jsonfile ) );
  }

  //TODO: handle multiple assessments

  return P.join(
    extractZipfile( opts ),
    retrieveJSONData( opts ),
    assessmentsService.retrieve( {
      _id: bulkupload.assessment.toString()
    } ), function( nothingreturned,
                   jsonData,
                   assessment ){
      return processFiles( bulkupload, jsonData, assessment, opts );
    }
  )
    .then( function(){
      return cleanup( bulkupload, opts );
    } )
}

function parseUserData( opts ){
  return convertersService.userCSVtoJson( opts );
}

function handleUsers( bulkupload ){
  if( !bulkupload.csvfile || !bulkupload.csvfile.filename ){
    return P.reject( new Error( 'CSV file is required!' ) );
  }

  const opts = {
    path: path.resolve( path.join( constants.directories.bulk, bulkupload.csvfile.filename ) )
  };

  return parseUserData( opts )
    .map( ( raw )=>{
      return usersService.list( { email: raw.email } )
        .then( ( users )=>{
          let user;
          if( users.length ){
            user = users[ 0 ];
          } else {
            if( !raw.password ){
              raw.password = crypto.randomBytes( 16 ).toString( 'base64' );
            }
            raw.actions = { sendInviteMail : true };
            user = new usersService.collection.model( raw );
          }
          bulkupload.assessment.forEach((assessmentId)=>{
            if( bulkupload.roles.asAssessee && user.assessments.assessee.indexOf(assessmentId)<0){
              user.assessments.assessee.push(assessmentId);
            }
            if( bulkupload.roles.asAssessor && user.assessments.assessor.indexOf(assessmentId)<0){
              user.assessments.assessor.push(assessmentId);
            }
            if( bulkupload.roles.asPAM && user.assessments.pam.indexOf(assessmentId)<0){
              user.assessments.pam.push(assessmentId);
            }
          });
          return user.save();
        } )
        .catch( ( err )=>P.reject( err ) );
    } )
    .then(function(){
      removeFile( { resolved: opts.path } )
    })
    .then( function(){
      bulkupload.completed = true;
    } );
}

function bulkuploadSavedHandler( bulkupload ){
  if( bulkupload.completed ){
    return P.reject( new Error( 'You cannot reuse bulk uploads. (Seriously that would mean a world of pain)' ) );
  }

  if( bulkupload.isNew ){
    return P.resolve();
  }

  let p;
  switch( bulkupload.uploadType ){
    case "representations":
      p = handleRepresentations( bulkupload );
      break;
    case "users":
      p = handleUsers( bulkupload );
      break;
  }

  return p.then( function(){
    bulkupload.result = "Bulk upload successfully completed.";
  } )
    .catch( function( err ){
      bulkupload.result = "Bulk upload failed: " + err.message;
    } );
}

module.exports.init = function(){
  keystone.list( 'Bulkupload' ).schema.pre( 'save', handleHook( bulkuploadSavedHandler ) );
};
