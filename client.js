var fs        = require('fs');
var net       = require('net');
var events    = require('events');

var irc = {};

var config_path = (process.env.IRC_NODE_PATH ||
                   process.env.HOME + '/.ircnode');
var config_file = config_path + '/config';
var user_file   = config_path + '/users.json';
var plugin_dir  = config_path + '/plugins/';

irc.config = JSON.parse(fs.readFileSync(config_file));

fs.readFile(user_file, function(err, data) {
  irc.users = JSON.parse(data);
});

irc.command_char = '!';
irc.debug = false;
irc.emitter = new events.EventEmitter();

irc.is_admin = function(nick) {
  if (typeof irc.users[nick] === 'undefined')
    return false;
  
  return (irc.users[nick].auth === 'admin');
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

irc.act = function(options, callback) {
  if (irc.debug) console.log(options);
  var string = options.action + ' ';
  if (typeof options.params !== 'undefined') {
    string += options.params.join(' ');
  }
  if (typeof options.longParam !== 'undefined') {
    string += ' :' + options.longParam;
  }
  if (typeof callback !== 'function') {
    callback = null;
  }
  if (irc.debug) console.log(string);
  irc._socket.write(string + '\r\n', callback);
};

irc.nick = function (nick, callback) {
  irc.act({action: 'NICK', params: [nick]}, callback);
};

var getNewAdmin = function(act) {
  if (typeof irc.users[act.nick] === 'undefined') {
    irc.users[act.nick] = {};
  }
  irc.users[act.nick].auth = 'admin';
  irc.act({action: 'PART', params: ['#bot_needs_admin']});
  irc.emitter.removeListener('hello', getNewAdmin);
  irc.act({action: 'JOIN', params: [irc.config.chan]});
}

irc._socket = net.connect(irc.config.port, irc.config.address, function () {
  var nick = irc.config.nick;
  var user = irc.config.user;
  var realName = irc.config.realName;
  irc.nick(nick, function() {
    irc.act({action: 'USER ',
             params: [user, 8,  '*'],
             longParam: realName}, function() {
      var has_admin = false;
      for (var u in irc.users) {
        if (irc.users[u].auth === 'admin') {
          has_admin = true;
        }
      }
      if (!has_admin) {
        irc.act({action: 'JOIN', params: ['#bot_needs_admin']}, function() {
          irc.emitter.on('hello', getNewAdmin);
        });
      }
    });
  });
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
  if (irc.is_admin(act.nick) === true) {
    for (var p in irc.plugins) {
      if (irc.plugins[p].name === act.params[0]) {
        irc.plugins[p].enabled = false;
        irc.emitter.removeListener(irc.plugins[p].name, irc.plugins[p].handler);
        irc.privmsg(act.channel, act.params[0] + ' disabled');
      }
    }
  } else {
    irc.privmsg(act.channel, 'ERROR: not authorized');
  }
});

irc.emitter.on('enable', function(act) {
  if (irc.is_admin(act.nick) === true) {
    for (var p in irc.plugins) {
      if (irc.plugins[p].name === act.params[0] &&
          irc.plugins[p].enabled === false) {
        irc.plugins[p].enabled = true;
        irc.emitter.on(irc.plugins[p].name, irc.plugins[p].handler);
        irc.privmsg(act.channel, act.params[0] + 'enabled');
      }
    }
  } else {
    irc.privmsg(act.channel, 'ERROR: not authorized');
  }
});

irc.emitter.on('PRIVMSG', function(data) {
  var nick = data.slice(0,data.indexOf('!'));
  if (typeof irc.users[nick] === 'undefined') {
    irc.users[nick] = {};
  }
  irc.users[nick].seen_time = new Date().toUTCString();
  irc.users[nick].seen_msg  = data.slice(data.indexOf(':') + 1);
  irc.users[nick].seen_channel = data.split(' ')[2];
});

irc.emitter.on('seen', function(act) {
  var nick = act.params[0] ? act.params : act.nick;
  irc.privmsg(act.channel, nick + ' last seen: ' + irc.users[nick].seen_time +
              " saying '" + irc.users[nick].seen_msg + "' in " +
              irc.users[nick].seen_channel);
});
