/** Static JSONPath cheat sheet shown in the hints pane. */
export interface Hint {
  query: string;
  description: string;
}

export interface HintSection {
  title: string;
  hints: Hint[];
  note?: string;
}

export const HINT_SECTIONS: HintSection[] = [
  {
    title: 'Selecting',
    hints: [
      { query: '$', description: 'The whole document' },
      { query: '$.store.name', description: 'A member (dot notation)' },
      { query: "$['first name']", description: 'A member whose name has spaces or dashes' },
      { query: '$.items[0]', description: 'First item (index from 0)' },
      { query: '$.items[-1]', description: 'Last item' },
      { query: '$.items[0:5]', description: 'Items 0–4 (slice, end excluded)' },
      { query: '$.items[::2]', description: 'Every second item' },
      { query: '$.items[0,2]', description: 'Several indexes' },
      { query: '$.items[*]', description: 'All items' },
      { query: '$.items[*].id', description: 'One field of every item' },
      { query: "$.user['name','email']", description: 'Several members' },
      { query: '$..id', description: 'Every id at any depth (recursive descent)' },
    ],
  },
  {
    title: 'Filtering [?…]',
    note: '@ is the current item. Comparisons are type-strict: 1 and "1" differ.',
    hints: [
      { query: "$.items[?@.status == 'FAILED']", description: 'Equals a string' },
      { query: '$.items[?@.price < 10]', description: 'Compare a number (<, <=, >, >=, ==, !=)' },
      { query: "$.items[?@.status != 'DONE' && @.retries > 2]", description: 'Both conditions (and)' },
      { query: "$.items[?@.type == 'a' || @.type == 'b']", description: 'Either condition (or)' },
      { query: '$.items[?@.discount]', description: 'Member exists' },
      { query: '$.items[?!@.deletedAt]', description: 'Member is missing' },
      { query: "$.items[?@.owner.country == 'PL'].id", description: 'Filter on a nested field, output one field' },
      { query: "$.items[?@.tags[?@ == 'vip']]", description: 'Array member contains a value' },
      { query: '$..[?@.id == 42]', description: 'Any object, at any depth, with id 42' },
      { query: '$.items[?@.price > 10][?@.stock > 0]', description: 'Chain two filters' },
    ],
  },
  {
    title: 'Functions',
    hints: [
      { query: '$.items[?length(@.name) > 20]', description: 'Length of a string, array or object' },
      { query: '$.items[?count(@.tags[*]) == 0]', description: 'Number of nodes (here: empty tags)' },
      { query: "$.items[?search(@.email, 'gmail')]", description: 'Regex found anywhere in the value' },
      { query: "$.items[?match(@.code, 'A[0-9]+')]", description: 'Regex matches the whole value' },
    ],
  },
  {
    title: 'Regex with flags (=~)',
    note: 'JSONPath Lens extension: full JavaScript regular expressions with flags (i, m, s, u) and lookarounds. Runs as regex(value, pattern, flags).',
    hints: [
      { query: '$.items[?@.email =~ /@gmail\\.com$/i]', description: 'Ends with, case-insensitive' },
      { query: '$..[?@.code =~ /^plt_/].code', description: 'Codes starting with plt_, anywhere' },
      { query: '$.items[?!(@.name =~ /test/i)]', description: 'Does not match' },
    ],
  },
];
