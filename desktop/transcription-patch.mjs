// Only adapt the extracted viewer. Never patch the installed desktop app.
export function patchLocalTranscription(source) {
  if (source.includes('/*remote-local-dictation*/')) return source;
  const transcription = /async function (\w+)\((\w+),(\w+)=\{\}\)\{(?=let \w+=\3\.contentType\?\?)/g;
  const hook = /function (\w+)\((\w+)\)\{(?=let \w+=\(0,\w+\.c\)\(\d+\),\{cleanupEnabled:[^}]+onTranscribeError:[^}]+streamingEnabled:)/g;
  for (const [name, pattern] of [['transcription entry', transcription], ['dictation hook', hook]]) {
    const count = [...source.matchAll(pattern)].length;
    if (count !== 1) throw Error(`${name}: expected one compatible match, found ${count}`);
  }
  source = source.replace(transcription, (match, name, audio, options) => `${match}/*remote-local-dictation*/if(window.__ELECTRON_SHIM__?.transcribeAudio)return window.__ELECTRON_SHIM__.transcribeAudio(${audio},${options});`);
  // Streaming and AI cleanup otherwise still contact external services before
  // or after the batch transcriber. Preserve their native behavior without shim.
  return source.replace(hook, (match, name, options) => `${match}if(window.__ELECTRON_SHIM__?.transcribeAudio)${options}={...${options},streamingEnabled:false,cleanupEnabled:false};`);
}
