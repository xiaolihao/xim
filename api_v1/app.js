var restify = require('restify');
var fs = require('fs');
var mongo = require('mongodb');
var gridfs = require('gridfs-stream');
var uuid = require('node-uuid');
var mime = require('mime-types');
var utf8 = require('utf8');
var mysql = require('mysql');
var async = require('async');
var ip = require('ip');
var settings = require('../config.js');


var mysql_conn=null;
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

mysql_conn = mysql.createPool({
		host: settings.mysql.host,
  		port: settings.mysql.port,
  		user: settings.mysql.user,
  		password: settings.mysql.password,
  		database: settings.mysql.database,
  		connectionLimit: settings.mysql.connection_limit,
  		queueLimit: settings.mysql.queue_limit
	});


function register(req, res, next){

	if(!req.params.email || !req.params.password){
		res.send(500, 'error paramters');
	}

	mysql_conn.getConnection(function(err,conn){
					conn.query('INSERT INTO XIM_USER SET ?', 
					{'EMAIL': req.params.email, 'PASSWORD': req.params.password}, function(err,rows,fields){
						conn.release();
						if(err){
							res.send(500, err);
						}

						else
							res.send(200);
					})
	});

}


function login(req, res, next){

	if(!req.params.email || !req.params.password){
		res.send(500, 'error paramters');
	}

	async.waterfall([
		function(callback){
			mysql_conn.getConnection(function(err,conn){
					conn.query('SELECT ID,NICK_NAME,REGISTER_DATE,LASTLOGIN_DATE,LASTLOGIN_IP,EMAIL FROM XIM_USER WHERE EMAIL=? AND PASSWORD=?',
						[req.params.email, req.params.password], function(err,rows,fields){
						if(err){
							callback(err)
						}
						else if(rows.length==0)
							callback('user name or password wrong');
						else{

							callback(null, conn, rows[0]);
						}
					})
			});
		},
		
		function(conn, me, callback){
			conn.query('SELECT A.ID,A.NICK_NAME,A.REGISTER_DATE,A.LASTLOGIN_DATE,A.LASTLOGIN_IP,A.EMAIL FROM XIM_USER AS A INNER JOIN (SELECT USERID_2 AS ID FROM XIM_FRIENDSHIP WHERE USERID_1=?) AS B ON A.ID=B.ID',
			me.ID, function(err,rows,fields){
			conn.release();
			if(err)
				callback(null, me, []);

			else
				callback(null, me, rows);
			});
		}
		
		],
		function(err, me, friends){
			if(err){
				console.log(err);
				res.send(500, err);
			}
			else{
				update_login(me.ID, req);
				me.friends=friends;
				res.send(200, me);
			}

	});
}


function update_login(user_id, req){
	var client_ip=req.headers['x-forwarded-for']||req.connection.remoteAddress;
	if(ip.isV6Format(client_ip))
		client_ip='255.255.255.255';

	var date=new Date().toJSON().replace('T', ' ').substr(0, 19);
	mysql_conn.getConnection(function(err,conn){
		conn.query('UPDATE XIM_USER SET LASTLOGIN_IP=INET_ATON(?), LASTLOGIN_DATE=? WHERE ID=?',
			[client_ip, date, user_id], function(err,rows,fields){
			if(err)
				console.log(err);
			conn.release();
		})
	});
}


function load_friend(req, res, next){
	mysql_conn.getConnection(function(err,conn){
		conn.query('SELECT A.ID,A.NICK_NAME,A.REGISTER_DATE,A.LASTLOGIN_DATE,A.LASTLOGIN_IP,A.EMAIL FROM XIM_USER AS A INNER JOIN (SELECT USERID_2 AS ID FROM XIM_FRIENDSHIP WHERE USERID_1=?) AS B ON A.ID=B.ID',
			req.params.user_id, function(err,rows,fields){
			conn.release();
			if(err)
				res.send(500, err);

			else
				res.send(200, rows);
		})
	});
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
		res.setHeader('Content-disposition', 'inline; filename=' + utf8.encode(file.filename));
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
server.use(function(req, res, next){
	console.log(req.url+','+JSON.stringify(req.params));
	next()
});
server.post('/api/v1/upload', file_upload);
server.get('/api/v1/download/:id', file_download);

server.post('/api/v1/register', register);
server.post('/api/v1/login', login);
server.post('/api/v1/friend', load_friend);

server.listen(settings.api.port, function() {
  console.log('%s listening at %s', server.name, server.url);
});



