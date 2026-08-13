/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import type { GameObjects } from 'phaser';
import { Node } from './Node';

export class ShaderNode extends Node {
  object: GameObjects.Layer;
  upperDepth: number;

  constructor(
    name: string,
    object: GameObjects.Layer,
    depth: number,
    upperDepth: number,
    parent: Node,
    treeDepth?: number,
  ) {
    super(name, object, depth, parent, treeDepth);
    this.object = object;
    this.upperDepth = upperDepth;
  }
}
