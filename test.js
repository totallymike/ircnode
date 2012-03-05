#!/usr/bin/env node
var irc    = require('./client');
var net    = require('net');
var assert = require('assert');

// Tests how responses to PING are created.
assert.strictEqual(irc._pongHandler('PING :burgle'), 'PONG :burgle\r\n');

// Tests how incomming messages are parsed.
var act = irc.splitcmd('irc!ircnode@localhost PRIVMSG #bots :!test param param2');
var res = {
  "nick": "irc",
  "user": "ircnode",
  "host": "localhost",
  "channel": "#bots",
  "source": "#bots",
  "cmd": "test",
  "params": [ "param", "param2" ],
  "data": "irc!ircnode@localhost PRIVMSG #bots :!test param param2"
};
for (var value in act)
  if (act[value] instanceof Array) {
    for (var sub in act[value])
      assert.strictEqual(act[value][sub], res[value][sub]);
  } else
    assert.strictEqual(act[value], res[value]);

process.exit(0);

