import { LifeMapDoc, NodeData, NoteData } from "./doc";

// case-insensitive keyword search over every node TITLE in the map,
// including nodes hidden in collapsed layers. Synthetic expand-midpoints
// are skipped: their "A-B" titles are structure, not user content
export function searchNodes(doc: LifeMapDoc, keyword: string): NodeData[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return [];
  return Object.values(doc.nodes).filter(
    (node) => !node.synthetic && node.title.toLowerCase().includes(query),
  );
}

// case-insensitive keyword search over every note in the map, including
// notes on nodes hidden in collapsed layers
export function searchNotes(doc: LifeMapDoc, keyword: string): { note: NoteData; node: NodeData }[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return [];
  const results: { note: NoteData; node: NodeData }[] = [];
  for (const node of Object.values(doc.nodes)) {
    for (const note of node.notes) {
      if (note.text.toLowerCase().includes(query)) {
        results.push({ note, node });
      }
    }
  }
  return results;
}
