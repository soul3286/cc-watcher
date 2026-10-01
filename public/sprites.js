// Every mascot and easter-egg picture, by pose. To swap the art, drop new files into public/sprites/ and change the
// names here — nothing else refers to the files. Classic script shared by the page and the service worker, hence `self`.
self.CCW_SPRITES = (() => {
  const at = o => Object.fromEntries(Object.entries(o).map(([k, f]) => [k, `sprites/${f}`]));
  return {
    pose: at({
      working: 'mascot.gif', idle: 'mascot-idle-vibe.gif', idleAlt: 'mascot-idle-soccer.gif', yawn: 'mascot-idle-yawn.gif',
      done: 'mascot-done.gif', error: 'mascot-error.gif', waiting: 'mascot-waiting.gif', away: 'mascot-away.gif',
      asleep: 'mascot-away.gif', asleepStill: 'mascot-asleep.png', still: 'mascot-idle.png',
      'idle-pumpkin': 'mascot-idle-vibe-pumpkin.gif', 'idle-santa': 'mascot-idle-vibe-santa.gif', 'idle-party': 'mascot-idle-vibe-party.gif',
      'done-pumpkin': 'mascot-done-pumpkin.gif', 'done-santa': 'mascot-done-santa.gif', 'done-party': 'mascot-done-party.gif',
    }),
    egg: at({
      wizard: 'egg-wizard.gif', juggling: 'egg-juggling.gif', happy: 'egg-happy.gif', dizzy: 'egg-dizzy.gif',
      overheated: 'egg-overheated.gif', annoyed: 'egg-annoyed.gif', doubleJump: 'egg-double-jump.gif', party: 'egg-party.gif',
    }),
  };
})();
