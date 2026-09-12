export type EvidenceSource = 'email' | 'transaction';

export type EvidenceField =
	| 'account-email'
	| 'contact-email'
	| 'email-subject'
	| 'sender-address'
	| 'account-created-date'
	| 'merchant'
	| 'transaction-date'
	| 'transaction-amount'
	| 'transaction-reference'
	| 'billing-name';

export type RedactionLevel = 'none' | 'partial' | 'hidden';

export interface RecoveryEvidenceFinding {
	id: string;
	source: EvidenceSource;
	field: EvidenceField;
	value: string;
	verifiedAt: string;
	externalReference?: string;
}

export interface RecoveryChecklistItem {
	id: string;
	field: EvidenceField;
	prompt: string;
	answer: string;
	redaction: RedactionLevel;
	evidenceId: string;
	verifiedAt: string;
	reviewState: 'pending';
}

export interface RecoveryEvidenceWorkspace {
	visibility: 'private';
	accountHint: string;
	generatedAt: string;
	disclosure: 'Contains only verified, minimally extracted evidence. It does not contain passwords, recovery codes, or authentication codes.';
	evidence: Array<{
		id: string;
		source: EvidenceSource;
		field: EvidenceField;
		value: string;
		verifiedAt: string;
		externalReference?: string;
	}>;
	checklist: RecoveryChecklistItem[];
}

export interface CreateRecoveryEvidenceWorkspaceInput {
	accountHint: string;
	findings: RecoveryEvidenceFinding[];
	redaction?: RedactionLevel;
	generatedAt?: string;
}

const validFieldsBySource: Record<EvidenceSource, readonly EvidenceField[]> = {
	email: ['account-email', 'contact-email', 'email-subject', 'sender-address', 'account-created-date'],
	transaction: ['merchant', 'transaction-date', 'transaction-amount', 'transaction-reference', 'billing-name']
};

const prompts: Record<EvidenceField, string> = {
	'account-email': 'Account email address',
	'contact-email': 'Contact email address associated with the account',
	'email-subject': 'Recent email subject from the service',
	'sender-address': 'Sender address used by the service',
	'account-created-date': 'Approximate account creation date',
	merchant: 'Merchant or service name from a related payment',
	'transaction-date': 'Date of a related payment',
	'transaction-amount': 'Amount of a related payment',
	'transaction-reference': 'Payment reference, if the recovery form requests it',
	'billing-name': 'Billing name shown on a related payment'
};

const forbiddenSecretPattern = /\b(password|passcode|recovery[\s_-]*code|backup[\s_-]*code|one[\s_-]*time[\s_-]*code|otp|cvv|cvc|security[\s_-]*code)\b/i;
const cardLikeNumberPattern = /(?:\d[ -]?){12,19}/;

function assertSafeText(value: string, context: string): void {
	if (!value.trim()) throw new Error(`${context} must not be blank.`);
	if (forbiddenSecretPattern.test(value)) {
		throw new Error(`${context} appears to contain a password, recovery code, or authentication code.`);
	}
	if (cardLikeNumberPattern.test(value)) {
		throw new Error(`${context} appears to contain a card-like number and cannot be included.`);
	}
}

function assertIsoDate(value: string, context: string): void {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
		throw new Error(`${context} must be an ISO-8601 UTC timestamp.`);
	}
}

function partialRedaction(value: string, field: EvidenceField): string {
	if (field === 'account-email' || field === 'contact-email' || field === 'sender-address') {
		const at = value.indexOf('@');
		if (at > 0 && at < value.length - 1) return `${value.slice(0, 1)}•••${value.slice(at)}`;
	}

	if (field === 'transaction-amount') {
		const currency = value.match(/^[^\d\s]+/)?.[0] ?? '';
		return `${currency}•••`;
	}

	if (field === 'transaction-reference') {
		return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
	}

	return value.length <= 3 ? '•••' : `${value.slice(0, 1)}•••${value.slice(-1)}`;
}

export function redactRecoveryEvidence(value: string, field: EvidenceField, level: RedactionLevel): string {
	assertSafeText(value, 'Evidence value');
	if (level === 'none') return value;
	if (level === 'hidden') return 'Hidden';
	return partialRedaction(value, field);
}

function validateFinding(finding: RecoveryEvidenceFinding): void {
	if (!finding.id.trim()) throw new Error('Each finding requires an id.');
	assertSafeText(finding.id, 'Finding id');
	if (!validFieldsBySource[finding.source]?.includes(finding.field)) {
		throw new Error(`Field "${finding.field}" is not valid for ${finding.source} evidence.`);
	}
	assertSafeText(finding.value, 'Evidence value');
	if (finding.value.length > 500) throw new Error('Evidence value must be 500 characters or fewer.');
	assertIsoDate(finding.verifiedAt, 'verifiedAt');
	if (finding.externalReference !== undefined) {
		assertSafeText(finding.externalReference, 'External reference');
		if (finding.externalReference.length > 256) throw new Error('External reference must be 256 characters or fewer.');
	}
}

/**
 * Creates an in-memory, private review model. This function performs no I/O and
 * intentionally does not persist evidence or retrieve email, bank, or payment data.
 */
export function createRecoveryEvidenceWorkspace(
	input: CreateRecoveryEvidenceWorkspaceInput
): RecoveryEvidenceWorkspace {
	assertSafeText(input.accountHint, 'Account hint');
	if (input.accountHint.length > 200) throw new Error('Account hint must be 200 characters or fewer.');
	if (!input.findings.length) throw new Error('At least one verified finding is required.');

	const generatedAt = input.generatedAt ?? new Date().toISOString();
	assertIsoDate(generatedAt, 'generatedAt');
	const redaction = input.redaction ?? 'partial';
	const seenIds = new Set<string>();

	for (const finding of input.findings) {
		validateFinding(finding);
		if (seenIds.has(finding.id)) throw new Error(`Duplicate finding id: ${finding.id}`);
		seenIds.add(finding.id);
	}

	return {
		visibility: 'private',
		accountHint: input.accountHint,
		generatedAt,
		disclosure: 'Contains only verified, minimally extracted evidence. It does not contain passwords, recovery codes, or authentication codes.',
		evidence: input.findings.map((finding) => ({ ...finding })),
		checklist: input.findings.map((finding) => ({
			id: `checklist:${finding.id}`,
			field: finding.field,
			prompt: prompts[finding.field],
			answer: redactRecoveryEvidence(finding.value, finding.field, redaction),
			redaction,
			evidenceId: finding.id,
			verifiedAt: finding.verifiedAt,
			reviewState: 'pending'
		}))
	};
}
