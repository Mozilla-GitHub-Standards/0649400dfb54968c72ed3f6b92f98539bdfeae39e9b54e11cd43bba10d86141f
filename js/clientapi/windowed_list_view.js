define(function(require) {
'use strict';

var evt = require('evt');

/**
 * @typedef {Object} SeekChangeInfo
 * @property {Boolean} offset
 *   Did the offset change?  If so, you might need to do a coordinate-space
 *   fixup in your virtual list at some point.
 * @property {Boolean} totalCount
 *   Did the total number of items in the true list change?  If so, you might
 *   need to adjust the scroll height of your container.
 * @property {Boolean} itemSet
 *   Were items added/removed/reordered from the items list?  If false, then
 *   for all x, `preItems[x] === postItems[x]`.  Items that were not yet loaded
 *   from the database and therefore null count as a change now that they
 *   properly get an object instance.
 * @property {Boolean} itemContents
 *   Did the contents of some of the items change?  If you care about checking
 *   whether an item's contents changed, you can compare its `serial` with the
 *   WindowedListView's `serial`.  If the values are the same then the item was
 *   updated (or new) in this seek.  If this is inefficient for you, we can add
 *   a list of changed indices or whatever works for you.  Let's discuss.
 */

/**
 * A windowed (subset) view into a conceptually much larger list view.  Because
 * a variety of complicated things can happen
 *
 * ## Events ##
 * - `seeked` (SeekChangeInfo): Fired when anything happens.  ANYTHING.  This is
 *   the only event you get and you'll like it.  Because the koolaid is
 *   delicious.
 *
 */
function WindowedListView(api, itemConstructor, handle) {
  evt.Emitter.call(this);
  this._api = api;
  this._handle = handle;
  this._itemConstructor = itemConstructor;

  this.serial = 0;

  /**
   * The index of `items[0]` in the true entire list.  If this is zero, then we
   * are at the top of the list.
   */
  this.offset = 0;
  /**
   *
   */
  this.totalCount = 0;
  /**
   * @type {Array<ItemInstance|null>}
   *
   * The list of items
   */
  this.items = [];
  /**
   * @type {Map<Id, ItemInstance>}
   *
   * Maps id's to non-null object instances.  If we don't have the data yet,
   * then there is no entry in the map.  (This is somewhat arbitrary for
   * control-flow purposes below; feel free to change if you update the control
   * flow.)
   */
  this._itemsById = new Map();

  /**
   * Has this slice been completely initially populated?  If you want to wait
   * for this, use once('complete').
   */
  this.complete = false;

}
WindowedListView.prototype = evt.mix({
  toString: function() {
    return '[WindowedListView: ' + this._itemConstructor.name + ' ' +
           this._handle + ']';
  },
  toJSON: function() {
    return {
      type: 'WindowedListView',
      namespace: this._ns,
      handle: this._handle
    };
  },

  __processUpdate: function(details) {
    let newSerial = ++this.serial;

    let existingSet = this._itemsById;
    let newSet = new Map();


    let newIds = details.ids;
    let newStates = details.values;
    let newItems = [];

    // Detect a reduction in set size by a change in length; all other changes
    // will be caught by noticing new objects.
    let itemSetChanged = newIds.length !== this.items.length;
    let contentsChanged = false;

    // - Process our contents
    for (let i = 0; i < newIds.length; i++) {
      let id = newIds[i];
      let obj;
      // Object already known, update.
      if (existingSet.has(id)) {
        obj = existingSet.get(id);
        // Update the object if we have new state
        if (newStates.has(id)) {
          contentsChanged = true;
          existingObj.serial = newSerial;
          existingObj.__update(newStates.get(id));
        }
        // Remove it from the existingSet so we can infer objects no longer in
        // the set.
        existingSet.delete(id);
        newSet.set(id, obj);
      } else if (newStates.has(id)) {
        itemSetChanged = true;
        obj = new this._itemConstructor(this, newStates.get(id));
        obj.serial = newSerial;
        newSet.set(id, obj);
      } else {
        // No state available yet, push null as a placeholder.
        obj = null;
      }
      newItems.push(obj);
    }

    // - If anything remained, kill it off
    for (let deadObj of existingSet.values()) {
      itemSetChanged = true;
      deadObj.__die();
    }

    let whatChanged = {
      offset: details.offset !== this.offset,
      totalCount: details.totalCount !== this.totalCount,
      itemSet: itemsChanged,
      itemContents: contentsChanged
    };
    this.offset = details.offset;
    this.totalCount = details.totalCount;
    this.items = newItems;
    this._itemsById = newSet;

    this.emit('seeked', whatChanged)
  },

  // TODO: determine whether these are useful at all; seems like the virtual
  // scroll widget needs to inherently know these things and these are useless.
  // These come from a pre-absolutely-positioned implementation.
  get atTop() {
    return this.offset === 0;
  },
  get atBottom() {
    return this.totalCount === this.offset + this.items.length;
  },

  /**
   * Seek to the top of the list and latch there so that our slice will always
   * include the first `numDesired` items in the list.
   */
  seekToTop: function(numDesired) {
    this._api.__bridgeSend({
      type: 'seekProxy',
      mode: 'top',
      above: 0,
      below: numDesired
    });
  },

  /**
   * Seek with the intent that we are anchored to a specific item as long as it
   * exists.  If the item ceases to exist, we will automatically re-anchor to
   * one of the adjacent items at the time of its removal.
   *
   * @param {Object} item
   *   The item to focus on.  This must be a current item in `items` or
   *   we will throw.
   */
  seekFocusedOnItem: function(item, numAbove, numBelow) {
    let idx = this.items.indexOf(item);
    if (idx === -1) {
      throw new Error('item is not in list')
    }
    this._api.__bridgeSend({
      type: 'seekProxy',
      mode: 'focus',
      focusKey: this._makeOrderingKeyFromItem(item),
      above: numAbove,
      below: numBelow
    });
  },

  /**
   * Seek to an arbitrary absolute index in the list and then anchor on whatever
   * item is at that location.  For UI purposes it makes the most sense to have
   * the index correspond to the first visible message in your list or the
   * central one.
   */
  seekFocusedOnAbsoluteIndex: function(index, numAbove, numBelow) {
    this._api.__bridgeSend({
      type: 'seekProxy',
      mode: 'focusIndex',
      index: index,
      above: numAbove,
      below: numBelow
    });
  },

  /**
   * Seek to the bottom of the list and latch there so that our slice will
   * always include the last `numDesired` items in the list.
   */
  seekToBottom: function(numDesired) {
    this._api.__bridgeSend({
      type: 'seekProxy',
      mode: 'bottom',
      above: numDesired,
      below: 0
    });
  },

  release: function() {
    // XXX we used to null out our event handlers here; it may be appropriate to
    // do something to ensure that after die() is called no more events are
    // heard from us.  Like re-initing our Emitter or synchronously notifying
    // the API to forget about us or setting some flag, etc.
    this._api.__bridgeSend({
        type: 'cleanupContext',
        handle: this._handle
      });

    for (let i = 0; i < this.items.length; i++) {
      let item = this.items[i];
      item.__die();
    }
  },
});

return WindowedListView;
});
