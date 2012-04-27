#!/usr/bin/env node

process.env.IRC_NODE_PATH = './';

var irc = require('../lib/ircnode'),
    net = require('net'),
    assert = require('assert');

var testServer = net.createServer(function testIrcNode(c) {
  console.log('Connection received');
  c.once('data', function(data) {
    assert.equal(data.toString(),
      'NICK ' + irc.config.nick + '\r\n' +
        'USER ' + irc.config.user + ' 8 * :' + irc.config.realName + '\r\n' +
        'JOIN ' + irc.config.chan + '\r\n');
    c.once('data', function(data) {
      assert.equal(data.toString(), 'PONG :burgle\r\n');
    });
    c.write('PING :burgle\r\n');
  });

});

testServer.listen(22121);


irc.config.port = 22121;
irc.config.address = '127.0.0.1';

assert.throws(function() {
  /* Break the default irc owner.
   * Check for error thrown on connect.
   * Must have the phrase 'admin' somewher to pass.
   */
  irc.users.ircnode_owner.auth = null;
  irc.connect(3313);
}, /admin/);
irc.users.ircnode_owner.auth = 'owner'; // Fix it.

irc.connect();

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

