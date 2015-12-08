var restify = require('restify');
var fs = require('fs');
var mongo = require('mongodb');
var gridfs = require('gridfs-stream');
var uuid = require('node-uuid');
var mime = require('mime-types');
var utf8 = require('utf8');
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


function register(req, res, next){

}


function login(req, res, next){

}


function load_friend(req, res, next){

}

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

		// open in browser use 'inline' take place attachment
		res.setHeader('Content-disposition', 'attachment; filename=' + utf8.encode(file.filename));
  		res.setHeader('Content-type', file.contentType);

		rs.pipe(res);
  	});
	
};



function file_upload(req, res, next){

	var namestr = null;
	for(first in req.files){
		namestr=first;
		break;
	} 	

	var _file = req.files[namestr];
	var path = _file.path;
	
	var ct=mime.lookup(_file.name)||'binary/octet-stream';
	var ws = gfs.createWriteStream({filename:_file.name, content_type: ct});
	fs.createReadStream(path).pipe(ws);

	ws.on('error', function(err){
		console.log(err);
		res.send(500, err);
	});

	ws.on('close', function(file){
		console.log('[upload]'+file._id+','+_file.name);
		var url='http://'+settings.api.host+':'+settings.api.port+'/api/v1/download/'+file._id;

		// send message to socket.io when complete api calling 
		res.send({file_type: ct, 
					url: url, 
					file_name: file.filename, 
					file_length: file.length,
					timestamp: file.uploadDate.toJSON().replace('T', ' ').substr(0, 19)});
	});
};


/////////////////////////////// server ///////////////////////////////
var server = restify.createServer({name: settings.api.name});
server.use(restify.CORS());
server.use(restify.bodyParser());
server.post('/api/v1/upload', file_upload);
server.get('/api/v1/download/:id', file_download);

server.post('/aip/v1/register', register);
server.post('/api/v1/login', login);
server.post('/api/v1/friends', load_friend);

server.listen(settings.api.port, function() {
  console.log('%s listening at %s', server.name, server.url);
});



