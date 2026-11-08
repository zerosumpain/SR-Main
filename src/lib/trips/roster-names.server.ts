// src/lib/trips/roster-names.server.ts
//
// v8: the family roster's first names and ids for the owner's /trips pages,
// so "Who is going" can add a family member with a tap. Names and opaque ids
// only — never an email on the page. Degrades to no names.

export async function rosterNames(): Promise<Array<{ id: string; name: string }>> {
  try {
    const { familyRoster } = await import('$lib/family/roster.server');
    return (await familyRoster())
      .filter((p) => p.name && p.id)
      .map((p) => ({ id: p.id, name: p.name }))
      .slice(0, 24);
  } catch (err) {
    console.warn('[trips] family roster unavailable:', (err as Error)?.message);
    return [];
  }
}
