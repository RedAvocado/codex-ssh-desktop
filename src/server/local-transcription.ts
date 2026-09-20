import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {FastifyInstance} from 'fastify';
import {viewerOrigin} from './access';

export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
type Config = {whisper: string; ffmpeg: string; model: string};
export class TranscriptionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
type Runner = (file: string, args: string[], signal: AbortSignal) => Promise<void>;
const run: Runner = (file, args, signal) => new Promise((resolve, reject) => {
  // Never include process output: it can contain the recording's transcript.
  execFile(file, args, {signal, timeout: 120_000, maxBuffer: 1024 * 1024}, error => {
    if (error) reject(new TranscriptionError('Local transcription failed. Try a shorter recording.', 500));
    else resolve();
  });
});

export function createLocalTranscriber(runtime: string, execute: Runner = run) {
  let busy = false;
  return async (audio: Buffer, language: string, signal: AbortSignal) => {
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new TranscriptionError('Record audio between 1 byte and 16 MB.');
    if (language && !/^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(language)) throw new TranscriptionError('Invalid dictation language.');
    if (busy) throw new TranscriptionError('Another recording is being transcribed. Try again shortly.', 429);
    busy = true;
    let directory: string | undefined;
    try {
      signal.throwIfAborted();
      let config: Config;
      try {
        config = JSON.parse(await fs.readFile(path.join(runtime, 'transcription-config.json'), 'utf8'));
        for (const value of [config.whisper, config.ffmpeg, config.model]) {
          if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error();
          await fs.access(value);
        }
      } catch { throw new TranscriptionError('Local dictation is not configured on this Mac.', 503); }
      const root = path.join(runtime, 'transcription-tmp');
      await fs.mkdir(root, {recursive: true, mode: 0o700});
      directory = await fs.mkdtemp(path.join(root, 'recording-'));
      const input = path.join(directory, 'input'), wav = path.join(directory, 'audio.wav'), output = path.join(directory, 'result');
      await fs.writeFile(input, audio, {mode: 0o600});
      await execute(config.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
        '-i', input, '-map', '0:a:0', '-t', '301', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], signal);
      // Decode only one extra second to reject overlong input without processing
      // an unbounded recording. PCM is mono, 16 kHz, two bytes per sample.
      if ((await fs.stat(wav)).size > 300 * 32000 + 1024) throw new TranscriptionError('Keep each dictation under five minutes.');
      signal.throwIfAborted();
      await execute(config.whisper, ['-m', config.model, '-f', wav, '-l', language.split('-')[0] || 'auto',
        '-t', '4', '-otxt', '-of', output, '-np', '-nt'], signal);
      signal.throwIfAborted();
      const text = (await fs.readFile(output + '.txt', 'utf8')).trim();
      return {text};
    } finally {
      try { if (directory) await fs.rm(directory, {recursive: true, force: true}); }
      finally { busy = false; }
    }
  };
}

export function registerLocalTranscription(app: FastifyInstance, runtime: string, expectedOrigin = viewerOrigin) {
  const transcribe = createLocalTranscriber(runtime);
  // Inherits the backend session-token gate. Require origin explicitly for this
  // mutation; the private HTTPS gateway rewrites only already-authorized requests.
  app.post('/__backend/transcribe', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.headers.origin !== expectedOrigin) return reply.code(403).send({error: 'Invalid origin'});
    if (!request.isMultipart()) return reply.code(400).send({error: 'Expected an audio recording.'});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const disconnected = () => {if (!reply.raw.writableEnded) controller.abort();};
    reply.raw.on('close', disconnected);
    try {
      let audio: Buffer | undefined, language = '';
      for await (const part of request.parts({limits: {fileSize: MAX_AUDIO_BYTES, files: 1, fields: 1, parts: 2}})) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file' || !/^(audio\/|video\/webm$)/.test(part.mimetype)) throw new TranscriptionError('Expected an audio recording.');
          audio = await part.toBuffer();
        } else if (part.fieldname === 'language' && typeof part.value === 'string') language = part.value;
        else throw new TranscriptionError('Unexpected dictation field.');
      }
      if (!audio) throw new TranscriptionError('No audio was received.');
      return await transcribe(audio, language, controller.signal);
    } catch (error) {
      const status = error instanceof TranscriptionError ? error.status : controller.signal.aborted ? 408 : 400;
      const message = error instanceof TranscriptionError ? error.message : controller.signal.aborted ? 'Transcription timed out or was cancelled. Try a shorter recording.' : 'The recording could not be read or exceeds 16 MB.';
      return reply.code(status).send({error: message});
    } finally {clearTimeout(timeout); reply.raw.off('close', disconnected);}
  });
}
