import { describe, expect, it } from 'vitest';
import {
  extensionForAudioMime,
  isAllowedAudioMime,
  normaliseAudioMime,
  resolveAudioMime,
  titleFromTranscript,
} from './voice';

describe('normaliseAudioMime', () => {
  it('strips the codec parameter MediaRecorder attaches', () => {
    // The whole reason this function exists: `audio/webm;codecs=opus` is what a
    // browser actually sends, and it matches no bare-MIME allowlist.
    expect(normaliseAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(isAllowedAudioMime(normaliseAudioMime('audio/webm;codecs=opus'))).toBe(true);
  });

  it('lowercases and trims, and survives a missing type', () => {
    expect(normaliseAudioMime(' AUDIO/MPEG ')).toBe('audio/mpeg');
    expect(normaliseAudioMime(null)).toBe('');
    expect(isAllowedAudioMime(normaliseAudioMime(undefined))).toBe(false);
  });

  it('refuses anything that is not audio', () => {
    expect(isAllowedAudioMime('video/mp4')).toBe(false);
    expect(isAllowedAudioMime('application/octet-stream')).toBe(false);
  });
});

describe('extensionForAudioMime', () => {
  it('maps the types the recorder and phones produce', () => {
    expect(extensionForAudioMime('audio/mpeg')).toBe('mp3');
    expect(extensionForAudioMime('audio/mp4')).toBe('m4a');
    expect(extensionForAudioMime('audio/x-wav')).toBe('wav');
  });

  it('falls back to webm rather than writing a file with no extension', () => {
    expect(extensionForAudioMime('audio/unknown')).toBe('webm');
  });
});

describe('titleFromTranscript', () => {
  it('takes a short first sentence whole, without its full stop', () => {
    expect(titleFromTranscript('Shed wiring. Armoured cable from the CU.')).toBe('Shed wiring');
  });

  it('clips a long opening on a word boundary', () => {
    const t = titleFromTranscript(
      'Remember to check the underfloor heating mat depth before ordering the tiles.',
    );
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(49);
    // Never mid-word — that is what made the old 72-character version unreadable.
    expect(t).toBe('Remember to check the underfloor heating mat…');
  });

  it('cuts a single very long word rather than returning nothing', () => {
    const t = titleFromTranscript('A'.repeat(90));
    expect(t).toBe(`${'A'.repeat(48)}…`);
  });

  it('is empty for an empty or whitespace-only transcript', () => {
    // A silent recording transcribes to nothing, which must leave the note
    // untitled rather than titled with a stray ellipsis.
    expect(titleFromTranscript('')).toBe('');
    expect(titleFromTranscript('   \n  \n ')).toBe('');
  });

  it('skips leading blank lines to the first line with words on it', () => {
    expect(titleFromTranscript('\n\n  Boiler replacement. Worth pricing.')).toBe(
      'Boiler replacement',
    );
  });
});

describe('resolveAudioMime', () => {
  it('accepts a sniffed audio type', () => {
    expect(resolveAudioMime('audio/mpeg', 'audio/mpeg')).toBe('audio/mpeg');
  });

  it('maps a WebM CONTAINER back to audio when the client said audio', () => {
    // The case that matters most: a browser MediaRecorder recording microphone
    // audio still writes a Matroska container, so file-type reports
    // `video/webm`. Rejecting that rejects the only format this route really
    // receives.
    expect(resolveAudioMime('video/webm', 'audio/webm;codecs=opus')).toBe('audio/webm');
    expect(resolveAudioMime('video/ogg', 'audio/ogg')).toBe('audio/ogg');
    expect(resolveAudioMime('video/x-matroska', 'audio/webm')).toBe('audio/webm');
  });

  it('still refuses a container the client calls video', () => {
    expect(resolveAudioMime('video/webm', 'video/webm')).toBeNull();
    expect(resolveAudioMime('video/mp4', 'video/mp4')).toBeNull();
  });

  it('refuses anything it cannot sniff, whatever the client claims', () => {
    // A text file has no magic bytes. Trusting the declared type here is what
    // let `bad.txt` upload as `audio/webm`.
    expect(resolveAudioMime(undefined, 'audio/webm')).toBeNull();
    expect(resolveAudioMime('', 'audio/mpeg')).toBeNull();
    expect(resolveAudioMime(null, 'audio/wav')).toBeNull();
  });

  it('refuses a sniffed non-audio, non-container type', () => {
    expect(resolveAudioMime('application/pdf', 'audio/webm')).toBeNull();
    expect(resolveAudioMime('image/png', 'audio/webm')).toBeNull();
  });
});
