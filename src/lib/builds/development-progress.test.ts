import { expect, it } from 'vitest';
import { evidencedCriteria, outputBudget } from './development-progress';
it('measures output budget without inventing a limit or exceeding the bar', () => {
 expect(outputBudget(500)).toBeNull(); expect(outputBudget(500, 0)).toBeNull();
 expect(outputBudget(250, 1000)).toEqual({used:250, limit:1000, percent:25});
 expect(outputBudget(1500, 1000)?.percent).toBe(100);
});
it('counts only passed criteria evidenced against the current candidate', () => {
 const criteria = [{verdict:'passed',revision:'old'}, {verdict:'failed',revision:'new'}, {verdict:'passed',revision:'new'}];
 expect(evidencedCriteria(criteria, null)).toBe(0); expect(evidencedCriteria(criteria,'new')).toBe(1);
});

import { developmentPosition, assessmentExcerpt, type DevelopmentProgress } from './development-progress';
import { newDelivery, inspectionCandidate, acceptanceBlocker, visibleDevelopmentStage } from '$lib/jkai/development';
it('does not present stopped work or model assessments as a verified delivery', () => {
 const state=newDelivery('example','Platform');
 const progress: DevelopmentProgress={totalTokens:10000,outputTokens:100,iterations:[],stage:{stage:'completed',message:'Stopped by user'},verification:{feedback_gate:{version:1,phase:'feedback_gate',label:'Checks',status:'failed'}}};
 const position=developmentPosition(progress,state,{status:'completed',outcome:'stopped_by_user'});
 expect(position.label).toBe('Stopped · no verified delivery'); expect(position.failed).toBe(true); expect(position.verified).toBe(false);
 expect(visibleDevelopmentStage(state,'completed','stopped_by_user')).toBe('stopped');
 expect(visibleDevelopmentStage(state,'completed')).toBe('ended without a candidate');
});
it('keeps inspection acceptance blocked and removes stale criteria evidence', () => {
 const state=newDelivery('example','Platform');state.brief.acceptedAt=new Date().toISOString();state.criteria=[{id:'c',text:'Criterion',verdict:'passed',evidence:'Old proof',revision:'old'}];
 const inspected=inspectionCandidate(state,'new');inspected.preview={url:'http://preview.test',status:'ready',detail:'Inspection'};
 expect(inspected.criteria[0].verdict).toBe('unverified'); expect(acceptanceBlocker(inspected)).toContain('passing repository gate');
 expect(developmentPosition({totalTokens:1,outputTokens:1,iterations:[]},inspected,{status:'paused'}).label).toBe('Inspection preview available');
});
it('removes repository file inventories from the report excerpt', () => {
 expect(assessmentExcerpt('## Evaluation\nFeature checks passed.\n\nWorkspace state after this iteration:\nstatic/large-file-list')).toBe('Feature checks passed.');
});

import { featurePreviewUrl } from './development-progress';
it('opens the requested feature route while retaining the signed preview grant', () => {
 expect(featurePreviewUrl('https://preview.test/?__sr_grant=example','/travel/rome')).toBe('https://preview.test/travel/rome?__sr_grant=example');
 expect(featurePreviewUrl('https://preview.test/?__sr_grant=example','//outside.test/path')).toBe('https://preview.test/?__sr_grant=example');
 expect(featurePreviewUrl('https://preview.test/?__sr_grant=example','/\\outside.test/path')).toBe('https://preview.test/?__sr_grant=example');
 expect(featurePreviewUrl(null,'/travel/rome')).toBeNull();
});

import { developmentLane, developmentTone } from './development-progress';
it('places a delivery in exactly one portfolio lane, latest stage winning', () => {
 const draft=newDelivery('example','Platform');
 expect(developmentLane(draft)).toBe('brief');
 const accepted={...draft,brief:{...draft.brief,acceptedAt:new Date().toISOString()}};
 expect(developmentLane(accepted)).toBe('building');
 expect(developmentLane({...accepted,candidate:'abc'})).toBe('review');
 expect(developmentLane({...accepted,candidate:'abc',decisions:[{id:'d',question:'Which?',answer:null}]})).toBe('input');
 expect(developmentLane({...accepted,candidate:'abc',decisions:[{id:'d',question:'Which?',answer:null}],stage:'accepted'})).toBe('accepted');
});
it('maps the printed stage word onto the hub tones and never invents one', () => {
 expect(developmentTone('needs input')).toBe('action');
 expect(developmentTone('failed')).toBe('urgent');
 expect(developmentTone('ended without a candidate')).toBe('urgent');
 expect(developmentTone('paused')).toBe('watch');
 expect(developmentTone('accepted')).toBe('good');
 expect(developmentTone('brief')).toBe('quiet');
 expect(developmentTone('building')).toBe('steady');
});
