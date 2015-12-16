var backbone = require('backbone');
var shared = require('./shared.js');
var _ = require('underscore');
var settings =require('./config.js');
var async = require('async');

var server_model=null;



var group_model = backbone.Model.extend({
	defaults: function(){
		return {
			'group_id': null,
			'owner': null,
			'name': null,
			'members':{}
		}
	},

	initialize: function(){},

	add_members: function(ms){
		var m=this.get('members');

		_.each(ms, function(v){
			m[v.USERID]=v.GROUP_NAME;
		});
	},

	emit_message: function(gmessage){
		var members=this.get('members');
			_.each(members, function(v, k, m){
				var message={
					action: 'gmessage',
					msg:{
						group_id: gmessage.msg.group_id,
						to_user_id: k,
						from_user_id: gmessage.msg.from_user_id,
						message_type: gmessge.msg.message_type,
						message: gmessage.msg.message,
						timestamp: gmessage.msg.timestamp
					}
				}
				server_model.emit_message(k, message, true);
			});
	}

});


var group_collection = backbone.Collection.extend({
	model: group_model
}); 


// client model
var client_model = backbone.Model.extend({	
	// status is in redis

	// remember that in javaScript, objects are passed by reference, 
	// so if you include an object as a default value, it will be shared among all instances. 
	// instead, define defaults as a function.
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


	add_friend: function(fid){
		this.get('friends')[fid]='on';
		shared.logger.info('add '+fid);
	},

	del_friend: function(fid){
		delete this.get('friends')[fid];
		shared.logger.info('del '+fid);
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

				var i=values.indexOf(v);
				// server not in redis
				if(i==-1){
					var field='p-'+values.length;
					self.get('payload')['field'] = field;
					shared.redis_db_conn.hset(uid, field, v)
					shared.logger.info(uid+','+field+'->'+v);
				}
				else{
					var field='p-'+i;
					self.get('payload')['field'] = field;
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

    						self.write_message({
    							action: 'state-notify',
    							msg: {
    								to_user_id: uid,
    								from_user_id: _uid,
    								state: 'on'
    							}
    						})
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
			conn.query('SELECT ID,MSG FROM XIM_OFFLINE_MSG WHERE TO_USERID=? AND ISREAD=0',
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
            				var message=JSON.parse(row.MSG);
            				self.write_message(message);
            			});
            		}

            		
        	});
        });
	},

	initialize: function(){

		var self=this;
		var sock = this.get('socket');

		// 'disconnect' event for socket.io
      	sock.on('close', function(){
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
	    	socket.write(JSON.stringify(message));
	     }
    },

	close: function(){
		// delete online info in redis
		var uid = this.get('user_id');
		var self = this;

		this.set('socket', null);

		// check if other clients login in same node
		var cs = server_model.get('clients').where({user_id: uid});
		if(cs.length > 1){
			this.trigger('close', this);
			return;
		}

		if(this.get('payload')['field'])
			shared.redis_db_conn.hdel(uid, this.get('payload')['field']);
		shared.logger.info('[hdel]'+uid+this.get('payload')['field']);

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


		this.trigger('close', this);
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
		'clients': null,
		'groups': null
	},

	initialize: function(){
		this.set('clients', new client_collection());
		this.set('groups', new group_collection());
	},

	emit_group_message: function(gmessage){
		var groups = this.get('groups');
		var self = this;

		var gs = groups.where({group_id: gmessage.msg.group_id+''});
		if(gs.length == 0){

			async.parallel([

					function(callback){
						shared.mysql_conn.getConnection(function(err,conn){
							conn.query('SELECT USERID,GROUP_NAME FROM XIM_GROUP_MEMBER WHERE GROUPID=?',
							gmessage.msg.group_id, 
			        		function(err, rows, fields){
			        			conn.release();
			        			if(err){
			        				shared.logger.info(err);
			        				callback(err);
			        			}

			        			callback(null, rows);
			        		});
						});


					},/* f1 */
					function(callback){
						shared.mysql_conn.getConnection(function(err,conn){
							conn.query('SELECT NAME,OWNER FROM XIM_GROUP WHERE ID=?',
							gmessage.msg.group_id, 
			        		function(err, rows, fields){
			        			conn.release();
			        			if(err){
			        				shared.logger.info(err);
			        				callback(err);
			        			}

			        			callback(null, rows);
			        		});
						});

					}/* f2 */
				], 


				function(err, results){

					if(err)
						return;


					var group = new group_model({
												'group_id': gmessage.msg.group_id,
												'owner': results[1][0].OWNER,
												'name': results[1][0].NAME				
											});
					group.add_members(results[0]);
					self.add_group(group);
					group.emit_message(gmessage);
			});

			
		}/* if */

		else{
			gs[0].emit_message(gmessage)
		}
	},

	add_client: function(client){
		this.get('clients').add(client);
	},

	add_group: function(group){
		this.get('groups').add(group);
	},

	print: function(){
		shared.logger.info(this.get('clients').toJSON());
	},

	// write directly to online socket
	write_message: function(uid, message, need_pub){
		var clients = this.get('clients');
		var cs = clients.where({user_id: uid+''});

		if(cs.length==0 && need_pub){
			shared.redis_db_conn.hvals(uid, function(err, values){
				if(err){
					shared.logger.info(err);
					return;
				}

				_.each(values, function(v){
					shared.redis_pub_conn.publish(v, JSON.stringify(message));

					shared.logger.info('[send:pub]channel:'+v+',message:'+JSON.stringify(message));
				});
				
			});
		}

		else{
			_.each(cs, function(v){
				v.write_message(message);

				if(message.action=='operation-notify'){

						if(message.msg.message_type=='friend-add')
							v.add_friend(message.msg.from_user_id);
						
						
						else if(message.msg.message_type=='friend-delete')
							v.del_friend(message.msg.from_user_id);
				}

				shared.logger.info('[write]'+JSON.stringify(message));

			});
		}
		
	},

	emit_message: function(uid, message, cache){
		var clients = this.get('clients');
		var cs = clients.where({user_id: uid+''});
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
        						'FROM_USERID': message.msg.from_user_id||0,
        						'CREATED_DATE': message.msg.timestamp,
        						'MSG': JSON.stringify(message)
        					}, 
        					function(err, rows, fields){
        						if(err)
        							shared.logger.info(err);

        						conn.release();
        					});
					});
  				
					shared.logger.info('[cache message]'+JSON.stringify(_message));

				}
				else{
					_.each(values, function(v){
						shared.redis_pub_conn.publish(v, JSON.stringify(_message));

						shared.logger.info('[send:pub]channel:'+v+',message:'+JSON.stringify(_message));
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
	},

	process_operation: function(message){
		switch(message.msg.operation){

			case 'friend-add-request':
				server_model.emit_message(message.msg.message.target_user_id, message, true);
			break;
			
			
			case 'friend-add-reject':
				// send reject message back to request user
				// target_user_id is user sending add-request
				server_model.emit_message(message.msg.message.target_user_id, message, true);
			break;
			
			case 'friend-add-agree':
				async.waterfall([
						// check if being friend already
						function(callback){
							shared.mysql_conn.getConnection(function(err,conn){
        						conn.query('SELECT ID FROM XIM_FRIENDSHIP WHERE USERID_1=? AND USERID_2=?', 
        						[message.msg.user_id, message.msg.message.target_user_id], function(err,rows,fields){

        						if(err){
        							shared.logger.info(err);
        							conn.release();
        							callback(-1);
        							return;
        						}
        						if(rows.length > 0){
        							conn.release();
        							callback(1);
        						}
        						else
        							callback(null, conn);
        						});
          					});
						},

						function(conn, callback){
							var _values='(\''+message.msg.user_id+'\',\''+message.msg.message.target_user_id+'\')'+','+
										'(\''+message.msg.message.target_user_id+'\',\''+message.msg.user_id+'\')';
							conn.query('INSERT INTO XIM_FRIENDSHIP(USERID_1,USERID_2) VALUES'+_values, function(err, rows, fields){
								conn.release();
								if(err){
        							shared.logger.info(err);
        							callback(-1);
        							return;
        						}

        						callback(1)
							});
						}

					], 

					function(err, results){
						if(err==1){
							var _message = {
        								action: 'operation-notify',
        								msg: {
        									to_user_id: message.msg.message.target_user_id,
                							from_user_id: message.msg.user_id,
                							message_type: 'friend-add',
        								}
        							}

        					server_model.write_message(message.msg.message.target_user_id, _message, true);
        						
        					_message.msg.to_user_id=message.msg.user_id;
        					_message.msg.from_user_id=message.msg.message.target_user_id;
        					server_model.write_message(message.msg.user_id, _message, true);
						}
				});
				// send success message to both user
			break;
			
			case 'friend-delete':
				// write db
				var id1=message.msg.user_id;
				var id2=message.msg.message.target_user_id;
				shared.mysql_conn.getConnection(function(err,conn){
					conn.query('DELETE FROM XIM_FRIENDSHIP WHERE (USERID_1=? AND USERID_2=?) OR (USERID_1=? AND USERID_2=?)', 
					[id1, id2, id2, id1], function(err,rows,fields){

					conn.release();
					if(err){
						shared.logger.info(err);
						return;
					}
					
					var _message = {
        								action: 'operation-notify',
        								msg: {
        									to_user_id: message.msg.message.target_user_id,
                							from_user_id: message.msg.user_id,
                							message_type: 'friend-delete',
        								}
        							}

        			server_model.write_message(message.msg.message.target_user_id, _message, true);
        						
        			_message.msg.to_user_id=message.msg.user_id;
        			_message.msg.from_user_id=message.msg.message.target_user_id;
        			server_model.write_message(message.msg.user_id, _message, true);

					});
				});
			break;
		}
	}

});


server_model = new server_model({});


exports.client_model = client_model;
exports.server_model = server_model;
















