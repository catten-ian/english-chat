/* ============================================================
   AI 英语对话教练 — 消息版本树（节点 / 活跃路径 / 增删截断）
   由 js/app.js 拆分而来（原 967-1055 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- Message version tree ---------- */
function makeNode(role, content, feedback) {
  return {
    id: genMsgId(),
    role: role,
    variants: [{ content: content, feedback: feedback || null, next: [] }],
    activeVariant: 0
  };
}
function activeVariant(node) {
  return node.variants[node.activeVariant];
}
// Flatten active branch path into linear message objects
function getActivePath() {
  const out = [];
  function walk(nodes) {
    for (const n of nodes) {
      const v = activeVariant(n);
      out.push({ role: n.role, content: v.content, id: n.id, feedback: v.feedback, strategy: v.strategy, research: v.research, node: n });
      walk(v.next);
    }
  }
  walk(conversation);
  return out;
}
// Append a node to the end of the active path
function appendToEnd(node) {
  const path = getActivePath();
  if (path.length) {
    activeVariant(path[path.length - 1].node).next.push(node);
  } else {
    conversation.push(node);
  }
}
// Find a node by id (search whole tree)
function findNode(id, nodes) {
  if (nodes === undefined) nodes = conversation;
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(id, activeVariant(n).next);
    if (found) return found;
  }
  return null;
}
// Truncate all nodes after the given node in the active path
function truncateAfter(node) {
  function cut(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] === node) {
        nodes.splice(i + 1, nodes.length - i - 1);
        return true;
      }
      const v = activeVariant(nodes[i]);
      if (cut(v.next)) return true;
    }
    return false;
  }
  cut(conversation);
}
// Remove a node and its subtree from the active tree
function removeNodeFromTree(id) {
  function cut(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        nodes.splice(i, 1);
        return true;
      }
      if (cut(activeVariant(nodes[i]).next)) return true;
    }
    return false;
  }
  cut(conversation);
}
// Migrate old flat messages into the version-tree structure
function migrateConversation(msgs) {
  if (!msgs || !msgs.length) return [];
  // If already in new format (has variants), just use it
  if (msgs[0] && msgs[0].variants) return msgs;
  const nodes = [];
  for (const m of msgs) {
    nodes.push(makeNode(m.role, m.content, m.feedback || null));
  }
  // Chain them: each node's next = the following node
  for (let i = 0; i < nodes.length - 1; i++) {
    activeVariant(nodes[i]).next = [nodes[i + 1]];
  }
  return nodes;
}
