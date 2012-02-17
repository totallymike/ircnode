var fs      = require('fs');
var net     = require('net');
var events  = require('events');

var address   = 'irc.linuxfromscratch.org';
var port      = 6667;
var myNick      = 'tm_bot';
var myUser      = 'tm_bot';
var realName  = "tm bot";

var irc = {};

irc.command_char = '!';
irc.debug = false;
irc.emitter = new events.EventEmitter();

irc.splitcmd = function (data) {
  var action = {};
  var params = data.split(' ');

  var nickuser = data.substring(0, data.indexOf(' '));
  action.nick = nickuser.split('!')[0];
  action.user = nickuser.split('!')[1].split('@')[0];
  action.host = nickuser.split('!')[1].split('@')[1];
  
  action.channel = params[2];

  params[3] = params[3].slice(2);

  action.cmd = params[3];
  action.params = params.slice(4);
  action.data   = data;

  return action;
};

irc.socket = net.connect(port, address, function () {
  irc.socket.write('NICK ' + myNick + '\r\n');
  irc.socket.write('USER ' + myUser + ' 8 * :' + realName + '\r\n');
  irc.socket.write('JOIN #tm_test\r\n');
});

irc.socket.on('data', function (data) {
  data = data.toString();

  if (irc.debug) {
    console.log(data);
  }

  var params = data.split(' ');
  if (data[0] === ':') {
    // Chop off initial colon, send to emitter.
    // also chop off \r\n
    irc.emitter.emit(params[1], data.slice(1, -2));
  } else {
    irc.emitter.emit(params[0], data);
  }
});

irc.emitter.on('PING', function (data) {
  irc.socket.write('PONG ' + data.slice(data.indexOf(':')) + '\r\n');
});

irc.emitter.on('PRIVMSG', function (data) {

  // Look for first character of the message.
  if (data[data.indexOf(':') + 1] === irc.command_char) {
    var action = irc.splitcmd(data);
    console.log(action);
    irc.emitter.emit(action.cmd, action);
  }
});

global.irc = irc;
irc.plugins = [];
fs.readdir('plugins', function(err, files) {
  for (var i = 0, len = files.length; i < len; i += 1) {
    irc.plugins.push(require('./plugins/' + files[i]));
  }
});
