# Deploying HammerPoint

The repo ships a `Dockerfile` that produces one self-contained image:

- the built React client and the bundled Express server;
- production `node_modules` and the headless Chrome that the remaining Puppeteer fallbacks use;
- a Python sidecar (`sidecar/`) with **Camoufox** for JavaScript pages and **curl_cffi** for
  browser-grade TLS/HTTP2 on plain requests.

Any host that runs a container can run it. The Node process starts the sidecar itself
(`SIDECAR_AUTOSTART=1`), waits for its `/health` endpoint, and serves the app on `PORT`. If the
sidecar cannot start, the server keeps running and providers fall back to Node `fetch` / Chrome.

## What the image needs

| Setting | When | Notes |
| --- | --- | --- |
| `VITE_GOOGLE_MAPS_PLATFORM_KEY` | **build arg** | Baked into the browser bundle by Vite. Public by design. Without it the app works but the map doesn't. |
| `PORT` | runtime | Defaults to 3000. Render sets it for you. |
| `TRUST_PROXY` | runtime | Set to `1` on any hosted platform (they all sit behind a proxy), otherwise every visitor shares one rate-limit bucket. |
| `SEARCH_RATE_LIMIT_PER_MINUTE`, `IMAGE_PROXY_RATE_LIMIT_PER_MINUTE` | runtime | Optional overrides. |
| `INSTALL_CAMOUFOX` | **build arg** | Defaults to `1`. Set to `0` to skip the ~1 GB Firefox download on a low-disk host; browser providers then use Chrome. |

The sidecar's own environment is optional: `SIDECAR_URL` points at an external sidecar, and
`SIDECAR_PYTHON` overrides the interpreter the image starts. Leave both unset in the image.

Firebase config is in `firebase-applet-config.json` and is built in; nothing to set.

**Memory:** give the container at least **3 GB**. A search can run Camoufox (Firefox) and Chrome
fallbacks at the same time; at 512 MB they get OOM-killed and providers silently return nothing.
**Disk:** the image needs roughly 3 GB (Chrome, Camoufox's browser, Node and Python deps), and the
first build downloads both browsers, so allow a generous build timeout.

**Firebase Auth:** after the first deploy, add the new domain (e.g. `hammerpoint-xxxx.a.run.app`)
under Firebase console → Authentication → Settings → Authorized domains, or Google sign-in fails.

## Run locally

Docker:

```sh
docker build -t hammerpoint --build-arg VITE_GOOGLE_MAPS_PLATFORM_KEY=your-key .
docker run --rm -p 3000:3000 --memory 3g hammerpoint
# open http://localhost:3000
```

Without Docker, run the two processes side by side:

```sh
pip install -r sidecar/requirements.txt
python -m camoufox fetch
npm run sidecar            # http://127.0.0.1:8877
# in another terminal:
SIDECAR_URL=http://127.0.0.1:8877 npm run dev
```

With `SIDECAR_URL` unset, `npm run dev` still works; providers use Node `fetch` and Chrome.

## Render / Railway / Fly.io (click-through, phone-friendly)

All three detect the `Dockerfile` automatically when you connect the GitHub repo:

- **Render**: New → Web Service → pick the repo and the branch you deploy (pushes to that branch
  redeploy automatically). Choose an instance with ≥3 GB RAM. Add `TRUST_PROXY=1` and
  `VITE_GOOGLE_MAPS_PLATFORM_KEY` (Render passes environment variables to the Docker build as build
  args, so the Maps key reaches Vite).
- **Railway**: New Project → Deploy from GitHub repo. Add the same two variables; Railway passes
  variables to `ARG`s declared in the Dockerfile. Raise memory to 3 GB.
- **Fly.io**: `fly launch` (choose not to deploy yet), set `memory = "3gb"` in `fly.toml`, then
  `fly secrets set TRUST_PROXY=1` and
  `fly deploy --build-arg VITE_GOOGLE_MAPS_PLATFORM_KEY=your-key`.

Each of these redeploys automatically on push to the branch you pick.

## Google Cloud Run

Cloud Run works, but the image is large and the browser needs headroom:

```sh
git clone https://github.com/vwitted/HammerPoint.git && cd HammerPoint
PROJECT=$(gcloud config get-value project)
REGION=europe-west2   # London; pick what suits
gcloud services enable run.googleapis.com artifactregistry.googleapis.com
gcloud artifacts repositories create hammerpoint --repository-format=docker --location=$REGION

IMAGE=$REGION-docker.pkg.dev/$PROJECT/hammerpoint/app
docker build -t $IMAGE --build-arg VITE_GOOGLE_MAPS_PLATFORM_KEY=your-key .
gcloud auth configure-docker $REGION-docker.pkg.dev
docker push $IMAGE

gcloud run deploy hammerpoint --image $IMAGE --region $REGION \
  --memory 4Gi --cpu 2 --timeout 300 \
  --set-env-vars TRUST_PROXY=1 --allow-unauthenticated
```

To redeploy after changes: `git pull`, then rerun the `docker build`, `docker push` and
`gcloud run deploy` lines. (`gcloud run deploy --source .` also works but can't pass the Maps key
build arg, so the map would be blank.)
