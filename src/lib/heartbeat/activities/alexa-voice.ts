import { syncSignalHistory, syncVoiceHistory } from '$lib/alexa/ingest.server';
import { tagUtteranceTopics } from '$lib/alexa/topics.server';
import type { ActivityHandler } from '../types';

/**
 * Keeps /home/voice current: reads Home Assistant's Alexa voice events since the
 * newest row held and inserts what is new. An unreachable house is `skipped`,
 * not `error` — HA keeps thirty days, so the next run reads the gap and nothing
 * is lost, and a flaky tailnet should not spend this action's failure budget.
 */
export const alexaVoiceSync: ActivityHandler = {
  name: 'alexa-voice-sync',
  description:
    "Copies what the household said to Alexa (and Alexa's replies) from Home Assistant's alexa_devices voice events into alexa_utterances for /home/voice. Reads from the newest held row minus two hours; keyed rows make the overlap free.",
  defaultCadenceSeconds: 300,
  defaultEnabled: true,
  async run() {
    const { getHomeAssistantService } = await import('$lib/workflows/homeassistant/service');
    const res = await syncVoiceHistory(getHomeAssistantService());
    if (!res.ok) {
      return { outcome: 'skipped', summary: `not synced: ${res.error ?? 'unknown'}`.slice(0, 200), details: { ...res } };
    }
    return {
      outcome: 'ok',
      summary: `${res.inserted} new of ${res.read} read across ${res.devices} devices`,
      details: { ...res },
    };
  },
};

/**
 * The Echos' other reports for /home/echoes: room temperature, light
 * and motion, alarm/timer/reminder changes, and what is playing. Its own
 * activity rather than a second step in the voice sync, so a failure in one
 * never costs the other its run. Unreachable HA is `skipped`, as above.
 */
export const alexaSignalsSync: ActivityHandler = {
  name: 'alexa-signals-sync',
  description:
    "Copies the Echos' room sensors (temperature, light, motion), their next alarm/timer/reminder and what they are playing from Home Assistant into alexa_signals for /home/echoes. Stores changes only; reads from the newest held row minus two hours.",
  defaultCadenceSeconds: 300,
  defaultEnabled: true,
  async run() {
    const { getHomeAssistantService } = await import('$lib/workflows/homeassistant/service');
    const res = await syncSignalHistory(getHomeAssistantService());
    if (!res.ok) {
      return { outcome: 'skipped', summary: `not synced: ${res.error ?? 'unknown'}`.slice(0, 200), details: { ...res } };
    }
    return {
      outcome: 'ok',
      summary: `${res.inserted} changes from ${res.read} states across ${res.entities} entities`,
      details: { ...res },
    };
  },
};

/**
 * Files each new utterance under one topic from a fixed list, overnight. Hourly
 * inside the window so a night with a backlog finishes it; a run with nothing
 * untagged makes no model call at all.
 */
export const alexaVoiceTopics: ActivityHandler = {
  name: 'alexa-voice-topics',
  description:
    'Tags untagged Alexa utterances with one topic from a fixed vocabulary (music, timers, weather, questions, …) using the extraction role model. Overnight, hourly, no call when nothing is untagged.',
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  defaultActiveHours: { start: '01:00', end: '04:30', tz: 'Europe/London' },
  async run() {
    const res = await tagUtteranceTopics();
    if (res.considered === 0) return { outcome: 'ok', summary: 'nothing untagged' };
    return {
      outcome: res.tagged === 0 ? 'error' : 'ok',
      summary: `tagged ${res.tagged} of ${res.considered}${res.remaining ? '; more remain' : ''}`,
      details: { ...res },
    };
  },
};
