// The command layer's states: pending until the provider confirms, failed in place otherwise, and
// only Try again or Move back leave a failure.
import {COMMAND_STATES} from '@setpoint/shared';
import type {CommandState} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {COMMAND_EVENTS, isActive, nextCommandState} from '../src/domain/commandStates.ts';
import type {CommandEvent} from '../src/domain/commandStates.ts';

// Every state × every event; null is a refused transition.
const TABLE: Record<CommandState, Record<CommandEvent, CommandState | null>> = {
  pending: {confirm: 'confirmed', fail: 'failed', retry: null, move_back: null},
  failed: {confirm: null, fail: null, retry: 'pending', move_back: 'reverted'},
  confirmed: {confirm: null, fail: null, retry: null, move_back: null},
  reverted: {confirm: null, fail: null, retry: null, move_back: null},
};

describe('nextCommandState', () => {
  test.each(COMMAND_STATES.flatMap(state => COMMAND_EVENTS.map(event => [state, event, TABLE[state][event]] as const)))(
    '%s + %s → %s', (state, event, next) => {
      expect(nextCommandState(state, event)).toBe(next);
    },
  );

  test.each<[CommandState, boolean]>([['pending', true], ['failed', true], ['confirmed', false], ['reverted', false]])('%s is active: %s', (state, active) => {
    expect(isActive(state)).toBe(active);
  });
});
