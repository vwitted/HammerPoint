# Deploying HammerPoint

The repo ships a `Dockerfile` that produces one self-contained image: the built React client, the
bundled Express server, production `node_modules`, and the headless Chrome that the BPI, ATG and
HiBid scrapers fall back to. Any host that runs a container can run it.

## What the image needs

| Setting | When | Notes |
| --- | --- | --- |
| `VITE_GOOGLE_MAPS_PLATFORM_KEY` | **build arg** | Baked into the browser bundle by Vite. Public by design. Without it the app works but the map doesn't. |
| `PORT` | runtime | Defaults to 3000. Cloud Run, Render, Railway and Fly set it for you. |
| `TRUST_PROXY` | runtime | Set to `1` on any hosted platform (they all sit behind a proxy), otherwise every visitor shares one rate-limit bucket. |
| `SEARCH_RATE_LIMIT_PER_MINUTE`, `IMAGE_PROXY_RATE_LIMIT_PER_MINUTE` | runtime | Optional overrides. |

Firebase config is in `firebase-applet-config.json` and is built in; nothing to set.

**Memory:** give the container at least **2 GB**. A single search can start up to three Chrome
instances; at 512 MB they get OOM-killed and those providers silently return nothing.

**Firebase Auth:** after the first deploy, add the new domain (e.g. `hammerpoint-xxxx.a.run.app`)
under Firebase console → Authentication → Settings → Authorized domains, or Google sign-in fails.

## Run locally

```sh
docker build -t hammerpoint --build-arg VITE_GOOGLE_MAPS_PLATFORM_KEY=your-key .
docker run --rm -p 3000:3000 hammerpoint
# open http://localhost:3000
```

## Google Cloud Run (no laptop needed: everything below works in Cloud Shell in a browser)

Fits well since the project already lives in Google Cloud via Firebase. Scales to zero, so it
costs nothing when idle. Open <https://shell.cloud.google.com>, then:

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
  --memory 2Gi --cpu 2 --timeout 300 \
  --set-env-vars TRUST_PROXY=1 --allow-unauthenticated
```

To redeploy after changes: `git pull`, then rerun the `docker build`, `docker push` and
`gcloud run deploy` lines. (`gcloud run deploy --source .` also works but can't pass the Maps key
build arg, so the map would be blank.)

## Render / Railway / Fly.io (click-through, phone-friendly)

All three detect the `Dockerfile` automatically when you connect the GitHub repo:

- **Render**: New → Web Service → pick the repo. Instance with ≥2 GB RAM. Add environment variables
  `VITE_GOOGLE_MAPS_PLATFORM_KEY` and `TRUST_PROXY=1` (Render passes env vars to the Docker build
  as build args, so the Maps key reaches Vite).
- **Railway**: New Project → Deploy from GitHub repo. Add the same two variables; Railway passes
  variables to `ARG`s declared in the Dockerfile. Raise memory to 2 GB.
- **Fly.io**: `fly launch` (choose not to deploy yet), set `memory = "2gb"` in `fly.toml`, then
  `fly secrets set TRUST_PROXY=1` and
  `fly deploy --build-arg VITE_GOOGLE_MAPS_PLATFORM_KEY=your-key`.

Each of these redeploys automatically on push to the branch you pick.
