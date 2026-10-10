# Publishing Guide

## Canonical locations

- GitHub repository: `https://github.com/yuviS003/rate-limiting-slate`
- Interactive lab after GitHub Pages is enabled: `https://yuvis003.github.io/rate-limiting-slate/rate-limiting-playground.html`
- Repository source links use: `https://github.com/yuviS003/rate-limiting-slate/blob/main/...`

## 1. Publish the interactive companion first

`rate-limiting-playground.html` is a single, zero-dependency file. Put it on any static host (GitHub Pages, Cloudflare Pages, Netlify, S3, etc.), then replace its relative link in the article with the public URL.

If you publish the full folder, keep `images/`, `videos/`, and `code/` beside the article so every relative link continues to resolve.

## 2. Use this asset order

| Position | Asset | Purpose / suggested alt text |
|---|---|---|
| Cover | `00-cover.png` | “Rate limiting from bare JavaScript to Redis, Postgres, concurrency and adaptive control.” |
| Cold open | `01-why-rate-limiting.png` | “One noisy client without and with a rate limiter.” |
| Fixed window | `02-fixed-window.png` | “Two valid windows permit a 2x burst across their boundary.” |
| Token bucket | `03-token-bucket.gif` | “Tokens refill continuously; requests spend tokens and empty buckets return 429.” |
| Algorithm recap | `06-cheatsheet.png` | “Fixed window, sliding log, token bucket and leaky bucket compared.” |
| Scale-out failure | `04-memory-vs-redis.png` | “Three in-memory counters versus one shared Redis counter.” |
| Atomicity | `07-race-condition.gif` | “Two pods both read 99 and overshoot; one Lua script serializes the decision.” |
| Hybrid data | `09-redis-postgres.png` | “Hot policy and quota checks in Redis with durable Postgres settlement.” |
| Concurrency | `10-rate-vs-concurrency.png` | “Equal request rates create different in-flight work when durations differ.” |
| Weighted cost | `11-cost-based.png` | “One health check and one large GraphQL query are not equal units of work.” |
| Adaptive | `13-adaptive.png` | “Concurrency falls when latency triples and rises after recovery.” |
| Layers | `12-defense-in-depth.png` | “Six protection layers from edge controls to worker load shedding.” |
| Conclusion | `14-decision-tree.png` | “Decision tree for choosing rate, concurrency, cost, adaptive or client-side controls.” |

Keep the two GIFs in the long-form web version. If an editor does not preserve animated media, upload the matching MP4 as a native companion post and use the PNG still in the article. Both MP4s are H.264 at 1280×720 and comfortably exceed LinkedIn's 75 KB minimum.

## 3. Paste the article into LinkedIn correctly

Canonical source: `rate-limiting-article.md`. **Do not paste that Markdown source directly into LinkedIn.** LinkedIn will show `#`, `##`, and `![image](url)` as ugly text.

Use the generated body-only copier instead:

- Local: `publish/linkedin-paste.html`
- After pushing: `https://yuvis003.github.io/rate-limiting-slate/publish/linkedin-paste.html`

Workflow:

1. Enter the LinkedIn title and subtitle in their dedicated fields.
2. Upload `images/00-cover.png` as the cover.
3. Open `linkedin-paste.html` in a browser.
4. Copy and paste its six numbered rich-text sections into LinkedIn, in order.
5. At each blue `ADD IMAGE HERE` marker, delete the marker and upload the named local image.
6. If a code block loses formatting, select it and click LinkedIn's code (`</>`) button.
7. Keep inline source links and the primary-reference section.
8. Preview desktop and mobile before publishing.

The copier intentionally excludes the duplicate title, subtitle, and cover from the article body. It also converts collapsible answer blocks and tables into editor-safe rich text.

## 4. Suggested LinkedIn launch post

> Most rate-limiting articles stop at `100 requests/minute`.
>
> That rule breaks the moment you add a second Node process.
>
> So I built the guide I wish I had earlier:
>
> - six algorithms in bare JavaScript;
> - the Redis race that silently overshoots;
> - atomic Lua across many pods;
> - Redis + Postgres without putting the DB on the hot path;
> - concurrency, weighted cost, LLM reservations, adaptive limits, and load shedding;
> - 15 original diagrams, 2 animations, and an interactive browser lab.
>
> The surprising part: rate limiting is not really about returning `429`.
>
> It is a scheduler deciding how shared capacity is divided when demand exceeds supply.
>
> [ARTICLE URL]
>
> Which failure have you seen first: a retry storm, a noisy tenant, or a slow endpoint?

Suggested tags: `#SystemDesign #NodeJS #Redis #BackendEngineering #DistributedSystems`

## 5. Verification before publishing

```powershell
npm install
npm test
```

Then check:

- every image is under the target platform’s dimension/file-size limits;
- both MP4s play and both GIFs loop;
- the public playground works on desktop and mobile;
- code links point to the published repository, not a local path;
- no claim says the teaching test double proves Redis Cluster failover;
- operational quota and hard financial reservation are clearly distinguished.

## 6. Recommended content split

The full article is intentionally deep. Reuse it as a series without rewriting:

1. **Post 1:** fixed window’s 2x boundary bug.
2. **Post 2:** token bucket animation and bare Node implementation.
3. **Post 3:** the invisible Redis GET/check/SET race.
4. **Post 4:** Redis for speed, Postgres for settled truth.
5. **Post 5:** why request rate cannot protect slow work.
6. **Post 6:** weighted limits for GraphQL and LLM tokens.
7. **Post 7:** adaptive concurrency and priority shedding.

Each post can point back to the master article and interactive lab.
