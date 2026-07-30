from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routers import accounts, auth, stats, trades, weekly_reviews

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

# NOTE: there is deliberately no StaticFiles mount for uploads. Screenshots are
# private, and a static mount bypasses get_current_user entirely - it served
# every image to anyone holding the URL. They go through
# GET /trades/{id}/screenshot, which checks ownership first.


@app.get("/health")
def health():
    return {"status": "ok"}
