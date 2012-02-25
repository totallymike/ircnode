var fs        = require('fs');
var net       = require('net');
var events    = require('events');
var path      = require('path');

var irc = {};

var config_path = (process.env.IRC_NODE_PATH ||
                   process.env.HOME + '/.ircnode');
var config_file = config_path + '/config';
var user_file   = config_path + '/users.json';
var plugin_dir  = config_path + '/plugins/';
var log_file    = config_path + '/bot.log';
var lock_file   = '/tmp/ircnode.pid';

var exists = path.existsSync(config_path);
if (!exists) {
  fs.mkdirSync(config_path, '0755');
  fs.mkdir(plugin_dir, '0755');
}

var review_required = false;
[config_file, user_file].forEach(function (file) {
  var exists = path.existsSync(file);
  if (!exists) {
    var sample_file = './' + path.basename(file) + '.sample';
    fs.openSync(file, 'w+');
    fs.writeFileSync(file, sample_file);
    console.log('Creating a new ' + file + ' + file.');
    review_required = true;
  }
});
if (review_required) {
  console.log('Please review the configuration files in ' + config_path);
  process.exit();
}

irc.config  = JSON.parse(fs.readFileSync(config_file));
irc.users   = JSON.parse(fs.readFileSync(user_file));

irc.command_char = '!';
irc.debug = process.env.IRC_NODE_DEBUG !== 'false';
irc.emitter = new events.EventEmitter();

var args = process.argv;
var dPID;

switch (args[2]) {
case "front":
  break;

case "start":
  if (path.existsSync(lock_file)) {
    console.log('IRC Node seems to be already running on this system!');
    console.log('If this is not true, please delete the ' + lock_file);
    process.exit(0);
  } else {
    var daemon = require('daemon');
    dPID = daemon.start(fs.openSync(log_file, 'w+'));
    daemon.lock(lock_file);
  }
  break;

case "restart":
  if (!path.existsSync(lock_file)) {
    console.log('IRC Node was not running before on this system!');
  } else {
    process.kill(parseInt(fs.readFileSync(lock_file), 10));
    fs.unlinkSync(lock_file);
  }
  var daemon = require('daemon');
  dPID = daemon.start(fs.openSync(log_file, 'w+'));
  daemon.lock(lock_file);
  break;

case "stop":
  if (!path.existsSync(lock_file)) {
    console.log('IRC Node does not seem to be running on this system!');
  } else {
    process.kill(parseInt(fs.readFileSync(lock_file), 10));
    fs.unlinkSync(lock_file);
  }
  process.exit(0);
  break;

default:
  console.log('Usage: js client.js [front|start|restart|stop]');
  process.exit(0);
}

fs.openSync(log_file, 'w+');
process.stdout = process.stderr = fs.createWriteStream(log_file);

irc.is_admin = function (nick) {
  if (typeof irc.users[nick] === 'undefined')
    return false;
  
  return (irc.users[nick].auth === 'admin' || irc.users[nick].auth === 'owner');
};

irc.is_owner = function (nick) {
  if (typeof irc.users[nick] === 'undefined')
    return false;

  return (irc.users[nick].auth === 'owner');
};

irc.privmsg  = function (target, msg) {
  irc._socket.write('PRIVMSG ' + target + ' :' + msg + '\r\n');
};

irc.splitcmd = function (data) {
  var action = {};
  var params = data.split(' ');

  var nickuser = data.substring(0, data.indexOf(' '));
  action.nick = nickuser.split('!')[0];
  action.user = nickuser.split('!')[1].split('@')[0];
  action.host = nickuser.split('!')[1].split('@')[1];

  action.channel = params[2];
  if (action.channel === irc.config.nick)
    action.source = action.nick;
  else
    action.source = action.channel;

  params[3] = params[3].slice(2);

  action.cmd = params[3];
  action.params = params.slice(4);
  action.data   = data;

  return action;
};

irc.act = function (options, callback) {
  if (irc.debug) console.log(options);
  var string = options.action + ' ';
  if (typeof options.params !== 'undefined') {
    string += options.params.join(' ');
  }
  if (typeof options.longParam !== 'undefined') {
    string += ' :' + options.longParam;
  }
  if (irc.debug) console.log(string);
  irc._socket.write(string + '\r\n', callback);
};

irc.join = function (channel, callback) {
  irc.act({action: 'JOIN', params: [channel]}, callback);
};

irc.part = function (channel, msg, callback) {
  irc.act({action: 'PART', params: [channel, msg]}, callback);
};

irc.nick = function (nick, callback) {
  irc.act({action: 'NICK', params: [nick]}, callback);
};

irc.user = function (user, mode, realName, callback) {
  irc.act({action: 'USER', params: [user, mode, '*'],
          longParam: realName}, callback);
};

irc.quit = function (msg, callback) {
  irc.act({action: 'QUIT', params: [msg]}, function () {
    if (path.existsSync(lock_file))
      fs.unlinkSync(lock_file);
    callback();
    process.exit(0);
  });
};

irc._socket = net.connect(irc.config.port, irc.config.address, function () {
  var nick      = irc.config.nick;
  var user      = irc.config.user;
  var realName  = irc.config.realName;
  var chan      = irc.config.chan;

  irc.nick(nick, function () {
    irc.user(user, '8', realName, function () {
      var has_admin = false;
      for (var u in irc.users) {
        if (irc.is_admin(u)) {
          has_admin = true;
        }
      }
      if (!has_admin) {
        throw ("An admin must be configured in users.json!");
      }
      
      if (chan instanceof Array) {
        for (var i = 0, l = chan.length; i < l; i += 1) {
          irc.join(chan[i]);
        }
      } else {
        irc.join(chan);
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
fs.readdir(plugin_dir, function (err, files) {
  for (var i = 0, len = files.length; i < len; i += 1) {
    var plugin = require(plugin_dir + files[i]);
    plugin.enabled = true;
    irc.plugins.push(plugin);
    irc.emitter.on(plugin.name, plugin.handler);
  }
});

irc.emitter.on('disable', function (act) {
  if (irc.is_admin(act.nick) === true) {
    for (var p in irc.plugins) {
      if (irc.plugins[p].name === act.params[0]) {
        irc.plugins[p].enabled = false;
        irc.emitter.removeListener(irc.plugins[p].name, irc.plugins[p].handler);
        irc.privmsg(act.source, act.params[0] + ' disabled');
      }
    }
  } else {
    irc.privmsg(act.source, 'ERROR: not authorized');
  }
});

irc.emitter.on('enable', function (act) {
  if (irc.is_admin(act.nick) === true) {
    for (var p in irc.plugins) {
      if (irc.plugins[p].name === act.params[0] &&
          irc.plugins[p].enabled === false) {
        irc.plugins[p].enabled = true;
        irc.emitter.on(irc.plugins[p].name, irc.plugins[p].handler);
        irc.privmsg(act.source, act.params[0] + ' enabled');
      }
    }
  } else {
    irc.privmsg(act.source, 'ERROR: not authorized');
  }
});

irc.emitter.on('set_auth', function (act) {
  var nick  = act.params[0];
  var level = act.params[1];
  var user  = irc.users[nick];

  if (typeof user === 'undefined')
    irc.users[nick] = {};

  if (act.params.length < 2) {
    irc.privmsg(act.source, 'ERROR: Insufficient parameters');
    return (1);
  }
  if (level !== 'user' && level !== 'owner' && level !== 'admin') {
    irc.privmsg(act.source, 'ERROR: Invalid parameter: ' + level);
    return (1);
  }
  if (irc.is_owner(act.nick)) {
    if (nick === act.nick) {
      irc.privmsg(act.source, 'ERROR: Cannot change your own permissions!');
    } else {
      user.auth = level;
      irc.privmsg(act.source, nick + ' made to ' + level);
    }
  } else {
    irc.privmsg(act.source, 'ERROR: Insufficient privileges');
  }
});

irc.emitter.on('PRIVMSG', function (data) {
  var nick = data.slice(0, data.indexOf('!'));
  if (typeof irc.users[nick] === 'undefined') {
    irc.users[nick] = {};
  }
  if (data.split(' ')[2] !== irc.config.nick) {
    irc.users[nick].seen_time = new Date().toUTCString();
    irc.users[nick].seen_msg  = data.slice(data.indexOf(':') + 1);
    irc.users[nick].seen_channel = data.split(' ')[2];
  }
});

irc.emitter.on('seen', function (act) {
  var nick = act.params[0] ? act.params : act.nick;
  if (typeof irc.users[nick] === 'undefined' ||
      typeof irc.users[nick].seen_msg === 'undefined' ||
      typeof irc.users[nick].seen_time === 'undefined') {
    irc.privmsg(act.source, 'Unknown nick: ' + nick);
    return (1);
  }
  irc.privmsg(act.source, nick + ' last seen: ' + irc.users[nick].seen_time +
              " saying '" + irc.users[nick].seen_msg + "' in " +
              irc.users[nick].seen_channel);
});
