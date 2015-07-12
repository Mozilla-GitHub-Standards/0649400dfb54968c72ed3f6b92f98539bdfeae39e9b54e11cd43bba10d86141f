define(function(require) {
'use strict';

let { extractReferences, extractMessageIdHeader } = '../imap/imapchew';

let { convIdFromMessageId, messageIdComponentFromUmid } =
  require('../id_conversions');

/**
 * Task helper to assist in establishing the conversation relationship for
 * a message given a BrowserBox-style raw message rep.
 */
function* resolveConversationTaskHelper(ctx, msg, umid) {
  // -- Perform message-id header lookups
  let references = extractReferences(msg);
  let msgIdHeader = extractMessageIdHeader(msg);

  let headerIdLookupRequests = new Map();
  for (let ref of references) {
    headerIdLookupRequests.set(ref, null);
  }
  headerIdLookupRequests.set(msgIdHeader, null);

  let fromDb = yield ctx.read({
    headerIdMaps: headerIdLookupRequests
  });

  // -- Check our results
  // Iterate over the results:
  // * keeping track of the conversation ids we find.  Ideally we find zero or
  //   one.  If we find multiple, we need to queue up a merge job.
  // TODO: implement the merge logic, etc.
  // * keeping track of the missing entries in the map.  We will issue writes to
  //   to these as part of this job,
  let conversationIds = new Set();
  let idsLackingEntries = [];
  let existingMessageEntry = null;
  for (let [headerId, result] of fromDb.headerIdMaps) {
    if (headerId === msgIdHeader) {
      existingMessageEntry = headerId;
    }
    if (!result) {
      if (headerId !== msgIdHeader) {
        idsLackingEntries.push(headerId);
      }
      continue;
    }

    // If it's an array then it's an array of MessageIds
    if (Array.isArray(result)) {
      conversationIds.add(convIdFromMessageId(result[0]));
    }
    else if (typeof(result) === 'string') {
      conversationIds.add(result);
    }
  }

  let convId;
  let existingConv;

  // If there isn't a conversation already, derive an id from our umid.
  if (conversationIds.size === 0) {
    convId = messageIdComponentFromUmid(umid);
    existingConv = false;
  }
  // If there's just one, then use it.
  else if (conversationIds.size === 1) {
    convId = Array.from(conversationIds)[0];
    existingConv = true;
  }
  // Otherwise we just arbitarily pick one and schedule a merge.
  else {
    convId = Array.from(conversationIds)[0];
    existingConv = true;
    // TODO: we want to merge it, merge it.  implement that.
  }

  // -- Generate our headerIdMaps writes
  // - Generate our full messageId.
  let messageId = convId + '.' + messageIdComponentFromUmid(umid);

  let headerIdWrites = new Map();
  // For the entries missing things, they just get the conversation id.
  for (let idLackingEntry of idsLackingEntries) {
    headerIdWrites.set(idLackingEntry, convId);
  }
  if (Array.isArray(existingMessageEntry)) {
    existingMessageEntry.push(messageId);
    headerIdWrites.set(msgIdHeader, existingMessageEntry);
  } else {
    headerIdWrites.set(msgIdHeader, [messageId]);
  }

  return {
    convId, existingConv, messageId, headerIdWrites,
    // when merging happens, this may end up being a list with that task in it:
    extraTasks: null
  };
}

return {
  resolveConversationTaskHelper
};

});