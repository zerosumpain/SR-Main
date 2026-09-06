import { describe, it, expect } from 'vitest';
import { assessIdentity, chooseIdentity, groundMention } from './policy';
import type { ResolvableEntity } from './match';
const entity = (id: string, name: string, type='organisation', email?: string): ResolvableEntity => ({id,name,typeId:type,typeName:type,properties:email?{email}:{},embedding:null,degree:0,noteCount:0});
describe('identity policy across ingestion and cleanup',()=>{
  it('holds homonymous people, initial expansions and cross-type names',()=>{
    expect(assessIdentity(entity('a','Alex Smith','person'),entity('b','Alex Smith','person')).canLink).toBe(false);
    expect(assessIdentity(entity('a','Morgan','person'),entity('b','Morgan','organisation')).canLink).toBe(false);
    expect(assessIdentity(entity('a','A. Smith','person'),entity('b','Alex Smith','person')).canLink).toBe(false);
  });
  it('links trusted identifiers but never revives a human rejection',()=>{
    const a=entity('a','Alex Smith','person','alex@example.test'),b=entity('b','A. Smith','person','alex@example.test');
    expect(assessIdentity(a,b).canLink).toBe(true);
    expect(assessIdentity(a,b,{}, {verdict:'different',decidedBy:'human'}).canLink).toBe(false);
    expect(assessIdentity(a,b,{addressIdentities:new Map([['alex@example.test',3]])}).canLink).toBe(false);
  });
  it('holds conflicting identifiers and numbered variants even after adjudication',()=>{
    const decision={verdict:'same',decidedBy:'llm',verdictConfidence:1,citations:['A supporting passage']};
    expect(assessIdentity(entity('a','Alex','person','one@example.test'),entity('b','Alex','person','two@example.test'),{},decision).canLink).toBe(false);
    expect(assessIdentity(entity('a','Battery 600'),entity('b','Battery 700'),{},decision).canLink).toBe(false);
  });
  it('can resolve a low lexical score using cited adjudication, but not bare certainty',()=>{
    const a=entity('a','Acme Board'),b=entity('b','Acme Authority');
    expect(assessIdentity(a,b,{}, {verdict:'same',decidedBy:'llm',verdictConfidence:1}).canLink).toBe(false);
    expect(assessIdentity(a,b,{}, {verdict:'same',decidedBy:'llm',verdictConfidence:.98,citations:['The Board was renamed the Authority.']}).canLink).toBe(true);
  });
  it('abstains when two candidates independently pass',()=>{
    const fresh=entity('new','Acme'),a=entity('a','Acme'),b=entity('b','Acme');
    expect(chooseIdentity([a,b].map(e=>({entity:e,assessment:assessIdentity(fresh,e)}))).outcome).toBe('unresolved');
  });
  it('verifies literal mentions, repairs offsets and rejects inventions',()=>{
    expect(groundMention('The Board met today.','Authority',{text:'Board',start:0})).toMatchObject({start:4,end:9,surface:'Board'});
    expect(groundMention('The Board met today.','Imaginary company')).toBeNull();
  });
});
