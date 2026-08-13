/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import { base } from '$app/paths';
import type { LevelType, NoteSkinName, ResourcePack } from '$lib/types';

/*
    The text to display underneath the combo counter.
*/
export const COMBO_TEXT = 'COMBO';

/*
    The size of hit effects, which will be scaled by the note size from the preferences.
*/
export const HIT_EFFECTS_SIZE = 1.1;

/*
    The size of hit effects particles, which will be scaled by HIT_EFFECTS_SIZE.
*/
export const HIT_EFFECTS_PARTICLE_SIZE = 27;

/*
    The sidelength (in pixels) of the square area in which the hit effects particles will be
    randomly scattered, which will be scaled by HIT_EFFECTS_SIZE.
*/
export const HIT_EFFECTS_PARTICLE_SPREAD_RANGE = 400;

/*
    The base size of notes, which will be scaled by the note size from the preferences.
*/
export const NOTE_BASE_SIZE = 0.19;

/*
    The priorities for each note type. A note with a higher priority will be rendered on top of those with relatively lower priorities.
*/
export const NOTE_PRIORITIES = [0, 3, 1, 4, 2];

/*
    Minimum velocity (in chart pixels per second) required to Perfect a Flick note.
*/
export const FLICK_VELOCTY_THRESHOLD = 75;

/*
    Maximum no-input interval (in milliseconds) allowed before a Hold note is considered missed.
*/
export const HOLD_BODY_TOLERANCE = 100;

/*
    Interval (in milliseconds) between the end of a Hold note and the judgment time of the note.
*/
export const HOLD_TAIL_TOLERANCE = 100;

/*
    Maximum distance (in chart pixels) between the projections of the input and a note along
    the judgment line allowed to hit the note.
*/
export const JUDGMENT_THRESHOLD = 180;

/*
    The radius (in percentage) of rounded corners of the illustration on the results scene.
    0 for no rounding; 100 for full rounding.
*/
export const RESULTS_ILLUSTRATION_CORNER_RADIUS = 12;

/*
    The regular expression to match keyboard inputs for playing.
*/
export const KEYBOARD_INPUT_REGEX = /^[0-9a-z`\-=[\]\\;',./ ]$/;

/*
    The maximum dimension (width or height) of images on mobile platforms. Images exceeding
    this limit will be scaled down proportionally before being handed to Phaser, to prevent
    issues with high-resolution/large images on devices with limited resources.
*/
export const MOBILE_MAX_IMAGE_DIMENSION = 2048;

export const DEFAULT_RESOURCE_PACK_ID = '__default__';

/*
    The default resource pack to use when no resource pack is specified or imported.
*/
export const DEFAULT_RESOURCE_PACK: ResourcePack<string> & { id: string } = {
  id: DEFAULT_RESOURCE_PACK_ID,
  name: 'Default',
  author: '鏄熼箍ELEC, Supa7onyz & Naptie',
  description: 'The default look of PhiZone Player.',
  thumbnail: `${base}/banner.png`,
  noteSkins: ([
    'Tap',
    'TapHL',
    'HoldHead',
    'HoldBody',
    'HoldTail',
    'HoldHeadHL',
    'HoldBodyHL',
    'HoldTailHL',
    'Flick',
    'FlickHL',
    'Drag',
    'DragHL',
  ] as NoteSkinName[]).map((name) => {
    return {
      name,
      file: `${base}/game/notes/${name}.png`,
    };
  }),
  hitSounds: (['Tap', 'Flick', 'Drag'] as const).map((name) => {
    return {
      name,
      file: `${base}/game/hitsounds/${name}.ogg`,
    };
  }),
  hitEffects: {
    spriteSheet: `${base}/game/HitEffects.png`,
    frameWidth: 375,
    frameHeight: 378,
    frameRate: 128,
    particle: {
      count: 5,
      style: 'circle',
    },
  },
  ending: {
    grades: (['A', 'B', 'C', 'F', 'Phi', 'S', 'V-FC', 'V'] as const).map((name) => {
      return {
        name,
        file: `${base}/game/grades/${name}.png`,
      };
    }),
    music: [0, 1, 2, 3, 4].map((levelType) => {
      return {
        levelType: levelType as LevelType,
        beats: 64,
        bpm: 140,
        file: `${base}/game/ending/LevelOver${Math.min(levelType, 3)}.ogg`,
      };
    }),
  },
  fonts: [
    ...(['Outfit', 'NotoSansSC'] as const).map((name) => {
      return {
        name,
        type: 'truetype' as const,
        file: `${base}/fonts/${name}/${name}.ttf`,
      };
    }),
    {
      name: 'Outfit',
      type: 'bitmap' as const,
      texture: `${base}/fonts/Outfit/Outfit.png`,
      descriptor: `${base}/fonts/Outfit/Outfit.fnt`,
    },
  ],
};
