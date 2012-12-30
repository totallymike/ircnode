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
var pluginData_file = path.join(config_path, 'pluginData.json');

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
irc._emitterRaw = new events.EventEmitter();
irc._emitter = new events.EventEmitter();

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
    var gotOneResponse = false;
    var listener = function (act) {
      if (act.nick !== 'NickServ') return;
      for (var p in act.params) {
        if (act.params[p] === nick) {
          if (gotOneResponse)
            irc._emitter.removeListener('NOTICE', listener);
          gotOneResponse = true;
          callback(act.params.pop() === '3');
          return;
        }
      }
    };
    irc._emitter.on('NOTICE', listener);
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

irc.splitmsg = function (data) {
  var params = data.split(' ');
  var nickuser = data.substring(0, data.indexOf(' '));

  var action = {
    "nick": "",
    "user": "",
    "host": "",
    "channel": params[2],
    "source": nickuser,
    "cmd": params[1],
    "params": [],
    "data": data
  };

  if (nickuser.indexOf('!') !== -1) {
    action.nick = nickuser.split('!')[0];
    action.user = nickuser.split('!')[1].split('@')[0];
    action.host = nickuser.split('!')[1].split('@')[1];

    if (action.channel === irc.config.nick || action.channel === 'tm_test_nick_12345')
      action.source = action.nick;
    else
      action.source = action.channel;
  }

  if (params.length > 3) {
    if (params[3].substr(0, 1) === ':')
      params[3] = params[3].slice(1);
    action.params = params.slice(3).join(' ').trim().split(' ');
  }

  return action;
};

irc.splitcmd = function (data) {
  if (typeof data === 'string')
    data = irc.splitmsg(data);

  data.cmd = data.params[0].slice(irc.command_char.length);
  data.params = data.params.splice(1);

  return data;
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

var dataBuffer = '';
irc._socket.on('data', function onData(data) {
  data = (dataBuffer + data.toString()).split('\r\n');
  dataBuffer = data.pop();

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
      irc._emitterRaw.emit(params[1], data[i].slice(1));
      irc._emitter.emit(params[1], irc.splitmsg(data[i].slice(1)));
    } else {
      irc._emitterRaw.emit(params[0], data[i]);
      irc._emitter.emit(params[0], irc.splitmsg(data[i]));
    }
  }
});

irc._pongHandler = function pongHandler(data) {
  // We only wrap pongs, write them to the socket for testing.
  var address = data.slice(data.indexOf(':') + 1);
  return irc._wrapAction({action: 'PONG', longParam: address});
};

irc._emitterRaw.on('PING', function (data) {
  irc.send(irc._pongHandler(data));
});

irc._emitter.on('PRIVMSG', function (act) {

  // Look for first character of the message.
  if (act.params[0].substr(0, irc.command_char.length) === irc.command_char) {
    act = irc.splitcmd(JSON.parse(JSON.stringify(act)));
    if (irc.debug) console.log(act);
    if (irc.reserved_words.indexOf(act.cmd) === -1)
      irc._emitter.emit(act.cmd, act);
  }
});

global.irc = irc;
irc.plugins = [];
var hooksEnabled = {};
var pluginData = {};
try {
  pluginData = JSON.parse(fs.readFileSync(pluginData_file));
} catch(e) {
}
var pluginDataLoop = setInterval(function () {
  for (var p in irc.plugins)
    pluginData[irc.plugins[p].name] = irc.plugins[p].store;
  fs.writeFile(pluginData_file, JSON.stringify(pluginData, null, 2));
}, 20000);
function unloadPlugin(filename) {
  var ppath = path.join(plugin_dir, filename);
  if (ppath.indexOf('.js', ppath.length - 3) === -1) {
    console.log('Invalid plugin file: ' + filename);
  } else if (require.cache[ppath] !== undefined) {
    var plugin = require.cache[ppath].exports;
    delete require.cache[ppath];

    for (var p in irc.plugins)
      if (irc.plugins[p].name === plugin.name)
        irc.plugins.pop(p);
    for (var hook in plugin.hooks)
      irc._emitter.removeListener(hook, plugin.hooks[hook]);

    pluginData[plugin.name] = plugin.store;
  }
}
function loadPlugin(filename) {
  var ppath = path.join(plugin_dir, filename);
  if (ppath.indexOf('.js', ppath.length - 3) === -1) {
    console.log('Invalid plugin file: ' + filename);
  } else {
    unloadPlugin(filename);
    var plugin = require(ppath);

    if (plugin.store === undefined)
      plugin.store = {};
    if (pluginData[plugin.name] === undefined)
      pluginData[plugin.name] = {};
    for (var valueName in pluginData[plugin.name])
      plugin.store[valueName] = pluginData[plugin.name][valueName];

    for (var hook in plugin.hooks) {
      if (hooksEnabled[hook] === undefined)
        hooksEnabled[hook] = true;
      if (hooksEnabled[hook])
        irc._emitter.on(hook, plugin.hooks[hook]);
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

irc._emitter.on('disable', function (act) {
  irc.check_level(act.nick, act.host, 'admin', function (is_admin) {
    if (is_admin) {
      for (var p in irc.plugins) {
        for (var hook in irc.plugins[p].hooks) {
          if (hook === act.params[0]) {
            hooksEnabled[hook] = false;
            irc._emitter.removeListener(hook, irc.plugins[p].hooks[hook]);
            irc.privmsg(act.source, act.params[0] + ' disabled');
          }
        }
      }
    } else {
      irc.privmsg(act.source, 'ERROR: not authorized');
    }
  });
});

irc._emitter.on('enable', function (act) {
  irc.check_level(act.nick, act.host, 'admin', function (is_admin) {
    if (is_admin) {
      for (var p in irc.plugins) {
        for (var hook in irc.plugins[p].hooks) {
          if (hook === act.params[0] && hooksEnabled[hook] === false) {
            hooksEnabled[hook] = true;
            irc._emitter.on(hook, irc.plugins[p].hooks[hook]);
            irc.privmsg(act.source, act.params[0] + ' enabled');
          }
        }
      }
    } else {
      irc.privmsg(act.source, 'ERROR: not authorized');
    }
  });
});

irc._emitter.on('set_auth', function (act) {
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

irc._emitter.on('PRIVMSG', function (act) {
  if (act.channel !== irc.config.nick) {
    if (irc.users[act.nick] === undefined)
      irc.users[act.nick] = {};
    irc.users[act.nick].seen_time = new Date().toUTCString();
    irc.users[act.nick].seen_msg = act.params.join(' ');
    irc.users[act.nick].seen_channel = act.channel;
  }
});

irc._emitter.on('seen', function (act) {
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

irc._emitter.on('version', function (act) {
  irc.privmsg(act.source, 'IRC Node ' + version);
});

if (require.main === module) {
  irc.connect();
}

