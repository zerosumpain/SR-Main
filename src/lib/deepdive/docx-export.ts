import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Footer,
  PageNumber,
  NumberFormat,
  Packer,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  FootnoteReferenceRun,
} from 'docx';
import { db } from '$lib/db';
import { researchSessions, facts, entities, sources, entityMentions } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { ResearchReport } from './types';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export async function generateReport(sessionId: string): Promise<{ buffer: Buffer; filename: string }> {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId));

  if (!session) throw new Error('Session not found');

  const report = session.report as ResearchReport | null;
  if (!report) throw new Error('Report not yet generated');

  const allFacts = await db.select().from(facts).where(eq(facts.sessionId, sessionId));
  const allEntities = await db.select().from(entities).where(eq(entities.sessionId, sessionId));
  const allSources = await db.select().from(sources).where(eq(sources.sessionId, sessionId));

  const factMap = new Map(allFacts.map((f) => [f.id, f]));
  const sourceMap = new Map(allSources.map((s) => [s.id, s]));
  const entityCentrality = report.entity_centrality ?? {};

  const dateStr = new Date().toISOString().split('T')[0];
  const slug = slugify(session.topic);

  // Build footnotes for sources
  let footnoteId = 1;
  const footnotes: Record<number, { children: Paragraph[] }> = {};

  function addFootnote(sourceId: string): number {
    const source = sourceMap.get(sourceId);
    const id = footnoteId++;
    footnotes[id] = {
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: source ? `${source.title ?? 'Source'} — ${source.url}` : 'Unknown source',
              size: 16,
            }),
          ],
        }),
      ],
    };
    return id;
  }

  // Build sections
  const sections: Paragraph[] = [];

  // Cover page
  sections.push(
    new Paragraph({ spacing: { after: 600 } }),
    new Paragraph({
      children: [new TextRun({ text: session.topic, bold: true, size: 56 })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Deep Dive Research Report', size: 28, color: '666666' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Generated: ${dateStr}`, size: 20, color: '999999' })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Facts: ${allFacts.filter((f) => !f.isCounterfactual).length} | Entities: ${allEntities.length} | Sources: ${allSources.length}`,
          size: 20,
          color: '999999',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    }),
  );

  // Executive summary
  sections.push(
    new Paragraph({
      text: 'Executive Summary',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }),
  );
  for (const para of (report.executive_summary || '').split('\n\n')) {
    if (para.trim()) {
      sections.push(
        new Paragraph({
          children: [new TextRun({ text: para.trim(), size: 22 })],
          spacing: { after: 200 },
        }),
      );
    }
  }

  // Topic reports (clusters)
  for (const cluster of report.clusters ?? []) {
    sections.push(
      new Paragraph({
        text: cluster.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: cluster.summary, size: 22 })],
        spacing: { after: 200 },
      }),
      new Paragraph({
        text: 'Key Findings',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }),
    );

    for (const factId of cluster.fact_ids ?? []) {
      const fact = factMap.get(factId);
      if (!fact) continue;

      const children: (TextRun | FootnoteReferenceRun)[] = [
        new TextRun({
          text: `${fact.content} [confidence: ${fact.confidence.toFixed(2)}]`,
          size: 22,
        }),
      ];

      if (fact.sourceId) {
        const fnId = addFootnote(fact.sourceId);
        children.push(new FootnoteReferenceRun(fnId));
      }

      sections.push(
        new Paragraph({
          children,
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      );
    }
  }

  // Appendix A: Entity index
  sections.push(
    new Paragraph({
      text: 'Appendix A: Key Entities',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }),
  );

  const sortedEntities = [...allEntities].sort(
    (a, b) => (entityCentrality[b.id] ?? 0) - (entityCentrality[a.id] ?? 0),
  );

  const entityTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: ['Name', 'Type', 'Description', 'Centrality'].map(
          (h) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })] })],
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
        ),
      }),
      ...sortedEntities.slice(0, 50).map(
        (e) =>
          new TableRow({
            children: [
              e.name,
              e.type,
              e.description ?? '',
              (entityCentrality[e.id] ?? 0).toFixed(2),
            ].map(
              (val) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: val, size: 18 })] })],
                  width: { size: 25, type: WidthType.PERCENTAGE },
                }),
            ),
          }),
      ),
    ],
  });
  sections.push(new Paragraph({ spacing: { after: 100 } }));

  // Appendix B: Counterfactuals
  const counterfactuals = allFacts.filter((f) => f.isCounterfactual);

  sections.push(
    new Paragraph({
      text: 'Appendix B: Contested Claims',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }),
  );

  // Group by refuted fact
  const grouped = new Map<string, typeof counterfactuals>();
  for (const cf of counterfactuals) {
    const key = cf.refutesFactId ?? 'unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(cf);
  }

  for (const [originalId, counterClaims] of grouped) {
    const original = factMap.get(originalId);
    if (!original) continue;

    const hasContradiction = counterClaims.some((c) => c.confidence >= 0.5);
    const badge = hasContradiction ? '[REFUTED]' : counterClaims.length > 0 ? '[NUANCED]' : '[UNRESOLVED]';

    sections.push(
      new Paragraph({
        text: `${original.content.slice(0, 80)} ${badge}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Original claim (confidence: ${original.confidence.toFixed(2)}): ${original.content}`,
            size: 22,
          }),
        ],
        spacing: { after: 100 },
      }),
    );

    for (const cc of counterClaims) {
      const source = sourceMap.get(cc.sourceId);
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Counter: ${cc.content}`,
              size: 22,
              italics: true,
            }),
            new TextRun({
              text: source ? ` (Source: ${source.url})` : '',
              size: 18,
              color: '666666',
            }),
          ],
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      );
    }
  }

  // Appendix C: Sources
  sections.push(
    new Paragraph({
      text: 'Appendix C: Sources',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }),
  );

  allSources.forEach((s, i) => {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true, size: 20 }),
          new TextRun({ text: `${s.title ?? 'Untitled'} — `, size: 20 }),
          new TextRun({ text: s.url, size: 18, color: '0563C1' }),
          new TextRun({ text: ` (${s.domain ?? 'unknown'}, Phase ${s.phase})`, size: 18, color: '999999' }),
        ],
        spacing: { after: 60 },
      }),
    );
  });

  const doc = new Document({
    footnotes,
    sections: [
      {
        children: [...sections.slice(0, sections.length), entityTable, ...sections.slice(sections.length)],
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: 'Deep Dive Research Report — ', size: 16, color: '999999' }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: '999999',
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  return {
    buffer: Buffer.from(buffer),
    filename: `deepdive-${slug}-${dateStr}.docx`,
  };
}
