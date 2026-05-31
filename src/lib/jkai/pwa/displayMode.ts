export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	const mq = window.matchMedia?.('(display-mode: standalone)');
	if (mq?.matches) return true;
	const nav = window.navigator as Navigator & { standalone?: boolean };
	return nav.standalone === true;
}
