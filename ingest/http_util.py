"""HTTP via curl, with retry.

Why curl and not urllib: macOS's system Python ships without a CA bundle, so
urllib fails TLS verification out of the box, and the whole point of this
pipeline is "clone it and run it" with no pip installs. curl is present on
every macOS and nearly every Linux box.

Why retry: the largest pulls (16 months of query x page) occasionally time
out or come back 5xx. One blip used to fail the whole step, and the daily run
would then analyze yesterday's files and write a log entry that looked fine.
"""
import json
import subprocess
import sys
import time

# curl exits worth another try: 6/7 resolve+connect, 28 timeout,
# 35 TLS handshake, 52 empty reply, 56 recv error.
RETRYABLE_EXITS = {6, 7, 28, 35, 52, 56}
TIMEOUT = 180
ATTEMPTS = 4


def curl_json(args, *, timeout=TIMEOUT, attempts=ATTEMPTS, label=""):
    """Run curl with `args`, parse JSON, retry transient failures.

    Raises RuntimeError once the attempts are spent, so the calling step
    fails loudly rather than returning partial data.
    """
    last = None
    for attempt in range(1, attempts + 1):
        p = subprocess.run(["curl", "-s", "--max-time", str(timeout), *args],
                           capture_output=True, text=True)
        if p.returncode == 0:
            try:
                data = json.loads(p.stdout)
            except json.JSONDecodeError as exc:
                last = f"unparseable response ({exc})"
            else:
                err = data.get("error") if isinstance(data, dict) else None
                # 5xx and 429 are the server's problem and worth retrying;
                # 4xx means the request is wrong and retrying won't fix it.
                code = int(err.get("code", 0)) if isinstance(err, dict) else 0
                if code >= 500 or code == 429:
                    last = f"HTTP {code} {str(err.get('message', ''))[:80]}"
                else:
                    return data
        elif p.returncode in RETRYABLE_EXITS:
            last = f"curl exit {p.returncode}"
        else:
            raise RuntimeError(f"curl exit {p.returncode}: {p.stderr.strip()[:200]}")
        if attempt < attempts:
            delay = 2 ** attempt  # 2s, 4s, 8s
            print(f"  retry {attempt}/{attempts - 1} {label}: {last}; sleeping {delay}s",
                  file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"{label or 'request'} failed after {attempts} attempts: {last}")


def get_json(url, token=None, *, label=""):
    args = []
    if token:
        args += ["-H", f"Authorization: Bearer {token}"]
    return curl_json([*args, url], label=label or url[-60:])


def post_json(url, body, token=None, *, label=""):
    args = ["-X", "POST", "-H", "Content-Type: application/json"]
    if token:
        args += ["-H", f"Authorization: Bearer {token}"]
    return curl_json([*args, "-d", json.dumps(body), url], label=label or url[-60:])


def fetch_text(url, *, timeout=15, ua="Mozilla/5.0 (compatible; n-seo/0.1)", follow=True,
               byte_range=None):
    """Plain page fetch → (status, body). status is None when curl itself failed."""
    cmd = ["curl", "-s", "-A", ua, "--max-time", str(timeout), "-w", "\n%{http_code}"]
    if follow:
        cmd.append("-L")
    if byte_range:
        cmd += ["-r", byte_range]
    try:
        p = subprocess.run([*cmd, url], capture_output=True, text=True, timeout=timeout + 5)
    except subprocess.TimeoutExpired:
        return None, ""
    body, _, code = p.stdout.rpartition("\n")
    return (int(code) if code.isdigit() else None), body
