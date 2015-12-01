
var backbone = require('backbone');
var shared = require('./shared.js');
var _ = require('lodash');


// client model
var client_model = backbone.Model.extend({
	idAttribute: 'user_id',
	
	// status is in redis
	defaults: {
		'user_id': null,
		
		'socket': null,		// allow multi connection(same node)
		'desc': ''
		'ip': '',

		// userid: {nick_name:}
		'friends': {},

		// store redis field
		'payload': ''
	},



	write_redis_info: function(){
		// write logininfo to redis
		// redis hash
		var uid = this.get('user_id');
		var v = settings.socket.host + ':' + settings.socket.port + ':' + process.pid;
		
		var self = this;
		shared.redis_db_conn.hvals(uid, function(err, values){

			if(err){
				shared.logger.info(err);
				return;
			}

			// first login
			if(values.length==0){
				self.set('payload', 'p-0');
				shared.redis_db_conn.hset(uid, 'p-0', v);
			}

			// has logined
			else{

				// server not in redis
				if(values.indexOf(v) == -1){
					var field='p-'+values.length;
					self.set('payload', field);
					shared.redis_db_conn.hset(uid, field, v)
				}
				
			}
		});

	},

	read_friend_list: function(){

		// read friend list
		var uid = this.get('user_id');
		var friends = this.get('friends');

		shared.mysql_conn.getConnection(function(err,conn){

        conn.query('SELECT USERID_2 FROM XIM_FRIENDSHIP WHERE USERID_1 = ?', uid, function(err, rows, fields){
          
          if(rows){
            _.each(rows, function(row) {
              
              	shared.redis_db_conn.hlen(row.USERID_2, function(err, reply){
              		if(err){
              			shared.logger.info(err);
        				return;
    				}

    				// has logined
    				if(reply > 0){
    					friends[row.USERID_2] = 'on';

    					// notify friend online info
    					// ...
    				}
    				else{
    					friends[row.USERID_2] = 'off';
    				}
				});

            });
          }
          conn.release();
        });
      });
	},

	initialize: function(){
		write_redis_info();
		read_friend_list();

		var self=this;
		var sock = this.get('socket');

      	sock.on('close', function(){
        	self.close();
      	});


	},/*initialize*/

	send_message: function (msg) {
      var socket = this.get('socket');
      if(socket){
         socket.write(JSON.stringify(msg));
      }
    },

	close: function(){
		// delete online info in redis
		var uid = this.get('user_id');
		shared.redis_db_conn.hdel(uid, this.get('payload'));

		// check if having other clients 
		shared.redis_db_conn.hlen(uid, function(err, reply){
			if(err){
				shared.logger.info(err);
				return;
			}

			// no other clients
			if(reply == 0){
				// notify friend offline info if no other client login
				// ...
			}
		});

		
		this.set('socket', null);
      	this.trigger('close', this);
	}
});

var client_collection = backbone.Collection.extend({
	model: client_model,

	add: function(client, options){
    	

    	backbone.Collection.prototype.add.call(this, client, options);
  	}
});



















