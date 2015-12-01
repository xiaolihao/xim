var shared = require('./shared.js');
var settings = require('./config');
var io = require('socket.io')(settings.socket.port);
var _ = require('lodash');


init();

io.on('connection', function(socket){
	
	/** msg format
	*	
	*	{
	*		userid: 	,		
	*		ip: 		,
	*		nick_name: 
	*		
	*	}
	*
	*/
	socket.on('init', function(msg){

	});

});




function init(){
	
	// sub ip:port channel
	shared.redis_ps_conn.subscribe(settings.socket.host + ':' + settings.socket.port + ':' + process.pid);

	// process sub message
	shared.redis_ps_conn.on('message', function(channel, message){
	});
}