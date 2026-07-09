'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const PositionManager = require('../src/core/PositionManager');
const { getMonitor } = require('../src/monitor/HealthMonitor');

test.after(() => getMonitor().stop());

test('pending jito bundleOnly BUY cannot trigger a sell exit', async () => {
  const manager = Object.create(PositionManager.prototype);
  const pos = {
    mint: 'mint',
    symbol: 'TEST',
    buySubmitMode: 'jito_bundle_only',
    reconciled: false,
    dryRun: false,
    exiting: false,
  };

  await manager._exit(pos, 1, 'SLOT_EXIT');

  assert.equal(pos.exiting, false);
  assert.equal(pos.exitReason, undefined);
});
