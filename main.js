var shared = require('./shared.js');
var settings = require('./config.js');
var argv = require('optimist').argv;
var _ = require('underscore');
var model = require('./model.js');

settings.socket.port=argv.port||settings.socket.port;

var io = require('socket.io')(settings.socket.port);

init();


var server_model = model.server_model;
io.on('connection', function(socket){
	
	socket.on('message', function(message){

		/** message format
		*	
		*	{
		*		action: 	, 	// init, state-notify, operation-notify, message, operation
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
					'user_id': d.msg.user_id+'',
					'ip': client_ip
				});

			break;

			/** msg format
			*	
			*	{
			*		to_user_id: 	,
			*		from_user_id: 	,		
			*		message_type: 	,	// text, image, file, voice, system
			*		message: 		,   
			*		timestamp: 			
			*		
			*	}
			*
			*/
			// message: {url:, file_type:, file_name:, file_length:}
			// timestamp for file write completely in file system
			case 'message':
				server_model.emit_message(d.msg.to_user_id, d, true);
			break;
			
			/** msg format
			*	
			*	{
			*		user_id: 		,
			*		operation: 		,	// friend-add-request, friend-add-reject, friend-add-agree, friend-delete
			*		message: 		,	// {target_user_id:, attach_message:}   
			*		timestamp: 			
			*	}
			*
			*/
			case 'operation':
				server_model.process_operation(d);
			break;

		}

	});

});




function init(){
	
	// sub ip:port channel
	shared.redis_sub_conn.subscribe(settings.socket.host + ':' + settings.socket.port + ':' + process.pid);

	// process sub message
	shared.redis_sub_conn.on('message', function(channel, message){
		shared.logger.info('[recv:sub]'+'channel:'+channel+',message:'+message);

		var d = JSON.parse(message);
		server_model.write_message(d.msg.to_user_id, d);
	});
}


