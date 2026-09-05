/* ============================================================
   AI 英语对话教练 - 限流框架（server/rate-limit.js）
   ------------------------------------------------------------
   内存滑动窗口限流器。

   当前接入点：
     - POST /api/auth/login（server/routes/auth.js）：只对【失败】计数，
       成功登录立即 clear，按 IP + 用户名双维度限，防密码爆破。

   用法：
     const limiter = createRateLimiter({ windowMs: 60000, max: 20 });
     // 在某条路由里：
     const r = limiter.check(req.socket.remoteAddress);
     if (!r.ok) { sendJson(res, 429, { error: 'too many requests' }); return; }
     // 放行后按需计数：limiter.hit(key)

   窗口滑动：每次 check 时丢弃窗口外的旧时间戳，再判断是否超限。
   内存占用与活跃 key 数成正比，单机场景完全可接受。
   ============================================================ */
'use strict';

function createRateLimiter(opts) {
  const windowMs = (opts && opts.windowMs) || 60 * 1000;
  const max = (opts && opts.max) || 20;
  // key → 窗口内的时间戳数组（升序）
  const hits = new Map();

  function prune(key, now) {
    const arr = hits.get(key);
    if (!arr) return [];
    // 从前往后丢弃窗口外的；保留窗口内的（时间戳升序，只需一次扫描）
    let i = 0;
    while (i < arr.length && arr[i] <= now - windowMs) i++;
    const kept = i > 0 ? arr.slice(i) : arr;
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  }

  return {
    /* 判断 key 是否仍可放行；调用方在放行后执行 hit() */
    check(key, now) {
      const t = now || Date.now();
      const arr = prune(key, t);
      if (arr.length >= max) {
        const oldest = arr[0];
        return { ok: false, retryAfterMs: Math.max(1, oldest + windowMs - t) };
      }
      return { ok: true, remaining: max - arr.length };
    },
    /* 记录一次命中（放行后调用） */
    hit(key, now) {
      const t = now || Date.now();
      const arr = hits.get(key) || [];
      arr.push(t);
      hits.set(key, arr);
    },
    /* 组合用法：一发一查记录（超限返回 { ok:false }） */
    attempt(key, now) {
      const t = now || Date.now();
      const r = this.check(key, t);
      if (!r.ok) return r;
      this.hit(key, t);
      return { ok: true, remaining: r.remaining };
    },
    /* 统计当前被跟踪的 key 数（调试/监控用） */
    size() { return hits.size; },
    /* 清空单个 key 的计数（例如登录成功后清掉该 IP/账户的失败记录） */
    clear(key) { hits.delete(key); },
    reset() { hits.clear(); }
  };
}

module.exports = { createRateLimiter };