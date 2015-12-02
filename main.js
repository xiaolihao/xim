var shared = require('./shared.js');
var settings = require('./config.js');
var io = require('socket.io')(settings.socket.port);
var _ = require('underscore');
var model = require('./model.js');

init();


var server_model = model.server_model;
io.on('connection', function(socket){
	
	socket.on('message', function(message){

		/** message format
		*	
		*	{
		*		action: 	, 	// init, state-notify, message, requst	
		*		msg: {}
		*		
		*	}
		*
		*/
		var d = JSON.parse(message);

		shared.logger.info(message);
		switch(d.action){

			/** msg format
			*	
			*	{
			*		user_id: 	,		
			*		ip: 		
			*		
			*	}
			*
			*/
			case 'init':
				var client_ip = socket.request.connection.remoteAddress;
				new model.client_model({
					'socket': socket,
					'user_id': d.msg.user_id,
					'ip': client_ip
				});

			break;

			case 'message':
			break;
			case 'request':
			break;

		}

	});

});




function init(){
	
	// sub ip:port channel
	shared.redis_sub_conn.subscribe(settings.socket.host + ':' + settings.socket.port + ':' + process.pid);

	// process sub message
	shared.redis_sub_conn.on('message', function(channel, message){
	});
}