var socket = null;
var user = null;
var vue = null;

function init_socket(u){
    user=u;

	socket.onopen = function(){
        socket.send(JSON.stringify({
        	action:'init',
                msg:{user_id:u.ID+''}
        }));
	};

	socket.onmessage = function(e){
        var msg=JSON.parse(e.data);

        switch(msg.action){
            case 'message':
                if(!vue.message[msg.msg.from_user_id])
                    vue.message[msg.msg.from_user_id]=[];

                vue.message[msg.msg.from_user_id].push(msg);
            break;
            case 'state-notify':
            break;
        }
        
    };

    socket.onclose = function(){
    };

};


Vue.component('login-component', function(resolve, reject) {
    Vue.http.get('/template/login.html').then(function(res){
        var parser = new DOMParser();
        var doc = parser.parseFromString(res.data, "text/html").body.innerHTML.trim();
        resolve({
        	data:function(){
        		return {
			    	username: '',
			    	password: ''			 	
			    }
        	},
			ready:function(){
			  	this.username=Cookies.get('username');
			  	this.password=Cookies.get('password');
			},

			methods:{
				login:function(){
					this.$http.post('http://127.0.0.1:9018/api/v1/login', {email:this.username, password:this.password}).then(function(res){
			      	Cookies.set('username', this.username);
			  		Cookies.set('password', this.password);

			  		socket=new SockJS('http://127.0.0.1:9019/xim/chat');
			  		init_socket(res.data);
			        this.$parent.login=true;
			      }, function(error) {
			        this.username='';
			        this.password='';
			        console.log(error);
			      });

			    }/* login */
			},

            template: doc
        });
    },
    function(err){
    	reject(err);
    }
    );
});


Vue.component('chat-component', function(resolve, reject) {
    Vue.http.get('/template/chat.html').then(function(res){
        var parser = new DOMParser();
        var doc = parser.parseFromString(res.data, "text/html").body.innerHTML.trim();
        resolve({
        	data:function(){
        		return {
                    id: user.ID,
                    nick_name: user.NICK_NAME,
                    friends: user.FRIENDS,
                    groups: user.GROUPS,
                    imessage:'',
                    to_user_id: null,
                    group_id: null,
                    message: {},
                    current_message:[]
			    }
        	},
			ready:function(){
			  	vue = this;
			},

			methods:{
                send: function(){
                    if(!this.imessage){
                        alert('发送内容不能为空!');
                        return;
                    }

                    if(this.to_user_id){
                        var msg={
                            action:'message',
                            msg:{
                                    to_user_id: this.to_user_id+'',
                                    from_user_id: this.id+'',
                                    message_type: 'text',
                                    message: this.imessage,
                                    timestamp: new Date().toJSON().replace('T', ' ').substr(0, 19)
                                }
                        }
                        socket.send(JSON.stringify(msg));
                        this.imessage='';

                        if(!this.message[this.to_user_id])
                            this.message[this.to_user_id]=[];

                        this.message[this.to_user_id].push(msg);
                        this.current_message=this.message[this.to_user_id]
                    }else if(this.group_id){

                    }
                    else{
                        alert('先选择一个朋友或组!');
                    }
                },

                fclick:function(event){
                    this.group_id=null;
                    this.to_user_id=event.path[1].id+'';

                    this.current_message=this.message[this.to_user_id]||[];
                }
			},

            template: doc
        });
    },
    function(err){
    	reject(err);
    }
    );
});


var main = new Vue({
  el:'body',
  data:function(){
  	return {
  		login: false
  	}
  },

  methods:{
  } /* method */
});











