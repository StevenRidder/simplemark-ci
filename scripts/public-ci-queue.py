#!/usr/bin/env python3
"""Drive SimpleMark's native merge queue using only its public CI sandbox."""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CANONICAL = os.environ.get("CANONICAL_REPO", "6th-Element-Labs/simplemark")
SANDBOX = os.environ.get("CI_REPO", "StevenRidder/simplemark-ci")
CONTEXT = os.environ.get("STATUS_CONTEXT", "simplemark-ci/full-suite")
ORIGIN = os.environ.get("ORIGIN_REMOTE", "origin")
TIMEOUT = int(os.environ.get("WAIT_TIMEOUT_SEC", "3600"))
POLL = int(os.environ.get("POLL_INTERVAL_SEC", "20"))


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def api(path, *args):
    output = command("gh", "api", path, *args)
    return json.loads(output) if output else None


def status(sha, state, description, target):
    api(f"repos/{CANONICAL}/statuses/{sha}", "-f", f"state={state}",
        "-f", f"context={CONTEXT}", "-f", f"description={description}",
        "-f", f"target_url={target}")


def latest_result(runs, sha, workflow_id, branch):
    matches = [r for r in runs if r["head_sha"] == sha
               and r["workflow_id"] == workflow_id
               and r["head_branch"] == branch
               and r["event"] == "workflow_dispatch"]
    if not matches:
        return None
    latest = max(matches, key=lambda r: r["id"])
    if latest["status"] != "completed":
        return None
    return latest


def verify_group(ref, sha, number, deadline):
    branch = f"ci/queue-pr{number}-{sha}"
    target = f"https://github.com/{SANDBOX}/actions"
    workflow = api(f"repos/{SANDBOX}/actions/workflows/verify.yml")
    command("git", "fetch", "--no-tags", ORIGIN, ref)
    if command("git", "rev-parse", "FETCH_HEAD") != sha:
        raise RuntimeError("merge group changed before mirroring; retry queue command")
    command("git", "push", f"https://github.com/{SANDBOX}.git",
            f"{sha}:refs/heads/{branch}")
    status(sha, "pending", "Public CI is verifying the exact merge-group SHA", target)
    api(f"repos/{SANDBOX}/actions/workflows/{workflow['id']}/dispatches",
        "-f", f"ref={branch}")
    print(f"Public CI: verifying merge-group {sha[:12]}", flush=True)
    while time.monotonic() < deadline:
        runs = api(f"repos/{SANDBOX}/actions/runs?event=workflow_dispatch&per_page=100")
        run = latest_result(runs["workflow_runs"], sha, workflow["id"], branch)
        if run:
            if run["conclusion"] != "success":
                status(sha, "failure", "Public merge-group verification failed", run["html_url"])
                raise RuntimeError(f"public CI {run['conclusion']}: {run['html_url']}")
            # A rebuilt queue ref needs fresh proof; never stamp its successor.
            current = command("git", "ls-remote", ORIGIN, ref).split()
            if not current or current[0] != sha:
                print("Merge group was superseded; waiting for its replacement", flush=True)
                return False
            status(sha, "success", "Full public CI passed for this exact merge-group SHA", run["html_url"])
            command("git", "push", f"https://github.com/{SANDBOX}.git", "--delete", branch)
            print(f"Public merge-group proof: {run['html_url']}", flush=True)
            return True
        time.sleep(POLL)
    raise RuntimeError("timed out waiting for public merge-group CI; no success status posted")


def queue(number):
    if api(f"repos/{SANDBOX}")["private"]:
        raise RuntimeError("CI sandbox must be public; refusing paid CI")
    pr = api(f"repos/{CANONICAL}/pulls/{number}")
    if pr["state"] != "open":
        raise RuntimeError("PR must be open")
    sha = pr["head"]["sha"]
    checks = api(f"repos/{CANONICAL}/commits/{sha}/status")["statuses"]
    proof = next((s for s in checks if s["context"] == CONTEXT), None)
    if not proof or proof["state"] != "success" or not (proof.get("target_url") or "").startswith(f"https://github.com/{SANDBOX}/actions"):
        raise RuntimeError("PR head needs successful exact-SHA public proof; run ci-sandbox.sh push/prove first")
    command("gh", "pr", "merge", str(number), "--repo", CANONICAL,
            "--squash", "--auto", "--match-head-commit", sha)
    deadline = time.monotonic() + TIMEOUT
    proven = set()
    prefix = f"refs/heads/gh-readonly-queue/{pr['base']['ref']}/"
    print(f"Queued PR #{number}; waiting for its public merge-group proof", flush=True)
    while time.monotonic() < deadline:
        current = api(f"repos/{CANONICAL}/pulls/{number}")
        if current["merged"]:
            print(f"Merged: {current['html_url']}", flush=True)
            return
        if current["state"] != "open" or current["head"]["sha"] != sha:
            raise RuntimeError("PR closed or head changed; fresh head proof is required")
        for line in command("git", "ls-remote", ORIGIN, f"{prefix}*").splitlines():
            group_sha, ref = line.split()
            if not re.search(rf"/pr-{number}-", ref) or group_sha in proven:
                continue
            if verify_group(ref, group_sha, number, deadline):
                proven.add(group_sha)
        time.sleep(POLL)
    raise RuntimeError("timed out waiting for merge queue; private CI remains disabled")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or not sys.argv[1].isdigit():
            raise RuntimeError("usage: scripts/ci-sandbox.sh queue <PR-number>")
        queue(int(sys.argv[1]))
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"public-ci-queue: {error}", file=sys.stderr)
        sys.exit(1)
