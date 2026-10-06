# Dev Provider Configuration

The public dev entry is `/english?version=dev`. Keep stable `/english/`
and `?version=stable` on the existing checkout and port 8091. Dev runs on
port 8092. Both the dev entry and `/english-dev/*` must proxy to the dev
application, not expose the whole checkout with `file_server`.

Generate the deployment HTML with:

```powershell
node scripts/build-dev-index.js <staging-index-path>
```

This pins assets to `/english-dev/` and changes their cache revision. The
local HTML stays relative; use `npm start` and `http://localhost:8091`,
not `file://`. Origin `null` is deliberately not allowed.

## Providers

Text and image requests have independent provider/model preferences.
The default remains MiniMax M3. Other providers use the OpenAI-compatible
chat completions protocol: OpenAI, DeepSeek, Qwen, SiliconFlow,
OpenRouter, Ollama, and custom endpoints. Native Anthropic/Gemini
protocol adapters are not implemented.

Account-specific API configuration is saved through `/api/providers`.
The API never returns the key. Credentials are encrypted with AES-GCM
and bound to the account/provider pair. Keep `data/provider-key.bin`
with database backups when restoring personal provider configuration;
database-only backups cannot decrypt it after that file is lost.

Only trusted HTTPS hostnames may be configured by users. Administrators
can add compatible hosts through `AI_EN_PROVIDER_HOSTS` (comma-separated
hostnames). Redirects are rejected by the proxy. Server-managed Ollama
is configured through `OLLAMA_BASE` and `OLLAMA_MODEL`; a remote website
cannot access a user's phone/desktop localhost instance.

Search is independently selectable: MiniMax, Brave, Bing, Tavily,
Google via Serper, or off. Bing/Brave use GET requests; result payloads
from each provider are normalized for the research agent.

Provider keys are not stored in localStorage or user settings JSON.
Users must configure valid keys for non-gift services. Selecting a
provider is not evidence that its credentials or model support images.
