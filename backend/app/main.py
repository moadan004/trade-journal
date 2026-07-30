from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.routers import accounts, auth, stats, trades, weekly_reviews
from app.routers import accounts, auth, stats, trades
from app.services.uploads import SUBDIR, storage_root

settings = get_settings()

app = FastAPI(title="Trade Journal API", version="0.1.0")

# allow_credentials is required for the auth cookie to be sent. Note that
# browsers reject wildcard origins when credentials are included, so the
# allowed origins must always be listed explicitly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(trades.router)
app.include_router(stats.router)
app.include_router(weekly_reviews.router)

# Trade screenshots. Created up front so the mount doesn't fail on a fresh
# checkout that has never had an upload.
_uploads = storage_root(settings.upload_dir)
(_uploads / SUBDIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok"}
