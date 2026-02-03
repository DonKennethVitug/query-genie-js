# QueryGenie

Generate PostgreSQL SQL or Rails Active Record queries from natural language. Paste your schema, describe what you want, and get valid queries.

## Setup

Open `index.html` in a browser or serve the project locally. Enter your OpenAI API key (stored in localStorage only).

## Deploy to Cloudflare Pages

```bash
wrangler pages deploy . --project-name=query-genie
```

Or add to `wrangler.toml` for config-based deploy:

```toml
pages_build_output_dir = "."
```

Then: `wrangler pages deploy .`
