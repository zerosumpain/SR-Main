import { describe, expect, it } from 'vitest';
import { validateTaxonomyAssessment } from './taxonomy-assessment.server';
import { parseExtractionJson } from './extract';

describe('grounded structured extraction and taxonomy assessment', () => {
  it('rejects invented taxonomy citations and malformed responses', () => {
    expect(validateTaxonomyAssessment('not JSON', []).outcome).toBe('unsure');
    expect(validateTaxonomyAssessment(JSON.stringify({outcome:'equivalent',rationale:'Similar labels',citations:[{ref:'a',quote:'Invented quotation'}]}), [{ref:'a',text:'A named document.'}]).outcome).toBe('unsure');
  });
  it('retains verified citations for an advisory assessment', () => {
    const result=validateTaxonomyAssessment(JSON.stringify({outcome:'related',rationale:'Overlapping subject',citations:[{ref:'a',quote:'A named document.'}]}),[{ref:'a',text:'A named document.'}]);
    expect(result.outcome).toBe('related');expect(result.citations).toHaveLength(1);
  });
  it('keeps same-name mentions distinct and rejects duplicate identifiers or dangling relationships', () => {
    const entity={name:'Alex Smith',type:'person',confidence:'high',properties:{},possibleMatchId:null};
    const extraction={summary:'Two people',entities:[{...entity,mentionId:'m1'},{...entity,mentionId:'m2'}],relationships:[{source:'m1',target:'m2',type:'knows',label:'Knows',confidence:'high'}],timelineEvents:[],proposedNewTypes:[]};
    expect(parseExtractionJson(JSON.stringify(extraction))?.entities).toHaveLength(2);
    expect(parseExtractionJson(JSON.stringify({...extraction,entities:[{...entity,mentionId:'m1'},{...entity,mentionId:'m1'}]}))).toBeNull();
    expect(parseExtractionJson(JSON.stringify({...extraction,relationships:[{...extraction.relationships[0],target:'m3'}]}))).toBeNull();
  });
});
