import { db } from '$lib/db';
import { intelEntityTypes } from '$lib/db/schema';

const SEEDED_TYPES = [
  { name: 'person', icon: '👤', color: '#7dd3fc', description: 'A person — colleague, stakeholder, contact', propertySchema: { role: 'string', team: 'string', department: 'string', reportsTo: 'string' } },
  { name: 'project', icon: '📋', color: '#34d399', description: 'A project, initiative, or workstream', propertySchema: { status: 'string', owner: 'string', deadline: 'string' } },
  { name: 'team', icon: '👥', color: '#a78bfa', description: 'A team or group of people', propertySchema: { department: 'string', lead: 'string' } },
  { name: 'risk', icon: '⚠️', color: '#ef4444', description: 'A risk, concern, or threat', propertySchema: { severity: 'string', likelihood: 'string', mitigation: 'string' } },
  { name: 'decision', icon: '✅', color: '#fbbf24', description: 'A decision that was made or needs to be made', propertySchema: { status: 'string', decidedBy: 'string' } },
  { name: 'deadline', icon: '📅', color: '#f472b6', description: 'A deadline or due date', propertySchema: { date: 'string', linkedProject: 'string' } },
  { name: 'organisation', icon: '🏢', color: '#60a5fa', description: 'An external or internal organisation, company, or vendor', propertySchema: { type: 'string', relationship: 'string' } },
  { name: 'system', icon: '🔧', color: '#c084fc', description: 'A system, tool, platform, or technology', propertySchema: { category: 'string', owner: 'string' } },
];

export async function seedEntityTypes(): Promise<void> {
  for (const t of SEEDED_TYPES) {
    await db
      .insert(intelEntityTypes)
      .values({
        name: t.name,
        icon: t.icon,
        color: t.color,
        isSeeded: true,
        description: t.description,
        propertySchema: t.propertySchema,
      })
      .onConflictDoNothing({ target: intelEntityTypes.name });
  }
}
