#!/usr/bin/env node
var irc = require('../lib/ircnode'),
    net = require('net'),
    assert = require('assert'),
    testServer = net.createServer();

testServer.listen(3313);


assert.equal(irc._pongHandler('PING :burgle'), 'PONG :burgle\r\n');
process.env.IRC_NODE_PATH = './';

var splitTests = {
  'mike!michael@localhost PRIVMSG #test :!test action': { // normal messages
    'nick': 'mike',
    'source': '#test',
    'user': 'michael',
    'host': 'localhost',
    'channel': '#test',
    'cmd': 'test',
    'params':  ['action'],
    'data': 'mike!michael@localhost PRIVMSG #test :!test action'
  },
  'mike!michael@localhost PRIVMSG tm_test_nick_12345 :!test action': { // test PM
    'nick': 'mike',
    'source': 'mike',
    'user': 'michael',
    'host': 'localhost',
    'channel': 'tm_test_nick_12345',
    'cmd': 'test',
    'params':  ['action'],
    'data': 'mike!michael@localhost PRIVMSG tm_test_nick_12345 :!test action'
  }
};

for (var u in splitTests) {
  var actual = irc.splitcmd(u);
  var expected = splitTests[u];

  assert.deepEqual(actual, expected);
}

process.exit(0);
