/** Match the server's evidence gate: partial or truncated dialogue is never complete. */
export function createNpcStreamReader(onText: (text: string) => void) {
  let buffer = '', text = '', done = false, stopped = false, invalid = false;
  const consume = (event: string) => {
    if (/^event:\s*error\s*$/im.test(event)) invalid = true;
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    try {
      const item = JSON.parse(data);
      if (item.error) invalid = true;
      const choice = item.choices?.[0];
      if (choice?.finish_reason === 'stop') stopped = true;
      else if (choice?.finish_reason) invalid = true;
      if (typeof choice?.delta?.content === 'string') {
        text += choice.delta.content;
        if (text.length > 6000) { text = text.slice(0, 6000); invalid = true; }
        onText(text);
      }
    } catch { invalid = true; }
  };
  return {
    push(chunk: string) {
      if (invalid) return;
      buffer += chunk;
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (buffer.length > 16000) { buffer = ''; invalid = true; }
    },
    finish() {
      if (buffer.trim()) consume(buffer);
      buffer = '';
      return { text: text.trim(), complete: Boolean(text.trim()) && !invalid && (done || stopped) };
    }
  };
}
