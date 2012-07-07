#!/usr/bin/env node
var fs        = require('fs'),
    path      = require('path'),
    irc       = require('ircnode');

var config_path = (process.env.IRC_NODE_PATH || process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'] + '/.ircnode');
var log_file    = config_path + '/bot.log';
var lock_file   = (process.env.IRC_NODE_PID_FILE || config_path + '/ircnode.pid');

var args = process.argv;
var dPID;

switch (args[2]) {
case "start":
  if (fs.existsSync(lock_file)) {
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
  if (!fs.existsSync(lock_file)) {
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
  if (!fs.existsSync(lock_file)) {
    console.log('IRC Node does not seem to be running on this system!');
  } else {
    process.kill(parseInt(fs.readFileSync(lock_file), 10));
    fs.unlinkSync(lock_file);
  }
  process.exit(0);
  break;
}

irc.connect();
