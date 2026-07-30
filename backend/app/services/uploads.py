"""Screenshot storage.

Files land on local disk under the configured upload directory and are served
back only through the ownership-checked route in app/routers/trades.py - there
is deliberately no static mount, because a bare StaticFiles app bypasses
authentication entirely and would make every screenshot readable by anyone
holding the URL.

See the deployment caveat in README: on Render's free tier the filesystem is
**ephemeral**, so uploads do not survive a deploy or a restart. This is fine for
local use and for trying the feature out; it is not storage you should trust
with anything you want to keep.
"""

import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

# Raster formats only. SVG is deliberately excluded: it can carry <script>, and
# these files are served from the same origin as the app, so accepting SVG would
# turn "upload a screenshot" into stored XSS against yourself.
#
# Keyed by extension, valued by the magic-byte prefixes that identify the format.
ALLOWED_IMAGE_TYPES: dict[str, tuple[bytes, ...]] = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF87a", b"GIF89a"),
    ".webp": (b"RIFF",),  # plus a "WEBP" tag at offset 8, checked below
}

SUBDIR = "screenshots"

# Prefix on the value stored in Trade.screenshot_url. It is an internal storage
# pointer, NOT a browser-reachable URL - screenshots are served only through the
# ownership-checked route in app/routers/trades.py. The prefix is kept (rather
# than storing a bare filename) so existing rows keep working without a
# migration, and so a stray value can be recognised and refused.
STORAGE_PREFIX = "uploads"


def _sniff_extension(head: bytes) -> str | None:
    """Identify the format from the file's own bytes.

    The client-declared Content-Type is a hint, not evidence - it is trivially
    set to anything. What actually determines how a browser renders the file is
    its content, so that is what gets checked.
    """
    for ext, magics in ALLOWED_IMAGE_TYPES.items():
        if ext in (".jpeg",):
            continue  # same bytes as .jpg; canonicalize to one extension
        for magic in magics:
            if not head.startswith(magic):
                continue
            if ext == ".webp":
                # RIFF is a container; only WEBP is acceptable here.
                if len(head) >= 12 and head[8:12] == b"WEBP":
                    return ext
                continue
            return ext
    return None


def storage_root(upload_dir: str) -> Path:
    """Absolute path of the upload directory, resolved against the backend root."""
    root = Path(upload_dir)
    if not root.is_absolute():
        # backend/app/services/uploads.py -> backend/
        root = Path(__file__).resolve().parents[2] / root
    return root


def save_screenshot(file: UploadFile, upload_dir: str, max_bytes: int) -> str:
    """Persist an uploaded image and return the internal storage pointer.

    Raises HTTPException(400) for anything that isn't a supported image, and
    HTTPException(413) for anything over the size cap.
    """
    contents = file.file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Screenshot must be {max_bytes // (1024 * 1024)}MB or smaller.",
        )
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    extension = _sniff_extension(contents[:12])
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Screenshot must be a PNG, JPEG, GIF or WebP image.",
        )

    # The filename is generated, never derived from the upload. A client-supplied
    # name is attacker-controlled and is the usual way "../../etc/something"
    # escapes the upload directory.
    target_dir = storage_root(upload_dir) / SUBDIR
    target_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{extension}"
    (target_dir / name).write_bytes(contents)

    return f"/{STORAGE_PREFIX}/{SUBDIR}/{name}"


def resolve_screenshot(url: str | None, upload_dir: str) -> Path | None:
    """The on-disk file for a stored screenshot pointer, or None if unusable.

    Shares the containment check with delete_screenshot: the stored value is
    treated as untrusted, so only paths that resolve inside the upload root are
    returned. A doctored `screenshot_url` therefore can't turn the serving route
    into an arbitrary-file read.
    """
    if not url or not url.startswith(f"/{STORAGE_PREFIX}/{SUBDIR}/"):
        return None

    root = storage_root(upload_dir).resolve()
    candidate = (root / SUBDIR / Path(url).name).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


def delete_screenshot(url: str | None, upload_dir: str) -> None:
    """Best-effort removal of a previously stored screenshot.

    Never raises: a missing file shouldn't block replacing or deleting a trade.
    Only touches paths under the upload directory, so a doctored screenshot_url
    can't be used to delete something else.
    """
    if not url or not url.startswith(f"/{STORAGE_PREFIX}/{SUBDIR}/"):
        return

    root = storage_root(upload_dir).resolve()
    candidate = (root / SUBDIR / Path(url).name).resolve()
    if not candidate.is_relative_to(root):
        return
    candidate.unlink(missing_ok=True)
