"""
PUSH — the link between the extractor and the deployed app.

Without this, connecting the two halves means copying JSON into the
repo and redeploying, which makes "adding a demo is a config row"
untrue. With it, the extractor POSTs and the URL is live in seconds.

Logos go to Vercel Blob rather than public/, because anything under
public/ is baked into the build — a new logo would mean a new deploy,
which is the same problem again.
"""
from __future__ import annotations

import json
import mimetypes
import os

import requests


class PushError(Exception):
    pass


def upload_logo(path: str, slug: str, token: str | None = None) -> str:
    """Returns a public URL. Raises if it cannot, so the caller can fall
    back to a wordmark rather than emit a broken <img>."""
    token = token or os.environ.get("BLOB_READ_WRITE_TOKEN")
    if not token:
        raise PushError("BLOB_READ_WRITE_TOKEN is not set")

    ext = os.path.splitext(path)[1] or ".png"
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"

    with open(path, "rb") as fh:
        body = fh.read()

    r = requests.put(
        f"https://blob.vercel-storage.com/logos/{slug}{ext}",
        headers={
            "authorization": f"Bearer {token}",
            "x-api-version": "7",
            "x-content-type": ctype,
            # Deterministic path: re-extracting the same company
            # overwrites its logo instead of accumulating copies.
            "x-add-random-suffix": "0",
        },
        data=body,
        timeout=20,
    )
    if r.status_code >= 300:
        raise PushError(f"blob upload failed: {r.status_code} {r.text[:200]}")
    return r.json()["url"]


def push_tenant(tenant_json: dict, base_url: str, admin_token: str | None = None) -> dict:
    token = admin_token or os.environ.get("ADMIN_TOKEN")
    if not token:
        raise PushError("ADMIN_TOKEN is not set")

    # `meta` is provenance for humans; the endpoint accepts it but the
    # renderer ignores it.
    r = requests.post(
        base_url.rstrip("/") + "/api/admin/tenants",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
        },
        data=json.dumps(tenant_json),
        timeout=20,
    )
    if r.status_code == 401:
        raise PushError("Unauthorised — ADMIN_TOKEN does not match the deployment")
    if r.status_code == 409:
        raise PushError("Deployment has no DATABASE_URL, so it cannot accept writes")
    if r.status_code >= 300:
        raise PushError(f"push failed: {r.status_code} {r.text[:300]}")
    return r.json()


def bind_ghl(slug: str, base_url: str, admin_token: str | None = None, **fields) -> dict:
    token = admin_token or os.environ.get("ADMIN_TOKEN")
    if not token:
        raise PushError("ADMIN_TOKEN is not set")

    payload = {"slug": slug, **{k: v for k, v in fields.items() if v}}
    r = requests.post(
        base_url.rstrip("/") + "/api/admin/bind",
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        data=json.dumps(payload),
        timeout=20,
    )
    if r.status_code >= 300:
        raise PushError(f"bind failed: {r.status_code} {r.text[:200]}")
    return r.json()
