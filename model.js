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

	emit_message: function(gmessage){
		var members=this.get('members');
			_.each(members, function(v, k, m){
				
				if(k==gmessage.msg.from_user_id)
					return;

				var message={
					action: 'gmessage',
					msg:{
						group_id: gmessage.msg.group_id,
						to_user_id: k,
						from_user_id: gmessage.msg.from_user_id,
						message_type: gmessage.msg.message_type,
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
			'payload': {},
			'groups': new group_collection()
			}
	},

	emit_group_message: function(gmessage){
		var gs=this.get('groups').where({group_id: gmessage.msg.group_id+''});
		if(gs.length == 0)
			return;
		gs[0].emit_message(gmessage);
	},

	add_group: function(g){
		var groups = self.get('groups');
    	var gs=groups.where({group_id: g.group_id+''});

    	if(gs.length==0)
    		groups.add(g);
	},

	del_group: function(gid){
		var groups = self.get('groups').remove({group_id: gid+''});
	},

	add_friend: function(fid){
		if(!(fid in this.get('friends'))){
			this.get('friends')[fid]='on';
			shared.logger.info('add '+fid);
		}
		
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

	read_group_list: function(){
		var uid = this.get('user_id');
		var self = this;

		shared.mysql_conn.getConnection(function(err,conn){
                conn.query('SELECT NAME,OWNER,C.* FROM XIM_GROUP INNER JOIN(SELECT B.GROUPID, A.USERID,A.GROUP_NAME from XIM_GROUP_MEMBER AS A INNER JOIN(SELECT GROUPID from XIM_GROUP_MEMBER WHERE USERID=?) AS B ON B.GROUPID=A.GROUPID) AS C ON XIM_GROUP.ID=C.GROUPID',
                uid, 
                function(err, rows, fields){
                    conn.release();
                    if(err){
                        shared.logger.info(err);
                    }

                    var groups = self.get('groups');
                    _.each(rows, function(v){
                    	var gs=groups.where({group_id: v.GROUPID+''});
                    	var g=null;
                    	if(gs.length==0){
                    		g=new group_model({
                    			'group_id': v.GROUPID+'',
                    			'owner': v.OWNER+'',
                    			'name': v.NAME
                    		});

                    		groups.add(g);
                    	}
                    	else
                    		g=gs[0];

                    	g.get('members')[v.USERID]=v.GROUP_NAME;
                    	
                    });

                    console.log(JSON.stringify(groups));
                });
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

		this.read_group_list();
	},/*initialize*/


	update_info: function(message){
		switch(message.action){
			case 'foperation':
				switch(message.msg.operation){
					case 'agree':
						self.add_friend(message.msg.from_user_id+'');
					break;

					case 'delete':
						self.del_friend(message.msg.from_user_id+'');
					break;
				}
			break;

			case 'goperation':
				switch(message.msg.operation){
					case 'create':

					break;
					case 'delete':
						self.del_group(message.msg.group_id);
					break;

					case 'in':

					break;
					case 'out':
					break;
				}
			break;
		}
	},

	write_message: function (message) {
		var self = this;
		var socket = this.get('socket');
	    if(socket){
	    	socket.write(JSON.stringify(message));
	    	self.update_info(message);
	     }
    },

	close: function(){
		// delete online info in redis
		var uid = this.get('user_id');
		var self = this;

		this.set('socket', null);
		this.get('groups').reset();
		this.set('groups', null);

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
				shared.logger.info('[write]'+JSON.stringify(message));

			});
		}
		
	},

	emit_group_message: function(gmessage){
		var clients = this.get('clients');
		var cs = clients.where({user_id: gmessage.msg.from_user_id+''});
		if(cs.length == 0)
			return;
		

		cs[0].emit_group_message(gmessage);
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
        						'FROM_GROUPID': message.msg.group_id||null,
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


	process_foperation: function(message){
		switch(message.msg.operation){

			case 'request':
			case 'reject':
				server_model.emit_message(message.msg.to_user_id, message, true);
				break;

			case 'add':
				var clients = this.get('clients');
				var cs = clients.where({user_id: message.msg.from_user_id+''});
				_.each(cs, function(v){
					v.add_friend(message.msg.to_user_id+'');
				});
				server_model.emit_message(message.msg.to_user_id, message, true);

			break;
			case 'delete':
				var clients = this.get('clients');
				var cs = clients.where({user_id: message.msg.from_user_id+''});
				_.each(cs, function(v){
					v.del_friend(message.msg.to_user_id+'');
				});
				server_model.emit_message(message.msg.to_user_id, message, true);
			break;
		}
	},

	process_goperation: function(message){
		switch(message.msg.operation){
			case 'delete':
				var clients = this.get('clients');
				var cs = clients.where({user_id: message.msg.owner_id+''});
				if(cs.length > 0){
					_.each(cs, function(v){
						v.del_group(message.msg.group_id+'');
					});

					var gc=cs[0].get('groups');

					var gs=gc.where({group_id: message.msg.group_id+''});
					if(gs.length > 0){

						_.each(gs[0].get('members'), function(k, v){
							if(k==message.msg.owner_id)
								return;

							var _message={
							action: 'goperation',
							msg:{
									to_user_id: k,
									from_user_id: message.msg.owner_id,
									group_id: message.msg.group_id,
									operation: message.msg.operation,
									message: '',
									timestamp: message.msg.timestamp
								}
							};

							server_model.emit_message(v, _message, true);
						});
					}
				}
			break;

			case 'request':
			case 'reject':
				server_model.emit_message(message.msg.to_user_id, message, true);
			break;

			case ''
		}
	}
});


server_model = new server_model({});


exports.client_model = client_model;
exports.server_model = server_model;
















