import { describe, expect, it } from 'vitest';
import {
	guardRemediation,
	schedulerRegistrationEvent,
	serviceProbeEvent,
	systemdAvailabilityEvent,
	workflowErrorEvent
} from '$lib/outages/timeline';

describe('outage timeline event factories', () => {
	const at = new Date('2026-08-24T10:00:00.000Z');

	it('captures failed probes as critical events', () => {
		const event = serviceProbeEvent({ service: 'app.service', occurredAt: at, healthy: false, latencyMs: 2_100 });
		expect(event).toMatchObject({ source: 'probe', kind: 'service.probe.failed', severity: 'critical' });
		expect(event.details).toEqual({ healthy: false, latencyMs: 2_100 });
	});

	it('captures the remaining operational event categories', () => {
		expect(systemdAvailabilityEvent({ service: 'app.service', occurredAt: at, available: false }).kind).toBe('systemd.unavailable');
		expect(schedulerRegistrationEvent({ service: 'app.service', occurredAt: at, scheduleId: 'nightly', registered: false }).severity).toBe('error');
		expect(workflowErrorEvent({ service: 'app.service', occurredAt: at, workflowId: 'wf-1', error: 'Timeout' })).toMatchObject({
			source: 'workflow',
			kind: 'workflow.error',
			severity: 'error'
		});
	});
});

describe('guardRemediation', () => {
	const request = {
		action: 'restart-service' as const,
		service: 'app.service',
		reason: 'Probe and systemd availability checks are failing.',
		requestedBy: 'admin@example.test',
		approval: 'REMEDIATE restart-service app.service',
		activeOutage: true
	};

	it('allows an explicitly approved remediation for an active outage', () => {
		expect(guardRemediation(request)).toEqual({ allowed: true, command: 'restart-service' });
	});

	it('rejects unapproved actions and unsafe service names', () => {
		expect(guardRemediation({ ...request, approval: 'yes' })).toMatchObject({ allowed: false });
		expect(guardRemediation({ ...request, service: 'app; rm -rf /', approval: 'REMEDIATE restart-service app; rm -rf /' })).toMatchObject({ allowed: false });
	});
});
