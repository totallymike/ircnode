var fs        = require('fs'),
    net       = require('net'),
    events    = require('events'),
    path      = require('path');

var irc = module.exports = {};
irc._socket = new net.Socket({'type': 'tcp4'});
irc.send = function (content, callback) {
  irc._socket.write(content, callback);
};

var config_path = (process.env.IRC_NODE_PATH ||
                   process.env[(process.platform === 'win32') ?
                   'USERPROFILE' : 'HOME'] + '/.ircnode');

var config_file = path.join(config_path, 'config');
var user_file   = path.join(config_path, 'users.json');
var host_file   = path.join(config_path, 'hosts.json');
var plugin_dir  = path.join(config_path, 'plugins');
var lock_file   = (process.env.IRC_NODE_PID_FILE || config_path + '/ircnode.pid');

irc.auth_levels = [ 'admin', 'owner' ];

irc.userLoop = setInterval(function () {
  fs.writeFile(user_file, JSON.stringify(irc.users, null, 2));
}, 20000);

irc.config  = JSON.parse(fs.readFileSync(config_file));
irc.users   = JSON.parse(fs.readFileSync(user_file));
try {
  irc.hosts   = JSON.parse(fs.readFileSync(host_file));
} catch(e) {
  irc.hosts   = {};
}

irc.reserved_words = ['PRIVMSG', 'PING', 'PART', 'JOIN', 'QUIT'];

irc.command_char = (process.env.IRC_NODE_PREFIX || irc.config.prefix || '!');
irc.debug = process.env.IRC_NODE_DEBUG !== 'false';
irc.emitter = new events.EventEmitter();

var version = '(unknown version)';
fs.exists(__dirname + '/.git/', function (exists) {
  if (exists) {
    var exec = require('child_process').exec;
    exec("git log -n1 --format=%h",
         function (err, stdout, stderr) {
          version = 'commit ' + stdout;
        }
    );
  } else {
    fs.exists(__dirname + '/package.json', function (exists) {
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
        fs.exists(__dirname + '/../ircnode/package.json', function (exists) {
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

irc.check_level = function (nick, host, level, callback) {
  if (typeof irc.hosts[host] !== 'undefined')
    if (irc.auth_levels.indexOf(level) !== -1 && irc.auth_levels.indexOf(level) <= irc.auth_levels.indexOf(irc.hosts[host])) {
      callback(true);
      return;
    }
  if (typeof irc.users[nick] === 'undefined')
    callback(false);
  else if (typeof irc.users[nick].auth === 'undefined')
    callback(false);
  else if (irc.auth_levels.indexOf(level) !== -1 && irc.auth_levels.indexOf(level) <= irc.auth_levels.indexOf(irc.users[nick].auth)) {
    var listener = function (data) {
      var params = data.split(' ').slice(3);
      params[0] = params[0].slice(1, params[0].length);
      var source = data.slice(0, data.indexOf('!'));
      if (params.length < 2) return;
      if (source !== 'NickServ') return;
      for (var i = 0; i < params.length; i++)
        if (params[i] === nick) {
          irc.emitter.removeListener('NOTICE', listener);
          if (params[params.length - 1] === '3')
            callback(true);
          else
            callback(false);
          break;
        }
    };
    irc.emitter.on('NOTICE', listener);
    irc.privmsg('NickServ', 'ACC ' + nick);
    irc.privmsg('NickServ', 'STATUS ' + nick);
  } else
    callback(false);
};

irc.is_admin = function (nick, host, callback) {
  irc.check_level(nick, host, 'admin', callback);
};

irc.is_owner = function (nick, host, callback) {
  irc.check_level(nick, host, 'owner', callback);
};


irc._wrapMessage = function (target, msg) {
  return 'PRIVMSG ' + target + ' :' + msg + '\r\n';
};

irc.privmsg  = function (target, msg) {
  msg = msg.split('\n');
  for (var i in msg)
    irc.send(irc._wrapMessage(target, msg[i]));
};

irc.splitcmd = function (data) {
  var action = {};
  var params = data.split(' ');

  var nickuser = data.substring(0, data.indexOf(' '));
  action.nick = nickuser.split('!')[0];
  action.user = nickuser.split('!')[1].split('@')[0];
  action.host = nickuser.split('!')[1].split('@')[1];

  action.channel = params[2];
  if (action.channel === irc.config.nick || action.channel === 'tm_test_nick_12345')
    action.source = action.nick;
  else
    action.source = action.channel;

  params[3] = params[3].slice(1 + irc.command_char.length);

  action.cmd = params[3];
  action.params = params.slice(4).join(' ').trim().split(' ');
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
    if (fs.existsSync(lock_file))
      fs.unlinkSync(lock_file);
    if (irc.debug) console.log('Quitting . . .');
    callback();
    process.exit(0);
  });
};

/* Sequential callbacks, pulled out for readability.
 * The sequence is started in irc.connect */
function initChans() {
  var chan = irc.config.chan;
  setTimeout(function () {
    if (chan instanceof Array) {
      for (var i = 0, l = chan.length; i < l; i += 1) {
        irc.join(chan[i]);
      }
    } else {
      irc.join(chan);
    }
  }, irc.config.waitTime);
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

function sendPass() {
  var pass = irc.config.password;
  if (pass !== '')
    irc.act({action: 'PASS', params: [pass]}, sendNick);
  else
    sendNick();
}
/* End sequential callbacks */

irc.connect = function connect(args) {
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

  // Allow programmatic overriding of config settings.
  if (typeof args !== 'undefined') {
    for (var i in args) {
      irc.config[i] = args[i];
    }
  }

  irc._socket.connect(irc.config.port, irc.config.address, sendPass);
};

irc._socket.on('data', function onData(data) {
  data = data.toString().split('\r\n');

  for (var i in data) {
    if (data[i] === '') {
      continue;
    }

    if (irc.debug) {
      console.log(data[i]);
    }

    var params = data[i].split(' ');
    if (data[i][0] === ':') {
      // Chop off initial colon, send to emitter.
      irc.emitter.emit(params[1], data[i].slice(1));
    } else {
      irc.emitter.emit(params[0], data[i]);
    }
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
var pluginsEnabled = {};
function unloadPlugin(filename) {
  var ppath = path.join(plugin_dir, filename);
  if (ppath.indexOf('.js', ppath.length - 3) === -1) {
    console.log('Invalid plugin file: ' + filename);
  } else {
    if (require.cache[ppath] === undefined)
      return;

    var plugin = require.cache[ppath].exports;
    delete require.cache[ppath];

    for (var p in irc.plugins)
      if (irc.plugins[p].name === plugin.name)
        irc.plugins.pop(p);
    for (var command in plugin.commands)
      irc.emitter.removeListener(command, plugin.commands[command]);
    return plugin.store;
  }
}
function loadPlugin(filename) {
  var ppath = path.join(plugin_dir, filename);
  if (ppath.indexOf('.js', ppath.length - 3) === -1) {
    console.log('Invalid plugin file: ' + filename);
  } else {
    var oldStore = unloadPlugin(filename);
    var plugin = require(ppath);
    if (plugin.store === undefined)
      plugin.store = {};
    for (var valueName in oldStore)
      plugin.store[valueName] = oldStore[valueName];
    for (var cmd in plugin.commands) {
      if (pluginsEnabled[cmd] === undefined)
        pluginsEnabled[cmd] = true;
      if (pluginsEnabled[cmd])
        irc.emitter.on(cmd, plugin.commands[cmd]);
    }
    irc.plugins.push(plugin);
  }
}
fs.readdir(plugin_dir, function (err, files) {
  for (var i = 0, len = files.length; i < len; i += 1) {
    loadPlugin(files[i]);
  }
});
fs.watch(plugin_dir, { persistent: false }, function (event, filename) {
  if (!filename) {
    console.log('Filename of modified plugin not provided');
  } else if (event === 'rename') {
    fs.exists(path.join(plugin_dir, filename), function (exists) {
      if (exists) {
        if (irc.debug)
          console.log('Plugin file created: ' + filename);
        loadPlugin(filename);
      } else {
        if (irc.debug)
          console.log('Plugin file deleted: ' + filename);
        unloadPlugin(filename);
      }
    });
  } else {
    if (irc.debug)
      console.log('Plugin file modified: ' + filename);
    loadPlugin(filename);
  }
});

irc.emitter.on('disable', function (act) {
  irc.check_level(act.nick, act.host, 'admin', function (is_admin) {
    if (is_admin) {
      for (var p in irc.plugins) {
        for (var cmd in irc.plugins[p].commands) {
          if (cmd === act.params[0]) {
            pluginsEnabled[cmd] = false;
            irc.emitter.removeListener(cmd, irc.plugins[p].commands[cmd]);
            irc.privmsg(act.source, act.params[0] + ' disabled');
          }
        }
      }
    } else {
      irc.privmsg(act.source, 'ERROR: not authorized');
    }
  });
});

irc.emitter.on('enable', function (act) {
  irc.check_level(act.nick, act.host, 'admin', function (is_admin) {
    if (is_admin) {
      for (var p in irc.plugins) {
        for (var cmd in irc.plugins[p].commands) {
          if (cmd === act.params[0] && pluginsEnabled[cmd] === false) {
            pluginsEnabled[cmd] = true;
            irc.emitter.on(cmd, irc.plugins[p].commands[cmd]);
            irc.privmsg(act.source, act.params[0] + ' enabled');
          }
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
  irc.check_level(act.nick, act.host, 'owner', function (is_owner) {
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
  if (act.channel === irc.config.nick) {
    irc.privmsg(act.source, 'As a security precaution, !seen has been deactivated for private messages. Please use the same command in a room in which the bot resides.');
  } else {
    var nick = act.params[0] ? act.params[0] : act.nick;
    if (typeof irc.users[nick] === 'undefined' ||
        typeof irc.users[nick].seen_msg === 'undefined' ||
        typeof irc.users[nick].seen_time === 'undefined') {
      irc.privmsg(act.source, 'Unknown nick: ' + nick);
      return (1);
    }
    var msg = irc.users[nick].seen_msg;
    if (msg.substring(0, 7) === '\u0001ACTION')
      msg = '***' + nick + msg.substring(7, msg.length - 1);
    irc.privmsg(act.source, nick + ' last seen: ' + irc.users[nick].seen_time + " saying '" + msg + "' in " + irc.users[nick].seen_channel);
  }
});

irc.emitter.on('version', function (act) {
  irc.privmsg(act.source, 'IRC Node ' + version);
});

if (require.main === module) {
  irc.connect();
}

