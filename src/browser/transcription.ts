// Audio goes over the existing authenticated device connection to the remote
// Mac. Do not fall back to uploading a failed local recording to another service.
export async function transcribeAudio(audio: Blob, options: {language?: string; signal?: AbortSignal} = {}): Promise<string> {
  options.signal?.throwIfAborted();
  if (!audio.size) throw new Error('No audio was recorded. Please try again.');
  if (audio.size > 16 * 1024 * 1024) throw new Error('Keep each recording below 16 MB.');
  const body = new FormData();
  body.append('file', audio, 'dictation');
  if (options.language) body.append('language', options.language);
  const response = await fetch('/__backend/transcribe', {method: 'POST', body, signal: options.signal, credentials: 'same-origin'});
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.text !== 'string') throw new Error(result?.error || 'Local transcription could not finish. Please try again.');
  return result.text;
}
