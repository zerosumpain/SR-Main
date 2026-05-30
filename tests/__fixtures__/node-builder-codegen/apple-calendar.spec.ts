import type { NodeSpec } from '$lib/node-builder/spec/types';

export const appleCalendarSpec: NodeSpec = {
  type: 'apple-calendar',
  label: 'Apple Calendar',
  category: 'integrations',
  description: 'Read and write events on iCloud calendars via CalDAV.',
  llmDescription:
    'Use to fetch events for a date range or to create / update / delete events on an iCloud calendar. ' +
    'Authenticated via app-specific password (basic auth, kind=basic in integrationCredentials).',
  llmExamples: [
    {
      scenario: 'List events in the next 7 days',
      config: { credentialId: '<id>', operation: 'list', dateRangeStart: '{{today}}', dateRangeEnd: '{{nextWeek}}' },
    },
    {
      scenario: 'Create a 1-hour event tomorrow at 10am',
      config: {
        credentialId: '<id>', operation: 'create',
        eventTitle: 'Standup', eventStart: '{{tomorrow10am}}', eventEnd: '{{tomorrow11am}}',
      },
    },
  ],
  inputSchema: { type: 'object', additionalProperties: true },
  outputSchema: {
    type: 'object',
    properties: {
      events: { type: 'array' },
      id: { type: 'string' },
      url: { type: 'string' },
      etag: { type: 'string' },
    },
  },
  configSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string' },
      operation: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
      calendar: { type: 'string' },
      dateRangeStart: { type: 'string' },
      dateRangeEnd: { type: 'string' },
      eventTitle: { type: 'string' },
      eventStart: { type: 'string' },
      eventEnd: { type: 'string' },
      eventLocation: { type: 'string' },
      eventNotes: { type: 'string' },
      eventId: { type: 'string' },
    },
    required: ['credentialId', 'operation', 'calendar'],
  },
  defaultConfig: { operation: 'list' },
  integrationType: 'apple-calendar',
  uiSchema: {
    layout: 'single',
    banners: [{ kind: 'credential-status', credentialField: 'credentialId' }],
    actions: [{
      kind: 'test-connection',
      placement: 'top',
      integrationType: 'apple-calendar',
      credentialField: 'credentialId',
    }],
    sections: [
      {
        title: 'Connection',
        intro: 'Pick the iCloud account and calendar to operate on.',
        fields: [
          { key: 'credentialId', label: 'iCloud account', widget: 'credential-picker', integrationType: 'apple-calendar', required: true },
          { key: 'calendar', label: 'Calendar', widget: 'resource-picker', credentialKey: 'credentialId', integrationType: 'apple-calendar', required: true },
        ],
      },
      {
        title: 'Operation',
        fields: [
          { key: 'operation', label: 'What to do', widget: 'dropdown', options: [
            { value: 'list', label: 'List events' },
            { value: 'create', label: 'Create event' },
            { value: 'update', label: 'Update event' },
            { value: 'delete', label: 'Delete event' },
          ], required: true },
        ],
      },
      {
        title: 'Date range',
        showWhen: { kind: 'eq', field: 'operation', value: 'list' },
        fields: [
          { key: 'dateRangeStart', label: 'From', widget: 'template-string', placeholder: 'ISO date or {{template}}' },
          { key: 'dateRangeEnd', label: 'To', widget: 'template-string', placeholder: 'ISO date or {{template}}' },
        ],
      },
      {
        title: 'Event details',
        showWhen: { kind: 'in', field: 'operation', values: ['create', 'update'] },
        fields: [
          { key: 'eventTitle', label: 'Title', widget: 'template-string' },
          { key: 'eventStart', label: 'Start', widget: 'template-string' },
          { key: 'eventEnd', label: 'End', widget: 'template-string' },
          { key: 'eventLocation', label: 'Location', widget: 'template-string' },
          { key: 'eventNotes', label: 'Notes', widget: 'template-string' },
        ],
      },
      {
        title: 'Target event',
        showWhen: { kind: 'in', field: 'operation', values: ['update', 'delete'] },
        fields: [
          { key: 'eventId', label: 'Event ID', widget: 'string', required: true },
        ],
      },
    ],
  },
  executorBody: `
    const cred = await getCredential<'basic'>(config.credentialId);
    if (!cred) throw new Error('Credential not found: ' + config.credentialId);
    if (cred.kind !== 'basic') throw new Error('Apple Calendar needs a basic credential');
    const client = await tsdav.createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: { username: cred.payload.username, password: cred.payload.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    const calendars = await client.fetchCalendars();
    const target = calendars.find((c) => c.url === config.calendar);
    if (!target) throw new Error('Unknown calendar: ' + config.calendar);

    if (config.operation === 'list') {
      const events = await client.fetchCalendarObjects({
        calendar: target,
        timeRange: { start: config.dateRangeStart, end: config.dateRangeEnd },
      });
      return { events: events.map((e) => ({ id: e.url, ical: e.data })) };
    }
    if (config.operation === 'create') {
      const ical = buildICal({
        title: config.eventTitle,
        start: config.eventStart,
        end: config.eventEnd,
        location: config.eventLocation,
        notes: config.eventNotes,
      });
      const created = await client.createCalendarObject({
        calendar: target,
        filename: \`\${crypto.randomUUID()}.ics\`,
        iCalString: ical,
      });
      return { id: created.url, url: created.url };
    }
    if (config.operation === 'update') {
      const ical = buildICal({ /* ... */ });
      const updated = await client.updateCalendarObject({
        calendarObject: { url: config.eventId, etag: '*', data: ical },
      });
      return { id: config.eventId, etag: updated.etag };
    }
    if (config.operation === 'delete') {
      await client.deleteCalendarObject({ calendarObject: { url: config.eventId, etag: '*' } });
      return { id: config.eventId };
    }
    throw new Error('Unknown operation: ' + config.operation);
  `,
  deps: [{ name: 'tsdav', version: '^2.0.0' }],
  optionsResolvers: [{
    fieldName: 'calendar',
    body: `
      const cred = await getCredential<'basic'>(credentialId);
      if (!cred) return [];
      const client = await tsdav.createDAVClient({
        serverUrl: 'https://caldav.icloud.com',
        credentials: { username: cred.payload.username, password: cred.payload.password },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      });
      const calendars = await client.fetchCalendars();
      return calendars.map((c) => ({ value: c.url, label: c.displayName ?? c.url }));
    `,
  }],
  testCredentialBody: `
    const cred = await getCredential<'basic'>(credentialId);
    if (!cred) throw new Error('Credential not found');
    const client = await tsdav.createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: { username: cred.payload.username, password: cred.payload.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    await client.fetchCalendars();
  `,
  docs: `## When to use

For workflows that need to read or write events on your iCloud calendar — alerts before meetings, scheduling, syncing with other systems.

## How it works

Connects via CalDAV (RFC 4791) to \`caldav.icloud.com\` using an app-specific password. Pick a credential, pick a calendar, choose an operation.

## Configuration

- **iCloud account** — the credential. Create one at \`/admin/integrations\` with kind=basic.
- **Calendar** — populated dynamically once the account is selected.
- **Operation** — list / create / update / delete.

## Output

| Operation | Output shape |
|---|---|
| list | \`{ events: [{ id, ical }] }\` |
| create | \`{ id, url }\` |
| update | \`{ id, etag }\` |
| delete | \`{ id }\` |
`,
};
