
var backbone = require('backbone');
var shared = require('./shared.js');
var _ = require('underscore');
var settings =require('./config.js');
var v = require('./values.js');

var server_model=null;


// client model
var client_model = backbone.Model.extend({	
	// status is in redis

	// Remember that in JavaScript, objects are passed by reference, 
	// so if you include an object as a default value, it will be shared among all instances. 
	// Instead, define defaults as a function.
	defaults: function(){
		return {
			'user_id': null,
			
			'socket': null,		// allow multi connection
			'desc': '',
			'ip': '',

			// userid: on/off
			'friends': {},

			'payload': {}
			}
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
				self.get('payload')['field'] = 'p-0';
				shared.redis_db_conn.hset(uid, 'p-0', v);

				shared.logger.info(uid+','+'p-0'+'->'+v);
			}

			// has logined
			else{

				// server not in redis
				if(values.indexOf(v) == -1){
					var field='p-'+values.length;
					self.get('payload')['field'] = field;
					shared.redis_db_conn.hset(uid, field, v)
					shared.logger.info(uid+','+field+'->'+v);
				}
				
			}

			if(values.length == 0)
				self.read_friend_list(true);
			else
				self.read_friend_list(false);
		});

	},

	read_friend_list: function(need_notify_friend){

		// read friend list
		var uid = this.get('user_id');
		var self = this;
		var b = need_notify_friend;

		shared.mysql_conn.getConnection(function(err,conn){
        	conn.query('SELECT USERID_2 FROM XIM_FRIENDSHIP WHERE USERID_1 = ?', uid, function(err, rows, fields){
          	
          	conn.release();
          	if(rows){
            	_.each(rows, function(row) {
              
              		shared.redis_db_conn.hlen(row.USERID_2+'', function(err, reply){
              			if(err){
              				shared.logger.info(err);
        					return;
    					}

    					var _uid=row.USERID_2+'';
    					// has logined
    					if(reply > 0){

    						self.get('friends')[row.USERID_2+''] = 'on';
    						// notify friend online info
    					
    						var message = {
    							action: 'state-notify',
    							msg: {
    								to_user_id: _uid,
    								from_user_id: uid,
    								state: 'on'
    							}
    						}

    						// only one instance login
    						if(b)
    							server_model.emit_message(_uid, message, false);

    					}
    					else{
    						self.get('friends')[row.USERID_2+''] = 'off';
    					}

					});

            	});
          	}
        	
        });
      });
	},

	update_read_flag: function(ids){
		shared.mysql_conn.getConnection(function(err,conn){
			var sql='UPDATE XIM_OFFLINE_MSG SET ISREAD=1 WHERE ID IN('+ids+')';
			conn.query(sql,
        		function(err, rows, fields){
        			conn.release();

        			if(err){
        				shared.logger.info(err);
            		}
        	});
        });
	},

	read_offline_msg: function(){
		var uid = this.get('user_id');
		var self = this;

		shared.mysql_conn.getConnection(function(err,conn){
			conn.query('SELECT ID,TO_USERID,FROM_USERID,MSG_TYPE,MSG,DATE_FORMAT(CREATED_DATE,"%Y-%m-%d %H:%i:%s") As CREATED_DATE FROM XIM_OFFLINE_MSG WHERE TO_USERID=? AND ISREAD=0',
				uid, 
        		function(err, rows, fields){
        			conn.release();

        			if(err){
        				shared.logger.info(err);
        				return;
        			}
        			if(rows.length == 0) return;

        			// batch update
        			var ids=_.map(_.pluck(rows, 'ID'), function(v){return '\''+v+'\'';}).join(',');
        			self.update_read_flag(ids);

        			if(rows){
            			_.each(rows, function(row) {
            				
            				var message = {
            					action: 'message',
            					msg: {
            						to_user_id: row.TO_USERID,
            						from_user_id: row.FROM_USERID,
            						message_type: v.msg_idx_type[row.MSG_TYPE],
            						message: row.MSG,
            						timestamp: row.CREATED_DATE
            					}
            				};

            				self.write_message(message);
            			});
            		}

            		
        	});
        });
	},

	initialize: function(){

		var self=this;
		var sock = this.get('socket');

		// 'close' event for sockjs
      	sock.on('disconnect', function(){
      		shared.logger.info('[exit]'+self.get('user_id'));
        	self.close();
      	});

		server_model.add_client(self);

		this.write_redis_info();

		this.read_offline_msg();

	},/*initialize*/

	write_message: function (message) {
		var self = this;
		var socket = this.get('socket');
	    if(socket){
	    	socket.emit('message',JSON.stringify(message));

	         // update friends state
	         if(message.action == 'state-notify'){
	         	this.get('friends')[message.msg.from_user_id]=message.msg.state;
	         	this.trigger('change', self);
	         }
	     }
    },

	close: function(){
		// delete online info in redis
		var uid = this.get('user_id');
		var self = this;

		this.set('socket', null);
      	this.trigger('close', this);

		// check if other clients login in same node
		var cs = server_model.get('clients').where({user_id: uid});
		if(cs.length != 0)
			return;


		shared.redis_db_conn.hdel(uid, this.get('payload')['field']);

		// check if having other clients 
		shared.redis_db_conn.hlen(uid, function(err, reply){
			if(err){
				shared.logger.info(err);
				return;
			}

			// no other clients
			if(reply == 0){
				// notify online friend offline info if no other client login
				var f=self.get('friends');
				_.each(f, function(v, k, f){
					
					// online
					if(v == 'on'){
						if(k == self.get('user_id')) return;

						var message = {
    						action: 'state-notify',
    						msg: {
    							to_user_id: k,
    							from_user_id: uid,
    							state: 'off'
    						}
    					}
    					server_model.emit_message(k, message, false);
					}
				});
			}
		});

	}
});


var client_collection = backbone.Collection.extend({
	model: client_model,

	add: function(client, options){
		var self=this;
    	self.listenTo(client, 'close', function(_client){
    		self.stopListening(_client);
    		self.remove(_client);

    		shared.logger.info('[client remove]'+'user_id:'+client.get('user_id')+','+
    						'ip:'+client.get('ip')+','+
    						'friends:'+JSON.stringify(client.get('friends'))+','+
    						'payload:'+JSON.stringify(client.get('payload')));

    	});


    	self.listenTo(client, 'add', function(_client){
    		shared.logger.info('[client add]'+'user_id:'+client.get('user_id')+','+
    						'ip:'+client.get('ip')+','+
    						'friends:'+JSON.stringify(client.get('friends'))+','+
    						'payload:'+JSON.stringify(client.get('payload')));
    	});

    	self.listenTo(client, 'change', function(_client){
    		shared.logger.info('[client change]'+'user_id:'+client.get('user_id')+','+
    						'ip:'+client.get('ip')+','+
    						'friends:'+JSON.stringify(client.get('friends'))+','+
    						'payload:'+JSON.stringify(client.get('payload')));
    	});

    	backbone.Collection.prototype.add.call(this, client, options);
    	
  	}
});


var server_model = backbone.Model.extend({
	default: {
		'clients': null
	},

	initialize: function(){
		this.set('clients', new client_collection());
	},

	add_client: function(client){
		this.get('clients').add(client);
	},

	print: function(){
		shared.logger.info(this.get('clients').toJSON());
	},

	emit_message: function(uid, message, cache){
		var clients = this.get('clients');
		var cs = clients.where({user_id: uid});
		var _message = message;

		// not on same node
		if(cs.length == 0){
			shared.redis_db_conn.hvals(uid, function(err, values){

				if(err){
					shared.logger.info(err);
					return;
				}

				// offline
				if(values.length == 0 && cache){
					// write to db
					 
					shared.mysql_conn.getConnection(function(err,conn){
        				conn.query('INSERT INTO XIM_OFFLINE_MSG SET ?', 
        					{
        						'TO_USERID': uid, 
        						'FROM_USERID': message.msg.from_user_id,
        						'MSG_TYPE': v.msg_type_idx[message.msg.message_type],
        						'CREATED_DATE': message.msg.timestamp,
        						'MSG': message.msg.message
        					}, 
        					function(err, rows, fields){
        						if(err)
        							shared.logger.info(err);

        						conn.release();
        					});
					});
  

				}
				else{
					_.each(values, function(v){
						shared.redis_pub_conn.publish(v, JSON.stringify(_message));

						shared.logger.info('[pub]'+JSON.stringify(_message));
					});
				}
				
			});

		}

		// same node
		// !!! if user also logined on other nodes, this strategy
		// !!! not publish message to other nodes 
		else{
			_.each(cs, function(v){
				v.write_message(_message);
				shared.logger.info('[write]'+JSON.stringify(_message));

			});
		}
	}

});


server_model = new server_model({});


exports.client_model = client_model;
exports.server_model = server_model;
















