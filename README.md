# Upwork Export MD

A userscript that extracts Upwork job details and exports them as structured Markdown — so you can actually read them somewhere else.

## Why

Upwork has no public API for freelancers (RSS feeds killed Aug 2024, API key requires undisclosed platform experience threshold). Chrome extensions that scrape Upwork only capture truncated descriptions from search result tiles — not the full job detail panel with client history, screening questions, and activity metrics.

This script extracts **everything visible** from any Upwork job detail page and exports it as a clean `.md` file. No API needed. No browser automation. Just read what's already on screen.

## What It Extracts

| Field | Source |
|-------|--------|
| Title, URL, Description | Job detail panel |
| Type (Hourly/Fixed), Budget, Bids | Features section |
| Experience, Duration, Hours | Features section |
| Contract-to-hire flag | Features section |
| Posted date, Proposals count | Activity section |
| Connects required | Sidebar |
| Skills (mandatory + nice-to-have) | Skills section |
| Screening questions | Questions section |
| Preferred qualifications | English level, Location, JSS |
| Activity (interviewing, invites, hires) | Activity section |
| Client: payment, phone, rating, location | About the client |
| Client: jobs posted, hire rate, spend | Client stats |
| Client: avg hourly rate, total hours | Client history |
| Client: company info, member since | Client profile |

## How It Works

1. Browse Upwork normally (search, best matches, or direct job links)
2. Open a job detail — click the **+** FAB button to add it to your list
3. Repeat for multiple jobs — the badge shows your count
4. Click **Export .md** to download a structured Markdown file
5. Feed the `.md` to your LLM for scoring, evaluation, or proposal drafting

The job list persists across page reloads via Greasemonkey storage.

## Supported Pages

| Page | URL Pattern | Method |
|------|------------|--------|
| Keyword Search | `/nx/search/jobs*` | Slider panel (`data-test` selectors) |
| Best Matches | `/nx/find-work/*` | Slider panel (class-based fallback) |
| Direct Job Page | `/jobs/~*` | Full page (`<main>` element) |

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/) (recommended) or [Greasemonkey](https://www.greasespot.net/) in your browser
2. Click the raw script link: **[Install upwork-export-md.user.js](https://github.com/haingt-dev/upwork-export-md/raw/main/upwork-export-md.user.js)**
3. Confirm installation in your userscript manager
4. Navigate to Upwork — the orange **+** button appears in the bottom-right corner

## Output Format

```markdown
# Upwork Jobs — 2026-04-08

1 jobs collected

## Backend Engineer for API-Driven Automation Systems (Hourly, Ongoing)
https://www.upwork.com/jobs/~022041671804986303299
Hourly | $30.00-$55.00 | Expert | Less than 30 hrs/week | 3 to 6 months | Posted 7 hours ago | 5 to 10 proposals | 20 Connects

[Full job description...]

Project Type: Ongoing project

Skills: Node.js, API Integration, Python, OAuth, REST API

Screening Questions:
- What's the most complex system you've built that connects multiple APIs?
- What usually breaks in these systems, and how do you prevent it?

Qualifications: Job Success Score: At least 90%, Location: Europe, Africa

Activity: Last viewed by client: yesterday; Interviewing: 0; Invites sent: 0

Client: Payment verified | Phone verified | 5.00 of 5 reviews | United States, Fayetteville | 23 jobs posted | 48% hire rate | $5.8K total spent | $21.44/hr avg hourly rate paid | 263 hours | Member since Jul 3, 2025
```

## Technical Design

- **Zero injection**: FAB button is `position: fixed` — never modifies Upwork's DOM tree
- **Lightweight polling**: 800ms `setInterval` checks for job panel changes (no MutationObserver, no page lag)
- **Extract on click**: Data is read from DOM only when you click **+**, not on page load
- **Multi-fallback selectors**: `data-test` attributes (stable) -> `data-qa` attributes -> class-based -> regex on text. Survives Upwork redesigns
- **Tooltip stripping**: Removes Upwork's tooltip overlay text that pollutes `textContent`
- **GM storage persistence**: Job list survives page reloads and SPA navigation

## TOS Compliance

This script reads visible DOM content during normal manual browsing. It does not:
- Automate navigation or clicking
- Send requests to Upwork servers
- Scrape pages in the background
- Bypass authentication or rate limits

This is functionally equivalent to manually copying text from the page.

## License

MIT
