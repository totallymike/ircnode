// Code execution/administration plugin for IRC Node.

var irc = global.irc;

var exec_handler = function (act) {
  irc.check_level(act.nick, 'owner', function (is_owner) {
    if (!is_owner)
      irc.privmsg(act.source, 'ERROR: not authorized');
    else if (act.params.length === 0)
      irc.privmsg(act.source, 'ERROR: missing code');
    else
      try {
        eval(act.params.join(' '));
      } catch (err) {
        irc.privmsg(act.source, 'ERROR: ' + err);
      }
  });
};

exports.name = 'exec';
exports.handler = exec_handler;

