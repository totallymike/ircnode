var irc = require('./client'),
    net = require('net'),
    assert = require('assert');

assert.equal(irc._pongHandler('PING :burgle'), 'PONG :burgle\r\n');

assert.equal(
  irc.splitcmd('mike!michael@localhost #test :!test action'), 
  {
    'nick': 'mike',
    'source': 'test',
    'user': 'michael',
    'host': 'localhost',
    'channel': '#test',
    'cmd': 'test',
    'params':  ['action'],
    'data': 'mike!michael@localhost #test :!test action'
  }
);



process.exit(0);
