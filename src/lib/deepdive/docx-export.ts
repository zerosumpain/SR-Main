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
  ImageRun,
} from 'docx';
import { db } from '$lib/db';
import { researchSessions, facts, entities, sources, entityMentions, narrativeItems, relationships } from '$lib/db/schema';
import { renderGraphSvg, describeGraph, fallbackPng } from './graph-image';
import { eq, and, sql, asc } from 'drizzle-orm';
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

  // The entity network, drawn. The report could describe entities in prose but
  // never showed their shape, which is the one thing a graph is for.
  const rels = await db
    .select({
      source: relationships.fromEntityId,
      target: relationships.toEntityId,
    })
    .from(relationships)
    .where(eq(relationships.sessionId, sessionId));

  const degree = new Map<string, number>();
  for (const r of rels) {
    if (r.source) degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
    if (r.target) degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
  }
  const graphNodes = allEntities.map((e) => ({
    id: e.id,
    name: e.name,
    degree: degree.get(e.id) ?? 0,
    weight: entityCentrality[e.id] ?? 0,
  }));
  const graphEdges = rels
    .filter((r): r is { source: string; target: string } => !!r.source && !!r.target)
    .map((r) => ({ source: r.source, target: r.target }));

  const svg = graphNodes.length > 1 ? renderGraphSvg(graphNodes, graphEdges) : '';
  if (svg) {
    sections.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: 'svg',
            data: Buffer.from(svg, 'utf-8'),
            transformation: { width: 600, height: 373 },
            // Required slot. Word 2016+ renders the SVG; the text rendering
            // below is what actually serves a viewer stuck on this fallback.
            fallback: { type: 'png', data: fallbackPng() },
          }),
        ],
        spacing: { after: 120 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Entity network — ${graphNodes.length} entities, ${graphEdges.length} relationships. Circle size is how many links an entity has; shading is its centrality.`,
            size: 18,
            color: '666666',
            italics: true,
          }),
        ],
        spacing: { after: 240 },
      }),
    );

    // Same structure in text, so a reader whose viewer cannot show the SVG is
    // not left with a grey box.
    const described = describeGraph(graphNodes, graphEdges);
    if (described.length) {
      sections.push(
        new Paragraph({
          children: [new TextRun({ text: 'Network, in words', bold: true, size: 22 })],
          spacing: { before: 120, after: 100 },
        }),
        ...described.map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line, size: 20 })],
              bullet: { level: 0 },
              spacing: { after: 40 },
            }),
        ),
      );
    }
  }

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

export async function generateNarrativeReport(
  sessionId: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId));

  if (!session) return null;

  const items = await db
    .select()
    .from(narrativeItems)
    .where(eq(narrativeItems.sessionId, sessionId))
    .orderBy(asc(narrativeItems.sortOrder));

  if (items.length === 0) return null;

  const children: Paragraph[] = [];
  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = slugify(session.topic);

  // Title
  children.push(
    new Paragraph({
      text: session.topic,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
  );
  children.push(
    new Paragraph({
      text: `Custom Narrative Report — ${dateStr}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: `Custom Narrative Report — ${dateStr}`,
          size: 22,
          color: '888888',
        }),
      ],
    }),
  );

  for (const item of items) {
    if (item.annotation) {
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 200 },
          children: [
            new TextRun({
              text: item.annotation,
              size: 24,
            }),
          ],
        }),
      );
    }

    if (item.factId) {
      const [fact] = await db
        .select()
        .from(facts)
        .where(eq(facts.id, item.factId))
        .limit(1);

      if (fact) {
        const [source] = await db
          .select()
          .from(sources)
          .where(eq(sources.id, fact.sourceId))
          .limit(1);

        children.push(
          new Paragraph({
            indent: { left: 400 },
            spacing: { before: 100, after: 50 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 3, color: 'C4570A' },
            },
            children: [
              new TextRun({
                text: fact.content,
                size: 22,
              }),
            ],
          }),
        );

        const metaParts: string[] = [`Confidence: ${fact.confidence.toFixed(2)}`];
        if (source) metaParts.push(`Source: ${source.title ?? source.domain}`);

        children.push(
          new Paragraph({
            indent: { left: 400 },
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: metaParts.join(' | '),
                size: 18,
                color: '888888',
                italics: true,
              }),
            ],
          }),
        );
      }
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);

  return {
    buffer: Buffer.from(buffer),
    filename: `narrative-${slug}-${dateStr}.docx`,
  };
}

export async function generateReportMarkdown(sessionId: string): Promise<string> {
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
  const dateStr = new Date().toISOString().slice(0, 10);
  const nonCfFacts = allFacts.filter((f) => !f.isCounterfactual);

  const lines: string[] = [];
  lines.push(`# ${session.topic}`);
  lines.push('');
  lines.push('*Deep Dive Research Report*');
  lines.push(`*Generated ${dateStr} — Facts: ${nonCfFacts.length} | Entities: ${allEntities.length} | Sources: ${allSources.length}*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Executive summary
  lines.push('## Executive Summary');
  lines.push('');
  for (const para of (report.executive_summary || '').split('\n\n')) {
    if (para.trim()) {
      lines.push(para.trim());
      lines.push('');
    }
  }

  // Topic clusters
  for (const cluster of report.clusters ?? []) {
    lines.push(`## ${cluster.title}`);
    lines.push('');
    if (cluster.summary) {
      lines.push(cluster.summary);
      lines.push('');
    }
    lines.push('### Key Findings');
    lines.push('');
    for (const factId of cluster.fact_ids ?? []) {
      const fact = factMap.get(factId);
      if (!fact) continue;
      const src = fact.sourceId ? sourceMap.get(fact.sourceId) : undefined;
      const cite = src ? ` ([${src.title ?? src.domain ?? 'source'}](${src.url}))` : '';
      lines.push(`- ${fact.content} *(confidence: ${fact.confidence.toFixed(2)})*${cite}`);
    }
    lines.push('');
  }

  // Key entities (top 50 by centrality)
  const sortedEntities = [...allEntities].sort(
    (a, b) => (entityCentrality[b.id] ?? 0) - (entityCentrality[a.id] ?? 0),
  );
  if (sortedEntities.length > 0) {
    lines.push('## Key Entities');
    lines.push('');
    lines.push('| Name | Type | Centrality |');
    lines.push('| --- | --- | --- |');
    for (const e of sortedEntities.slice(0, 50)) {
      lines.push(`| ${e.name} | ${e.type} | ${(entityCentrality[e.id] ?? 0).toFixed(2)} |`);
    }
    lines.push('');
  }

  // Knowledge gaps
  if (report.knowledge_gaps && report.knowledge_gaps.length > 0) {
    lines.push('## Knowledge Gaps');
    lines.push('');
    for (const g of report.knowledge_gaps) {
      lines.push(`- **[${g.severity}]** (${g.type}) ${g.gap}`);
    }
    lines.push('');
  }

  // Hypotheses
  if (report.hypotheses && report.hypotheses.length > 0) {
    lines.push('## Hypotheses');
    lines.push('');
    for (const h of report.hypotheses) {
      lines.push(`- ${h.hypothesis} *(testability: ${h.testability})*`);
    }
    lines.push('');
  }

  // Follow-up suggestions
  if (report.suggested_followups && report.suggested_followups.length > 0) {
    lines.push('## Suggested Follow-ups');
    lines.push('');
    for (const f of report.suggested_followups) {
      lines.push(`- **${f.question}** — ${f.context}`);
    }
    lines.push('');
  }

  // Source diversity
  if (report.source_diversity) {
    const sd = report.source_diversity;
    lines.push('## Source Diversity');
    lines.push('');
    lines.push(`- Distinct domains: ${sd.total_domains}`);
    lines.push(`- Concentration index: ${sd.concentration_index}`);
    lines.push('');
  }

  // Sources
  if (allSources.length > 0) {
    lines.push('## Sources');
    lines.push('');
    allSources.forEach((s, i) => {
      lines.push(`${i + 1}. [${s.title ?? 'Untitled'}](${s.url}) — ${s.domain ?? 'unknown'} (Phase ${s.phase})`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
