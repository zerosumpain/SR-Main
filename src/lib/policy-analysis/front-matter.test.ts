// The pages of a real white paper that are not policy, against the real pages.
//
// Every fixture below is the verbatim extracted text of a page of the Post-16
// Education and Skills white paper (CP 1412), taken from the run that failed on
// 2026-09-10. Synthetic examples would have told us nothing: the question is
// whether these rules keep the page that names three Secretaries of State and
// drop the page that is a licence.
import { describe, expect, it } from 'vitest';
import { artefact, type Artefact } from './contracts';
import { boilerplateReason, partitionFrontMatter, skippedNote } from './front-matter';

const page = (n: number, text: string): Artefact =>
  artefact(`passage_${String(n).padStart(4, '0')}`, 'passage', `Page ${n} · passage ${n}`, text, { documentHash: 'a'.repeat(64) }, { origin: 'extracted_fact', page: n });

const cover = page(1, 'Post-16 Education\nand Skills\nCP 1412');

const imprint = page(2, `Post-16 Education
and Skills
Presented to Parliament by the Secretary of State for Education,
the Secretary of State for Work and Pensions and the
Secretary of State for Science, Innovation and Technology
by Command of His Majesty
October 2025
CP 1412`);

const copyright = page(3, `© Crown copyright 2025
This publication is licensed under the terms of the Open Government Licence v3.0 except
where otherwise stated. To view this licence, visit nationalarchives.gov.uk/doc/open-
government-licence/version/3
Where we have identified any third-party copyright information you will need to obtain
permission from the copyright holders concerned.
This publication is also available on our website at www.gov.uk/government/publications
Any enquiries regarding this publication should be sent to us at www.gov.uk/contact-dfe
ISBN 978-1-5286-5771-6
E03371301 10/25
Printed on paper containing 40% recycled fibre content minimum
Printed in the UK by HH Associates Ltd. on behalf of the Controller of His Majesty's
Stationery Office`);

const contents = page(4, `3
Contents
Ministerial Foreword 4
Executive summary 6
1. Working with employers to drive growth and opportunity through education
and training 12
1.1 Joining up the skills and employment systems 13
1.2 Data-driven skills planning to meet employers' needs 16
1.3 Boosting employer engagement and investment 19
1.4 Building a system that leaves no learner behind 22
2. A specialist and prestigious further education system that delivers high-quality
education and training for all 29
2.1 High-quality teaching in a prestigious further education sector 30
2.2 Clear pathways into high-quality jobs 34
3. Strengthening our world-leading higher education system 45
4. How we will measure success 70`);

const foreword = page(6, `Ministerial Foreword 5
research and innovation, and they help define the future. We know that higher level
qualifications are a ticket to success for many of our young people. So, we will support
everyone who has the desire and ability to go to university.
Our reforms will bring stability to the sector through a commitment to sustainable funding.
And in return we ask universities to focus on their strengths, to specialise and collaborate,
and align what they do closely with the needs of the country.
Our plan will provide education and skills for growth and a springboard for a brighter
future. We will support more people into work than ever before.
The Rt Hon
Bridget Phillipson MP
Secretary of State for
Education`);

describe('the front matter of a real white paper', () => {
  it('drops the cover, the copyright notice and the contents list', () => {
    expect(boilerplateReason(cover)).toBe('too little text on the page to analyse');
    expect(boilerplateReason(copyright)).toBe('copyright, licence and publication notice');
    expect(boilerplateReason(contents)).toBe('a contents list, not policy text');
  });

  it('KEEPS the command-paper imprint, which names three departments', () => {
    // It is short and it is front matter, but "Presented to Parliament by the
    // Secretary of State for Education, Work and Pensions, and Science" is the
    // sponsoring-actor triple, and the actor register wants it.
    expect(boilerplateReason(imprint)).toBeNull();
  });

  it('keeps ordinary policy prose', () => {
    expect(boilerplateReason(foreword)).toBeNull();
  });

  it('keeps a policy page that merely mentions the licence it is published under', () => {
    const long = page(40, `${'The Secretary of State will direct providers to publish outcome data. '.repeat(60)} This is available under the Open Government Licence.`);
    expect(boilerplateReason(long)).toBeNull();
  });

  it('keeps a page of numbered lines that never says it is a contents list', () => {
    const table = page(41, `Funding allocations by region\nNorth East 120\nNorth West 340\nYorkshire 210\nEast Midlands 190\nWest Midlands 260\nThese allocations are indicative and subject to the spending review.`);
    expect(boilerplateReason(table)).toBeNull();
  });
});

describe('partitioning a document', () => {
  const body = Array.from({ length: 8 }, (_, i) => page(10 + i, `Policy prose for page ${10 + i}. ${'The department will fund providers to deliver training. '.repeat(6)}`));

  it('sends the policy and names what it did not send', () => {
    const { analyse, skipped, distrusted } = partitionFrontMatter([cover, imprint, copyright, contents, foreword, ...body]);
    expect(analyse.map((a) => a.page)).toEqual([2, 6, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(skipped.map((s) => s.page)).toEqual([1, 3, 4]);
    const note = skippedNote(skipped, 13);
    expect(note).toContain('3 of 13 pages');
    expect(note).toContain('page 3 (copyright, licence and publication notice)');
    expect(note).toContain('remain part of the document record');
    expect(distrusted).toBe(false);
  });

  it('refuses to trust itself when almost nothing survives', () => {
    // An extractor returning fragments for every page would otherwise delete the
    // whole assessment quietly.
    const fragments = Array.from({ length: 20 }, (_, i) => page(i + 1, 'page ' + i));
    const { analyse, skipped, distrusted } = partitionFrontMatter(fragments);
    expect(distrusted).toBe(true);
    expect(skipped).toHaveLength(0);
    expect(analyse).toHaveLength(20);
  });

  it('does nothing to a document with no front matter', () => {
    const { analyse, skipped } = partitionFrontMatter(body);
    expect(analyse).toHaveLength(body.length);
    expect(skipped).toHaveLength(0);
  });
});
