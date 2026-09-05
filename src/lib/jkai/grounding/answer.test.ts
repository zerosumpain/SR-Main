import { it, expect } from 'vitest';
import { answerContract, parseAssessment } from './answer';
it('keeps simple status brief and assigns explicit review coverage', () => {
 expect(answerContract('is the light on?').needsReview).toBe(false);
 expect(answerContract('propose 10 improvements')).toMatchObject({ depth: 'detailed', requestedItems: 10, needsReview: true });
});
it('never treats verifier errors as a quality pass', () => {
 expect(parseAssessment('invalid').supported).toBe(null);
 expect(parseAssessment('{"supported":true,"complete":false,"issues":["missing part"]}').complete).toBe(false);
});
