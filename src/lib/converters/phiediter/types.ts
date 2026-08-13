/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import type { Note } from '$lib/types';

export type PecCommandTypeBPM = 'bp';
export type PecCommandTypeNote = 'n1' | 'n2' | 'n3' | 'n4';
export type PecCommandTypeNoteExtra = '#' | '&';
export type PecCommandTypeLine = 'cv' | 'cm' | 'cp' | 'cr' | 'cd' | 'cf' | 'ca';
export type PecCommandType =
  | PecCommandTypeBPM
  | PecCommandTypeNote
  | PecCommandTypeNoteExtra
  | PecCommandTypeLine;

export interface PecCommandBase extends Array<string> {
  0: PecCommandType;
}

export interface PecNote extends Note {
  lineID: number;
}
