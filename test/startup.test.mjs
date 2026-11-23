import { test } from 'node:test';
import assert from 'node:assert/strict';
import startup from '../desktop/startup.cjs';

test('temporary renderer load failure is retried without aborting startup', async () => {
  let calls=0, stops=0;const waits=[], events=[];
  await startup.loadWithRetry({load:async()=>{if(++calls===1)throw Object.assign(new Error('ERR_FAILED (-2)'),{code:'ERR_FAILED'});},ready:()=>calls>1,stop:()=>stops++,wait:async ms=>waits.push(ms),report:event=>events.push(event)});
  assert.equal(calls,2);assert.equal(stops,1);assert.deepEqual(waits,[300]);assert.equal(events.at(-1),'load-ready');
});
test('a rejected same-page navigation does not fail an already loaded application', async () => {
  let calls=0;
  await startup.loadWithRetry({load:async()=>{calls++;throw Object.assign(new Error('Navigation interrupted'),{code:'ERR_ABORTED'});},ready:()=>true,stop:()=>assert.fail('A ready page must not be stopped'),wait:()=>assert.fail('A ready page must not be reloaded')});
  assert.equal(calls,1);
});
test('retry limit preserves the last error for the recoverable startup dialog', async () => {
  let calls=0, stops=0;const failure=Object.assign(new Error('ERR_CONNECTION_REFUSED'),{code:'ERR_CONNECTION_REFUSED'});
  await assert.rejects(startup.loadWithRetry({load:async()=>{calls++;throw failure;},ready:()=>false,stop:()=>stops++,wait:async()=>{}}),error=>error===failure);
  assert.equal(calls,3);assert.equal(stops,3);
});
test('stalled startup has a timeout and does not leave the user waiting indefinitely', async () => {
  let calls=0, stops=0;
  await assert.rejects(startup.loadWithRetry({load:()=>{calls++;return new Promise(()=>{});},ready:()=>false,stop:()=>stops++,wait:async()=>{},timeout:10,attempts:2}),{code:'STARTUP_TIMEOUT'});
  assert.equal(calls,2);assert.equal(stops,2);
});
test('unrecoverable file and certificate errors are not blindly retried', async () => {
  let calls=0;
  await assert.rejects(startup.loadWithRetry({load:async()=>{calls++;throw Object.assign(new Error('Certificate rejected'),{code:'ERR_CERT_AUTHORITY_INVALID'});},ready:()=>false,wait:()=>assert.fail('No retry')}),{code:'ERR_CERT_AUTHORITY_INVALID'});
  assert.equal(calls,1);
});
