var restify = require('restify');
var fs = require('fs');
var mongo = require('mongodb');
var gridfs = require('gridfs-stream');
var uuid = require('node-uuid');
var mime = require('mime-types');
var settings = require('../config.js');


var db = new mongo.Db(settings.mongodb.database, 
						new mongo.Server(settings.mongodb.host, settings.mongodb.port));

var gfs = null;

db.open(function(err){
	if(err){
		console.log(err);
		return;
	}

	gfs = gridfs(db, mongo);
});


function file_download(req, res, next){
	
	gfs.findOne({ _id: req.params.id}, function(err, file){
		if(err){
			console.log(err);
			res.send(500, err);
		}


		var rs = gfs.createReadStream({_id: req.params.id});

		rs.on('error', function(err){
			console.log(err);
			res.send(500, err);
		});

		console.log('[download]'+file._id+','+file.filename);
		res.setHeader('Content-disposition', 'attachment; filename=' + file.filename);
  		res.setHeader('Content-type', file.contentType);
		rs.pipe(res);
  	});
	
};



function file_upload(req, res, next){

	var path = req.files.file.path;
	
	var ct=mime.lookup(req.files.file.name);
	var ws = gfs.createWriteStream({filename:req.files.file.name, content_type: ct||'binary/octet-stream'});
	fs.createReadStream(path).pipe(ws);

	ws.on('error', function(err){
		console.log(err);
		res.send(500, err);
	});

	ws.on('close', function(file){
		console.log('[upload]'+file._id+','+req.files.file.name);
		var url='http://'+settings.api.host+':'+settings.api.port+'/api/v1/download/'+file._id;
		res.send(url);
	});
};


/////////////////////////////// server ///////////////////////////////
var server = restify.createServer({name: settings.api.name});
server.use(restify.bodyParser());
server.post('/api/v1/upload', file_upload);
server.get('/api/v1/download/:id', file_download);

server.listen(settings.api.port, function() {
  console.log('%s listening at %s', server.name, server.url);
});



