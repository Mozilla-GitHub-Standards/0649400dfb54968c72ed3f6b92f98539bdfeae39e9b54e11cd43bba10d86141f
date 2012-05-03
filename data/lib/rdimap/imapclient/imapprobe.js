/**
 * Validates connection information for an account and verifies the server on
 * the other end is something we are capable of sustaining an account with.
 * Before growing this logic further, first try reusing/adapting/porting the
 * Thunderbird autoconfiguration logic.
 **/

define(
  [
    'imap',
    'exports'
  ],
  function(
    $imap,
    exports
  ) {

/**
 * Right now our tests consist of:
 * - logging in to test the credentials
 *
 * If we succeed at that, we hand off the established connection to our caller
 * so they can reuse it.
 */
function ImapProber(connInfo) {
  var opts = {};
  for (var key in connInfo) {
    opts[key] = connInfo[key];
  }
  //opts.debug = console.debug.bind(console);

  console.log("PROBE attempting to connect to", connInfo.host);
  this._conn = new $imap.ImapConnection(opts);
  this._conn.connect(this.onConnect.bind(this));

  this.onresult = null;
  this.accountGood = null;
}
exports.ImapProber = ImapProber;
ImapProber.prototype = {
  onConnect: function(err) {
    console.log("PROBE connect result:", err);
    if (err) {
      this.accountGood = false;
      this._conn = null;
    }
    else {
      this.accountGood = true;
    }

    var conn = this._conn;
    this._conn = null;

    if (this.onresult)
      this.onresult(this.accountGood, conn);
  },
};

}); // end define
