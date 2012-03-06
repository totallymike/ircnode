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
  setTimeout(function () {
    if (chan instanceof Array) {
      for (var i = 0, l = chan.length; i < l; i += 1) {
        irc.join(chan[i]);
      }
    } else {
      irc.join(chan);
    }
  }, irc.config.waitTime);

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

if (process.env.IRC_NODE_ENABLE_KNOW !== 'false') {
  var parsePhrase = function (phrase) {
    phrase = phrase.replace(/%nick/gi, irc.config.nick);
    phrase = phrase.replace(/%re/gi, '');
    return phrase.toLowerCase();
  };

  var msgContainsPhrase = function (msg, phrase) {
    phrase = phrase.replace(/%nick/gi, irc.config.nick);
    if (phrase.indexOf('%re') !== -1) {
      while (phrase.indexOf('%re') !== -1) {
        var phrase1 = phrase.slice(0, phrase.indexOf('%re'));
        var phrasex = phrase.slice(phrase.indexOf('%re') + 3);
        var phrasere = phrasex.slice(0, phrasex.indexOf('%re'));
        var phrase2 = phrasex.slice(phrasex.indexOf('%re') + 3);
        try {
          var regexp = (phrasere.split('/').length > 1) ? (new RegExp(phrasere.split('/')[1], phrasere.split('/')[2])) : (new RegExp(phrasere, 'i'));
          phrase = phrase1 + phrase2;
          if (msg.indexOf(phrase1.trim()) === -1 || msg.indexOf(phrase2.trim()) === -1 || msg.search(regexp) === -1) {
            return false;
          }
        } catch (err) {
          console.log('WARNING: Unable to parse \'' + phrasere + '\' into a RegExp. Error: ' + err.message);
          return false;
        }
      }
      return true;
    } else {
      return msg.indexOf(phrase.toLowerCase()) !== -1;
    }
  };

  if (!path.existsSync(config_path + '/know.json'))
    fs.writeFileSync(config_path + '/know.json', '{ "action": { }, "regular": { } }', 'utf8');
  var know_dict = JSON.parse(fs.readFileSync(config_path + '/know.json', 'utf8'));
  setInterval(function () {
    try {
      var new_dict = JSON.parse(fs.readFileSync(config_path + '/know.json', 'utf8'));
      know_dict = new_dict;
    } catch (err) {
      console.log('WARNING: Unable to update the "know" dictionary. Error: ' + err.message);
    }
  }, 20000);

  irc.emitter.on('PRIVMSG', function (data) {
    var msg = data.slice(data.indexOf(':') + 1).toLowerCase();
    var source = data.split(' ')[2];
    if (source === irc.config.nick)
      source = data.slice(0, data.indexOf('!'));

    if (data.slice(data.indexOf(':') + 1).substring(0, 7) === '\u0001ACTION' &&
        msg.substring(msg.length - 1, msg.length) === '\u0001') {
      msg = msg.substring(8, msg.length - 1);
      for (var valuea1 in know_dict.action)
        if (msgContainsPhrase(msg, valuea1))
          irc.privmsg(source, know_dict.action[valuea1].response);
    } else if (msg.substring(0, irc.command_char.length + 6) !== irc.command_char + 'forget' &&
        msg.substring(0, irc.command_char.length + 5) !== irc.command_char + 'learn')
      for (var valuer1 in know_dict.regular)
        if (msgContainsPhrase(msg, valuer1))
          irc.privmsg(source, know_dict.regular[valuer1].response);
  });

  irc.emitter.on('learn', function (act) {
    irc.check_level(act.nick, 'admin', function (is_admin) {
      if (is_admin) {
        var input = act.params.join(' ').split('"');
        if (input.length < 5)
          irc.privmsg(act.source, 'Usage: ' + irc.command_char + 'learn "LISTENER" "RESPONSE"');
        else {
          var listener = input[1];
          var response = input[3];
          if (listener === '')
            irc.privmsg(act.source, 'Unable to add an empty listener.');
          else if (response === '')
            irc.privmsg(act.source, 'Unable to add an empty response.');
          else {
            if (listener.substring(0, 4) === '/me ') {
              know_dict.action[listener.substring(4, listener.length).toLowerCase()] = { "response": response, "hidden": "false" };
              irc.privmsg(act.source, 'Added the "' + parsePhrase(listener) +  '" listener.');
              fs.writeFile(config_path + '/know.json', JSON.stringify(know_dict, null, 2), 'utf8');
            } else {
              know_dict.regular[listener.toLowerCase()] = { "response": response, "hidden": "false" };
              irc.privmsg(act.source, 'Added the "' + parsePhrase(listener) + '" listener.');
              fs.writeFile(config_path + '/know.json', JSON.stringify(know_dict, null, 2), 'utf8');
            }
          }
        }
      } else
        irc.privmsg(act.source, 'Not authorized to modify responses.');
    });
  });

  irc.emitter.on('forget', function (act) {
    irc.check_level(act.nick, 'admin', function (is_admin) {
      if (is_admin) {
        var listener = act.params.join(' ');
        if (listener === '')
          irc.privmsg(act.source, 'USAGE: ' + irc.command_char + 'forget LISTENER');
        else {
          if (listener.substring(0, 4) === '/me ' && know_dict.action[listener.substring(4, listener.length).toLowerCase()] !== undefined) {
            delete know_dict.action[listener.substring(4, listener.length).toLowerCase()];
            irc.privmsg(act.source, 'Deleted the "' + parsePhrase(listener) +  '" listener.');
            fs.writeFile(config_path + '/know.json', JSON.stringify(know_dict, null, 2), 'utf8');
          } else if (know_dict.regular[listener.toLowerCase()] !== undefined) {
            delete know_dict.regular[listener.toLowerCase()];
            irc.privmsg(act.source, 'Deleted the "' + parsePhrase(listener) + '" listener.');
            fs.writeFile(config_path + '/know.json', JSON.stringify(know_dict, null, 2), 'utf8');
          } else
            irc.privmsg(act.source, 'Could not find the "' + parsePhrase(listener) + '" listener.');
        }
      } else
        irc.privmsg(act.source, 'Not authorized to modify responses.');
    });
  });

  irc.emitter.on('know', function (act) {
    var output = 'Responses known to: ';
    for (var valuea2 in know_dict.action)
      if (know_dict.action[valuea2].hidden !== 'true')
        output += '\'/me ' + parsePhrase(valuea2) + '\', ';
    for (var valuer2 in know_dict.regular)
      if (know_dict.regular[valuer2].hidden !== 'true')
        output += '\'' + parsePhrase(valuer2) + '\', ';
    if (output === 'Responses known to: ')
      irc.privmsg(act.source, 'No known responses.');
    else {
      output = output.substring(0, output.length - 2);
      if (output.length > 400) {
        var cuts = 0;
        while (output.length > 390) {
          var outArr = output.split(', ');
          outArr.splice(outArr.length - 1, 1);
          output = outArr.join(', ');
          cuts++;
        }
        output += ' and ' + cuts + ' more';
      }
      irc.privmsg(act.source, output);
    }
  });
}

if (require.main === module) {
  irc.connect();
}

