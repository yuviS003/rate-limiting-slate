# LinkedIn Campaign — Rate Limiting from 15 Lines to Production

## Campaign links

Replace `[LINKEDIN_ARTICLE_URL]` after the long-form article is published.

- Article: `[LINKEDIN_ARTICLE_URL]`
- Interactive lab: https://yuvis003.github.io/rate-limiting-slate/rate-limiting-playground.html
- Source code: https://github.com/yuviS003/rate-limiting-slate

## Recommended rhythm

This calendar starts on **Monday, October 12, 2026** and publishes three times per week. If you start later, preserve the Monday/Wednesday/Friday spacing rather than forcing the original dates.

Use one consistent starting time—**9:30 AM in the timezone where most of your target audience works** is a reasonable first experiment. After the first week, use your own LinkedIn analytics instead of treating any generic posting time as a law.

| Date | Format | Topic | Primary asset |
|---|---|---|---|
| Fri, Oct 9 | Preparation only | Final push and QA | None |
| Mon, Oct 12 | LinkedIn Article + launch post | The complete journey | `images/00-cover.png` |
| Wed, Oct 14 | Image post | Fixed-window boundary bug | `images/02-fixed-window.png` |
| Fri, Oct 16 | Native video | Token bucket | `videos/token-bucket.mp4` |
| Mon, Oct 19 | Native video | Invisible Redis race | `videos/redis-race.mp4` |
| Wed, Oct 21 | Image post | Redis + Postgres | `images/09-redis-postgres.png` |
| Fri, Oct 23 | Image post | Rate versus concurrency | `images/10-rate-vs-concurrency.png` |
| Mon, Oct 26 | Image post | Weighted cost | `images/11-cost-based.png` |
| Wed, Oct 28 | Image post | Adaptive concurrency | `images/13-adaptive.png` |
| Fri, Oct 30 | Carousel/summary | Decision guide | `images/06-cheatsheet.png`, `12-defense-in-depth.png`, `14-decision-tree.png` |

---

# Day 0 — Friday, October 9: preparation

Do not post yet.

## Checklist

1. Push the generated publishing files and this campaign.
2. Confirm the interactive lab works in an incognito window.
3. Open both MP4 files and check playback.
4. Open every PNG at full size and check text readability.
5. Decide whether GIFs animate in the LinkedIn Article editor. If uncertain, use PNG stills in the article and native MP4s in posts.
6. Keep one document ready for recording metrics after 24 hours and 7 days.

## Final Git push

```powershell
git add package.json publish tools/build-publish-copy.mjs
git commit -m "Add LinkedIn publishing campaign"
git push
```

The application code was already pushed. This final push adds publishing copies, the campaign, and the reproducible publishing generator.

---

# Post 1 — Monday, October 12

## Purpose

Publish the complete LinkedIn Article, then announce it with a normal post. This becomes the destination linked by every later post.

## Part A: publish the Article first

- Source: `publish/linkedin-article.md`
- Cover: `images/00-cover.png`
- Title: **The Night One Client Ate the API**
- Subtitle: **Rate limiting from 15 lines of JavaScript to Redis, Postgres, and adaptive concurrency**
- Interactive URL: https://yuvis003.github.io/rate-limiting-slate/rate-limiting-playground.html

Follow the image order in `publishing-guide.md`. Remove the editor note and skip the first inline cover image because the same image is already the LinkedIn cover.

After publishing, copy the LinkedIn Article URL. Replace `[LINKEDIN_ARTICLE_URL]` in this campaign file and `linkedin-launch-post.md`.

## Part B: normal launch post

**Format:** text post sharing the LinkedIn Article. Let LinkedIn use the article preview, or attach `images/00-cover.png` if no preview appears.

### Copy

Most rate-limiting articles stop at “100 requests per minute.”

That is where the interesting problems begin.

The rule silently changes when you add a second Node process.

It cannot see a 30-second PDF job holding a worker.

It prices a health check and a million-node GraphQL query as the same “one request.”

And when the whole fleet is already slow, a per-user counter is answering the wrong question.

So I built the guide I wish I had earlier:

• six algorithms in bare JavaScript  
• the Redis GET/check/SET race that silently overshoots  
• atomic Lua across multiple pods  
• Redis + Postgres without putting the database on the hot path  
• idempotent quota settlement and its real durability boundary  
• concurrency, weighted cost, LLM reservations, adaptive limits, and load shedding  
• 15 original visuals, two animations, and an interactive browser lab

The deeper lesson: a rate limiter is not middleware that says “no.”

It is a scheduler deciding how shared capacity is divided when demand exceeds supply.

I wrote this for the engineer learning the topic today and the engineer debugging it in production tomorrow.

Read it here: [LINKEDIN_ARTICLE_URL]

What failed first in a system you worked on: a retry storm, a noisy tenant, or a slow endpoint?

#SystemDesign #NodeJS #Redis #BackendEngineering #DistributedSystems

### First comment

Interactive lab: https://yuvis003.github.io/rate-limiting-slate/rate-limiting-playground.html

Verified source and tests: https://github.com/yuviS003/rate-limiting-slate

### Alt text if attaching the cover

“Rate Limiting: from 15 lines to production. A visual field guide covering bare JavaScript, Redis and Lua, Postgres, concurrency, cost, and adaptive limits.”

### After publishing

- Reply to substantive questions with a real answer, not only “thanks.”
- Save good questions; they become ideas for the later posts.
- Record article views and launch-post impressions after 24 hours.

---

# Post 2 — Wednesday, October 14

## Purpose

Teach one surprising bug with one image. This post targets freshers and engineers who have only used fixed-window middleware.

**Format:** single-image post  
**Asset:** `images/02-fixed-window.png`

### Copy

Your “100 requests per minute” limiter may allow 200 requests almost back to back.

No race condition is required.

No attacker needs to bypass anything.

It is normal fixed-window behavior:

• 100 requests at 11:59:59  
• the counter resets at 12:00:00  
• 100 more requests at 12:00:01

Both windows are valid.

Your server still absorbs 200 requests in roughly two seconds.

Fixed window is not useless. It is cheap, easy to explain, and often fine for coarse protection.

The mistake is setting its limit equal to the maximum load your dependency can survive.

If the boundary can deliver roughly 2×, leave headroom—or choose a sliding window/token bucket when the traffic shape matters.

Pause and predict:

If your database safely handles 150 requests/sec, would you configure a fixed-window limit of 150/sec?

My answer: not without accounting for the boundary burst.

Full visual guide: [LINKEDIN_ARTICLE_URL]

#APIDesign #SystemDesign #BackendDevelopment #NodeJS

### First comment

Try the same burst against four algorithms: https://yuvis003.github.io/rate-limiting-slate/rate-limiting-playground.html

Bare implementations: https://github.com/yuviS003/rate-limiting-slate/blob/main/code/phase1-bare/limiters.mjs

### Alt text

“A timeline showing 100 requests at the end of one fixed window and 100 at the start of the next. Each window passes its 100-request check, producing a 200-request boundary burst.”

### Discussion prompt

Ask commenters what algorithm they use and why. Do not turn the comments into “token bucket is always best”; the point is trade-offs.

---

# Post 3 — Friday, October 16

## Purpose

Make token bucket intuitive and drive readers to the interactive lab.

**Format:** native LinkedIn video  
**Asset:** `videos/token-bucket.mp4`  
**Fallback image:** `images/03-token-bucket.png`

### Copy

Token bucket clicked for me when I stopped thinking about “requests per minute” and separated two promises:

**Refill rate = sustainable traffic.**  
**Bucket capacity = tolerated burst.**

In this example:

• capacity: 10 tokens  
• refill: 2 tokens/sec  
• each request spends 1 token

A quiet client can send 10 requests together.

But it cannot sustain more than 2 requests/sec forever.

That is a good fit for real applications. Opening one React screen may fire six API calls together, then remain quiet. A strict 2-per-second counter would reject normal usage. A token bucket absorbs the burst while protecting the long-term rate.

The implementation does not need a timer.

On every request:

```text
new balance = min(capacity, old balance + elapsed × refill rate)
```

Then spend one token if available.

Try changing capacity and refill rate yourself: https://yuvis003.github.io/rate-limiting-slate/rate-limiting-playground.html

What capacity would match your application's normal burst?

#NodeJS #APIs #SystemDesign #JavaScript

### First comment

Full implementation: https://github.com/yuviS003/rate-limiting-slate/blob/main/code/phase1-bare/limiters.mjs

Full article: [LINKEDIN_ARTICLE_URL]

### Video caption

“Tokens refill continuously. Green requests consume tokens and reach the API. When the bucket is empty, red requests leave with HTTP 429.”

### Upload details

- Upload the MP4 directly, not as a Pages link.
- Use the first sentence as the post hook.
- Confirm LinkedIn does not crop the 980×560 video.

---

# Post 4 — Monday, October 19

## Purpose

Teach the distributed race that surprises developers who know Redis commands are atomic.

**Format:** native LinkedIn video  
**Asset:** `videos/redis-race.mp4`  
**Fallback image:** `images/07-race-condition.png`

### Copy

“Redis is single-threaded, so my rate limiter is safe.”

Not necessarily.

Each Redis command can be atomic while your workflow is not.

Suppose the count is 99 and the cap is 100:

1. Pod A reads 99.  
2. Pod B reads 99.  
3. Both decide one slot remains.  
4. Both serve the request.  
5. Both write 100.

Two requests used one remaining slot.

The final counter still says 100, so the overshoot is invisible in the stored result.

The fix is not a distributed lock around Node code.

Move the whole decision into one atomic Redis operation:

```text
read → validate → decide → update → expire
```

A Lua script runs that sequence without another command interleaving.

Important detail: validate every TTL and argument before the first write. Redis isolates a script, but a runtime error does not roll back mutations that already happened.

Full article: [LINKEDIN_ARTICLE_URL]

Have you seen an “atomic command” mistaken for an atomic workflow?

#Redis #DistributedSystems #NodeJS #BackendEngineering

### First comment

Lua scripts: https://github.com/yuviS003/rate-limiting-slate/blob/main/code/phase2-redis/scripts.mjs

Interactive lab: https://yuvis003.github.io/rate-limiting-slate/rate-limiting-playground.html

### Video caption

“Two pods both read 99 and allow one request. In the second half, one Lua script serializes the decision: one request is allowed and one is rejected.”

---

# Post 5 — Wednesday, October 21

## Purpose

Explain exactly what belongs in Redis and what belongs in a database.

**Format:** single-image post  
**Asset:** `images/09-redis-postgres.png`

### Copy

Redis is fast.

Redis is not automatically your invoice.

A production API usually has two different questions:

**Rate limit:** can this customer send the request right now?  
**Quota:** how much has this customer consumed this billing period?

They need different guarantees.

I use the split this way:

**Redis owns the hot path**  
• token balance  
• cached plan policy  
• month-to-date running count  
• unflushed usage delta

**Postgres owns settled truth**  
• plans and overrides  
• durable usage periods  
• idempotent flush IDs  
• data that must survive cache loss

The hot path should not run `SELECT usage` on every request.

On a cold Redis key, let the atomic script ask for a durable seed. Read Postgres once, then continue in Redis.

For settlement, rotate mutable counters into an immutable UUID-tagged batch. Apply that UUID and the aggregate update in one database transaction. A retry after an ambiguous commit then becomes harmless.

One honest boundary remains: total Redis loss can still lose usage that was accepted but not durably rotated. A hard financial cap needs a durable reservation on the acknowledgement path.

Full article: [LINKEDIN_ARTICLE_URL]

#Redis #PostgreSQL #SystemDesign #SaaS

### First comment

Hybrid implementation: https://github.com/yuviS003/rate-limiting-slate/blob/main/code/phase3-db-redis/quota-service.mjs

Schema: https://github.com/yuviS003/rate-limiting-slate/blob/main/code/phase3-db-redis/schema.sql

### Alt text

“Request path through cached policy, Redis token bucket, and Redis quota before the handler. Postgres stores plans, customers, and settled usage; cold reads seed Redis and aggregated usage flushes back.”

### Discussion prompt

Ask: “Which usage in your system is disposable protection, and which is financial truth?”

---

# Post 6 — Friday, October 23

## Purpose

Show why request rate and concurrency are different dimensions.

**Format:** single-image post  
**Asset:** `images/10-rate-vs-concurrency.png`

### Copy

Two requests per second can be harmless—or enough to exhaust your service.

Case A:

```text
2 requests/sec × 50ms each ≈ 0.1 requests in flight
```

Case B:

```text
2 requests/sec × 6 seconds each ≈ 12 requests in flight
```

The arrival rate is identical.

The amount of work held at once is not.

That is why expensive endpoints often need a concurrency limit in addition to a request-rate limit.

Examples:

• PDF rendering  
• report generation  
• LLM inference  
• large database aggregation  
• export/download preparation

A safe local pattern is:

```js
const slot = limiter.tryAcquire(customerId);
if (!slot.acquired) return res.status(429).end();

try {
  await doExpensiveWork();
} finally {
  slot.release();
}
```

The `finally` is the feature. Errors must not leak capacity.

For queued work, also bound total queue size, per-customer queue size, maximum wait, and cancellation on disconnect.

Full article: [LINKEDIN_ARTICLE_URL]

#PerformanceEngineering #NodeJS #SystemDesign #APIs

### First comment

Tested local concurrency implementation: https://github.com/yuviS003/rate-limiting-slate/blob/main/code/phase4-beyond/concurrency.mjs

### Alt text

“Two timelines each receive two requests per second. Requests lasting 50ms peak at two visually arriving together; requests lasting six seconds accumulate to twelve in flight.”

---

# Post 7 — Monday, October 26

## Purpose

Introduce weighted limits using GraphQL and LLM calls as familiar examples.

**Format:** single-image post  
**Asset:** `images/11-cost-based.png`

### Copy

A health check and a million-node GraphQL query are both “one request.”

That does not make them equal work.

Request-count limiting breaks when costs vary dramatically:

```text
GET /health                         cost 1
GET /search                        cost 20
POST /chat                    cost 3,000 tokens
Nested GraphQL query        cost 1,010,100 units
```

The better question is not:

> How many requests did this customer send?

It is:

> How much of the protected resource did those requests consume?

That resource might be:

• GraphQL complexity  
• LLM tokens  
• rows scanned  
• recipients emailed  
• bytes exported  
• estimated CPU time

When final cost is unknown, reserve an estimate before execution, then settle the actual value afterwards.

Do not automatically cancel a reservation after a timeout. A timeout is an unknown outcome—the provider may have completed and billed the operation.

Use a durable reservation ID for money-sensitive limits.

Full article: [LINKEDIN_ARTICLE_URL]

What unit predicts cost better than “request” in your system?

#GraphQL #LLMEngineering #APIDesign #SystemDesign

### First comment

Weighted budget implementation: https://github.com/yuviS003/rate-limiting-slate/blob/main/code/phase4-beyond/cost.mjs

### Alt text

“Four requests plotted by logarithmic cost: health check 1, search 20, chat 3,000, and a deeply nested GraphQL request 1,010,100. Counting all as one request hides the real work.”

---

# Post 8 — Wednesday, October 28

## Purpose

Show that limits can react to system health instead of remaining static forever.

**Format:** single-image post  
**Asset:** `images/13-adaptive.png`

### Copy

The concurrency limit that is safe today may be dangerous tomorrow.

Or unnecessarily conservative.

The database slows down. Cache hit rate falls. A downstream deploy regresses. The instance type changes.

A static limit of 40 knows none of this.

Adaptive concurrency borrows the shape of congestion control:

1. observe successful latency;  
2. estimate how much work is queueing;  
3. increase cautiously while latency stays near the healthy floor;  
4. decrease when queueing appears;  
5. cut harder after a real drop.

A simplified Vegas-shaped estimate is:

```text
queue ≈ limit × (1 - minimum latency / current latency)
```

In this simulation, latency rises from 100ms to 300ms.

The chosen concurrency limit falls before a request has to fail, then climbs after recovery.

Two important cautions:

• a failed sample must not become the new “fastest healthy” baseline;  
• a real controller needs sample windows, smoothing, app-limited filtering, hysteresis, and an actual admission semaphore.

This is a feedback-controller demonstration, not a copy of Netflix or TCP.

Full article: [LINKEDIN_ARTICLE_URL]

#ReliabilityEngineering #DistributedSystems #Performance #SystemDesign

### First comment

Controller demonstration: https://github.com/yuviS003/rate-limiting-slate/blob/main/code/phase4-beyond/adaptive.mjs

### Alt text

“Observed latency rises from 100 to 300 milliseconds. A simplified adaptive controller reduces concurrency from around 67 to 22, then increases after latency recovers.”

---

# Post 9 — Friday, October 30

## Purpose

Finish the series with a saveable decision guide and route late readers back to the full article.

**Preferred format:** LinkedIn document/carousel with three pages  
**Pages:**

1. `images/06-cheatsheet.png`
2. `images/12-defense-in-depth.png`
3. `images/14-decision-tree.png`

If document upload is inconvenient, publish only `images/14-decision-tree.png` as a single-image post.

### Copy

Stop asking, “Which rate-limiting algorithm is best?”

Ask, “What exactly am I protecting?”

**Fairness between callers?**  
Start with a token bucket. Use a sliding window when exact trailing fairness matters.

**Long-running work?**  
Cap concurrency, not only requests per second.

**Requests with different costs?**  
Spend weighted units and reserve unknown cost before execution.

**A safe capacity that moves with latency?**  
Use adaptive concurrency—with real sampling and stability controls.

**The whole service is already overloaded?**  
Shed low-priority work while protecting a separately reserved critical pool.

**You are the client receiving 429?**  
Respect `Retry-After` as a floor, add later jitter, preserve one stable idempotency key, and stop inside a total retry budget.

Mature APIs compose these controls because each answers a different question.

If you remember only one rule from this series:

> The algorithm determines traffic shape. The key determines fairness. The store determines scope. The failure mode determines your worst day.

Full article: [LINKEDIN_ARTICLE_URL]

Interactive lab: https://yuvis003.github.io/rate-limiting-slate/rate-limiting-playground.html

Which branch of the decision tree would your current API take?

#SystemDesign #BackendEngineering #Redis #APIs

### First comment

All code and tests: https://github.com/yuviS003/rate-limiting-slate

### Document title

```text
Which Rate Limiter Do I Actually Need?
```

### Alt text

- Page 1: “Comparison of fixed window, sliding window, token bucket, and leaky bucket.”
- Page 2: “Six layers of protection from edge rate limiting to worker load shedding.”
- Page 3: “Decision tree connecting fairness, expensive work, service overload, and upstream 429 responses to appropriate controls.”

---

# Engagement and measurement routine

## Immediately after each post

- Open the post once to verify line breaks, image/video crop, and links.
- Add the prepared first comment.
- Correct genuine errors quickly; do not repeatedly rewrite a live post for style.
- Reply to technical questions with enough substance that the thread teaches something.

## After 24 hours

Record:

| Metric | Why it matters |
|---|---|
| Impressions | Distribution |
| Reactions | Lightweight agreement/interest |
| Comments | Conversation quality |
| Reposts | Whether the lesson felt shareable |
| Saves, when shown | Whether the visual felt reusable |
| Profile views | Whether the series builds professional interest |
| New followers/connections | Audience growth |
| Article views | Long-form conversion |
| Repository traffic/stars | Technical intent |

## After 7 days

Compare posts by format and topic, not only total impressions:

- Which hook earned comments from the audience you want?
- Did video outperform static diagrams for understanding?
- Did the lab receive questions or repository visits?
- Which question appears repeatedly in comments?
- Which post should become the next deeper article?

Do not delete a technically useful post merely because its first-day reach was smaller. This series is also a durable portfolio demonstrating React/Node experience, backend design depth, and clear technical communication.

# Reuse rules

- Do not post the same asset on consecutive publishing days.
- Each post should teach one complete idea even if nobody clicks the article.
- Keep one primary CTA per post; questions are better than three competing links in the body.
- Put supporting code/lab links in the first comment when the body is already dense.
- Replace every `[LINKEDIN_ARTICLE_URL]` before the first scheduled post.
- Preserve source attribution in the long-form article; short posts can link back to that sourced version.
