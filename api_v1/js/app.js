var socket = null;
var user = null;

function init_socket(u, vue){
    user=u;

    console.log(u);
	socket.onopen = function(){
        socket.send(JSON.stringify({
        	action:'init',
                msg:{user_id:u.ID+''}
        }));
	};

	socket.onmessage = function(e){
        var msg=JSON.parse(e.data);
        console.log(e.data);
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
			  		init_socket(res.data, this);
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
                    groups: user.GROUPS
			    }
        	},
			ready:function(){
			  	
			},

			methods:{
			
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











