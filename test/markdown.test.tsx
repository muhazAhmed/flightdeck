import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../client/features/chat/Markdown.tsx';

/**
 * The agent writes markdown. Before this renderer the transcript showed literal `##` and `**`,
 * which is what prompted the change — so these tests assert the syntax is *consumed*, not just that
 * some HTML came out.
 */
const render = (source: string) => renderToStaticMarkup(<Markdown>{source}</Markdown>);

test('headings become heading elements, not literal hashes', () => {
  const html = render('## Numbers now have a real background');
  assert.match(html, /<h2[^>]*>Numbers now have a real background<\/h2>/);
  assert.ok(!html.includes('##'), 'the hashes must not survive into the output');
});

test('bold and italic are consumed', () => {
  const html = render('a **bold** and an *italic* word');
  assert.match(html, /<strong[^>]*>bold<\/strong>/);
  assert.match(html, /<em[^>]*>italic<\/em>/);
  assert.ok(!html.includes('**'), 'asterisks must not survive');
});

test('inline code is a chip, and a fenced block is a pre', () => {
  const inline = render('use `--surface-3` here');
  assert.match(inline, /<code[^>]*>--surface-3<\/code>/);
  assert.ok(!inline.includes('`'), 'backticks must not survive');

  const block = render('```ts\nconst a = 1;\n```');
  assert.match(block, /<pre[^>]*>/);
  assert.match(block, /language-ts/);
});

test('lists render as lists', () => {
  const html = render('- one\n- two\n\n1. first\n2. second');
  assert.match(html, /<ul[^>]*>/);
  assert.match(html, /<ol[^>]*>/);
  assert.equal((html.match(/<li[^>]*>/g) ?? []).length, 4);
});

test('gfm extras work — tables and strikethrough', () => {
  const table = render('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(table, /<table[^>]*>/);
  assert.match(table, /<th[^>]*>a<\/th>/);
  assert.match(table, /<td[^>]*>1<\/td>/);

  assert.match(render('~~gone~~'), /<del[^>]*>gone<\/del>/);
});

test('links open in a new tab and cannot reach back into the app', () => {
  const html = render('[docs](https://example.com)');
  assert.match(html, /target="_blank"/);
  // Without noopener a linked page gets a handle on this window.
  assert.match(html, /rel="noreferrer noopener"/);
});

test('every element carries our classes rather than browser defaults', () => {
  // A heading with no class means unstyled white text at browser sizes, which is how a chat
  // transcript ends up looking like a 1996 document.
  const html = render('# Title\n\ntext with `code`\n\n> quoted');
  for (const tag of ['h1', 'p', 'code', 'blockquote']) {
    assert.match(html, new RegExp(`<${tag} class="`), `${tag} rendered without a class`);
  }
});

test('a plain paragraph is left alone', () => {
  const html = render('just a sentence');
  assert.match(html, /<p[^>]*>just a sentence<\/p>/);
});
