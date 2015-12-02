
// api
exports.api = {
  host: '127.0.0.1',  // server self ip
  port: 9018,
  name: 'xim api'
};

exports.socket = {
  host: '127.0.0.1', // server self ip
  port: 9019
};


// mysql
exports.mysql = {
  host: '127.0.0.1',
  port: '3306',
  user: 'mysql',
  password: 'mysql',
  database: 'XIM',

  connection_limit: 100,
  queue_limit: 100
};


// redis
exports.redis = {

  // pub/sub
  pubhost: '127.0.0.1',
  pubport: 6379,

  subhost: '127.0.0.1',
  subport: 6379,
  
  // db
  dbhost: '127.0.0.1',
  dbport: 6379
};


// winston
exports.log = {
    path: __dirname+'/xim.log',
    level: 'debug'  // could be silly=0,  verbose=1, info=2, warn=3, debug=4, error=5
};
