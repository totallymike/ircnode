var fs        = require('fs');
var net       = require('net');
var events    = require('events');

/* 
var address   = 'irc.linuxfromscratch.org';
var port      = 6667;
var myNick      = 'tm_bot';
var myUser      = 'tm_bot';
var realName  = "tm bot";
*/

var irc = {};

var config_path = (process.env.IRC_NODE_PATH ||
                   process.env.HOME + '/.ircnode');
var config_file = config_path + '/config';
var plugin_dir  = config_path + '/plugins/';

irc.config = JSON.parse(fs.readFileSync(config_file));

irc.command_char = '!';
irc.debug = false;
irc.emitter = new events.EventEmitter();

irc.is_admin = function(nick) {
  // Stub function.
  return true;
}

irc.privmsg  = function (chan, msg) {
  irc._socket.write('PRIVMSG ' + chan + ' :' + msg + '\r\n');
};

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

irc._socket = net.connect(irc.config.port, irc.config.address, function () {
  irc._socket.write('NICK ' + irc.config.nick + '\r\n');
  irc._socket.write('USER ' + irc.config.user + ' 8 * :'
                    + irc.config.realName + '\r\n');
  irc._socket.write('JOIN ' + irc.config.chan + '\r\n');
});

irc._socket.on('data', function (data) {
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
  irc._socket.write('PONG ' + data.slice(data.indexOf(':')) + '\r\n');
});

irc.emitter.on('PRIVMSG', function (data) {

  // Look for first character of the message.
  if (data[data.indexOf(':') + 1] === irc.command_char) {
    var action = irc.splitcmd(data);
    if (irc.debug) console.log(action);
    irc.emitter.emit(action.cmd, action);
  }
});

global.irc = irc;
irc.plugins = [];
fs.readdir(plugin_dir, function(err, files) {
  for (var i = 0, len = files.length; i < len; i += 1) {
    var plugin = require(plugin_dir + files[i]);
    plugin.enabled = true;
    irc.plugins.push(plugin);
    irc.emitter.on(plugin.name, plugin.handler);
  }
});

irc.emitter.on('disable', function(act) {
  if (irc.is_admin(act.nick)) {
    for (var p in irc.plugins) {
      if (irc.plugins[p].name === act.params[0]) {
        irc.plugins[p].enabled = false;
        irc.emitter.removeListener(irc.plugins[p].name, irc.plugins[p].handler);
      }
    }
  }
  irc.privmsg(act.channel, act.params[0] + ' disabled');
});

irc.emitter.on('enable', function(act) {
  if (irc.is_admin(act.nick)) {
    for (var p in irc.plugins) {
      if (irc.plugins[p].name === act.params[0] &&
          irc.plugins[p].enabled === false) {
        irc.plugins[p].enabled = true;
        irc.emitter.on(irc.plugins[p].name, irc.plugins[p].handler);
      }
    }
  }
  irc.privmsg(act.channel, act.params[0] + 'enabled');
});
