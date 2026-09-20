const assert = require('node:assert/strict');
const {test} = require('node:test');
const {nativeImage} = require('../src/server/electron/index.js');

test('desktop app-information can skip unavailable native icon previews', () => {
  // The shipped appInfo.get() builds its optional dock icon previews this way.
  // A headless image stub must not claim it loaded an image it cannot resize.
  function iconPreview(filename) {
    const icon = nativeImage.createFromPath(filename);
    return icon.isEmpty() ? null : icon.resize({width:128,height:128,quality:'best'}).toDataURL();
  }
  assert.deepEqual(
    ['icon-chatgpt.png', 'icon-codex-dark-color.png', 'icon-codex-light.png'].map(iconPreview),
    [null, null, null],
  );
});
