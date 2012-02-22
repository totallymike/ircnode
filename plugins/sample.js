/* A sample plugin.
 * First we take the irc object from global (there has to be a better
 * way to do that).  Here we use it to access the privmsg function,
 * but you could really pull anything that's attached to it.
 *
 * Then we give the plugin a name, designate a handler and export
 * them back to the 'main' module, where they are stored and processed. */

var irc = global.irc;

var m_handler = function(act) {
  if (act.params.length === 0) {
    irc.privmsg(act.channel, 'test');
  } else {
    irc.privmsg(act.channel, act.params.join(' '));
  }
};

/* This is where the final object is built.  'name' is how the plugin
 * will be referred to in methods that control plugins, and handler
 * is the hnadler that is controlled.
 *
 * For example, this plugin is called 'test'.  Admins can enable/disable
 * plugins by using the !enable or !disable command in a channel and calling
 * this name like so:
 * !enable test
 * That will detach the handler, in this case test_handler, from the event
 * emitter. */
exports.name = 'test';
exports.handler = test_handler;
