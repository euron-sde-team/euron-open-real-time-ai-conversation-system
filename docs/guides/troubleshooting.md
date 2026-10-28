# Troubleshooting

Symptoms, causes and fixes, grouped by where they show up. Every API error body carries a
stable `code` and a `requestId`; the same id is on the API's log line
([operations.md](operations.md#logs)).

## In the interview room

| Symptom | Cause | Fix |
| --- | --- | --- |
| "The microphone is blocked. Allow it in the browser's address bar, then try again." | The browser or the operating system denied microphone access, or the page is not on `https` or `localhost` (browsers only offer the microphone on secure origins) | Allow the microphone for the site (and for the browser in the OS privacy settings), then press join again. Or choose to continue by typing: the interview works with typed answers |
| "The voice connection could not be opened. This is usually a VPN, firewall or network that blocks real-time audio..." | OpenAI: the WebRTC peer connection failed or its data channel did not open within 15 s. Gemini: the WebSocket to Google could not be opened | Try another network (a phone hotspot works well) and retry. For OpenAI the handshake already goes through the API relay (`/api/realtime/openai/calls`), so blocking `api.openai.com` alone is not the problem; what is blocked is the WebRTC media (UDP). For Gemini the browser must reach `wss://generativelanguage.googleapis.com` |
| "The voice session expired. Start the question again." (`401 REALTIME_SESSION_INVALID`) | The relay accepts a credential once, inside its connection window (`REALTIME_CONNECT_TTL_SECONDS`, 120 s by default), and only while its live session is open | Retry the question: the room mints a new credential. If it happens every time, check the server clock and that nothing replays requests |
| "The voice service could not start a session. Try again in a moment." (`502 REALTIME_UNAVAILABLE`) | The provider refused to mint a credential: a wrong or unfunded key, a renamed model, or an outage | Press **Test** on the voice model in `/admin/models`; the API log has `live.mint` with the provider's HTTP status |
| "No voice model is set up yet. Ask an administrator to add one." (`503 NO_REALTIME_MODEL`) | No enabled REALTIME model with a usable provider. A production install has no stub, and the OpenAI and Gemini models stay hidden until their key is set | Put an `openai` or `gemini` key in `PROVIDER_KEYS` (or `OPENAI_API_KEY` / `GEMINI_API_KEY`), roll the API and worker, and check the model in `/admin/models` ([providers.md](providers.md)) |
| Gemini connects in development but not in production, and the browser console shows a CSP `connect-src` violation | `REALTIME_ORIGINS` on the web service does not include the Gemini WebSocket origin (the dev server allows any `wss:`) | Leave `REALTIME_ORIGINS` unset (the default allows Gemini) or include `wss://generativelanguage.googleapis.com` ([configuration.md](configuration.md#web-environment)) |
| The interviewer cannot be heard | Autoplay was blocked, the output device is wrong, or the tab is muted | Click in the page once (joining is a click, which usually unlocks audio), check the output device and the tab's mute state |
| The interviewer hears itself and keeps talking | Speakers feeding back into the microphone | Use headphones. The room asks for echo cancellation, but laptop speakers at high volume still leak |
| The session ends by itself | The session reached its maximum length (the tier's `max_session_minutes`, or less when few voice minutes are left this month) | Normal. The answer so far is submitted and scored. An admin can raise the tier's limits |
| "You have used this month's allowance. It resets on the 1st (UTC)." (`429 QUOTA_EXCEEDED`) | No interviews or fewer than 30 seconds of voice left this month | Wait for the reset, or ask an admin for a tier change or a per-user override ([quotas.md](../architecture/quotas.md)) |
| "The face check could not start in this browser. Tab checks are still on." | The MediaPipe face detector (served from `/mediapipe/` on this origin) failed to load or compile: an old browser, WebAssembly disabled, or the files missing from the image | The interview carries on without the face check. If it happens in every browser, check that `apps/web/public/mediapipe` was populated at build (`scripts/copy-mediapipe.mjs` runs before `next build`) and that the CSP still has `wasm-unsafe-eval` |
| "The camera is off, so presence is not checked." | Proctoring is on but the camera was denied or is missing | Allow the camera and rejoin, or carry on: proctoring is advisory and the report notes it |

## Creating an interview

| Symptom | Cause | Fix |
| --- | --- | --- |
| The interview page says "The questions could not be prepared" (`PLAN_FAILED`) | The text model could not be reached, or returned something that was not a valid plan twice in a row (one retry), or had no usable rounds. The interview is given back to this month's quota | From a job description: **Try again** (`POST /api/interviews/:id/replan`), which books the interview again. From a resume: **Upload the resume again** (resumes are never stored, so they cannot be re-planned). If it keeps failing, press **Test** on the TEXT model; small local models often break the JSON format |
| The interview stays in `PLANNING` | The worker is not running, so the `interview.plan` job waits in Redis | Start the worker (`make logs SERVICE=worker` locally; the worker service on AWS). Jobs run when it returns |
| `503 NO_TEXT_MODEL` | No enabled TEXT model with a usable provider | Add a key for a TEXT model's provider, or an `OPENAI_COMPATIBLE` server, and set a default in `/admin/models` |
| `400 FILE_TYPE` | The file's bytes are not a PDF or a DOCX, whatever its name | Export the resume as PDF or `.docx` |
| `422 RESUME_TOO_SHORT` | Fewer than 200 characters of text could be read, usually a scanned image | Upload a text PDF or a `.docx` |
| `400 FILE_TOO_LARGE` | Larger than `MAX_RESUME_MB` (8 MB by default) | Shrink the file, or raise `MAX_RESUME_MB` (up to 20) |
| `403 FEATURE_DISABLED` | Resume upload or job descriptions are turned off in `/admin/settings` | Turn the feature on |
| An answer shows as failed to score (`FAILED`) | The scoring call failed or returned an invalid format, after the queue's retries | Answering the question again replaces the answer and scores it again |

## Local stack

| Symptom | Cause | Fix |
| --- | --- | --- |
| `port is already allocated` on `make up` | Another process uses 3550, 5046, 5512, 6449, 8066, 1066, 4617 or 5139 | Move it in `deploy/compose/.env`: `CONV_WEB_PORT`, `CONV_API_PORT`, `CONV_PG_PORT`, `CONV_REDIS_PORT`, `CONV_MAILPIT_PORT`, `CONV_SMTP_PORT`, `CONV_FLOCI_PORT`, `CONV_STUB_PORT` ([quickstart-local.md](quickstart-local.md#ports)) |
| `run make env first` | Compose started without the generated secrets | `make env` (or `make up`, which runs it) |
| The `terraform` or `migrate` one-shot fails | Emulator state and its Terraform state out of step, or a stale `.terraform` from running Terraform on the host | `make logs SERVICE=terraform` (or `migrate`); `make down && make up`; delete `infra/terraform/envs/local-floci/.terraform` |
| No email arrives | Locally every mail goes to Mailpit | http://localhost:8066 |
| Sign-in says `EMAIL_NOT_VERIFIED` | `REQUIRE_EMAIL_VERIFICATION=true` (the default) | Open the link in Mailpit, or set `REQUIRE_EMAIL_VERIFICATION=false` in `.env` for local work |
| A change to `.env` has no effect | Compose reads `.env` when it creates containers | `make up` again |
| A local Ollama cannot be reached from the API | `localhost` inside the API container is the container | Base URL `http://host.docker.internal:11434/v1` |
| `400 STUB_IN_PRODUCTION` | Creating a `STUB` provider with `NODE_ENV=production` | Use a real provider |

## Deployment

| Symptom | Cause | Fix |
| --- | --- | --- |
| The API exits at boot with "Refusing to start with an insecure configuration" | A production guard failed (development secrets, `CORS_ORIGINS` unset, `MAIL_MODE=outbox`, inline jobs, low bcrypt cost) | Fix each listed item ([configuration.md](configuration.md#production-guards)) |
| The boot log warns `no model provider key is configured` | `PROVIDER_KEYS` still holds `set-me` placeholders | Put real keys in `<name_prefix>/provider-keys` and roll the api and worker ([deploy-aws.md](deploy-aws.md#provider-keys)) |
| Tasks die at start with `exec format error` | Images built for the wrong CPU architecture | Build with the `PLATFORM` that matches `cpu_architecture` |
| `make aws-admin` exits non-zero | The set-password mail could not be sent (unverified SES identity, or a sandboxed account and an unverified recipient) | Verify the identity, or the recipient while in the SES sandbox |
| Signed out on every reload | The refresh cookie is not first-party or not `Secure` over https | Serve the web app and `/api` on one https host; `COOKIE_SECURE=auto` follows `APP_WEB_URL` |
