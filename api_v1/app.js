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
var _ = require('underscore');


var mysql_conn = null;
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
					conn.query('SELECT ID,NICK_NAME,DATE_FORMAT(REGISTER_DATE, "%Y-%m-%d %H:%i:%s") AS REGISTER_DATE,DATE_FORMAT(LASTLOGIN_DATE, "%Y-%m-%d %H:%i:%s") AS LASTLOGIN_DATE ,INET_NTOA(LASTLOGIN_IP) AS LASTLOGIN_IP,EMAIL FROM XIM_USER WHERE EMAIL=? AND PASSWORD=?',
						[req.params.email, req.params.password], function(err,rows,fields){
						if(err){
							console.log(err);
							conn.release();
							callback(err)
						}
						else if(rows.length==0){
							conn.release();
							callback('user name or password wrong');
						}
							
						else{

							callback(null, conn, rows[0]);
						}
					})
			});
		},
		
		function(conn, me, callback){
			conn.query('SELECT A.ID,A.NICK_NAME,DATE_FORMAT(A.REGISTER_DATE, "%Y-%m-%d %H:%i:%s") AS REGISTER_DATE,DATE_FORMAT(A.LASTLOGIN_DATE, "%Y-%m-%d %H:%i:%s") AS LASTLOGIN_DATE ,INET_NTOA(A.LASTLOGIN_IP) AS LASTLOGIN_IP,A.EMAIL FROM XIM_USER AS A INNER JOIN (SELECT USERID_2 AS ID FROM XIM_FRIENDSHIP WHERE USERID_1=?) AS B ON A.ID=B.ID',
			me.ID, function(err,rows,fields){
			
			if(err){
				console.log(err);
				callback(null, me, []);
			}

			else
				callback(null, conn, me, rows);
			});
		},
		
		function(conn, me, friends, callback){
            conn.query('SELECT NAME,OWNER,C.* FROM XIM_GROUP INNER JOIN(SELECT B.GROUPID, A.USERID,A.GROUP_NAME from XIM_GROUP_MEMBER AS A INNER JOIN(SELECT GROUPID from XIM_GROUP_MEMBER WHERE USERID=?) AS B ON B.GROUPID=A.GROUPID) AS C ON XIM_GROUP.ID=C.GROUPID',
            me.ID, 
            function(err, rows, fields){
                conn.release();
                if(err){
                    console.log(err);
                }

                var groups = [];
                _.each(rows, function(v){
                	var gs=_.where(groups, {GROUP_ID: v.GROUPID+''});
                	var g=null;
                	if(gs.length==0){
                		g={
                			'GROUP_ID': v.GROUPID+'',
                			'OWNER': v.OWNER+'',
                			'NAME': v.NAME,
                			'MEMBERS':[]
                		};

                		groups.push(g);
                	}
                	else
                		g=gs[0];

                	g['MEMBERS'].push({
                		'USER_ID': v.USERID,
                		'GROUP_NAME': v.GROUP_NAME
                	});
                	
                });
                callback(null, me, friends, groups)
                
            });
		}

		],
		function(err, me, friends, groups){
			if(err){
				console.log(err);
				res.send(500, err);
			}
			else{
				update_login(me.ID, req);
				me.FRIENDS=friends;
				me.GROUPS=groups;
				console.log(me);
				res.send(200, me);
			}

	});
}


function update_login(user_id, req){

	var client_ip=req.headers['x-forwarded-for']||req.connection.remoteAddress;
	console.log(client_ip);
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
		conn.query('SELECT A.ID,A.NICK_NAME,DATE_FORMAT(A.REGISTER_DATE, "%Y-%m-%d %H:%i:%s") AS REGISTER_DATE,DATE_FORMAT(A.LASTLOGIN_DATE, "%Y-%m-%d %H:%i:%s") AS LASTLOGIN_DATE ,INET_NTOA(A.LASTLOGIN_IP) AS LASTLOGIN_IP,A.EMAIL FROM XIM_USER AS A INNER JOIN (SELECT USERID_2 AS ID FROM XIM_FRIENDSHIP WHERE USERID_1=?) AS B ON A.ID=B.ID',
			req.params.id, function(err,rows,fields){
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

function load_group(req, res, next){

	if(!req.params.id){
		res.send(500, 'error paramters');
	}
	mysql_conn.getConnection(function(err,conn){
		conn.query('SELECT NAME,OWNER,C.* FROM XIM_GROUP INNER JOIN(SELECT B.GROUPID, A.USERID,A.GROUP_NAME from XIM_GROUP_MEMBER AS A INNER JOIN(SELECT GROUPID from XIM_GROUP_MEMBER WHERE USERID=?) AS B ON B.GROUPID=A.GROUPID) AS C ON XIM_GROUP.ID=C.GROUPID',
	            req.params.id, 
	            function(err, rows, fields){
	                conn.release();
	                if(err){
	                    console.log(err);
	                }

	                var groups = [];
	                _.each(rows, function(v){
	                	var gs=_.where(groups, {GROUP_ID: v.GROUPID+''});
	                	var g=null;
	                	if(gs.length==0){
	                		g={
	                			group_id: v.GROUPID+'',
	                			owner: v.OWNER+'',
	                			name: v.NAME,
	                			members:[]
	                		};

	                		groups.push(g);
	                	}
	                	else
	                		g=gs[0];

	                	g['members'].push({
	                		user_id: v.USERID,
	                		group_name: v.GROUP_NAME
	                	});
	                	
	                });
	                
	                res.send(groups);
	        });
	});
};


function del_group(req, res, next){
	if(!req.params.gid || !req.params.ownerid){
		res.send(500, 'error paramters');
	}


	mysql_conn.getConnection(function(err,conn){
		conn.query('DELETE A,B FROM XIM_GROUP A, XIM_GROUP_MEMBER B WHERE A.ID=? AND A.OWNER=? AND A.ID=B.GROUPID;', 
		[req.params.gid, req.params.ownerid], function(err,rows,fields){
			conn.release();
			
			if(err){
				console.log(err);
				res.send(500, err);
			}

			var _message={
				action: 'goperation',
				msg: {
					owner_id: req.params.ownerid,
					operation: 'delete',
					group_id: req.params.gid,
					timestamp: new Date().toJSON().replace('T', ' ').substr(0, 19)
				}

			}
			res.send(_message);
		})
	});
	
};

function create_group(req, res, next){
	if(!req.params.name || !req.params.ownerid){
		res.send(500, 'error paramters');
	}

	mysql_conn.getConnection(function(err,conn){
			conn.query('INSERT INTO XIM_GROUP SET ?', 
			{'NAME': req.params.name, 'OWNER': req.params.ownerid}, function(err,rows,fields){
				
				if(err){
					conn.release();
					res.send(500, err);
				}

				else{
					var gid=rows.insertId;
					conn.query('INSERT INTO XIM_GROUP_MEMBER SET ?',{
						'USERID': req.params.ownerid, 'GROUPID': rows.insertId
					}, function(err, rows, fields){
						conn.release();

						if(err){
							res.send(500, err);
						}
						else
							res.send({
								group_id: gid,
								name: req.params.name,
								owner_id: req.params.ownerid
							});
					});
				}
			})
	});
};


function create_friend(req, res, next){
	if(!req.params.myid || !req.params.targetid){
		res.send(500, 'error paramters');
	}

	mysql_conn.getConnection(function(err,conn){
		var _values='(\''+req.params.myid+'\',\''+req.params.targetid+'\')'+','+
					'(\''+req.params.targetid+'\',\''+req.params.myid+'\')';
			conn.query('INSERT INTO XIM_FRIENDSHIP(USERID_1,USERID_2) VALUES'+_values, function(err, rows, fields){
				conn.release();
				if(err){
					console.log(err);
					res.send(500, err);
				}

				var _message = {
							action: 'foperation',
							msg: {
								to_user_id: req.params.targetid,
    							from_user_id: req.params.myid,
    							operation: 'add',
    							message: '',
    							timestamp: new Date().toJSON().replace('T', ' ').substr(0, 19)
							}
						}
				res.send(_message);
			});
	});
};


function del_friend(req, res, next){
	if(!req.params.myid || !req.params.targetid){
		res.send(500, 'error paramters');
	}

	var id1=req.params.myid;
	var id2=req.params.targetid;
	mysql_conn.getConnection(function(err,conn){
		conn.query('DELETE FROM XIM_FRIENDSHIP WHERE (USERID_1=? AND USERID_2=?) OR (USERID_1=? AND USERID_2=?)', 
		[id1, id2, id2, id1], function(err,rows,fields){

		conn.release();
		if(err){
			console.log(err);
			res.send(500, err);
		}
		
		var _message = {
							action: 'foperation',
							msg: {
								to_user_id: req.params.targetid,
    							from_user_id: req.params.myid,
    							operation: 'delete',
    							message: '',
    							timestamp: new Date().toJSON().replace('T', ' ').substr(0, 19)
							}
						}

		res.send(_message);

		});
	});
};




function get_group(req, res, next){

};

function put_group(req, res, next){
	// in/out
	if(!req.params.type||!req.params.gid||!req.params.ownerid)
		res.send(500, 'error paramters');

	switch(req.params.type){
		case 'in':
			if(!req.params.uid)
				res.send(500, 'error paramters');

			mysql_conn.getConnection(function(err,conn){
				conn.query('INSERT INTO XIM_GROUP_MEMBER SET ?', 
				{GROUPID: req.params.gid, USERID: req.params.uid}, function(err,rows,fields){
					conn.release();
					if(err){
						console.log(err);
						res.send(500, err);
					}

					else{
						var _message={
							action: 'goperation',
							msg:{
								owner_id: req.params.ownerid,
								user_id: req.params.uid,
								operation: 'in',
								group_id: req.params.gid,
								timestamp: new Date().toJSON().replace('T', ' ').substr(0, 19) 
							}
						}
						res.send(_message);
					}
				})
			});
		break;

		case 'out':
			if(!req.params.uid)
				res.send(500, 'error paramters');

			mysql_conn.getConnection(function(err,conn){
				conn.query('DELETE FROM XIM_GROUP_MEMBER WHERE GROUPID=? AND USERID=?', 
				[req.params.gid, req.params.uid], function(err,rows,fields){
					conn.release();
					if(err){
						console.log(err);
						res.send(500, err);
					}

					else{
						var _message={
							action: 'goperation',
							msg:{
								owner_id: req.params.ownerid,
								user_id: req.params.uid,
								operation: 'out',
								group_id: req.params.gid,
								timestamp: new Date().toJSON().replace('T', ' ').substr(0, 19) 
							}
						}
						res.send(_message);
					}
				})
			});
		break;
	}

};


/////////////////////////////// server ///////////////////////////////
var server = restify.createServer({name: settings.api.name});
server.use(restify.CORS());
server.use(restify.bodyParser());
server.use(function(req, res, next){
	console.log('['+req.method+']'+req.url+','+JSON.stringify(req.params));
	next()
});

server.use(function (req, res, next) {
    if (req.url.match(/^\/api\/v1\/download\/.+/)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    next();
});

server.post('/api/v1/upload', file_upload);
server.get('/api/v1/download/:id', file_download);

server.post('/api/v1/register', register);
server.post('/api/v1/login', login);

server.get('/api/v1/user/friend/:id', load_friend);
server.get('/api/v1/user/group/:id', load_group);

server.post('/api/v1/friend', create_friend);
server.del('/api/v1/friend', del_friend);

server.post('/api/v1/group', create_group);
server.del('/api/v1/group', del_group);
server.get('/api/v1/group/:id', get_group);
server.put('/api/v1/group', put_group);


server.get(/^\/(js|css|template)\/?.*$/, restify.serveStatic({
  directory: __dirname
}));

server.get('/', function(req, res, next){
	fs.readFile(__dirname + '/index.html',
		function (err, data) {
		    if (err){
				res.writeHead(500);
				return res.end('fail to load index.html');
		    }

		    res.writeHead(200);
		    res.end(data);
		});
});

server.listen(settings.api.port, function() {
  console.log('%s listening at %s', server.name, server.url);
});



