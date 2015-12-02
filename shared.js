
var settings = require('./config');
var mysql = require('mysql');
var winston = require('winston');
var redis = require('redis');

var logger;
var mysql_conn;
var redis_pub_conn, redis_sub_con;
var redis_db_conn;


function init_logger(){
	logger = new(winston.Logger)({
        transports: [
          new (winston.transports.Console)({ json: false, timestamp: true }),
          new winston.transports.File({ filename:settings.log.path, level:settings.log.level, json: false})
          ]
    });
};


function init_mysql(){

	// mysql pool
	mysql_conn = mysql.createPool({
		host: settings.mysql.host,
  		port: settings.mysql.port,
  		user: settings.mysql.user,
  		password: settings.mysql.password,
  		database: settings.mysql.database,
  		connectionLimit: settings.mysql.connection_limit,
  		queueLimit: settings.mysql.queue_limit
	});

	/*
	mysql_conn = mysql.createConnection({
		host: settings.mysql.host,
    	user: settings.mysql.user,
    	password: settings.mysql.password,
    	database: settings.mysql.database,
    	port: settings.mysql.port
	});

	mysql_conn.connect(function(err){
		if(err){
			logger.info('mysql error when connecting to db:', err);
			throw err;
		}
	});

	mysql_conn.on('error', function(err){
		if(err.code === 'PROTOCOL_CONNECTION_LOST')
			init_mysql();
		
		else{
			logger.info('mysql error:', err);
			throw err;
		}
	});
	*/
};


function init_redis(){
	redis_pub_conn = redis.createClient(
		{
			host:settings.redis.pubhost, 
			port:settings.redis.pubport
		});

	redis_sub_conn = redis.createClient(
		{
			host:settings.redis.subhost, 
			port:settings.redis.subport
		});

	redis_db_conn = redis.createClient(
		{
			host:settings.redis.dbhost, 
			port:settings.redis.dbport
		});	
};


///////////////////////////////////////////////
function init(){
	init_logger();
	init_mysql();
	init_redis();
};

init();

exports.logger = logger;
exports.mysql_conn = mysql_conn;
exports.redis_pub_conn = redis_pub_conn;
exports.redis_sub_conn = redis_sub_conn;
exports.redis_db_conn = redis_db_conn;












