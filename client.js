#!/usr/bin/env node
var fs        = require('fs');
var net       = require('net');
var events    = require('events');
var path      = require('path');

var irc = module.exports = {};
irc._socket = new net.Socket({'type': 'tcp4'});
irc.send = function (content, callback) {
  irc._socket.write(content, callback);
};

var config_path = (process.env.IRC_NODE_PATH ||
                   process.env[(process.platform === 'win32') ?
                   'USERPROFILE' : 'HOME'] + '/.ircnode');

var config_file = config_path + '/config';
var user_file   = config_path + '/users.json';
var plugin_dir  = config_path + '/plugins/';
var log_file    = config_path + '/bot.log';
var lock_file   = '/tmp/ircnode.pid';

irc.auth_levels = [ 'admin', 'owner' ];

// If started as main and config files don't exist,
// make them.
if (require.main === module) {
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
      fs.writeFileSync(file, fs.readFileSync(sample_file));
      console.log('Creating a new ' + file + ' + file.');
      review_required = true;
    }
  });
  if (review_required) {
    console.log('Please review the configuration files in ' + config_path);
    process.exit();
  }
}

irc.userLoop = setInterval(function () {
  fs.writeFile(user_file, JSON.stringify(irc.users, null, 2));
}, 20000);

irc.config  = JSON.parse(fs.readFileSync(config_file));
irc.users   = JSON.parse(fs.readFileSync(user_file));

irc.reserved_words = ['PRIVMSG', 'PING', 'PART', 'JOIN', 'QUIT'];

irc.command_char = (process.env.IRC_NODE_PREFIX || irc.config.prefix || '!');
irc.debug = process.env.IRC_NODE_DEBUG !== 'false';
irc.emitter = new events.EventEmitter();

var args = process.argv;
var dPID;

switch (args[2]) {
case "start":
  if (path.existsSync(lock_file)) {
    console.log('IRC Node seems to be already running on this system!');
    console.log('If this is not true, please delete the ' + lock_file);
    process.exit(0);
  } else {
    try {
      var daemon = require('daemon');
    } catch (err) {
      if (process.platform === 'win32') {
        console.log('There is no daemon support for Windows.');
      } else {
        console.log('You do not have daemon.node available. Please');
        console.log('run \'npm install daemon\' to install it to the');
        console.log('working directory.');
      }
      console.log('You can still launch the bot without daemon');
      console.log('by simply launching it without any arguments.');
      process.exit(0);
      break;
    }
    dPID = daemon.start(fs.openSync(log_file, 'a+'));
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
  try {
    var daemon = require('daemon');
  } catch (err) {
    if (process.platform === 'win32') {
      console.log('There is no daemon support for Windows.');
    } else {
      console.log('You do not have daemon.node available. Please');
      console.log('run \'npm install daemon\' to install it to the');
      console.log('working directory.');
    }
    console.log('You can still launch the bot without daemon');
    console.log('by simply launching it without any arguments.');
    process.exit(0);
    break;
  }
  dPID = daemon.start(fs.openSync(log_file, 'a+'));
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
}

var version = '(unknown version)';
path.exists(__dirname + '/.git/', function (exists) {
  if (exists) {
    var exec = require('child_process').exec;
    exec("git log -n1 --format=%h",
         function (err, stdout, stderr) {
          version = 'commit ' + stdout;
        }
    );
  } else {
    path.exists(__dirname + '/package.json', function (exists) {
      if (exists) {
        fs.readFile(__dirname + '/package.json', 'utf8', function (err, data) {
          if (err !== null) console.log(err);
          else
            try {
              version = JSON.parse(data).version;
            } catch (err) {
              console.log(err);
            }
        });
      } else {
        path.exists(__dirname + '/../ircnode/package.json', function (exists) {
          if (exists) {
            fs.readFile(__dirname + '/../ircnode/package.json', 'utf8', function (err, data) {
              if (err !== null) console.log(err);
              else
                try {
                  version = JSON.parse(data).version;
                } catch (err) {
                  console.log(err);
                }
            });
          }
        });
      }
    });
  }
});

irc.check_level = function (nick, level, callback) {
  if (typeof irc.users[nick] === 'undefined')
    callback(false);
  else if (typeof irc.users[nick].auth === 'undefined')
    callback(false);
  else if (irc.auth_levels.indexOf(level) !== -1) {
    var listener = function (data) {
      var params = data.split(' ').slice(4);
      var source = data.slice(0, data.indexOf('!'));
      if (params.length < 2) return;
      if (source !== 'NickServ') return;
      if (params[params.length - 2] === nick) {
        irc.emitter.removeListener('NOTICE', listener);
        if (params[params.length - 1] === '3')
          callback(true);
        else
          callback(false);
      }
    };
    irc.emitter.on('NOTICE', listener);
    irc.privmsg('NickServ', 'ACC ' + nick);
    irc.privmsg('NickServ', 'STATUS ' + nick);
  } else
    callback(false);
};

irc.is_admin = function (nick, callback) {
  irc.check_level(nick, 'admin', callback);
};

irc.is_owner = function (nick, callback) {
  irc.check_level(nick, 'owner', callback);
};


irc._wrapMessage = function (target, msg) {
  return 'PRIVMSG ' + target + ' :' + msg + '\r\n';
};

irc.privmsg  = function (target, msg) {
  irc.send(irc._wrapMessage(target, msg));
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

  params[3] = params[3].slice(1 + irc.command_char.length);

  action.cmd = params[3];
  action.params = params.slice(4);
  action.data   = data;

  return action;
};

irc._wrapAction = function (options) {
  if (irc.debug) console.log(options);
  var string = options.action;
  if (typeof options.params !== 'undefined') {
    string += ' ' + options.params.join(' ');
  }
  if (typeof options.longParam !== 'undefined') {
    string += ' :' + options.longParam;
  }
  if (irc.debug) console.log(string);
  return string + '\r\n';
};

irc.act = function act(options, callback) {
  irc.send(irc._wrapAction(options), callback);
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
    if (irc.debug) console.log('Quitting . . .');
    callback();
    process.exit(0);
  });
};

/* Sequential callbacks, pulled out for readability.
 * The sequence is started in irc.connect */
function initChans() {
  var has_admin = false;
  for (var u in irc.users) {
    if (typeof irc.users[u] !== 'undefined')
      if (typeof irc.users[u].auth !== 'undefined')
        if (irc.users[u].auth === 'admin' || irc.users[u].auth === 'owner')
          has_admin = true;
  }
  if (!has_admin) {
    throw ("An admin must be configured in users.json!");
  }

  var chan = irc.config.chan;
  if (chan instanceof Array) {
    for (var i = 0, l = chan.length; i < l; i += 1) {
      irc.join(chan[i]);
    }
  } else {
    irc.join(chan);
  }
}

function sendUser() {
  var user = irc.config.user;
  var realName = irc.config.realName;
  irc.user(user, '8', realName, initChans);
}

function sendNick() {
  var nick = irc.config.nick;
  irc.nick(nick, sendUser);
}
/* End sequential callbacks */

irc.connect = function connect(args) {
  // Allow programmatic overriding of config settings.
  if (typeof args !== 'undefined') {
    for (var i in args) {
      irc.config[i] = args[i];
    }
  }

  // Here begins the sequence ;)
  irc._socket.connect(irc.config.port, irc.config.address, sendNick);
};

irc._socket.on('data', function onData(data) {
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

irc._pongHandler = function pongHandler(data) {
  // We only wrap pongs, write them to the socket for testing.
  var address = data.slice(data.indexOf(':') + 1);
  return irc._wrapAction({action: 'PONG', longParam: address});
};

irc.emitter.on('PING', function (data) {
  irc.send(irc._pongHandler(data));
});

irc.emitter.on('PRIVMSG', function (data) {

  // Look for first character of the message.
  if (data.substring(data.indexOf(':') + 1, data.indexOf(':') + 1
                     + irc.command_char.length) === irc.command_char) {
    var action = irc.splitcmd(data);
    if (irc.debug) console.log(action);
    if (irc.reserved_words.indexOf(action.cmd) === -1)
      irc.emitter.emit(action.cmd, action);
  }
});

global.irc = irc;
irc.plugins = [];
fs.readdir(plugin_dir, function (err, files) {
  for (var i = 0, len = files.length; i < len; i += 1) {
    var ppath = plugin_dir + files[i];
    if (ppath.indexOf('.js', ppath.length - 3) === -1) {
      console.log('Invalid plugin file: ' + files[i]);
    } else {
      var plugin = require(ppath);
      plugin.enabled = true;
      irc.plugins.push(plugin);
      irc.emitter.on(plugin.name, plugin.handler);
    }
  }
});

irc.emitter.on('disable', function (act) {
  irc.check_level(act.nick, 'admin', function (is_admin) {
    if (is_admin) {
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
});

irc.emitter.on('enable', function (act) {
  irc.check_level(act.nick, 'admin', function (is_admin) {
    if (is_admin) {
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
  irc.check_level(act.nick, 'owner', function (is_owner) {
    if (is_owner) {
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

irc.emitter.on('version', function (act) {
  irc.privmsg(act.source, 'IRC Node ' + version);
});

if (require.main === module) {
  irc.connect();
}
