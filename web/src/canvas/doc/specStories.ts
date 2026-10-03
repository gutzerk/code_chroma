import { linesOf } from "./epicsLayout";

/** One parsed User Story inside a «Спеки» card: its title+priority line, an optional muted «why» line,
 * and a numbered criteria list. `intro` is set only on a leading non-story paragraph (the muted
 * header line of the specs block), never alongside the other fields. */
export interface SpecStory {
  intro?: string;
  title?: string;
  priority?: string;
  why?: string;
  criteria: string[];
}

/** Splits a «Спеки» description into story cards. Groups are separated by blank lines. The first
 * group is an intro paragraph if its single line is not a story title (a story title matches
 * `US# · … (P# · …)`); each remaining group has a title line, an optional `why` line right after it
 * (not starting with a digit), and numbered criteria after that. */
export function specStories(description: string): SpecStory[] {
  const groups = description
    .split(/\n\s*\n/)
    .map((g) => linesOf(g))
    .filter((g) => g.length > 0);
  const titleRe = /^US\s*\d+\s*·/;
  const first = groups[0];
  const stories: SpecStory[] = [];
  let cursor = 0;
  // A leading group whose single line isn't a story title is the specs block's intro paragraph.
  if (first && first.length === 1 && !titleRe.test(first[0])) {
    stories.push({ intro: first[0], criteria: [] });
    cursor = 1;
  }
  for (let i = cursor; i < groups.length; i++) {
    const g = groups[i];
    if (g.length === 0 || !titleRe.test(g[0])) continue; // ignore stray paragraphs
    const story: SpecStory = { criteria: [] };
    story.title = g[0];
    const prioMatch = /\(([^)]+)\)\s*$/.exec(g[0]);
    if (prioMatch) {
      story.priority = prioMatch[1];
      story.title = g[0].slice(0, prioMatch.index).trim();
    }
    let k = 1;
    if (k < g.length && !/^\d+[.)]/.test(g[k])) {
      story.why = g[k];
      k++;
    }
    for (; k < g.length; k++) story.criteria.push(g[k].replace(/^\d+[.)]\s*/, ""));
    stories.push(story);
  }
  return stories;
}
