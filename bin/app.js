#!/usr/bin/env node
var irc;
try {
  irc = require(__dirname + '/../lib/ircnode.js');
} catch (err) {
  irc = require('ircnode');
}
irc.connect();
