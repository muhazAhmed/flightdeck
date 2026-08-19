const chat = await (await fetch('http://127.0.0.1:5174/api/chats', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: 'flightdeck', model: 'claude-haiku-4-5', title: 'Resume probe' })
})).json();
console.log('chat', chat.id);

async function send(text: string, label: string) {
  console.log(`\n=== ${label} ===`);
  const r = await fetch(`http://127.0.0.1:5174/api/chats/${chat.id}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  });
  const reader = r.body!.getReader(); const dec = new TextDecoder(); let carry = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break;
    carry += dec.decode(value, { stream: true });
    const frames = carry.split('\n\n'); carry = frames.pop() ?? '';
    for (const f of frames) { const l = f.split('\n').find((x) => x.startsWith('data: ')); if (!l) continue;
      const e = JSON.parse(l.slice(6));
      if (e.type === 'text') process.stdout.write(e.delta);
      else console.log('  [' + e.type + ']', JSON.stringify(e).slice(0, 260));
    }
  }
}
await send('Say: first', 'FIRST (claims session)');
await send('Say: second', 'SECOND (resumes)');
console.log('\nchatId=' + chat.id);
