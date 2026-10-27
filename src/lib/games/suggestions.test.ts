import { describe, expect, it } from "vitest";
import {
  addSuggestion,
  cleanSuggestion,
  MAX_KEPT,
  MAX_NAME,
  MAX_PER_PERSON,
  parseSuggestions,
  removeSuggestion,
  sameName,
  suggestionsView,
  voteSuggestion,
  type GameSuggestion,
} from "./suggestions";

const ann = { id: "p_ann", name: "Ann" };
const sam = { id: "p_sam", name: "Sam" };

function add(
  list: GameSuggestion[],
  name: string,
  who = ann,
  at = 1,
  id = `s_${name}`,
): GameSuggestion[] {
  const out = addSuggestion(list, { name, note: "" }, who, at, id);
  if (typeof out === "string") throw new Error(out);
  return out;
}

describe("cleanSuggestion", () => {
  it("tidies the name and note, and refuses a name too short to mean anything", () => {
    expect(
      cleanSuggestion({
        name: "  Moon\n lander ",
        note: " tilt \u0007 to land ",
      }),
    ).toEqual({ name: "Moon lander", note: "tilt to land" });
    expect(cleanSuggestion({ name: " x " })).toEqual({
      refusal: "Give the game a name.",
    });
    expect(cleanSuggestion({ name: 42 })).toEqual({
      refusal: "Give the game a name.",
    });
    expect(
      (cleanSuggestion({ name: "a".repeat(200) }) as { name: string }).name,
    ).toHaveLength(MAX_NAME);
  });
});

describe("the list", () => {
  it("counts the asker as the first +1, and the same name again as another", () => {
    let list = add([], "Moon Lander");
    list = add(list, "moon-lander!", sam, 2, "s_other");
    expect(list).toHaveLength(1);
    expect(list[0].votes).toEqual(["p_ann", "p_sam"]);
    expect(sameName("Moon Lander", "moonlander")).toBe(true);
    expect(sameName("!!", "??")).toBe(false);
  });

  it("+1s and takes a +1 back, once each", () => {
    let list = add([], "Kart race");
    list = voteSuggestion(list, "s_Kart race", "p_sam", true)!;
    list = voteSuggestion(list, "s_Kart race", "p_sam", true)!;
    expect(list[0].votes).toEqual(["p_ann", "p_sam"]);
    list = voteSuggestion(list, "s_Kart race", "p_ann", false)!;
    expect(list[0].votes).toEqual(["p_sam"]);
    expect(voteSuggestion(list, "s_none", "p_sam", true)).toBeNull();
  });

  it("lets the asker or a parent take one off, nobody else", () => {
    const list = add([], "Snakes");
    expect(removeSuggestion(list, "s_Snakes", "p_sam", false)).toBe(
      "Only whoever suggested it, or a parent, can take it off.",
    );
    expect(removeSuggestion(list, "s_Snakes", "p_ann", false)).toEqual([]);
    expect(removeSuggestion(list, "s_Snakes", "p_sam", true)).toEqual([]);
    expect(removeSuggestion(list, "s_none", "p_ann", true)).toBeNull();
  });

  it("caps what one person may ask for, and what is kept", () => {
    let list: GameSuggestion[] = [];
    for (let i = 0; i < MAX_PER_PERSON; i++)
      list = add(list, `Game ${i}`, ann, i);
    expect(
      typeof addSuggestion(
        list,
        { name: "One more", note: "" },
        ann,
        99,
        "s_x",
      ),
    ).toBe("string");

    let many: GameSuggestion[] = [];
    for (let i = 0; i < MAX_KEPT + 5; i++)
      many = add(many, `Idea ${i}`, { id: `p_${i}`, name: `P${i}` }, i);
    expect(many).toHaveLength(MAX_KEPT);
    // The oldest of the equally wanted make way.
    expect(many.some((s) => s.name === "Idea 0")).toBe(false);
  });

  it("shows the most wanted first, with names and never an id of anybody else", () => {
    let list = add([], "Older", ann, 1);
    list = add(list, "Newer", sam, 2);
    list = add(list, "Wanted", sam, 0);
    list = voteSuggestion(list, "s_Wanted", "p_ann", true)!;
    const view = suggestionsView(list, "p_ann");
    expect(view.map((v) => [v.name, v.votes, v.voted, v.mine])).toEqual([
      ["Wanted", 2, true, false],
      ["Newer", 1, false, false],
      ["Older", 1, true, true],
    ]);
    expect(JSON.stringify(view)).not.toContain("p_sam");
  });

  it("reads a stored value defensively", () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(
      parseSuggestions([
        { id: "s_1", name: "Ok", byId: "p_a", votes: ["p_a", "p_a", 3] },
        { name: "no id" },
        "junk",
      ]),
    ).toEqual([
      {
        id: "s_1",
        name: "Ok",
        note: "",
        byId: "p_a",
        byName: "Someone",
        at: 0,
        votes: ["p_a"],
      },
    ]);
  });
});
