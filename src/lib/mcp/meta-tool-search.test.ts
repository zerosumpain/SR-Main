import { describe, expect, it } from 'vitest';
import { searchTools } from './meta-tool';

const CATALOGUE = [
  { name: 'apple_calendar_list', description: 'List Apple Calendar credentials, calendars, or events in a date range.' },
  { name: 'author_ephemeral_tool', description: 'Create a new tool, capability or integration and run it immediately — the FAST way to add something the platform cannot yet do.' },
  { name: 'promote_ephemeral_tool', description: 'Keep a tool authored by author_ephemeral_tool, making it a permanent, reusable capability.' },
  { name: 'request_change', description: 'Request a code change to the site itself. THIS IS THE SLOWEST PATH — a build, a review and a deploy.' },
  { name: 'node_call', description: 'Run one workflow node directly, without building a workflow.' },
  { name: 'gmail_search', description: 'Search mail on connected accounts.' },
  { name: 'update_tool', description: "Replace a stored custom tool's handler code in place. Use this to FIX a tool that is failing." },
];

const names = (q: string) => searchTools(CATALOGUE, q).map((t) => t.name);

describe('catalogue search', () => {
  // Measured against production 2026-08-11, when the filter was a single
  // `includes(query)`: "calendar" found two tools and every phrase a person
  // would actually type found nothing at all. A model looking for a way to add
  // a capability got silence and fell back on what it already knew, which is
  // most of why a tool request became a 50-minute repo build.
  it.each([
    ['create tool', 'author_ephemeral_tool'],
    ['add a tool', 'author_ephemeral_tool'],
    ['new capability', 'author_ephemeral_tool'],
    ['fix a broken tool', 'update_tool'],
    ['run a node', 'node_call'],
  ])('finds something useful for %j', (query, expected) => {
    const hits = names(query);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain(expected);
  });

  it('still answers a single word exactly as before', () => {
    expect(names('calendar')).toEqual(['apple_calendar_list']);
  });

  it('ranks a name match above a description mention', () => {
    // `update_tool` has the word in its name; the others merely discuss tools.
    expect(names('update_tool')[0]).toBe('update_tool');
  });

  it('ranks the whole phrase above scattered word overlap', () => {
    // "workflow node" appears verbatim in node_call's description, and the two
    // words separately appear all over the catalogue.
    expect(names('workflow node')[0]).toBe('node_call');
  });

  it('ignores words that would match everything', () => {
    // Without stopwords, "a" and "the" pull in the entire catalogue and the
    // ranking becomes noise.
    expect(names('the a of')).toEqual([]);
  });

  it('returns nothing for a query about something absent', () => {
    expect(names('quantum spreadsheet')).toEqual([]);
  });

  it('passes the catalogue through when there is no query', () => {
    expect(searchTools(CATALOGUE, '   ')).toHaveLength(CATALOGUE.length);
  });
});
