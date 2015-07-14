define(function(require) {
'use strict';

const $wbxml = require('wbxml');
const as = require('activesync/codepages/AirSync').Tags;
const ie = require('activesync/codepages/ItemEstimate').Tags;

/**
 * Get an estimate of the number of messages to be synced.
 * TODO: document how/why this needs both a syncKey and a filterType.  Very
 * confusing.
 *
 * @param {ActiveSyncConnection} conn
 * @param {Object} args
 * @param args.protocolVersion
 *   The protocol version in use for minor variation.
 * @param {String} args.folderServerId
 * @param {String} args.folderSyncKey
 * @param {String} args.filterType
 */
function* getItemEstimate(
  conn, { protocolVersion, folderSyncKey, folderServerId, filterType }) {

  let w = new $wbxml.Writer('1.3', 1, 'UTF-8');
  w.stag(ie.GetItemEstimate)
     .stag(ie.Collections)
       .stag(ie.Collection);

  if (protocolVersion.gte('14.0')) {
        w.tag(as.SyncKey, folderSyncKey)
         .tag(ie.CollectionId, folderServerId)
         .stag(as.Options)
           .tag(as.FilterType, filterType)
         .etag();
  }
  else if (protocolVersion.gte('12.0')) {
        w.tag(ie.CollectionId, folderServerId)
         .tag(as.FilterType, filterType)
         .tag(as.SyncKey, folderSyncKey);
  }
  else {
        w.tag(ie.Class, 'Email')
         .tag(as.SyncKey, folderSyncKey)
         .tag(ie.CollectionId, folderServerId)
         .tag(as.FilterType, filterType);
  }

      w.etag(ie.Collection)
     .etag(ie.Collections)
   .etag(ie.GetItemEstimate);

  let response = yield conn.postCommand(w);

  let e = new $wbxml.EventParser();
  let base = [ie.GetItemEstimate, ie.Response];

  let status, estimate;
  e.addEventListener(base.concat(ie.Status), function(node) {
    status = node.children[0].textContent;
  });
  e.addEventListener(base.concat(ie.Collection, ie.Estimate),
                     function(node) {
    estimate = parseInt(node.children[0].textContent, 10);
  });

  try {
    e.run(response);
  }
  catch (ex) {
    console.error('Error parsing FolderCreate response:', ex, '\n',
                  ex.stack);
    throw 'unknown';
  }

  if (status !== ie.Enums.Status.Success) {
    throw 'unknown';
  }
  else {
    return { estimate };
  }
}

return getItemEstimate;
});
